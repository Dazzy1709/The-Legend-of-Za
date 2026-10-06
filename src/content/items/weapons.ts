// src/content/items/weapons.ts
// Which weapons the player starts with, and what the Weapons Store in the
// Handelsviertel sells. A weapon on sale can wait on a story flag — it's
// shown, locked, until the story gets there.

import type { WeaponKind } from "../../types";

/** Owned from the start of a new game. */
export const STARTING_WEAPONS: WeaponKind[] = ["sword", "pickaxe"];

export interface WeaponForSale {
  kind: WeaponKind;
  name: string;
  description: string;
  price: number;
  /** Not sold until this story flag is set. */
  requiresFlag?: string;
  /** Shown while it's still locked. */
  lockedHint?: string;
}

export const WEAPON_STORE: WeaponForSale[] = [
  {
    kind: "gun",
    name: "Pistol",
    description: "A reliable sidearm. R to aim, F to fire, G to reload.",
    price: 75,
    requiresFlag: "chapter-1-complete",
    lockedHint: "The guards are watching you. Settle your debt first (finish Chapter One).",
  },
];
