// src/babylon/combat/CombatManager.ts
// The single, centralized damage-processing path every attack in the
// game goes through — spec section 3/34: "All damage calculations
// should go through a centralized damage system rather than individual
// attacks directly modifying health." Nothing outside this file ever
// mutates a combatant's health directly.

import { Vector3 } from "@babylonjs/core";
import { EventBridge } from "../core/EventBridge";
import { mitigateDamage } from "../progression/Progression";
import type { WeaponKind } from "../../types";

/**
 * The minimal shape CombatManager needs from anything that can deal or
 * receive damage — the player and every Enemy instance both implement
 * this, rather than CombatManager depending on either concrete class
 * directly (spec section 39: Combat Manager is its own module, not
 * fused into the player or enemy code).
 */
export interface Combatant {
  readonly id: string;
  /** True only for actual hostile Enemy instances. Friendly/neutral NPCs, the crowd, and the player itself are never isEnemy — spec section 3's "must never accidentally damage friendly/neutral NPCs" is enforced structurally here: nothing that isn't isEnemy can ever be a valid target of a player attack, because it was never given this flag, not because of a per-attack allowlist that could be gotten wrong. */
  readonly isEnemy: boolean;
  isDead(): boolean;
  isInvulnerable(): boolean;
  getPosition(): Vector3;
  getCurrentHealth(): number;
  getMaxHealth(): number;
  /** Character level (1-100) — reported with kills, for kill XP. */
  getLevel(): number;
  /** The defense stat — scales down every hit this combatant takes (see Progression.mitigateDamage). */
  getDefense(): number;
  /** Called only by CombatManager, only after full validation — mutates this combatant's own stored health and returns the actual amount applied (health cannot go below 0, so this can be less than requested for a killing blow). */
  receiveDamage(amount: number): number;
}

interface AttackInstance {
  /** Every target this specific swing/attack has already hit — spec section 5/27/33: a target can only be damaged once per attack instance, even if collision detection stays active across several frames. */
  hitTargets: Set<string>;
}

let nextAttackInstanceId = 1;

export class CombatManager {
  private attackInstances = new Map<string, AttackInstance>();

  constructor(private bridge: EventBridge) {}

  /** Call once per new swing/attack (player or enemy) before any damage from it is applied — returns the ID to pass into applyDamage for every hit this same swing lands. */
  beginAttackInstance(): string {
    const id = `atk-${nextAttackInstanceId++}`;
    this.attackInstances.set(id, { hitTargets: new Set() });
    return id;
  }

  /** Call once the attack's damage window has fully closed — frees the bookkeeping for that instance. Not strictly required for correctness (a finished instance just never gets more hits added to it), but keeps the map from growing unbounded over a long play session. */
  endAttackInstance(attackInstanceId: string) {
    this.attackInstances.delete(attackInstanceId);
  }

  /**
   * The one and only path to damaging a combatant — spec section 5's
   * ten-step validation list, and section 33's target-validation list,
   * both happen here, every time, for every attack (player or enemy),
   * rather than each attack site re-implementing its own subset of
   * these checks.
   */
  /**
   * `rawDamage` is the attacker's strength plus its weapon's damage (times
   * any per-attack multiplier) — the target's defense is applied here, so
   * every hit in the game is reduced the same way. `weapon` is what the
   * attack was made with (null = unarmed/enemy), reported with kills.
   */
  applyDamage(source: Combatant, target: Combatant, rawDamage: number, attackInstanceId: string, weapon: WeaponKind | null = null): boolean {
    if (source.isDead()) return false; // an attacker that died mid-swing (e.g. killed by something else) can't still land its own hit
    if (target.isDead()) return false;
    if (target.isInvulnerable()) return false;
    // The core "never accidentally damage a friendly" rule (spec section
    // 3): a non-enemy source (the player) can only ever damage an enemy
    // target, and an enemy source can only ever damage the one non-enemy
    // combatant that matters here, the player.
    if (source.isEnemy === target.isEnemy) return false;

    const instance = this.attackInstances.get(attackInstanceId);
    if (!instance) return false; // beginAttackInstance was never called, or endAttackInstance already closed it out
    if (instance.hitTargets.has(target.id)) return false; // this exact swing already hit this exact target once
    instance.hitTargets.add(target.id);

    // This is the single most central point every attack in the game
    // passes through — a thrown error here, previously uncaught, would
    // propagate straight out to whichever loop called applyDamage (an
    // unguarded forEach over several targets, or an enemy's own per-
    // frame update), aborting everything after it in that same loop.
    // target.receiveDamage() alone can cascade into a death-state
    // transition, an animation play call, a health-bar update, and
    // event emissions below — any one of those failing must not corrupt
    // this call's own bookkeeping (the hitTargets tracking above has
    // already happened and stays correct either way) or crash the
    // caller. applyDamage's own signature promises a boolean, never an
    // exception; this makes that promise actually hold.
    try {
      const actualAmount = target.receiveDamage(mitigateDamage(rawDamage, target.getDefense()));
      const isFinalBlow = target.isDead();

      if (target.isEnemy) {
        this.bridge.emit("enemyDamaged", {
          enemyId: target.id,
          amount: actualAmount,
          position: { x: target.getPosition().x, z: target.getPosition().z },
          isFinalBlow,
        });
        if (isFinalBlow) {
          this.bridge.emit("enemyDied", { enemyId: target.id, level: target.getLevel(), killedByPlayer: !source.isEnemy, weapon });
        }
      } else {
        this.bridge.emit("playerHealthChanged", { current: target.getCurrentHealth(), max: target.getMaxHealth() });
        // applyDamage only ever runs for actual damage — healing
        // (PlayerController.heal()) is a separate path that never goes
        // through here — so this is always genuine damage, safe to
        // emit unconditionally whenever this branch (the player is the
        // target) runs.
        this.bridge.emit("playerDamaged", { amount: actualAmount });
        if (isFinalBlow) this.bridge.emit("playerDied", undefined);
      }
    } catch (err) {
      console.error(`applyDamage: receiveDamage/event-emission threw for target "${target.id}" — damage bookkeeping stays consistent, caller unaffected:`, err);
    }

    return true;
  }

  /**
   * Finds every valid enemy target within a radius and a forward-facing
   * arc of an attack origin — the shared geometry query both the
   * player's melee swings and (symmetrically) enemy attacks against the
   * player are built from, so the "radius + direction + arc, not a
   * 360-degree field" rule (spec section 6) lives in exactly one place.
   */
  findTargetsInArc(
    origin: Vector3,
    facingYaw: number,
    radius: number,
    arcHalfAngle: number,
    candidates: Combatant[],
    excludeIsEnemy: boolean
  ): Combatant[] {
    const forward = new Vector3(Math.sin(facingYaw), 0, Math.cos(facingYaw));
    // Diagnostic-only bookkeeping — every candidate this call actually
    // considered (not dead, not the wrong side), and why each one that
    // didn't make it was rejected. Logged below only when it looks
    // suspicious (something was nearby but nothing qualified), not on
    // every call — this is meant to catch the next occurrence of
    // "attacks stop landing" and say exactly why, rather than adding
    // more blind hardening.
    const rejections: string[] = [];
    let consideredCount = 0;

    const result = candidates.filter((c) => {
      if (c.isDead() || c.isEnemy === excludeIsEnemy) return false;
      consideredCount++;
      const toTarget = c.getPosition().subtract(origin);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > radius || dist < 0.001) {
        if (dist < radius * 2.5) rejections.push(`${c.id}: dist=${dist.toFixed(2)} (radius=${radius})`);
        return false;
      }
      // Clamped before acos — Vector3.Dot of two normalized vectors can
      // drift fractionally past 1.0 from ordinary floating-point
      // imprecision (most likely exactly when a target sits nearly
      // straight ahead, i.e. the single most common attacking
      // scenario). Math.acos of anything outside [-1, 1] returns NaN in
      // JS, and NaN <= arcHalfAngle is always false — so an unclamped
      // dot product here meant a target could silently fail this check
      // and never be found as a valid target again, with no error
      // thrown anywhere to catch. This was the actual cause of attacks
      // seeming to stop landing.
      const dot = Math.max(-1, Math.min(1, Vector3.Dot(forward.normalize(), toTarget.normalize())));
      const angle = Math.acos(dot);
      const withinArc = angle <= arcHalfAngle;
      if (!withinArc) {
        rejections.push(`${c.id}: dist=${dist.toFixed(2)} OK, angle=${((angle * 180) / Math.PI).toFixed(0)}deg (max=${((arcHalfAngle * 180) / Math.PI).toFixed(0)}deg) facingYaw=${facingYaw.toFixed(2)}`);
      }
      return withinArc;
    });

    // Only logs when it actually looks like a miss worth explaining —
    // at least one live, correct-side candidate existed nearby and
    // still nothing qualified. An ordinary empty swing at open air
    // never reaches this (rejections stays empty in that case, since
    // nothing was close enough to be worth recording), so this won't
    // spam the console during normal play the way the earlier
    // finger-bone warnings did.
    if (result.length === 0 && rejections.length > 0) {
      console.warn(`findTargetsInArc: 0 hits despite ${consideredCount} live candidate(s) nearby. facingYaw=${facingYaw.toFixed(2)}, radius=${radius}, arcHalfAngle=${((arcHalfAngle * 180) / Math.PI).toFixed(0)}deg. Rejections:\n  ${rejections.join("\n  ")}`);
    }

    return result;
  }
}