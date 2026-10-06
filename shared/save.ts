// shared/save.ts
// The save file: everything about a player's game that persists between
// sessions. Shared by the game (which writes and loads it) and the server
// (which stores it), so both always agree on its shape.
//
// Changing the shape: bump SAVE_VERSION and add a step to migrateSave()
// that upgrades the previous version, so older saves keep loading.
// No imports here — this file must stay usable from any runtime.

export const SAVE_VERSION = 2;

export type SavedWeaponKind = "sword" | "pickaxe" | "gun";

export interface SavedMissionProgress {
  status: "active" | "completed";
  /** Index of the current objective. */
  step: number;
  /** Progress within it (e.g. enemies defeated so far). */
  counter: number;
}

export interface SaveGame {
  version: number;
  /** ISO timestamp of when it was written. */
  savedAt: string;
  player: {
    cityId: string;
    x: number;
    z: number;
    facing: number;
    health: number;
    gold: number;
    equippedWeapon: SavedWeaponKind | null;
    /** Weapons the player has (the gun is bought at the Weapons Store). Since version 2. */
    ownedWeapons: SavedWeaponKind[];
    /** Where the player comes back after dying — the last safe house they rested at. */
    respawn: { x: number; z: number };
  };
  progression: {
    level: number;
    xp: number;
    weapons: Partial<Record<SavedWeaponKind, { level: number; xp: number }>>;
  };
  inventory: { itemId: string; quantity: number }[];
  story: {
    activeMissionId: string | null;
    missions: Record<string, SavedMissionProgress>;
    /** One-off facts the story has recorded ("met-snoop", ...). */
    flags: string[];
    /** Cutscenes already watched, so they don't replay. */
    seenCutscenes: string[];
    /** Standing with people and factions. */
    reputation: Record<string, number>;
  };
  /** Where each vehicle was left. */
  vehicles: Record<string, { x: number; z: number; yaw: number }>;
  world: {
    /** The world clock (seconds), which sets the time of day. */
    clock: number;
  };
  stats: {
    playTimeSeconds: number;
    enemiesDefeated: number;
    deaths: number;
    coinsCollected: number;
  };
}

/** A short description for menus ("Level 4 · The Debt · 2 min ago"). */
export interface SaveSummary {
  level: number;
  savedAt: string;
  activeMissionId: string | null;
  playTimeSeconds: number;
}

export function summarizeSave(save: SaveGame): SaveSummary {
  return {
    level: save.progression.level,
    savedAt: save.savedAt,
    activeMissionId: save.story.activeMissionId,
    playTimeSeconds: save.stats.playTimeSeconds,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Turns stored data into a current SaveGame — upgrading older versions —
 * or null if it isn't a save this game can read.
 */
export function migrateSave(raw: unknown): SaveGame | null {
  if (!isObject(raw) || typeof raw.version !== "number") return null;
  const save = raw as unknown as SaveGame;
  if (!isObject(save.player) || !isObject(save.progression) || !isObject(save.story)) return null;
  // 1 -> 2: weapons became owned. The gun is now bought at the Weapons Store.
  if (save.version === 1) {
    save.player.ownedWeapons = ["sword", "pickaxe"];
    if (save.player.equippedWeapon === "gun") save.player.equippedWeapon = null;
    save.version = 2;
  }
  if (save.version !== SAVE_VERSION) return null;
  const weapons: SavedWeaponKind[] = ["sword", "pickaxe", "gun"];
  if (!Array.isArray(save.player.ownedWeapons) || !save.player.ownedWeapons.every((w) => weapons.includes(w))) return null;
  return save;
}

/** Stops absurd payloads reaching storage. */
export const MAX_SAVE_BYTES = 512 * 1024;
