// src/types.ts
// Core type definitions for The Legend of Zaza gameplay layer.

import type { CharacterSkinId } from "./babylon/characters/SkeletalCharacter";

export type GameMode = "explore" | "dialogue" | "inventory" | "weaponWheel";

export type WeaponKind = "sword" | "pickaxe" | "gun";

/** The four base stats every character (player and enemy) has — see babylon/Progression.ts. */
export type StatName = "strength" | "endurance" | "cardio" | "defense";

// ---------- Player ----------

export interface PlayerState {
  name: string;
  hp: number;
  maxHp: number;
  gold: number;
  inventory: InventoryEntry[];
  reputation: Record<string, number>; // per-NPC/faction trust, e.g. { cordozar: 40, opps: -20 }
  /**
   * Ground-plane position, synced from the Babylon player mesh once per
   * frame via GameEngine -> EventBridge -> SET_POSITION. This is read-only
   * from the reducer's perspective — the source of truth for movement is
   * still the Babylon mesh, this is just a mirror for UI (HUD, minimap).
   */
  position: WorldPosition;
}

export interface InventoryEntry {
  strainId: string;
  quantity: number;
}

// ---------- Strains (items) ----------

export type StrainEffect =
  | { kind: "heal"; amount: number }
  /** A temporary boost to one base stat in the real-time game, for `seconds`. */
  | { kind: "statBuff"; stat: StatName; amount: number; seconds: number };

export interface Strain {
  id: string;
  name: string;
  description: string;
  effect: StrainEffect;
  /** Flavor color used for the item's Glow particle tint in the UI. */
  color: string;
}

// ---------- Dialogue ----------

export interface DialogueChoice {
  id: string;
  text: string;
  nextNodeId: string | null; // null ends the conversation
  reputationDelta?: { target: string; amount: number };
  questFlag?: string;
}

export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  choices: DialogueChoice[];
}

export interface DialogueTree {
  npcId: string;
  startNodeId: string;
  nodes: Record<string, DialogueNode>;
}

// ---------- 3D world (Babylon.js) ----------
// Ground-plane coordinates. Babylon's y-axis is "up", so world height is
// handled by the engine layer — placement data only needs x/z.

export interface WorldPosition {
  x: number;
  z: number;
}

export interface NPCPlacement {
  id: string;
  name: string;
  title: string;
  dialogueTreeId: string;
  position: WorldPosition;
  colorHex: string;
  /** Which character model this NPC uses — never "ninja", which is reserved for the player. */
  skin: CharacterSkinId;
  /** Optional character flourish from the story notes — not rendered on the 3D models yet. */
  accessory?: "none" | "sunglasses" | "bandana" | "crown";
}

export interface BuildingPlacement {
  id: string;
  position: WorldPosition;
  width: number;
  depth: number;
  height: number;
  colorHex: string;
  /** Which of the 6 building types to render as — omitted for hand-placed landmarks (palace, market stalls), which keep the plain generic box+roof look they've always had. Procedurally generated buildings always set this. */
  archetype?: "royal" | "church" | "village" | "shop" | "hut" | "workshop" | "barn";
  /** World-space yaw (radians) the building's own front face (door/windows/sign — always built on local +Z) should be rotated to. Omitted/undefined means the default: front face points world +Z, unrotated. Used by avenue-frontage row-houses so each one actually faces the avenue it fronts, rather than every building facing the same fixed world direction regardless of which side of which avenue it's on. */
  facingYaw?: number;
}
