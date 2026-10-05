// src/content/cities/kushtar/index.ts
// Kushtar, the walled capital — the starting city.

import type { CityDefinition } from "../cityTypes";
import { BUILDINGS, NPC_PLACEMENTS, PLAZA_SPAWN, SAFE_HOUSES } from "./placements";

export const KUSHTAR: CityDefinition = {
  id: "kushtar",
  name: "Kushtar",
  spawnPoint: PLAZA_SPAWN,
  buildings: BUILDINGS,
  npcs: NPC_PLACEMENTS,
  safeHouses: SAFE_HOUSES,
};
