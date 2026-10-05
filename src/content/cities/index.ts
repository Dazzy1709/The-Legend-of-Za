// src/content/cities/index.ts
// Every city in the game. To add one: create content/cities/<id>/ with
// its placements and an index.ts exporting a CityDefinition, then list it
// here.

import type { CityDefinition } from "./cityTypes";
import { KUSHTAR } from "./kushtar";

export const CITIES: Record<string, CityDefinition> = {
  [KUSHTAR.id]: KUSHTAR,
};

/** The city a new game starts in. */
export const STARTING_CITY_ID = KUSHTAR.id;

export function getCity(id: string): CityDefinition {
  const city = CITIES[id];
  if (!city) throw new Error(`Unknown city "${id}"`);
  return city;
}
