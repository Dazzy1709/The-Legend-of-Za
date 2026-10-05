// src/babylon/world/Districts.ts
// Kushtar's four Bezirke. Unlike the old compass-wedge layout, the
// Adelsviertel is now a RING that fully surrounds the plaza (any point
// within ADEL_RING_OUTER_RADIUS of the center, at any bearing) — the
// royal seat and its immediate neighborhood sit right around the city's
// heart, with the palace itself just inside that ring. The other three
// Bezirke fill the area beyond the ring, split into three ~120° wedges by
// bearing, same mechanism the old system used for all four.
//
// This is the single source of truth for "which district is this point
// in" — CityBuilder uses it to pick a building's palette/roof/archetype
// mix and to tint streets/sidewalks, and DistrictTracker uses the same
// function to announce district crossings to the player.

import { Color3 } from "@babylonjs/core";

/**
 * The six building types CityBuilder can place. Each district leans
 * heavily on 1-2 of these (its own character) with a smaller share of the
 * others, so every Bezirk still has "a bit of everything" rather than
 * being visually monotonous.
 */
export type BuildingArchetype = "royal" | "church" | "village" | "shop" | "hut" | "workshop" | "barn";

export interface DistrictDef {
  id: string;
  name: string;
  /** Bearing this district's outer wedge is centered on (0=north/+z, 90=east/+x, etc). Meaningless for the Adelsviertel ring itself — it has no single bearing — but harmless to keep populated for type consistency. */
  bearingDeg: number;
  palette: string[];
  heightBase: number;
  heightRange: number;
  /** Roof pyramid tessellation — 4 = square pyramid, 6 = hexagonal spire. A cheap but visible style knob. */
  roofTessellation: number;
  /** Probability a given window is lit in createFacadePair — higher reads as busier/more commercial. */
  windowLitChance: number;
  pavementTint: Color3;
  /** Relative weight per archetype — doesn't need to sum to 1, pickArchetype normalizes. */
  archetypeWeights: Partial<Record<BuildingArchetype, number>>;
  /** false = buildings stand in the regular, symmetric street-grid lots (Adelsviertel only — the other symmetric case, main-avenue frontage, is handled directly in CityBuilder regardless of district). true = an organic, jittered scatter instead — small irregular clusters rather than one building per grid cell. */
  organic: boolean;
}

/** Any point within this radius of the plaza is Adelsviertel, at any bearing — a full ring, not a wedge. */
export const ADEL_RING_OUTER_RADIUS = 40; // was 55 — brings the three outer Bezirke noticeably closer to the plaza/each other, "feel a bit more closer and tighter together"

export const DISTRICTS: DistrictDef[] = [
  {
    id: "noble",
    name: "Adelsviertel",
    bearingDeg: 0, // unused for ring placement — see ADEL_RING_OUTER_RADIUS
    palette: ["#8a8a94", "#6f6f7a", "#7d7d88", "#5c5c66"],
    heightBase: 6.2, // noticeably taller than the outer districts — the noble quarter should read as grander even from a distance
    heightRange: 4.2,
    roofTessellation: 6,
    windowLitChance: 0.32,
    pavementTint: new Color3(0.88, 0.9, 0.96),
    archetypeWeights: { royal: 0.92, church: 0.04, village: 0.04 }, // "every house is a multi-story building block": royal's tiered-block shape stands in for that, at 90-95%; the true 5-10% "royal buildings" distinction (luxury Stone Tile Wall/Roof Slates 03 vs standard Stone Wall 05/Gray Roof 01) is a material-level roll in CityBuilder.buildOne, not an archetype split — see ADEL_LUXURY_CHANCE
    organic: false,
  },
  {
    id: "trade",
    name: "Handelsviertel",
    bearingDeg: 60,
    palette: ["#a8763e", "#c98a4b", "#95765a", "#b98a4f"],
    heightBase: 3.0,
    heightRange: 2.0,
    roofTessellation: 4,
    windowLitChance: 0.62,
    pavementTint: new Color3(0.98, 0.85, 0.62),
    archetypeWeights: { shop: 0.8, village: 0.2 }, // 80% shops / 20% houses, per request
    organic: true,
  },
  {
    id: "craft",
    name: "Handwerksviertel",
    bearingDeg: 180,
    palette: ["#7a5a4a", "#6a4f42", "#8a6a52", "#5c4a3d"],
    heightBase: 2.4,
    heightRange: 1.2,
    roofTessellation: 4,
    windowLitChance: 0.42,
    pavementTint: new Color3(0.85, 0.76, 0.66),
    archetypeWeights: { workshop: 0.6, village: 0.25, hut: 0.15 },
    organic: true,
  },
  {
    id: "farm",
    name: "Bauernviertel",
    bearingDeg: 300,
    palette: ["#6b7a4e", "#5c6b46", "#7a8a5a", "#59683f"],
    heightBase: 3.4, // scaled up from 2 — "every house should be bigger than the average house, like a farm"; see FARM_SIZE_SCALE in CityBuilder for the matching width/depth scale-up
    heightRange: 1.6,
    roofTessellation: 4,
    windowLitChance: 0.22,
    pavementTint: new Color3(0.78, 0.9, 0.8),
    archetypeWeights: { hut: 0.4, village: 0.4, barn: 0.2 }, // 80% houses (hut+village) / 20% barns, per request
    organic: true,
  },
];

const OUTER_DISTRICTS = DISTRICTS.slice(1); // everything but the Adelsviertel ring

/** Bearing in degrees, 0-360, where 0 = north (+z) and 90 = east (+x) — matches the DISTRICTS above. */
export function bearingDeg(x: number, z: number): number {
  let deg = (Math.atan2(x, z) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The nearest of the three outer (non-Adelsviertel) districts by bearing, ignoring ring radius entirely. */
function nearestOuterDistrict(x: number, z: number): DistrictDef {
  const b = bearingDeg(x, z);
  let best = OUTER_DISTRICTS[0];
  let bestDiff = Infinity;
  for (const d of OUTER_DISTRICTS) {
    const diff = angleDiffDeg(b, d.bearingDeg);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

/** The single district this point belongs to — Adelsviertel if within the ring, otherwise whichever outer wedge's bearing it's closest to. */
export function nearestDistrict(x: number, z: number): DistrictDef {
  if (Math.hypot(x, z) <= ADEL_RING_OUTER_RADIUS) return DISTRICTS[0];
  return nearestOuterDistrict(x, z);
}

/**
 * A smooth blend of pavement tints — used for street/sidewalk vertex
 * coloring so a road crossing between Bezirke shades gradually rather
 * than snapping at a hard seam. Two blend axes now instead of one: near
 * the Adelsviertel ring's own boundary, radial distance blends the ring's
 * tint against the outer-district blend; among the three outer districts
 * themselves, angular closeness blends between them exactly as it always
 * did.
 */
export function blendedPavementTint(x: number, z: number): Color3 {
  const dist = Math.hypot(x, z);

  // Angular blend among the three outer districts (unchanged mechanism).
  const b = bearingDeg(x, z);
  let r = 0;
  let g = 0;
  let bl = 0;
  let totalWeight = 0;
  for (const d of OUTER_DISTRICTS) {
    const diff = angleDiffDeg(b, d.bearingDeg);
    const weight = Math.max(0, Math.cos((diff * Math.PI) / 180));
    r += d.pavementTint.r * weight;
    g += d.pavementTint.g * weight;
    bl += d.pavementTint.b * weight;
    totalWeight += weight;
  }
  const outerBlend =
    totalWeight > 0 ? new Color3(r / totalWeight, g / totalWeight, bl / totalWeight) : new Color3(0.7, 0.7, 0.7);

  // Radial blend of the ring against that outer blend, over an 8-unit
  // transition band centered on the ring boundary.
  const transitionBand = 8;
  const ringWeight = Math.max(
    0,
    Math.min(1, (ADEL_RING_OUTER_RADIUS + transitionBand / 2 - dist) / transitionBand)
  );
  const adel = DISTRICTS[0].pavementTint;
  return new Color3(
    adel.r * ringWeight + outerBlend.r * (1 - ringWeight),
    adel.g * ringWeight + outerBlend.g * (1 - ringWeight),
    adel.b * ringWeight + outerBlend.b * (1 - ringWeight)
  );
}

/** Picks one archetype for a district, weighted by its archetypeWeights, using a 0-1 seed value the caller already has (keeps building placement fully deterministic). */
export function pickArchetype(district: DistrictDef, seed01: number): BuildingArchetype {
  const entries = Object.entries(district.archetypeWeights) as [BuildingArchetype, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let cursor = seed01 * total;
  for (const [archetype, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return archetype;
  }
  return entries[entries.length - 1][0];
}