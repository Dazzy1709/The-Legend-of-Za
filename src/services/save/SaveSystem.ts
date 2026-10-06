// src/services/save/SaveSystem.ts
// Builds a save from the two halves of the game's state — the engine's
// (position, levels, story, vehicles, clock, stats) and the UI's (gold,
// items, equipped weapon, reputation) — and splits a save back into the
// UI's starting state. The save's shape is shared/save.ts.

import { SAVE_VERSION, type SaveGame } from "../../../shared/save";
import type { EngineState } from "../../babylon/core/GameEngine";
import type { GameState } from "../../state/useGameState";

export function buildSave(engine: EngineState, ui: GameState): SaveGame {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    player: { ...engine.player, gold: ui.player.gold, equippedWeapon: ui.equippedWeapon, ownedWeapons: [...ui.ownedWeapons] },
    progression: engine.progression,
    inventory: ui.player.inventory.map((i) => ({ itemId: i.strainId, quantity: i.quantity })),
    story: {
      ...engine.story,
      // Flags set by conversations live in the UI state; mission flags in the engine — saved together.
      flags: [...new Set([...engine.story.flags, ...ui.questFlags])],
      reputation: { ...ui.player.reputation },
    },
    vehicles: engine.vehicles,
    world: engine.world,
    stats: engine.stats,
  };
}

/** The parts of a save the UI state starts from. */
export interface UiStartState {
  gold: number;
  equippedWeapon: GameState["equippedWeapon"];
  ownedWeapons: GameState["ownedWeapons"];
  inventory: { strainId: string; quantity: number }[];
  reputation: Record<string, number>;
  questFlags: string[];
}

export function uiStateFromSave(save: SaveGame): UiStartState {
  return {
    gold: save.player.gold,
    equippedWeapon: save.player.equippedWeapon,
    ownedWeapons: save.player.ownedWeapons,
    inventory: save.inventory.map((i) => ({ strainId: i.itemId, quantity: i.quantity })),
    reputation: save.story.reputation,
    questFlags: save.story.flags,
  };
}
