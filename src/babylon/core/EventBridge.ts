// src/babylon/core/EventBridge.ts
// A tiny typed pub/sub so the Babylon layer (imperative, runs every frame)
// and the React layer (declarative, renders on state change) can talk
// without either one depending on the other's internals.

import type { WeaponKind, WorldPosition } from "../../types";
import type { InteractableKind } from "../interaction/InteractableManager";
import type { RideState } from "../vehicles/Budmobile";
import type { LevelUpEvent, ProgressionSnapshot, WeaponLevelUpEvent } from "../progression/Progression";

export interface BridgeEvents {
  npcNearby: string | null;
  npcInteract: string;
  positionChanged: WorldPosition;
  districtChanged: string;
  weaponWheelToggled: undefined;
  weaponHotkey: WeaponKind;
  aimingChanged: boolean;
  playerHealthChanged: { current: number; max: number };
  /** Fired only on genuine damage (not healing) — playerHealthChanged fires on both, so this is the clean, unambiguous signal for reactions that should only trigger on getting hit (a screen flash, a hit-reaction animation), rather than every UI having to compare against the previous value itself. */
  playerDamaged: { amount: number };
  playerDied: undefined;
  enemyDamaged: { enemyId: string; amount: number; position: WorldPosition; isFinalBlow: boolean };
  /** `killedByPlayer` with the weapon that landed the killing blow (null = unarmed), for kill XP. */
  enemyDied: { enemyId: string; level: number; killedByPlayer: boolean; weapon: WeaponKind | null };
  progressionChanged: ProgressionSnapshot;
  levelUp: LevelUpEvent;
  weaponLevelUp: WeaponLevelUpEvent;
  lockOnChanged: { enemyId: string | null };
  comboChanged: { hitIndex: number; resetting: boolean };
  goldChanged: number;
  /** A usable thing (not a person) in range — safe house door, etc. — or null. */
  interactableNearby: { id: string; label: string; action: string } | null;
  interactableUsed: { id: string; kind: InteractableKind };
  /** Fade the whole screen to black (opacity 1) or back (0) over durationMs. */
  screenFade: { opacity: number; durationMs: number };
  /** Rested at a safe house: health is back to full. */
  safeHouseRested: { name: string };
  /** Back on their feet after dying — the death screen can go. */
  playerRespawned: undefined;
  /** A cutscene started or ended: the HUD hides while one plays. */
  cutsceneChanged: { id: string | null; active: boolean; letterbox: boolean; skippable: boolean };
  /** The Budmobile: parked, being hopped on/off, or ridden — and whether the rider may hop off right now. */
  rideChanged: { state: RideState; canDismount: boolean };
}

type Listener<K extends keyof BridgeEvents> = (payload: BridgeEvents[K]) => void;

export class EventBridge {
  private listeners: { [K in keyof BridgeEvents]?: Listener<K>[] } = {};

  on<K extends keyof BridgeEvents>(event: K, listener: Listener<K>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [] as Listener<K>[] as (typeof this.listeners)[K];
    }
    (this.listeners[event] as Listener<K>[]).push(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof BridgeEvents>(event: K, listener: Listener<K>) {
    const list = this.listeners[event] as Listener<K>[] | undefined;
    if (!list) return;
    (this.listeners[event] as Listener<K>[]) = list.filter((l) => l !== listener);
  }

  emit<K extends keyof BridgeEvents>(event: K, payload: BridgeEvents[K]) {
    const list = this.listeners[event] as Listener<K>[] | undefined;
    list?.forEach((l) => l(payload));
  }
}