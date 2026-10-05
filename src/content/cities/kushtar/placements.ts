// src/content/cities/kushtar/placements.ts
// Hand-placed landmarks for the 3D world. The bulk of the city (regular
// blocks, streets/sidewalks, park squares, lamp posts) and the outskirts
// homesteads are generated procedurally by CityBuilder — this file only
// lists things that need to be *specific*: named NPCs, the palace, and
// notable market stalls/homes from the story.

import type { BuildingPlacement, NPCPlacement, WorldPosition } from "../../../types";
import type { SafeHousePlacement } from "../cityTypes";

/** The plaza center — where the player starts, and respawns after dying (until saving is added). */
export const PLAZA_SPAWN: WorldPosition = { x: 0, z: 5 };

/**
 * The player's own house, in the Adelsviertel just north-west of the
 * plaza. Its door faces the street at z = 25 (facingYaw = PI turns the
 * front to -Z); `door` is the spot on the sidewalk in front of it.
 */
const SAFE_HOUSE_BUILDING: BuildingPlacement = {
  id: "safe-house",
  position: { x: -37.5, z: 39 },
  width: 9,
  depth: 8,
  height: 5,
  colorHex: "#d9c7a3",
  facingYaw: Math.PI,
};

export const SAFE_HOUSES: SafeHousePlacement[] = [
  {
    id: "safe-house",
    name: "Safe House",
    building: SAFE_HOUSE_BUILDING,
    door: { x: -37.5, z: 32.4 },
    // The house plus a yard on its east side, where the Budmobile is parked.
    property: { minX: -43, maxX: -26, minZ: 32, maxZ: 44 },
    // Beside the house, nose toward the street (yaw PI faces -Z).
    parking: { x: -29.5, z: 38, yaw: Math.PI },
  },
];

export const NPC_PLACEMENTS: NPCPlacement[] = [
  {
    id: "snoop",
    name: "Snoop Cordozar",
    title: "Guard's Son",
    dialogueTreeId: "snoop-intro",
    position: { x: -14, z: 13 },
    colorHex: "#38bdf8",
    skin: "men",
  },
  {
    id: "mary-jane",
    name: "Mary Jane",
    title: "Maid's Daughter",
    dialogueTreeId: "mary-jane-intro",
    position: { x: 15, z: -11 },
    colorHex: "#fb7185",
    skin: "women",
  },
  {
    id: "kenny-mousse",
    name: "Kenny Mousse",
    title: "Grower's Son",
    dialogueTreeId: "kenny-mousse-intro",
    position: { x: -35, z: 5 }, // moved from {28, 14} — that spot sat close enough to the healing shop's door (45, 26) that it read as "Kenny is the apothecary," since he was the nearest interactable thing to it
    colorHex: "#8a9a6a",
    skin: "men",
  },
  {
    id: "steven-jungleboy",
    name: "Steven Jungleboy",
    title: "Local Farmhand",
    dialogueTreeId: "steven-jungleboy-intro",
    position: { x: 14, z: -28 },
    colorHex: "#6a8a4a",
    skin: "men",
    accessory: "bandana",
  },
  {
    id: "emily-cookies",
    name: "Emily Cookies",
    title: "Judge's Daughter",
    dialogueTreeId: "emily-cookies-intro",
    position: { x: -14, z: 42 },
    colorHex: "#e8b4d8",
    skin: "women",
  },
  {
    id: "jeremias-blunt",
    name: "Jeremias Blunt",
    title: "City Knight",
    dialogueTreeId: "jeremias-blunt-intro",
    position: { x: 14, z: 56 },
    colorHex: "#9aa5b1",
    skin: "warriorMale",
  },
  {
    id: "olaf-kush",
    name: "Olaf Kush",
    title: "Quiet Regular",
    dialogueTreeId: "olaf-kush-intro",
    position: { x: -28, z: 14 },
    colorHex: "#7a6a8a",
    skin: "wizard",
    accessory: "bandana",
  },
  {
    id: "bobby-johnson",
    name: "OG Bobby Johnson",
    title: "Local Swordsman",
    dialogueTreeId: "bobby-johnson-intro",
    position: { x: 42, z: -14 },
    colorHex: "#c9a84a",
    skin: "warriorMale",
    accessory: "sunglasses",
  },
  {
    // The healing shop — placed in Handelsviertel (the trade district,
    // bearing ~60deg from the crowd generation calls in GameEngine.ts),
    // handled as a special NPC id rather than a whole separate
    // proximity/interaction system, since NPCManager already has one
    // that works. dialogueTreeId is a real, unused-but-valid ID here —
    // App.tsx's handleInteract intercepts this specific id and opens
    // the shop panel instead of ever calling talkToNpc with it, so this
    // string is never actually looked up.
    id: "healing-shop",
    name: "Kushtar Apothecary",
    title: "Healing Leaves",
    dialogueTreeId: "healing-shop-unused",
    // The shop's front door — just in front of the building's street-facing
    // facade (see the "healing-shop" BUILDINGS entry below), on the
    // sidewalk side of the street at z=25.
    position: { x: 62.5, z: 31.6 },
    colorHex: "#34d399",
    skin: "seller",
  },
];

// Landmarks only — CityBuilder fills in the rest of the city grid, streets,
// park squares, and the outskirts homesteads around these.
export const BUILDINGS: BuildingPlacement[] = [
  {
    id: "palace-gate",
    // Off the avenue entirely now (was x=0, sitting exactly on the
    // widened avenue centerline) — offset to the side so its footprint
    // clears the road + sidewalk, while staying close enough to the
    // plaza along the northern approach to read as fronting it.
    position: { x: 18, z: 30 },
    width: 24,
    depth: 11,
    height: 13,
    colorHex: "#8a7654",
    archetype: "royal", // CityBuilder still special-cases this specific id for the bespoke Bundestag-style treatment (columns, pediment, dome, garden)
  },
  {
    id: "rathaus-hall",
    // Southwest of the plaza, well clear of both avenues' own frontage
    // bands (|x|/|z| > 10) and within the Adelsviertel ring
    // (hypot ~37.7, between PLAZA_CLEARANCE=20 and ADEL_RING_OUTER_RADIUS=55).
    position: { x: -32, z: -20 },
    width: 20,
    depth: 14,
    height: 11,
    colorHex: "#8a8a94",
    archetype: "royal", // CityBuilder special-cases this id for the bespoke clock-tower treatment (buildRathaus)
  },
  {
    id: "ancient-library",
    // Southeast of the plaza, same clearance reasoning as the Rathaus above (hypot ~43).
    position: { x: 25, z: -35 },
    width: 18,
    depth: 16,
    height: 9,
    colorHex: "#8a8a94",
    archetype: "royal", // CityBuilder special-cases this id for the bespoke reading-hall-dome treatment (buildLibrary)
  },
  {
    id: "market-stall-1",
    position: { x: -15, z: 13 },
    width: 4,
    depth: 4,
    height: 2.8,
    colorHex: "#a8763e",
    archetype: "shop",
  },
  {
    id: "market-stall-2",
    position: { x: 15, z: 13 },
    width: 4,
    depth: 4,
    height: 2.8,
    colorHex: "#a8763e",
    archetype: "shop",
  },
  {
    // The healing shop ("gas shop") — built bespoke by CityBuilder.buildHealingShop.
    // In Handelsviertel, its door turned (facingYaw = PI) toward the street
    // at z=25; NPC_PLACEMENTS' "healing-shop" entry is the spot in front of it.
    id: "healing-shop",
    position: { x: 62.5, z: 39 },
    width: 11,
    depth: 9.5,
    height: 7.5,
    colorHex: "#e3d3b5",
    archetype: "shop",
    facingYaw: Math.PI,
  },
  SAFE_HOUSE_BUILDING,
  { id: "cordozar-home", position: { x: -80, z: 30 }, width: 6, depth: 5.5, height: 4, colorHex: "#6b7a4e" },
  { id: "quiet-house", position: { x: 80, z: 30 }, width: 5.5, depth: 5.5, height: 4, colorHex: "#5c6b46" },
  { id: "lake-cottage", position: { x: 14, z: -82 }, width: 5.5, depth: 5, height: 3.6, colorHex: "#7a6a52" },
];

// A small still-water feature in the outskirts south of the city,
// purely visual — see GameEngine.buildLake(). Kept clear of homesteads by
// the exclusion check in CityBuilder.generateOutskirtsHomesteads.
export const LAKE_CENTER = { x: 0, z: -95 };
export const LAKE_RADIUS = 13;