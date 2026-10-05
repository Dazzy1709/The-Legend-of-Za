// src/content/cities/cityTypes.ts
// The shape every city is described with. One folder per city under
// content/cities/<id>/, registered in content/cities/index.ts.

import type { BuildingPlacement, NPCPlacement, WorldPosition } from "../../types";

/** A house that belongs to the player: interact at its door to rest (full health). */
export interface SafeHousePlacement {
  id: string;
  name: string;
  /** The building — also listed in the city's buildings, so nothing else is generated on top of it. */
  building: BuildingPlacement;
  /** Where the player stands to interact (just outside the door). */
  door: WorldPosition;
  /** The house's grounds (yard included) — kept free of generated buildings. */
  property: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Where the player's vehicle is parked at the start: a spot on the property, and the way it faces. */
  parking: WorldPosition & { yaw: number };
}

export interface CityDefinition {
  id: string;
  name: string;
  /** Where the player starts, and respawns until they've saved somewhere. */
  spawnPoint: WorldPosition;
  buildings: BuildingPlacement[];
  npcs: NPCPlacement[];
  safeHouses: SafeHousePlacement[];
}
