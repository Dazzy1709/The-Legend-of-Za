// src/content/items/strains.ts
// Items (strains): what each one does and what the shop charges for it.
// Add a new item here, plus its icon style in components/shared/ItemIcon.tsx.

import type { Strain } from "../../types";

// ---------- Strains ----------
// Named, lore-consistent items rather than generic potions.

export const STRAINS: Record<string, Strain> = {
  indica: {
    id: "indica",
    name: "Indica Leaf",
    description:
      "The legendary calming plant said to have healed soldiers' wounds in wartime.",
    effect: { kind: "heal", amount: 25 },
    color: "emerald",
  },
  sativa: {
    id: "sativa",
    name: "Sativa Bud",
    description: "Bright and quick-acting. A small, fast mend rather than a deep one.",
    effect: { kind: "heal", amount: 15 },
    color: "lime",
  },
  ogKush: {
    id: "ogKush",
    name: "OG Kush Leaf",
    description: "Rare, deeply rooted stock. The strongest mend money can grow.",
    effect: { kind: "heal", amount: 40 },
    color: "amber",
  },
  blueDream: {
    id: "blueDream",
    name: "Blue Dream Leaf",
    description: "Sweet-scented and even-tempered. A steady, reliable mend.",
    effect: { kind: "heal", amount: 20 },
    color: "sky",
  },
  northernLights: {
    id: "northernLights",
    name: "Northern Lights Leaf",
    description: "Grown far from the city, under a sky that never quite goes dark.",
    effect: { kind: "heal", amount: 22 },
    color: "cyan",
  },
  vapePen: {
    id: "vapePen",
    name: "Vape Pen",
    description: "A quick draw, filtered and clean. Faster than chewing a leaf, if a little less deep.",
    effect: { kind: "heal", amount: 18 },
    color: "slate",
  },
  hash: {
    id: "hash",
    name: "Hash",
    description: "Pressed and concentrated. Hits harder than any raw leaf on its own.",
    effect: { kind: "heal", amount: 35 },
    color: "orange",
  },
  wax: {
    id: "wax",
    name: "Wax",
    description: "The most refined form the Apothecary sells. Not cheap, and not subtle either.",
    effect: { kind: "heal", amount: 50 },
    color: "yellow",
  },
  kush: {
    id: "kush",
    name: "Kushtar Kush",
    description: "Grown on the palace hillside. Steadies the hand and the nerve. (+6 Defense, 60s)",
    effect: { kind: "statBuff", stat: "defense", amount: 6, seconds: 60 },
    color: "amber",
  },
  // Temporary stat boosts for the real-time game (see Progression.ts buffs).
  gorillaGlue: {
    id: "gorillaGlue",
    name: "Gorilla Glue",
    description: "Sticky, heavy and strong. Puts real weight behind every blow for a while. (+10 Strength, 90s)",
    effect: { kind: "statBuff", stat: "strength", amount: 10, seconds: 90 },
    color: "stone",
  },
  whiteWidow: {
    id: "whiteWidow",
    name: "White Widow",
    description: "Frosted white and calming. Hits glance off you for a while. (+12 Defense, 90s)",
    effect: { kind: "statBuff", stat: "defense", amount: 12, seconds: 90 },
    color: "slate",
  },
  durbanPoison: {
    id: "durbanPoison",
    name: "Durban Poison",
    description: "A sharp, energizing sativa. Run longer before your lungs give out. (+15 Cardio, 120s)",
    effect: { kind: "statBuff", stat: "cardio", amount: 15, seconds: 120 },
    color: "lime",
  },
  granddaddyPurple: {
    id: "granddaddyPurple",
    name: "Granddaddy Purple",
    description: "Deep purple and deeply soothing. Your body takes more punishment for a while. (+12 Endurance, 90s)",
    effect: { kind: "statBuff", stat: "endurance", amount: 12, seconds: 90 },
    color: "violet",
  },
  haze: {
    id: "haze",
    name: "Wild Haze",
    description: "Sharp-scented and wild. Hits land harder for a little while. (+6 Strength, 60s)",
    effect: { kind: "statBuff", stat: "strength", amount: 6, seconds: 60 },
    color: "lime",
  },
};

// Gold cost to buy one of a strain at the healing shop — only the three
// heal-effect strains are actually sold there (see HEALING_LEAF_IDS in
// HUD.tsx), priced roughly in proportion to how much each one heals.
export const STRAIN_PRICES: Record<string, number> = {
  indica: 15,
  sativa: 8,
  ogKush: 30,
  blueDream: 18,
  northernLights: 20,
  vapePen: 14,
  hash: 28,
  wax: 45,
  gorillaGlue: 50,
  whiteWidow: 50,
  durbanPoison: 40,
  granddaddyPurple: 55,
};
