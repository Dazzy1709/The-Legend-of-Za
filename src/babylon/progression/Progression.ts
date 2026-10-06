// src/babylon/progression/Progression.ts
// The leveling system: character levels (1-100), weapon levels (1-99),
// the four base stats, XP, and temporary stat buffs. The math is plain
// functions shared by the player and every enemy; ProgressionSystem holds
// the player's own state and tells React about changes over the bridge.

import type { StatName, WeaponKind } from "../../types";
import { EventBridge } from "../core/EventBridge";
import { getGunConfig } from "../combat/CombatConfig";

export const MAX_CHARACTER_LEVEL = 100;
export const MAX_WEAPON_LEVEL = 99;
export const STAT_NAMES: StatName[] = ["strength", "endurance", "cardio", "defense"];

/** How many levels above the player an enemy is — each one rolls a value in this range. */
export const ENEMY_LEVEL_ABOVE = { min: 1, max: 2 };

// ---------- Stats ----------

export type Stats = Record<StatName, number>;

/** Every stat is 15 at level 1 and 99 at level 100, rising evenly in between. */
export function statForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, level));
  return Math.round(15 + ((clamped - 1) * (99 - 15)) / (MAX_CHARACTER_LEVEL - 1));
}

export function statsForLevel(level: number): Stats {
  const v = statForLevel(level);
  return { strength: v, endurance: v, cardio: v, defense: v };
}

/** Endurance -> max health: 120 at level 1, 792 at level 100. */
export function maxHealthForEndurance(endurance: number): number {
  return Math.round(endurance * 8);
}

/** Cardio -> how many seconds of sprinting a full stamina bar holds: ~8s at level 1, ~21s at level 100. */
export function sprintSecondsForCardio(cardio: number): number {
  return 6 + cardio * 0.15;
}

// ---------- XP ----------

/** XP needed to go from `level` to the next one — the same curve for characters and weapons. */
export function xpToNextLevel(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5));
}

/** XP for killing an enemy of the given level — by far the biggest XP source. */
export function killXp(enemyLevel: number): number {
  return 20 + 8 * enemyLevel;
}

/** XP for a shop purchase: half the price. */
export function purchaseXp(price: number): number {
  return Math.max(1, Math.round(price / 2));
}

/** XP for finishing a conversation — deliberately tiny. */
export const INTERACTION_XP = 5;
/** Seconds before talking to the same person again gives XP again. */
const INTERACTION_XP_COOLDOWN = 120;

// ---------- Weapons & damage ----------

/** A weapon's own base damage at a level: melee 10 -> 300, guns 5 -> 150, over levels 1-99. */
export function weaponDamageForLevel(kind: WeaponKind, level: number): number {
  const clamped = Math.max(1, Math.min(MAX_WEAPON_LEVEL, level));
  const t = (clamped - 1) / (MAX_WEAPON_LEVEL - 1);
  const [min, max] = getGunConfig(kind) ? [5, 150] : [10, 300];
  return Math.round(min + t * (max - min));
}

/**
 * Damage after the target's defense. Defense works like armor in League of
 * Legends: it never blocks a hit outright, it scales it down —
 * 100 / (100 + defense), so 15 defense takes ~13% off, 99 takes ~50% off.
 */
export function mitigateDamage(raw: number, defense: number): number {
  return Math.max(1, Math.round((raw * 100) / (100 + Math.max(0, defense))));
}

// ---------- Player progression ----------

export interface StatBuff {
  stat: StatName;
  amount: number;
  /** Seconds left. */
  remaining: number;
  /** For the HUD — the item that granted it. */
  source: string;
}

export interface WeaponProgress {
  level: number;
  xp: number;
  xpToNext: number;
  damage: number;
}

export interface ProgressionSnapshot {
  level: number;
  xp: number;
  /** XP needed for the next level (0 at max level). */
  xpToNext: number;
  baseStats: Stats;
  /** Base stats plus active buffs — what's actually used. */
  stats: Stats;
  buffs: StatBuff[];
  weapons: Record<WeaponKind, WeaponProgress>;
}

export interface LevelUpEvent {
  level: number;
  changes: { stat: StatName; from: number; to: number }[];
  maxHealthFrom: number;
  maxHealthTo: number;
}

export interface WeaponLevelUpEvent {
  weapon: WeaponKind;
  level: number;
  damageFrom: number;
  damageTo: number;
}

const WEAPON_KINDS: WeaponKind[] = ["sword", "pickaxe", "gun"];

export class ProgressionSystem {
  private level = 1;
  private xp = 0;
  private weapons = new Map<WeaponKind, { level: number; xp: number }>(WEAPON_KINDS.map((k) => [k, { level: 1, xp: 0 }]));
  private buffs: StatBuff[] = [];
  private lastInteractionXp = new Map<string, number>();
  private elapsed = 0;

  constructor(private bridge: EventBridge) {}

  getLevel(): number {
    return this.level;
  }

  getBaseStats(): Stats {
    return statsForLevel(this.level);
  }

  /** Base stats plus every active buff. */
  getStats(): Stats {
    const stats = this.getBaseStats();
    for (const b of this.buffs) stats[b.stat] += b.amount;
    return stats;
  }

  getMaxHealth(): number {
    return maxHealthForEndurance(this.getStats().endurance);
  }

  getSprintSeconds(): number {
    return sprintSecondsForCardio(this.getStats().cardio);
  }

  getWeaponLevel(kind: WeaponKind): number {
    return this.weapons.get(kind)?.level ?? 1;
  }

  getWeaponDamage(kind: WeaponKind): number {
    return weaponDamageForLevel(kind, this.getWeaponLevel(kind));
  }

  /** Adds XP to the character — and, if given, the same amount to that weapon. */
  grantXp(amount: number, weapon?: WeaponKind | null) {
    if (amount <= 0) return;
    this.addCharacterXp(amount);
    if (weapon) this.addWeaponXp(weapon, amount);
    this.emitChanged();
  }

  /** Small XP for finishing a conversation — once per person per cooldown, so it can't be farmed. */
  grantInteractionXp(npcId: string) {
    const last = this.lastInteractionXp.get(npcId);
    if (last !== undefined && this.elapsed - last < INTERACTION_XP_COOLDOWN) return;
    this.lastInteractionXp.set(npcId, this.elapsed);
    this.grantXp(INTERACTION_XP);
  }

  /** A temporary stat boost (from an item). The same item again refreshes its timer rather than stacking. */
  addBuff(stat: StatName, amount: number, seconds: number, source: string) {
    this.buffs = this.buffs.filter((b) => !(b.stat === stat && b.source === source));
    this.buffs.push({ stat, amount, remaining: seconds, source });
    this.emitChanged();
  }

  /** Call once per frame — counts buffs down. */
  update(dt: number) {
    this.elapsed += dt;
    if (this.buffs.length === 0) return;
    let expired = false;
    for (const b of this.buffs) {
      b.remaining -= dt;
      if (b.remaining <= 0) expired = true;
    }
    if (expired) {
      this.buffs = this.buffs.filter((b) => b.remaining > 0);
      this.emitChanged();
    }
  }

  getBuffs(): readonly StatBuff[] {
    return this.buffs;
  }

  /** What a save keeps: level, XP and each weapon's level and XP (buffs are temporary and aren't saved). */
  exportState(): { level: number; xp: number; weapons: Partial<Record<WeaponKind, { level: number; xp: number }>> } {
    const weapons: Partial<Record<WeaponKind, { level: number; xp: number }>> = {};
    for (const [kind, w] of this.weapons) weapons[kind] = { level: w.level, xp: w.xp };
    return { level: this.level, xp: this.xp, weapons };
  }

  /** Restores a saved state (see exportState). */
  importState(state: { level: number; xp: number; weapons: Partial<Record<WeaponKind, { level: number; xp: number }>> }) {
    this.level = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(state.level) || 1));
    this.xp = Math.max(0, state.xp || 0);
    for (const kind of WEAPON_KINDS) {
      const saved = state.weapons[kind];
      if (saved) this.weapons.set(kind, { level: Math.max(1, Math.min(MAX_WEAPON_LEVEL, Math.floor(saved.level) || 1)), xp: Math.max(0, saved.xp || 0) });
    }
    this.emitChanged();
  }

  getSnapshot(): ProgressionSnapshot {
    const weapons = {} as Record<WeaponKind, WeaponProgress>;
    for (const kind of WEAPON_KINDS) {
      const w = this.weapons.get(kind)!;
      weapons[kind] = {
        level: w.level,
        xp: w.xp,
        xpToNext: w.level >= MAX_WEAPON_LEVEL ? 0 : xpToNextLevel(w.level),
        damage: weaponDamageForLevel(kind, w.level),
      };
    }
    return {
      level: this.level,
      xp: this.xp,
      xpToNext: this.level >= MAX_CHARACTER_LEVEL ? 0 : xpToNextLevel(this.level),
      baseStats: this.getBaseStats(),
      stats: this.getStats(),
      buffs: this.buffs.map((b) => ({ ...b })),
      weapons,
    };
  }

  private addCharacterXp(amount: number) {
    if (this.level >= MAX_CHARACTER_LEVEL) return;
    this.xp += amount;
    // "Reach the XP limit for this level and then surpass it": every full
    // bar is one level, and whatever's left over carries into the next.
    while (this.level < MAX_CHARACTER_LEVEL && this.xp >= xpToNextLevel(this.level)) {
      this.xp -= xpToNextLevel(this.level);
      const before = statsForLevel(this.level);
      const maxHealthFrom = maxHealthForEndurance(before.endurance);
      this.level += 1;
      const after = statsForLevel(this.level);
      const event: LevelUpEvent = {
        level: this.level,
        changes: STAT_NAMES.map((stat) => ({ stat, from: before[stat], to: after[stat] })),
        maxHealthFrom,
        maxHealthTo: maxHealthForEndurance(after.endurance),
      };
      this.bridge.emit("levelUp", event);
    }
    if (this.level >= MAX_CHARACTER_LEVEL) this.xp = 0;
  }

  private addWeaponXp(kind: WeaponKind, amount: number) {
    const w = this.weapons.get(kind);
    if (!w || w.level >= MAX_WEAPON_LEVEL) return;
    w.xp += amount;
    while (w.level < MAX_WEAPON_LEVEL && w.xp >= xpToNextLevel(w.level)) {
      w.xp -= xpToNextLevel(w.level);
      const damageFrom = weaponDamageForLevel(kind, w.level);
      w.level += 1;
      this.bridge.emit("weaponLevelUp", { weapon: kind, level: w.level, damageFrom, damageTo: weaponDamageForLevel(kind, w.level) });
    }
    if (w.level >= MAX_WEAPON_LEVEL) w.xp = 0;
  }

  private emitChanged() {
    this.bridge.emit("progressionChanged", this.getSnapshot());
  }
}
