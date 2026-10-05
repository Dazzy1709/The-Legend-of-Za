// src/babylon/world/CityBuilder.ts
// Builds the plaza, a full street+sidewalk grid, a city wall with four
// gates, building blocks (each themed by which of Kushtar's four Bezirke —
// Districts.ts — it falls in, with occasional park squares breaking up the
// grid), lamp posts, and a ring of outskirts homesteads — layered on top of
// hand-placed "landmark" buildings (palace, notable market stalls) passed
// in from content/cities/kushtar/placements.ts.
//
// City shape: the Adelsviertel is a RING that fully surrounds the plaza
// (any bearing, out to ADEL_RING_OUTER_RADIUS — see Districts.ts), with
// the palace itself just inside that ring. The other three Bezirke fill
// the area beyond the ring, split into three wedges by bearing. Four main
// avenues (the two streets through x=0 and z=0, each spanning the full
// city) run straight from each of the four wall gates through the
// Adelsviertel to the plaza — those get the "grand boulevard" treatment:
// sidewalks, lamps, and dense, regular "Berlin row house" frontage
// buildings standing shoulder to shoulder right up against them,
// regardless of which of the four Bezirke the land technically belongs
// to. Every other street is a plain, sidewalk-less lane.
//
// Building placement follows the same divide: the Adelsviertel ring and
// the avenue-frontage band both use the regular, symmetric grid-cell
// layout (one building centered per cell). The three outer Bezirke,
// everywhere else, use an organic scatter instead — a cluster of 1-3
// smaller, irregularly placed and rotated buildings per cell, closer to
// a small village huddled around its own lanes than a city block.
//
// Building archetypes: six types (royal, church, village, shop, hut,
// workshop — see Districts.ts's BuildingArchetype), each with a
// genuinely different shape/roof, not just a recolored box. Every
// district leans on 1-2 of these as "what it represents" but always
// keeps a smaller share of the others too (Districts.ts's
// archetypeWeights), so no Bezirk is visually monotonous.
//
// Building walls/roofs use real, photographed PBR texture sets now, one
// pair per district (buildDistrictBuildingMaterials) rather than the
// procedural, color-tinted window-grid facades this project started
// with — createFacadePair still exists and is still used, but only for
// the palace landmark's own bespoke facade. Lamp posts use their own
// separate emissive-glow mechanism. GameEngine calls setNightIntensity()
// each frame from the day/night cycle, so lamps and the palace's own
// windows glow in sync with dusk/dawn; regular district-textured
// buildings don't have a lit-window layer to brighten.
//
// Texture tiling: any mesh using a real photographed PBR texture set
// (via PbrTextureSet.createPbrTextureSetMaterial) should NOT rely on
// MeshBuilder's default UVs or a material-level uScale/vScale — those
// always span a fixed 0->1 across whatever mesh they're applied to,
// which stretches badly once meshes of very different physical sizes
// share one material (a 14-unit street block vs. a 160-unit avenue, a
// short wall segment vs. a long one, etc). Instead, every such mesh gets
// applyWorldScaledUV(mesh, tileSizeInWorldUnits) called on it once its
// final position/rotation/vertex-displacement is set, so the texture
// tiles at a fixed real-world size everywhere it's used. This is the
// pattern to follow for any *new* mesh added to the city that uses a
// photographed texture set — see UvUtils.ts for details.

import {
  Color3,
  CreateHemisphere,
  Material,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { BuildingPlacement, WorldPosition } from "../../types";
import { BUILDINGS, SAFE_HOUSES } from "../../content/cities/kushtar/placements";
import {
  ADEL_RING_OUTER_RADIUS,
  blendedPavementTint,
  DISTRICTS,
  type BuildingArchetype,
  nearestDistrict,
  pickArchetype,
} from "./Districts";
import { createPbrTextureSetMaterial } from "./PbrTextureSet";
import { CITY_RADIUS, sampleTerrainHeight } from "./TerrainBuilder";
import {
  createFacadePair,
  createShopSignTexture,
  createSignTexture,
} from "./TextureFactory";
import { applyWorldScaledUV } from "./UvUtils";

export const CELL_SIZE = 25; // spacing between street grid lines — bigger blocks, more breathing room
const STREET_HALF_WIDTH = 3; // ordinary street

// Real-world size, in world units, one repeat of each photographed
// texture represents, used by applyWorldScaledUV so tiling density stays
// consistent regardless of a given mesh's own physical size (a single
// grid-cell street segment vs. a 160-unit avenue, the plaza disc, a wall
// segment, etc). Tunable per-material: smaller = the texture's own detail
// (cracks, grain, pebbles) reads bigger and coarser; larger = finer and
// more repeats, but can start looking busy/noisy up close.
const ROAD_TEXTURE_TILE_SIZE = 4; // dirt/cobblestone-embedded-asphalt streets
const PAVEMENT_TEXTURE_TILE_SIZE = 5; // ganges pebbles — plaza, main avenues, most streets
const SIDEWALK_TEXTURE_TILE_SIZE = 7; // asphalt photo, narrow strip — small tile so it reads detailed, not blank
const WALL_TEXTURE_TILE_SIZE = 2.5; // city wall
const BUILDING_TEXTURE_TILE_SIZE = 2.5; // building walls — see applyWorldScaledUV calls in composeBuilding

const MAIN_AVENUE_HALF_WIDTH = 6.5; // the two cobblestone streets running through the plaza (x=0, z=0) — widened from 3.4 for a proper grand-boulevard feel
const PLAZA_RIM_WIDTH = 4.5; // a wide sidewalk border ring around the plaza's outer edge
const SIDEWALK_WIDTH = 5;
const MINOR_SIDEWALK_WIDTH = 1.2; // very tiny sidewalk given to every ordinary (non-avenue) street now — a curb strip, not a full boulevard sidewalk
const LOT_MARGIN = STREET_HALF_WIDTH + SIDEWALK_WIDTH; // clearance from a grid line to a building lot

const AVENUE_FRONTAGE_LOT_DEPTH = 4.2; // was 5.5 — shallower, freeing up room for a real setback from the road without needing a frontage band wide enough to risk excluding the next regular grid cell too (see frontageOffset)
const AVENUE_FRONTAGE_SPACING = 7.8; // was 6.5 — distance between neighboring frontage buildings along the avenue; each building is spacing-0.4 wide (was spacing-1.2), so raising this both makes buildings themselves wider ("bigger") and, combined with the smaller subtracted gap, packs them closer together
// The main avenue's sidewalk outer edge — row houses stand directly behind it.
const AVENUE_SIDEWALK_OUTER_EDGE = MAIN_AVENUE_HALF_WIDTH + SIDEWALK_WIDTH;
// How far from an avenue's centerline still counts as its dense "row
// house" frontage: sidewalk edge plus one row house's depth. Building
// lots inside this band skip the normal grid-cell/organic generation
// entirely and are handled by buildAvenueFrontage instead, regardless of
// which Bezirk's land they're technically on.
const AVENUE_FRONTAGE_HALF_WIDTH = AVENUE_SIDEWALK_OUTER_EDGE + AVENUE_FRONTAGE_LOT_DEPTH;
// A separate, larger clearance used only to decide which regular grid
// cells get excluded as "too close to the avenue" — gives the regular
// district buildings real breathing room behind the row houses.
const DISTRICT_BUILDING_AVENUE_CLEARANCE = 20;

const PLAZA_RADIUS = 15;
export const PLAZA_CLEARANCE = 20; // no procedural buildings closer than this to center
export const CITY_SPAN = 165; // was 200 — tightened along with ADEL_RING_OUTER_RADIUS so the whole city (not just the noble ring) reads as more compact
const GRID_HALF = Math.ceil(CITY_SPAN / CELL_SIZE);

export const WALL_RADIUS = CITY_SPAN + 4;
const WALL_DEPTH = 2.6;
/**
 * The ring road running round the inside of the wall, from the wall
 * inward: a small gap, a sidewalk, the road, another sidewalk. Every
 * street of the grid ends on the road's centerline.
 */
const RING_WALL_GAP = 1.2;
export const RING_SIDEWALK_WIDTH = 2.5;
export const RING_ROAD_WIDTH = 7;
export const RING_ROAD_RADIUS = WALL_RADIUS - WALL_DEPTH / 2 - RING_WALL_GAP - RING_SIDEWALK_WIDTH - RING_ROAD_WIDTH / 2;
/** Inner edge of the ring's inner sidewalk. Nothing procedural (buildings, lots, lamps) is placed beyond BUILDABLE_RADIUS, a small margin inside it. */
const RING_INNER_EDGE = RING_ROAD_RADIUS - RING_ROAD_WIDTH / 2 - RING_SIDEWALK_WIDTH;
const BUILDABLE_RADIUS = RING_INNER_EDGE - 1.5;

/** Half-length of a straight grid street at `offset` from the center line, so it ends exactly on the ring road's centerline (0 if it misses the ring). */
export function streetHalfLength(offset: number): number {
  return Math.sqrt(Math.max(0, RING_ROAD_RADIUS * RING_ROAD_RADIUS - offset * offset));
}
const WALL_SEGMENTS = 52;
const GATE_HALF_ANGLE = Math.PI / 24; // gap left open at each of the 4 cardinal gates

const OUTSKIRTS_INNER = CITY_RADIUS + 6;
const OUTSKIRTS_OUTER = 145;
const OUTSKIRTS_STEP = 17;

const PARK_CHANCE = 0.03; // fraction of eligible cells that become a small green square instead of a building, in districts where PARK_CHANCE_OVERRIDE doesn't apply
/** Per-district override of PARK_CHANCE — currently just Adelsviertel, scaled down since it should read as dense multi-story blocks, not a district dotted with green squares. Districts not listed here use the plain PARK_CHANCE above. */
const PARK_CHANCE_OVERRIDE: Record<string, number> = { noble: 0.008 };
const FARM_SIZE_SCALE = 1.55; // Bauernviertel's organic-cluster buildings scale up by this over the base 4.2-6.8/4.2-6.6 footprint range — "every house should be bigger than the average house, like a farm"

// Along with its Bezirk, a building's height still nudges up slightly with
// distance from the plaza — keeps the immediate market-stall-lined plaza
// edge feeling low and busy regardless of which district it's in.
const DISTANCE_HEIGHT_BONUS_PER_UNIT = 0.025;

function seedFor(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// The palace is built bigger than its BUILDINGS entry (see buildPalace),
// with a columned porch out front and its own garden alongside — kept as
// shared constants so landmark-footprint exclusion matches what's built.
const PALACE_WIDTH_SCALE = 1.4;
const PALACE_DEPTH_SCALE = 1.9;
const PALACE_PORCH_DEPTH = 2.2;

function palaceLayout(b: BuildingPlacement) {
  const width = b.width * PALACE_WIDTH_SCALE;
  const depth = b.depth * PALACE_DEPTH_SCALE;
  const gardenWidth = width * 1.6;
  const gardenDepth = depth * 1.1;
  return {
    width,
    depth,
    garden: { x: b.position.x - width / 2 - gardenWidth / 2 - 2, z: b.position.z, width: gardenWidth, depth: gardenDepth },
  };
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const LANDMARK_CLEARANCE = 1.5;

function rectAround(x: number, z: number, halfX: number, halfZ: number): Rect {
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

let landmarkFootprintCache: Rect[] | null = null;

/** Ground footprints (plus clearance) of the hand-placed landmarks — palace with its porch and garden, Rathaus, library, market stalls, homes — so procedural buildings never get generated on top of them. */
function landmarkFootprints(): Rect[] {
  if (landmarkFootprintCache) return landmarkFootprintCache;
  const rects: Rect[] = [];
  for (const b of BUILDINGS) {
    if (b.id === "palace-gate") {
      const { width, depth, garden } = palaceLayout(b);
      // Porch projects toward -Z (see buildPalace).
      const r = rectAround(b.position.x, b.position.z, width / 2, depth / 2);
      r.minZ -= PALACE_PORCH_DEPTH + 1.4;
      rects.push(r, rectAround(garden.x, garden.z, garden.width / 2, garden.depth / 2));
    } else {
      // Generous enough to cover the library's front colonnade and the Rathaus tower.
      rects.push(rectAround(b.position.x, b.position.z, b.width / 2, b.depth / 2 + 2.5));
    }
  }
  // Safe-house grounds (the yard and parking spot), not just the house.
  for (const house of SAFE_HOUSES) rects.push({ ...house.property });
  landmarkFootprintCache = rects.map((r) => ({
    minX: r.minX - LANDMARK_CLEARANCE,
    maxX: r.maxX + LANDMARK_CLEARANCE,
    minZ: r.minZ - LANDMARK_CLEARANCE,
    maxZ: r.maxZ + LANDMARK_CLEARANCE,
  }));
  return landmarkFootprintCache;
}

function overlapsLandmark(r: Rect): boolean {
  return landmarkFootprints().some((l) => r.minX < l.maxX && r.maxX > l.minX && r.minZ < l.maxZ && r.maxZ > l.minZ);
}

/** True if (x, z) falls within the avenue's own dense frontage band (kept tight, drives row-house placement) OR the wider clearance zone regular district buildings must stay clear of (kept separate, gives them real breathing room from the row-houses without moving those). */
function isAvenueFrontage(x: number, z: number): boolean {
  return Math.abs(x) < AVENUE_FRONTAGE_HALF_WIDTH || Math.abs(z) < AVENUE_FRONTAGE_HALF_WIDTH;
}

/** The wider check used only to exclude regular grid cells — see DISTRICT_BUILDING_AVENUE_CLEARANCE's own comment for why this is a separate function from isAvenueFrontage rather than that function's own threshold simply being raised. */
function isTooCloseToAvenueForRegularBuildings(x: number, z: number): boolean {
  return Math.abs(x) < DISTRICT_BUILDING_AVENUE_CLEARANCE || Math.abs(z) < DISTRICT_BUILDING_AVENUE_CLEARANCE;
}

/**
 * The highest terrain height found anywhere within `radius` of (cx, cz),
 * sampled on a ring pattern. Used to safely place a flat feature (the
 * plaza disc, a park square) above every bump of local terrain noise
 * under its footprint — a single sample at the center isn't enough once
 * the footprint is more than a couple of units across (see the street fix
 * above for the same underlying issue at a larger scale).
 */
function maxTerrainHeightNear(cx: number, cz: number, radius: number): number {
  let max = sampleTerrainHeight(cx, cz);
  const ringSteps = 6;
  const angleStepDeg = 20;
  for (let i = 1; i <= ringSteps; i++) {
    const r = (radius * i) / ringSteps;
    for (let a = 0; a < 360; a += angleStepDeg) {
      const rad = (a * Math.PI) / 180;
      const h = sampleTerrainHeight(cx + Math.sin(rad) * r, cz + Math.cos(rad) * r);
      if (h > max) max = h;
    }
  }
  return max;
}

export interface CityLayout {
  buildings: BuildingPlacement[];
  parks: WorldPosition[];
  /** One full-lot ground patch per eligible non-park cell — covers the whole cell, not just around individual buildings, so there's no gap for the raw (always grass-toned) terrain to show through between/around buildings in a cluster. */
  groundPatches: { x: number; z: number; districtId: string }[];
}

/**
 * The regular grid-cell layout — one building (or, for organic Bezirke, a
 * small 1-3 building cluster) per eligible cell. Used for every cell
 * EXCEPT those in the avenue-frontage band (handled separately by
 * buildAvenueFrontage, so it isn't duplicated here).
 */
export function generateCityLayout(): CityLayout {
  const buildings: BuildingPlacement[] = [];
  const parks: WorldPosition[] = [];
  const groundPatches: { x: number; z: number; districtId: string }[] = [];
  let id = 0;

  for (let ki = -GRID_HALF; ki < GRID_HALF; ki++) {
    for (let kj = -GRID_HALF; kj < GRID_HALF; kj++) {
      const cx = (ki + 0.5) * CELL_SIZE;
      const cz = (kj + 0.5) * CELL_SIZE;
      const dist = Math.hypot(cx, cz);
      if (dist < PLAZA_CLEARANCE || dist > CITY_SPAN) continue;
      // The lot's farthest corner has to stay inside the ring road, or its
      // buildings would end up on the road or through the wall.
      const lotHalf = CELL_SIZE / 2 - STREET_HALF_WIDTH - MINOR_SIDEWALK_WIDTH;
      if (Math.hypot(Math.abs(cx) + lotHalf, Math.abs(cz) + lotHalf) > BUILDABLE_RADIUS) continue;
      if (isAvenueFrontage(cx, cz)) continue; // that band belongs to buildAvenueFrontage instead
      if (isTooCloseToAvenueForRegularBuildings(cx, cz)) continue; // more space between district houses and the main avenue, per request — regular buildings now stay clear of a wider band than just the row-houses' own footprint
      // The whole cell (out to its streets) is skipped if any part of it
      // touches a landmark — ground patch included, not just buildings.
      const cellHalf = CELL_SIZE / 2 - STREET_HALF_WIDTH;
      if (overlapsLandmark(rectAround(cx, cz, cellHalf, cellHalf))) continue;

      const seed = seedFor(cx, cz);
      const seed2 = seedFor(cx + 91.7, cz - 13.3);

      const jitterX = (seed - 0.5) * 0.9;
      const jitterZ = (seed2 - 0.5) * 0.9;

      const district = nearestDistrict(cx, cz);
      const parkChance = PARK_CHANCE_OVERRIDE[district.id] ?? PARK_CHANCE;
      if (seed > 1 - parkChance) {
        parks.push({ x: cx + jitterX, z: cz + jitterZ });
        continue;
      }

      const lotSize = CELL_SIZE - 2 * LOT_MARGIN;
      // One patch for the whole cell, centered on the cell (not on any
      // individual building's jittered position) and sized to the full
      // lot — this is what actually eliminates gaps, since it doesn't
      // matter how many buildings end up in this cell or exactly where:
      // the entire lot is covered regardless.
      groundPatches.push({ x: cx, z: cz, districtId: district.id });

      if (district.organic) {
        // A small cluster of 1-3 smaller, irregularly placed/rotated
        // buildings scattered within the lot instead of one centered
        // building — a village huddle, not a city block. Cluster count
        // and each member's offset/size/archetype are all seeded off the
        // cell center, so the layout is stable across reloads.
        const clusterCount = 1 + Math.floor(seedFor(cx + 5.1, cz + 5.1) * 3); // 1-3
        for (let m = 0; m < clusterCount; m++) {
          const mSeed = seedFor(cx + m * 17.3, cz + m * 23.9);
          const mSeed2 = seedFor(cx + m * 41.1 + 7, cz + m * 31.7 - 4);
          // Even tighter and bigger again (spread 0.12 -> 0.08, footprint
          // 3.4-6.0 -> 4.2-6.8) — the outer Bezirke should read as
          // buildings packed close together, not houses with visible
          // grass gaps between them.
          const offR = mSeed * lotSize * 0.08; // how far from the cell center this member sits
          const offA = mSeed2 * Math.PI * 2;
          const archetype = pickArchetype(district, mSeed);
          const sizeScale = district.id === "farm" ? FARM_SIZE_SCALE : 1; // "every house should be bigger than the average house, like a farm"
          const barnScale = archetype === "barn" ? 1.3 : 1; // barns bigger again than the district's already-scaled-up regular houses
          const width = (4.2 + mSeed2 * 2.6) * sizeScale * barnScale; // smaller than the grid buildings — a cottage, not a block
          const depth = (4.2 + mSeed * 2.4) * sizeScale * barnScale;
          const height =
            district.heightBase * 0.7 + ((mSeed + mSeed2) % 1) * district.heightRange * 0.8 +
            dist * DISTANCE_HEIGHT_BONUS_PER_UNIT;
          const colorHex = district.palette[Math.floor(mSeed * district.palette.length) % district.palette.length];
          buildings.push({
            id: `city-block-${id++}`,
            position: { x: cx + Math.sin(offA) * offR, z: cz + Math.cos(offA) * offR },
            width,
            depth,
            height,
            colorHex,
            archetype,
            // Faces outward from the cell center along its own offset
            // direction (offA), which — since streets run along every
            // grid line, surrounding every cell on all sides — points it
            // toward whichever street edge it actually sits closest to,
            // not a single fixed direction every building in these three
            // districts shared before. atan2(x,z) is this project's
            // established facingYaw convention (0=+Z, clockwise toward
            // +X), which offA already matches directly: the offset
            // itself is (sin(offA)*offR, cos(offA)*offR), so its own
            // angle in that convention is just offA, no conversion
            // needed.
            facingYaw: offA,
          });
        }
        continue;
      }

      // Symmetric grid placement (Adelsviertel only, outside this
      // function's excluded avenue band) — unchanged from the original
      // one-building-per-cell layout.
      // Occupies more of the lot now (was 50-80% of lotSize, now 65-95%)
      // so less bare ground shows around the building within its cell.
      const width = lotSize * 0.65 + seed * lotSize * 0.3;
      const depth = lotSize * 0.65 + seed2 * lotSize * 0.3;
      const height =
        district.heightBase + ((seed + seed2) % 1) * district.heightRange + dist * DISTANCE_HEIGHT_BONUS_PER_UNIT;
      const colorHex = district.palette[Math.floor(seed * district.palette.length) % district.palette.length];

      buildings.push({
        id: `city-block-${id++}`,
        position: { x: cx + jitterX, z: cz + jitterZ },
        width,
        depth,
        height,
        colorHex,
        archetype: pickArchetype(district, seed),
      });
    }
  }

  return { buildings, parks, groundPatches };
}

/**
 * Dense, regular "Berlin row house" frontage along all four arms of the
 * two main avenues — buildings standing close together (AVENUE_FRONTAGE_SPACING
 * apart) right at the edge of the sidewalk, symmetric on both sides,
 * regardless of which of the four Bezirke the underlying land belongs to.
 * Skips the plaza/Adelsviertel-ring core (PLAZA_CLEARANCE) since the
 * Adelsviertel's own grid-cell buildings already front the avenue there.
 */
export function buildAvenueFrontage(): BuildingPlacement[] {
  const buildings: BuildingPlacement[] = [];
  let id = 0;
  // Each row house's near (street-facing) edge sits exactly on the
  // sidewalk's outer edge — no overlap with the sidewalk, no gap behind it.
  const frontageOffset = AVENUE_SIDEWALK_OUTER_EDGE + AVENUE_FRONTAGE_LOT_DEPTH / 2;
  // How close to a cross-street's own centerline still counts as "at the
  // Kreuzung" and should be left clear of frontage buildings — needs to
  // cover the cross-street's own width plus enough building depth on
  // either side that nothing clips into the intersection.
  const INTERSECTION_CLEARANCE = STREET_HALF_WIDTH + AVENUE_FRONTAGE_LOT_DEPTH / 2 + 1.5;

  for (let step = PLAZA_CLEARANCE + AVENUE_FRONTAGE_SPACING / 2; step + AVENUE_FRONTAGE_SPACING / 2 < BUILDABLE_RADIUS; step += AVENUE_FRONTAGE_SPACING) {
    // Skip this step entirely if it falls where a cross-street (every
    // CELL_SIZE) actually meets the avenue — no house at the Kreuzung.
    const nearestGridLine = Math.round(step / CELL_SIZE) * CELL_SIZE;
    if (Math.abs(step - nearestGridLine) < INTERSECTION_CLEARANCE) continue;

    // Both avenue arms in both directions, both sides of each: 4
    // positions per step, each with the yaw that turns its front face
    // (door/windows/sign — always built on local +Z) to actually point
    // at the avenue it fronts. Every building previously used the same
    // unrotated (yaw=0, facing world +Z) orientation regardless of
    // position — for the two south-facing E/W-arm slots below that
    // happened to already be correct by coincidence (world +Z is what
    // "face the avenue" resolves to there), which is why the bug read
    // as "buildings on one side face the wrong way" rather than "every
    // building faces the wrong way" — the other six slots (both N/S-arm
    // sides, and the north-facing E/W-arm side) were never actually
    // facing their avenue at all.
    const positions: (WorldPosition & { facingYaw: number })[] = [
      { x: frontageOffset, z: step, facingYaw: -Math.PI / 2 }, // east of a N/S arm -> face west, toward the avenue
      { x: -frontageOffset, z: step, facingYaw: Math.PI / 2 }, // west of a N/S arm -> face east
      { x: frontageOffset, z: -step, facingYaw: -Math.PI / 2 },
      { x: -frontageOffset, z: -step, facingYaw: Math.PI / 2 },
      { x: step, z: frontageOffset, facingYaw: Math.PI }, // north of an E/W arm -> face south, toward the avenue
      { x: step, z: -frontageOffset, facingYaw: 0 }, // south of an E/W arm -> face north (already correct pre-fix)
      { x: -step, z: frontageOffset, facingYaw: Math.PI },
      { x: -step, z: -frontageOffset, facingYaw: 0 },
    ];

    const rowWidth = AVENUE_FRONTAGE_SPACING - 0.4;
    for (const pos of positions) {
      const dist = Math.hypot(pos.x, pos.z);
      if (dist > CITY_SPAN) continue;
      // N/S-arm houses (facing east/west) run their width along Z; E/W-arm houses along X.
      const alongZ = Math.abs(Math.sin(pos.facingYaw)) > 0.5;
      const footprint = alongZ
        ? rectAround(pos.x, pos.z, AVENUE_FRONTAGE_LOT_DEPTH / 2, rowWidth / 2)
        : rectAround(pos.x, pos.z, rowWidth / 2, AVENUE_FRONTAGE_LOT_DEPTH / 2);
      if (overlapsLandmark(footprint)) continue;
      const district = nearestDistrict(pos.x, pos.z);
      const seed = seedFor(pos.x, pos.z);
      const seed2 = seedFor(pos.x - 33.3, pos.z + 12.1);
      // Tall and narrow — apartment-row proportions, not a detached
      // house. Base/range both raised (5.2/3.4 -> 6.5/4.5) for "bigger."
      const height = 6.5 + seed * 4.5 + dist * DISTANCE_HEIGHT_BONUS_PER_UNIT;
      const colorHex = district.palette[Math.floor(seed * district.palette.length) % district.palette.length];
      // Row-house frontage leans heavily shop/village (ground-floor
      // commercial, apartments above) rather than each district's own
      // usual mix — a royal palace-style building or a farm hut doesn't
      // belong shoulder-to-shoulder on the boulevard.
      const archetype: BuildingArchetype = seed2 < 0.6 ? "shop" : "village";
      buildings.push({
        id: `avenue-row-${id++}`,
        position: { x: pos.x, z: pos.z },
        facingYaw: pos.facingYaw,
        // Wider and packed much closer together (spacing-1.2 -> spacing-0.4
        // gap) — "wider... more close to each other and bigger," per request.
        width: rowWidth,
        depth: AVENUE_FRONTAGE_LOT_DEPTH,
        height,
        colorHex,
        archetype,
      });
    }
  }
  return buildings;
}

export function generateOutskirtsHomesteads(): BuildingPlacement[] {
  const buildings: BuildingPlacement[] = [];
  let id = 0;
  for (let gx = -OUTSKIRTS_OUTER; gx <= OUTSKIRTS_OUTER; gx += OUTSKIRTS_STEP) {
    for (let gz = -OUTSKIRTS_OUTER; gz <= OUTSKIRTS_OUTER; gz += OUTSKIRTS_STEP) {
      const dist = Math.hypot(gx, gz);
      if (dist < OUTSKIRTS_INNER || dist > OUTSKIRTS_OUTER) continue;
      const seed = seedFor(gx * 1.7, gz * 1.7);
      if (seed > 0.45) continue; // sparse — most cells stay empty countryside
      if (gz < -80 && Math.abs(gx) < 32) continue; // keep the lake clear

      buildings.push({
        id: `homestead-${id++}`,
        position: { x: gx + (seed - 0.5) * 7, z: gz + (seed - 0.5) * 7 },
        width: 4 + seed * 1.5,
        depth: 4 + seed * 1.2,
        height: 2.8,
        colorHex: "#6b7a4e",
        archetype: "hut",
      });
    }
  }
  return buildings;
}

const ADEL_LUXURY_CHANCE = 0.075; // 5-10% of Adelsviertel buildings get the luxury (Stone Tile Wall/Roof Slates 03) material treatment instead of the standard one — a material-level roll, not a separate archetype

/** Per-district wall/roof PBR materials, built once in buildDistrictBuildingMaterials() and looked up per-building in buildOne(). Optional slots are only populated for the districts that actually need them (shopWall only for Handelsviertel, specialWall/specialRoof only for Handwerksviertel's workshops, luxuryWall/luxuryRoof only for Adelsviertel, trimMaterial only where roof trim is requested). */
export interface DistrictBuildingMaterials {
  houseWall: Material;
  houseRoof: Material;
  shopWall?: Material;
  specialWall?: Material;
  specialRoof?: Material;
  luxuryWall?: Material;
  luxuryRoof?: Material;
  trimMaterial?: Material;
}

export class CityBuilder {
  private hutWallMaterial: PBRMaterial;
  private thatchRoofMaterial: PBRMaterial;
  private nightGlowMaterials: StandardMaterial[] = [];
  private roofMaterial: PBRMaterial;
  private pavementMaterial: PBRMaterial;
  private roadMaterial: PBRMaterial;
  private sidewalkMaterial: PBRMaterial;
  private wallMaterial: PBRMaterial;
  private parkMaterial: PBRMaterial;
  private groundPatchMaterial: PBRMaterial;
  private benchMaterial: StandardMaterial;
  private lampPoleMaterial: StandardMaterial;
  private grassStreetMaterial: PBRMaterial;
  private foundationMaterial: StandardMaterial;
  private doorMaterial: StandardMaterial;
  private shutterMaterial: StandardMaterial;
  private windowWoodMaterial: PBRMaterial;
  private parkPositions: WorldPosition[] = [];
  private groundPatchPositions: { x: number; z: number; districtId: string }[] = [];
  /** Per-district wall/roof (and, where relevant, shop/workshop/luxury-specific) PBR materials — see buildDistrictBuildingMaterials(). Keyed by DistrictDef.id ("noble"/"trade"/"craft"/"farm"). */
  private districtMaterials = new Map<string, DistrictBuildingMaterials>();

  constructor(private scene: Scene, landmarks: BuildingPlacement[], private shadows?: ShadowGenerator) {
    this.roofMaterial = createPbrTextureSetMaterial(scene, {
      name: "cobblestone",
      diffuseFile: "cobblestone_embedded_asphalt_diff_1k.jpg",
      normalFile: "cobblestone_embedded_asphalt_nor_gl_1k.png",
      roughnessFile: "cobblestone_embedded_asphalt_rough_1k.png",
      uScale: 1,
      vScale: 1,
    });

    // Road/sidewalk materials are left at the default white diffuseColor on
    // purpose: their meshes carry per-vertex district-blended colors (see
    // buildStreetStrip). This applies to PBRMaterial exactly the same way
    // it did to the old StandardMaterial — verified PBRMaterial has its
    // own real VERTEXCOLOR shader path (not something StandardMaterial-
    // specific) before making this swap, so district tinting still works.
    //
    // uScale/vScale are left at 1 across every photographed-texture
    // material below on purpose — actual tiling density comes from
    // per-mesh applyWorldScaledUV calls (see the tile-size constants up
    // top), since a single material-level scale can't tile correctly
    // across meshes that range from one grid cell up to the full city
    // span, or across the plaza disc / wall segments.
    this.wallMaterial = createPbrTextureSetMaterial(scene, {
      name: "cobblestone",
      diffuseFile: "cobblestone_embedded_asphalt_diff_1k.jpg",
      normalFile: "cobblestone_embedded_asphalt_nor_gl_1k.png",
      roughnessFile: "cobblestone_embedded_asphalt_rough_1k.png",
      uScale: 1,
      vScale: 1,
    });
    this.sidewalkMaterial = createPbrTextureSetMaterial(scene, {
      name: "medieval_blocks_03",
      diffuseFile: "medieval_blocks_03_diff_1k.jpg",
      normalFile: "medieval_blocks_03_nor_gl_1k.png",
      roughnessFile: "medieval_blocks_03_rough_1k.png",
      uScale: 1,
      vScale: 1,
    });
    this.roadMaterial = createPbrTextureSetMaterial(scene, {
      name: "concrete_rock_path",
      diffuseFile: "concrete_rock_path_diff_1k.jpg",
      normalFile: "concrete_rock_path_nor_gl_1k.png",
      roughnessFile: "concrete_rock_path_rough_1k.png",
      uScale: 1,
      vScale: 1,
    });
    this.pavementMaterial = createPbrTextureSetMaterial(scene, {
      name: "concrete_rock_path",
      diffuseFile: "concrete_rock_path_diff_1k.jpg",
      normalFile: "concrete_rock_path_nor_gl_1k.png",
      roughnessFile: "concrete_rock_path_rough_1k.png",
      uScale: 1,
      vScale: 1,
    });
    this.grassStreetMaterial = createPbrTextureSetMaterial(scene, {
      name: "concrete_rock_path",
      diffuseFile: "concrete_rock_path_diff_1k.jpg",
      normalFile: "concrete_rock_path_nor_gl_1k.png",
      roughnessFile: "concrete_rock_path_rough_1k.png",
      uScale: 1,
      vScale: 1,
    });

    this.parkMaterial = createPbrTextureSetMaterial(scene, {
      name: "rocky_terrain_02",
      diffuseFile: "rocky_terrain_02_diff_1k.jpg",
      normalFile: "rocky_terrain_02_nor_gl_1k.png",
      roughnessFile: "rocky_terrain_02_rough_1k.png",
      uScale: 3,
      vScale: 3,
    });

    // The uniform "floor" material every regular (non-avenue-frontage)
    // building's ground patch now uses, across all four districts —
    // previously this was parkMaterial (green) for Adelsviertel/
    // Bauernviertel and sidewalkMaterial for the other two; per request
    // it's now one consistent brown-mud ground everywhere a building
    // sits, avenue-frontage row-houses excepted (those lost their floor
    // entirely — see buildStreetStrip's fill-strip removal below).
    this.groundPatchMaterial = createPbrTextureSetMaterial(scene, {
      name: "brown_mud_03",
      diffuseFile: "brown_mud_03_diff_1k.jpg",
      normalFile: "brown_mud_03_nor_gl_1k.png",
      uScale: 1,
      vScale: 1,
    });

    // "Mossy brick" — a new texture set the huts need supplied at
    // public/textures/mossy_brick/textures/, matching this project's
    // established per-texture-set folder convention (same pattern as
    // grass_medium_01 and every district's own wall materials). Roof
    // reuses roof_tiles_14 (already loaded for Handelsviertel's own
    // roofs, so this is a real, already-present texture, not a new
    // requirement) rather than the old procedural thatch texture.
    this.hutWallMaterial = createPbrTextureSetMaterial(scene, {
      name: "mossy_brick",
      diffuseFile: "mossy_brick_diff_1k.jpg",
      normalFile: "mossy_brick_nor_gl_1k.png",
      roughnessFile: "mossy_brick_rough_1k.png",
      uScale: 2.5,
      vScale: 2.5,
    });
    this.thatchRoofMaterial = createPbrTextureSetMaterial(scene, {
      name: "roof_tiles_14",
      diffuseFile: "roof_tiles_14_diff_1k.jpg",
      roughnessFile: "roof_tiles_14_rough_1k.jpg",
      uScale: 2,
      vScale: 2,
    });

    // Stone-grey — foundations, chimneys, finials, steps. A flat color
    // rather than a texture: these are small, incidental parts across a
    // huge number of buildings, and a whole extra material/texture per
    // building for a 0.45-unit chimney isn't worth the load.
    this.foundationMaterial = new StandardMaterial("foundationMat", scene);
    this.foundationMaterial.diffuseColor = new Color3(0.42, 0.4, 0.38);
    this.foundationMaterial.specularColor = Color3.Black();

    this.doorMaterial = new StandardMaterial("doorMat", scene);
    this.doorMaterial.diffuseColor = new Color3(0.24, 0.15, 0.09); // dark plank wood
    this.doorMaterial.specularColor = Color3.Black();

    this.shutterMaterial = new StandardMaterial("shutterMat", scene);
    this.shutterMaterial.diffuseColor = new Color3(0.28, 0.34, 0.22); // muted rustic green
    this.shutterMaterial.specularColor = Color3.Black();

    // Windows now get a real wood-textured material rather than a flat
    // color — reuses the "wood_trunk_wall" PBR set already loaded for
    // Handwerksviertel/Bauernviertel's own walls/roofs, rather than
    // asking for yet another texture folder just for this.
    this.windowWoodMaterial = createPbrTextureSetMaterial(scene, {
      name: "wood_trunk_wall",
      diffuseFile: "wood_trunk_wall_diff_1k.jpg",
      normalFile: "wood_trunk_wall_nor_gl_1k.png",
      roughnessFile: "wood_trunk_wall_rough_1k.png",
      uScale: 4,
      vScale: 4,
    });

    this.benchMaterial = new StandardMaterial("benchMat", scene);
    this.benchMaterial.diffuseColor = new Color3(0.38, 0.26, 0.16);
    this.benchMaterial.specularColor = Color3.Black();

    this.lampPoleMaterial = new StandardMaterial("lampPoleMat", scene);
    this.lampPoleMaterial.diffuseColor = new Color3(0.15, 0.15, 0.17);
    this.lampPoleMaterial.specularColor = Color3.Black();

    this.buildDistrictBuildingMaterials();

    this.buildPlaza();
    this.buildStreetNetwork();
    this.buildCityWall();
    this.buildInnerRingRoad();
    this.buildAvenueLamps();
    this.buildDistrictSigns();
    this.buildCityGateSign();

    const layout = generateCityLayout();
    this.parkPositions = layout.parks;
    this.groundPatchPositions = layout.groundPatches;
    // One ground patch per cell, built before the buildings themselves —
    // full lot-to-street coverage, so there's no gap anywhere in the
    // interior city for the terrain's own (always grass-toned) texture to
    // show through, regardless of how many buildings end up in that cell
    // or where within it they land.
    layout.groundPatches.forEach((p) => this.buildGroundPatch(p.x, p.z, p.districtId));
    const all = [...landmarks, ...layout.buildings, ...buildAvenueFrontage(), ...generateOutskirtsHomesteads()];
    all.forEach((b) => this.buildOne(b));
    layout.parks.forEach((p) => this.buildParkSquare(p));
  }

  /** Park square centers, so GameEngine can plant a tree in each via VegetationBuilder. */
  getParkPositions(): WorldPosition[] {
    return this.parkPositions;
  }

  /** Every building lot's own ground-patch center and which district it's in — "the pavement of almost all buildings," used to scatter grass there without needing to reimplement district-boundary geometry a second time (this reuses the exact same per-cell district lookup buildGroundPatch itself was built from). */
  getGroundPatchPositions(): { x: number; z: number; districtId: string }[] {
    return this.groundPatchPositions;
  }

  /** Exposes a district's own real material objects — e.g. so a bespoke building outside the procedural pipeline (the healing shop) can use the exact same wall/roof materials regular buildings in that district use, rather than an approximation that risks picking the wrong texture file or a mismatched UV scale, both of which actually happened the first time. */
  getDistrictMaterials(districtId: string): DistrictBuildingMaterials | undefined {
    return this.districtMaterials.get(districtId);
  }

  /**
   * Builds every district's real, photographed PBR wall/roof materials —
   * the actual "Merkmale" (signature look) each Bezirk was specced with.
   * Texture set names here are slugs (lowercase, underscored) derived
   * directly from the names given — e.g. "Gray Roof 01" ->
   * "gray_roof_01" — matching PbrTextureSet.ts's expected folder layout
   * (public/textures/<name>/textures/<name>_diff_1k.jpg etc). Drop
   * matching files in under those folder names and every material below
   * picks them up with no further code changes.
   *
   * uScale/vScale are left at PbrTextureSet's own default (8) throughout
   * — unlike the street/road materials elsewhere in this file, which
   * each need a hand-tuned tile size to look right across wildly
   * different mesh sizes (a single grid-cell street vs. a 160-unit
   * avenue), individual building walls/roofs are all roughly
   * comparable, human-scale sizes, so one shared default reads
   * reasonably across all of them without needing that same per-mesh
   * tuning.
   */
  private buildDistrictBuildingMaterials() {
    const scene = this.scene;

    // Adelsviertel — standard Stone Wall 05 / Gray Roof 01, plus a
    // luxury Stone Tile Wall / Roof Slates 03 pair for the ~5-10% of
    // buildings ADEL_LUXURY_CHANCE rolls onto in buildOne().
    this.districtMaterials.set("noble", {
      houseWall: createPbrTextureSetMaterial(scene, {
        name: "stone_wall_05",
        diffuseFile: "stone_wall_05_diff_1k.jpg",
        normalFile: "stone_wall_05_nor_gl_1k.png",
        roughnessFile: "stone_wall_05_rough_1k.png",
        uScale: 1,
        vScale: 1
      }),
      houseRoof: createPbrTextureSetMaterial(scene, {
        name: "grey_roof_01",
        diffuseFile: "grey_roof_01_diff_1k.jpg",
        normalFile: "grey_roof_01_nor_gl_1k.png",
        roughnessFile: "grey_roof_01_rough_1k.jpg",
        uScale: 1,
        vScale: 1
      }),
      luxuryWall: createPbrTextureSetMaterial(scene, {
        name: "stone_tile_wall",
        diffuseFile: "stone_tile_wall_diff_1k.jpg",
        normalFile: "stone_tile_wall_nor_gl_1k.png",
        roughnessFile: "stone_tile_wall_rough_1k.png",
        uScale: 1,
        vScale: 1
      }),
      luxuryRoof: createPbrTextureSetMaterial(scene, {
        name: "roof_slates_03",
        diffuseFile: "roof_slates_03_diff_1k.jpg",
        normalFile: "roof_slates_03_nor_gl_1k.png",
        roughnessFile: "roof_slates_03_rough_1k.png",
        uScale: 1,
        vScale: 1
      }),
    });

    // Handelsviertel — Weathered Planks walls (houses and, since no
    // distinct shop-wall texture was specified, shops too), Roof Tiles
    // 14 roofs, and a Dark Wooden Planks trim material for the
    // bargeboard/ridge/eaves detailing every building here gets (see
    // buildRoofTrim).
    const tradeWall = createPbrTextureSetMaterial(scene, {
      name: "dark_brick_wall",
      diffuseFile: "dark_brick_wall_diff_1k.jpg",
      normalFile: "dark_brick_wall_nor_gl_1k.png",
      roughnessFile: "dark_brick_wall_rough_1k.png",
      uScale: 1,
      vScale: 1
    });
    this.districtMaterials.set("trade", {
      houseWall: tradeWall,
      shopWall: tradeWall, // no separate shop-wall texture was given — shops share the house wall material
      houseRoof: createPbrTextureSetMaterial(scene, {
        name: "roof_tiles_14",
        diffuseFile: "roof_tiles_14_diff_1k.jpg",
        roughnessFile: "roof_tiles_14_rough_1k.jpg",
        uScale: 1,
        vScale: 1
      }),
      trimMaterial: createPbrTextureSetMaterial(scene, {
        name: "dark_wooden_planks",
        diffuseFile: "dark_wooden_planks_diff_1k.jpg",
        normalFile: "dark_wooden_planks_nor_gl_1k.png",
        roughnessFile: "dark_wooden_planks_rough_1k.png",
        uScale: 1,
        vScale: 1
      }),
    });

    // Handwerksviertel — Planks Brown 10 walls / Wood Trunk Wall roofs
    // for regular houses, Brown Planks 09 walls / Dark Wooden Planks
    // roofs specifically for workshops ("Werkstatt"), which is what
    // specialWall/specialRoof below hold.
    this.districtMaterials.set("craft", {
      houseWall: createPbrTextureSetMaterial(scene, {
        name: "rock_wall_09",
        diffuseFile: "rock_wall_09_diff_1k.jpg",
        normalFile: "rock_wall_09_nor_gl_1k.png",
        roughnessFile: "rock_wall_09_rough_1k.png",
        uScale: 2,
        vScale: 2
      }),
      houseRoof: createPbrTextureSetMaterial(scene, {
        name: "wood_trunk_wall",
        diffuseFile: "wood_trunk_wall_diff_1k.jpg",
        normalFile: "wood_trunk_wall_nor_gl_1k.png",
        roughnessFile: "wood_trunk_wall_rough_1k.png",
        uScale: 2,
        vScale: 2
      }),
      specialWall: createPbrTextureSetMaterial(scene, {
        name: "wood_trunk_wall",
        diffuseFile: "wood_trunk_wall_diff_1k.jpg",
        normalFile: "wood_trunk_wall_nor_gl_1k.png",
        roughnessFile: "wood_trunk_wall_rough_1k.png",
        uScale: 1,
        vScale: 1
      }),
      specialRoof: createPbrTextureSetMaterial(scene, {
        name: "dark_wooden_planks",
        diffuseFile: "dark_wooden_planks_diff_1k.jpg",
        normalFile: "dark_wooden_planks_nor_gl_1k.png",
        roughnessFile: "dark_wooden_planks_rough_1k.png",
        uScale: 1,
        vScale: 1
      }),
    });

    // Bauernviertel — Wood Trunk Wall walls, Reed Roof 04 roofs, for
    // both regular houses and barns alike (no separate barn texture was
    // specified).
    this.districtMaterials.set("farm", {
      houseWall: createPbrTextureSetMaterial(scene, {
        name: "mossy_brick",
        diffuseFile: "mossy_brick_diff_1k.jpg",
        normalFile: "mossy_brick_nor_gl_1k.png",
        roughnessFile: "mossy_brick_rough_1k.png",
        uScale: 1,
        vScale: 1
      }),
      houseRoof: createPbrTextureSetMaterial(scene, {
        name: "reed_roof_04",
        diffuseFile: "reed_roof_04_diff_1k.jpg",
        normalFile: "reed_roof_04_nor_gl_1k.png",
        roughnessFile: "reed_roof_04_rough_1k.jpg",
        uScale: 1,
        vScale: 1
      }),
    });
  }

  /** 0 = daytime (windows/lamps dark), 1 = full night (glowing) — called every frame from the day/night cycle. */
  setNightIntensity(intensity: number) {
    const c = Math.max(0, Math.min(1, intensity));
    this.nightGlowMaterials.forEach((m) => m.emissiveColor.set(c, c, c));
  }

  /** Computes normals (CreateDisc doesn't do this itself) and applies world-scaled UV tiling — shared by the plaza's rim ring and its inner pavement disc, both of which need this. */
  private finalizeDiscMesh(mesh: Mesh, tileSize: number) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const indices = mesh.getIndices();
    if (positions && indices) {
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      mesh.setVerticesData(VertexBuffer.NormalKind, normals);
    }
    applyWorldScaledUV(mesh, tileSize);
  }

  private buildPlaza() {
    // A wide sidewalk rim around the plaza's outer edge — built as a
    // larger disc first, using the sidewalk material, sitting under the
    // actual pavement disc; the ring of it left exposed beyond the
    // pavement disc's own radius is what reads as the border. Simpler
    // and more reliable than constructing a true hollow annulus mesh,
    // and matches how buildGroundPatch/buildParkSquare already layer
    // ground materials rather than cutting holes in geometry.
    const rimRadius = PLAZA_RADIUS + PLAZA_RIM_WIDTH;
    const rim: Mesh = MeshBuilder.CreateDisc("plaza-rim", { radius: rimRadius, tessellation: 64 }, this.scene);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = maxTerrainHeightNear(0, 0, rimRadius) + 0.03;
    rim.material = this.sidewalkMaterial;
    rim.receiveShadows = true;
    this.finalizeDiscMesh(rim, SIDEWALK_TEXTURE_TILE_SIZE);

    const plaza: Mesh = MeshBuilder.CreateDisc("plaza", { radius: PLAZA_RADIUS, tessellation: 56 }, this.scene);
    plaza.rotation.x = Math.PI / 2;
    // Clearly above the rim disc (0.03) it sits on top of, not just
    // above the raw terrain — avoids z-fighting across their whole
    // overlapping area.
    plaza.position.y = maxTerrainHeightNear(0, 0, PLAZA_RADIUS) + 0.06;
    plaza.material = this.pavementMaterial;
    plaza.receiveShadows = true;
    // The disc is ~30 units across — without this, MeshBuilder's default
    // UVs (0->1 across the whole disc) smear a single texture repeat over
    // the entire plaza. Needs normals first since applyWorldScaledUV
    // reads them; CreateDisc doesn't compute them itself.
    this.finalizeDiscMesh(plaza, PAVEMENT_TEXTURE_TILE_SIZE);
  }

  /** A full street+sidewalk lattice along every grid line, not just the two main avenues. */
  private buildStreetNetwork() {
    for (let k = -GRID_HALF; k <= GRID_HALF; k++) {
      const pos = k * CELL_SIZE;
      if (Math.abs(pos) >= RING_ROAD_RADIUS) continue;
      const isMainAvenue = pos === 0;
      const roadHalfWidth = isMainAvenue ? MAIN_AVENUE_HALF_WIDTH : STREET_HALF_WIDTH;
      // The wall is a circle, so a straight street's length depends on
      // how far its line sits from the center: every ordinary street ends
      // on the ring road (streetHalfLength), never crossing the wall. Only
      // the two main avenues run on to the wall itself, since they line
      // up with the four gates (buildCityWall).
      const span = (isMainAvenue ? WALL_RADIUS : streetHalfLength(pos)) * 2;
      // Main avenues get the same fine cobblestone/pebbles as the plaza —
      // they're the ceremonial spine of the city, and are the only
      // streets that get sidewalks + lamps + dense row-house frontage.
      // Every other street is a plain lane with no sidewalk at all: 60%
      // cobblestone, 20% packed dirt/concrete, 20% grass path.
      const nsMat = isMainAvenue ? this.pavementMaterial : this.pickStreetSurfaceMaterial("ns", pos);
      const ewMat = isMainAvenue ? this.pavementMaterial : this.pickStreetSurfaceMaterial("ew", pos);

      this.buildStreetStrip("ns", pos, roadHalfWidth, span, nsMat, !isMainAvenue, isMainAvenue);
      this.buildStreetStrip("ew", pos, roadHalfWidth, span, ewMat, !isMainAvenue, isMainAvenue);
    }
  }

  /** Deterministically picks one of three street surfaces for a given line: 60% cobblestone, 20% dirt, 20% grass. */
  private pickStreetSurfaceMaterial(axis: "ns" | "ew", pos: number): Material {
    const r = seedFor(pos, axis === "ns" ? 4173.2 : 8291.7);
    if (r < 0.6) return this.pavementMaterial;
    if (r < 0.8) return this.roadMaterial;
    return this.grassStreetMaterial;
  }

  /** Picks the world-scaled tile size for a given street material. */
  private tileSizeFor(mat: Material): number {
    if (mat === this.roadMaterial) return ROAD_TEXTURE_TILE_SIZE;
    if (mat === this.pavementMaterial) return PAVEMENT_TEXTURE_TILE_SIZE;
    return ROAD_TEXTURE_TILE_SIZE; // grassStreetMaterial (now also a photo set) — same order of magnitude as the road tile size
  }

  /**
   * Builds a road strip along one grid line — plus, ONLY for the two main
   * avenues, two flanking sidewalk strips. Ordinary streets skip
   * sidewalks entirely now: they're plain lanes, and the "proper street"
   * treatment (sidewalks + lighting + dense frontage) is reserved for the
   * four avenue arms, per the new city design. Each strip is subdivided
   * along its *length* and, per vertex, both conformed to the actual
   * local terrain height and painted with a district-blended pavement
   * color — a strip can run up to the full city span, and the terrain's
   * own gentle noise varies meaningfully across that distance. A single
   * flat height for the whole strip left the ground poking up through the
   * road in most places; this is what actually fixes that.
   */
  private buildStreetStrip(
    axis: "ns" | "ew",
    pos: number,
    roadHalfWidth: number,
    length: number,
    roadMat: Material,
    applyDistrictTint: boolean,
    isMainAvenue: boolean
  ) {
    const lengthSubdivisions = 48; // resolution along the strip's length — both for terrain-following and color gradient

    const road = MeshBuilder.CreateGround(
      `road-${axis}-${pos}`,
      axis === "ns"
        ? { width: roadHalfWidth * 2, height: length, subdivisionsX: 1, subdivisionsY: lengthSubdivisions, updatable: true }
        : { width: length, height: roadHalfWidth * 2, subdivisionsX: lengthSubdivisions, subdivisionsY: 1, updatable: true },
      this.scene
    );
    const roadCenter = axis === "ns" ? new Vector3(pos, 0, 0) : new Vector3(0, 0, pos);
    road.position = roadCenter;
    road.material = roadMat;
    road.receiveShadows = true;
    this.conformStreetToTerrain(road, roadCenter, 0.04, applyDistrictTint, { tileSize: this.tileSizeFor(roadMat) });

    if (!isMainAvenue) {
      // A very tiny sidewalk for every ordinary street too — previously
      // these had no sidewalk at all (the sole exception was the two
      // main avenues). Much narrower than the avenue's own
      // SIDEWALK_WIDTH (5) — this is meant to read as a modest curb
      // strip, not a full boulevard-style sidewalk.
      [-1, 1].forEach((side) => {
        const offset = roadHalfWidth + MINOR_SIDEWALK_WIDTH / 2;
        const sw = MeshBuilder.CreateGround(
          `minor-sidewalk-${axis}-${pos}-${side}`,
          axis === "ns"
            ? { width: MINOR_SIDEWALK_WIDTH, height: length, subdivisionsX: 1, subdivisionsY: lengthSubdivisions, updatable: true }
            : { width: length, height: MINOR_SIDEWALK_WIDTH, subdivisionsX: lengthSubdivisions, subdivisionsY: 1, updatable: true },
          this.scene
        );
        const swCenter =
          axis === "ns" ? new Vector3(pos + side * offset, 0, 0) : new Vector3(0, 0, pos + side * offset);
        sw.position = swCenter;
        sw.material = this.sidewalkMaterial;
        sw.receiveShadows = true;
        this.conformStreetToTerrain(sw, swCenter, 0.06, applyDistrictTint, { tileSize: SIDEWALK_TEXTURE_TILE_SIZE });
      });
      return;
    }

    // The avenue itself runs on through the ring to the wall gate, but its
    // sidewalks stop where they meet the ring road's inner sidewalk.
    const sidewalkOuter = roadHalfWidth + SIDEWALK_WIDTH;
    const sidewalkLength = 2 * Math.sqrt(Math.max(0, RING_INNER_EDGE * RING_INNER_EDGE - sidewalkOuter * sidewalkOuter));
    [-1, 1].forEach((side) => {
      const offset = roadHalfWidth + SIDEWALK_WIDTH / 2;
      const sw = MeshBuilder.CreateGround(
        `sidewalk-${axis}-${pos}-${side}`,
        axis === "ns"
          ? { width: SIDEWALK_WIDTH, height: sidewalkLength, subdivisionsX: 1, subdivisionsY: lengthSubdivisions, updatable: true }
          : { width: sidewalkLength, height: SIDEWALK_WIDTH, subdivisionsX: lengthSubdivisions, subdivisionsY: 1, updatable: true },
        this.scene
      );
      const swCenter =
        axis === "ns" ? new Vector3(pos + side * offset, 0, 0) : new Vector3(0, 0, pos + side * offset);
      sw.position = swCenter;
      sw.material = this.sidewalkMaterial;
      sw.receiveShadows = true;
      this.conformStreetToTerrain(sw, swCenter, 0.08, applyDistrictTint, { tileSize: SIDEWALK_TEXTURE_TILE_SIZE }); // sidewalks sit a touch higher than the road — a visible curb

      // The fill strip that used to sit between the sidewalk's outer
      // edge and AVENUE_FRONTAGE_HALF_WIDTH (paved ground under where
      // the row-house buildings stand) has been removed per request —
      // "remove the floor of all houses on the main avenue." The
      // buildings themselves are now wide enough and close enough
      // together (see AVENUE_FRONTAGE_SPACING) that they cover most of
      // this band on their own; whatever's left between/behind them now
      // shows the raw terrain instead of a paved strip.
    });
  }

  /**
   * Reads a ground mesh's local vertex positions, and for each one: looks
   * up the real local terrain height at that world (x, z) and writes it
   * back (plus a small fixed clearance so the surface sits just above the
   * ground, never coincident with it). Optionally also writes a blended
   * district pavement tint — skipped for the main avenues, which are
   * meant to match the plaza's brightness exactly rather than being
   * multiplicatively darkened by a district tint. Recomputes normals
   * afterward so lighting/shadows read correctly on the now
   * gently-undulating strip, then — if `worldScaledUV` is passed —
   * hands off to applyWorldScaledUV (UvUtils.ts) so the texture tiles at
   * a fixed real-world size regardless of this strip's own length.
   */
  private conformStreetToTerrain(
    mesh: Mesh,
    center: Vector3,
    heightOffset: number,
    applyDistrictTint: boolean,
    worldScaledUV?: { tileSize: number }
  ) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;

    const colors = applyDistrictTint ? new Float32Array((positions.length / 3) * 4) : null;
    for (let i = 0, v = 0; i < positions.length; i += 3, v += 4) {
      const worldX = positions[i] + center.x;
      const worldZ = positions[i + 2] + center.z;
      positions[i + 1] = sampleTerrainHeight(worldX, worldZ) + heightOffset;

      if (colors) {
        const tint = blendedPavementTint(worldX, worldZ);
        colors[v] = tint.r;
        colors[v + 1] = tint.g;
        colors[v + 2] = tint.b;
        colors[v + 3] = 1;
      }
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    if (colors) mesh.setVerticesData(VertexBuffer.ColorKind, colors);

    const indices = mesh.getIndices();
    if (indices) {
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
    }

    if (worldScaledUV) applyWorldScaledUV(mesh, worldScaledUV.tileSize);
  }

  /** A ringed stone wall with four gates (N/E/S/W), following the terrain height under each segment. Gate angles (0/90/180/270) line up exactly with the two main avenues, so all four avenue arms run straight from a gate to the plaza. */
  private buildCityWall() {
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const angle = (i / WALL_SEGMENTS) * Math.PI * 2;
      const nearestGate = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
      const gateDelta = Math.abs(((angle - nearestGate + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gateDelta < GATE_HALF_ANGLE) continue; // leave the gate gap open

      const segLength = ((2 * Math.PI * WALL_RADIUS) / WALL_SEGMENTS) * 1.08;
      const x = Math.sin(angle) * WALL_RADIUS;
      const z = Math.cos(angle) * WALL_RADIUS;
      const groundY = sampleTerrainHeight(x, z);

      const seg = MeshBuilder.CreateBox(
        `wall-${i}`,
        { width: segLength, depth: WALL_DEPTH, height: 9.5 }, // was depth: 1.6, height: 5.5 — "bigger walls," a notably more imposing/fortified scale
        this.scene
      );
      seg.position = new Vector3(x, groundY + 4.75, z); // was +2.75 — half of the new height, keeping the wall's base at ground level
      seg.rotation.y = angle;
      seg.checkCollisions = true;
      seg.material = this.wallMaterial;
      seg.receiveShadows = true;
      applyWorldScaledUV(seg, WALL_TEXTURE_TILE_SIZE);
      this.shadows?.addShadowCaster(seg);
    }
  }

  /**
   * "One big road around the inside of the wall (around city)" — a
   * continuous road just inside the wall with a sidewalk on both sides
   * and a small gap between the outer sidewalk and the wall, every street
   * of the grid ending on it (see streetHalfLength). Each band is one
   * seamless annulus mesh following the terrain.
   */
  private buildInnerRingRoad() {
    const roadInner = RING_ROAD_RADIUS - RING_ROAD_WIDTH / 2;
    const roadOuter = RING_ROAD_RADIUS + RING_ROAD_WIDTH / 2;
    // Road just above the streets (+0.04) so it reads as continuous where
    // they meet it; sidewalks just below them, so a street crossing the
    // inner sidewalk to reach the road shows on top of it.
    this.buildRingBand("ring-road", roadInner, roadOuter, 0.05, this.pavementMaterial, PAVEMENT_TEXTURE_TILE_SIZE);
    this.buildRingBand("ring-sidewalk-inner", roadInner - RING_SIDEWALK_WIDTH, roadInner, 0.03, this.sidewalkMaterial, SIDEWALK_TEXTURE_TILE_SIZE);
    this.buildRingBand("ring-sidewalk-outer", roadOuter, roadOuter + RING_SIDEWALK_WIDTH, 0.03, this.sidewalkMaterial, SIDEWALK_TEXTURE_TILE_SIZE);
  }

  /** One flat annulus between two radii, conformed to the terrain, `heightOffset` above it. */
  private buildRingBand(name: string, inner: number, outer: number, heightOffset: number, material: Material, tileSize: number) {
    const segments = 192;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      for (const r of [inner, outer]) {
        const x = sin * r;
        const z = cos * r;
        positions.push(x, sampleTerrainHeight(x, z) + heightOffset, z);
      }
      if (i < segments) {
        const v = i * 2;
        // Winding chosen so the faces point up (Babylon is left-handed).
        indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const band = new Mesh(name, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.applyToMesh(band);
    band.material = material;
    band.receiveShadows = true;
    applyWorldScaledUV(band, tileSize);
  }

  /** Lamp posts lining both sides of the two main avenues, at regular intervals — the only streets that get lighting, matching the sidewalk treatment. */
  private buildAvenueLamps() {
    const spacing = CELL_SIZE * 0.7; // closer together than a full block, for a proper lit boulevard feel
    const offset = AVENUE_SIDEWALK_OUTER_EDGE - 0.7; // on the sidewalk, just in front of the row houses that stand right behind it
    let id = 0;

    for (let step = PLAZA_RADIUS + spacing; step <= BUILDABLE_RADIUS; step += spacing) {
      [-1, 1].forEach((side) => {
        this.buildLamp(side * offset, step, `avenue-ns-${id++}`);
        this.buildLamp(side * offset, -step, `avenue-ns-${id++}`);
      });
      [-1, 1].forEach((side) => {
        this.buildLamp(step, side * offset, `avenue-ew-${id++}`);
        this.buildLamp(-step, side * offset, `avenue-ew-${id++}`);
      });
    }
  }

  private buildLamp(x: number, z: number, id: string) {
    const groundY = sampleTerrainHeight(x, z);
    const pole = MeshBuilder.CreateCylinder(`lamp-pole-${id}`, { height: 3.2, diameter: 0.12 }, this.scene);
    pole.position = new Vector3(x, groundY + 1.6, z);
    pole.material = this.lampPoleMaterial;
    this.shadows?.addShadowCaster(pole);

    const head = MeshBuilder.CreateSphere(`lamp-head-${id}`, { diameter: 0.4 }, this.scene);
    head.position = new Vector3(x, groundY + 3.3, z);
    const headMat = new StandardMaterial(`lampHeadMat-${id}`, this.scene);
    headMat.diffuseColor = new Color3(0.95, 0.88, 0.7);
    headMat.emissiveColor = Color3.Black(); // brightened at night by setNightIntensity()
    headMat.specularColor = Color3.Black();
    head.material = headMat;
    this.nightGlowMaterials.push(headMat);
  }

  /**
   * A wooden post + signboard, the shared structure behind both the
   * district entry signs (Ortsschilder) and the city gate sign
   * (Stadtschild) — see buildDistrictSigns/buildCityGateSign below.
   * `bearingRad` orients the board to face along that bearing (the same
   * sin/cos convention every other radial placement in this file uses,
   * e.g. buildCityWall's own wall-segment rotation) — readable by
   * someone walking along that line. backFaceCulling is left off on the
   * board's material on purpose: which way a plane's front face ends up
   * actually pointing (toward incoming or outgoing travelers) isn't
   * something I can verify without seeing it rendered, so this
   * guarantees the sign reads correctly from both directions of travel
   * regardless of which way that turned out — the same safety-valve
   * approach SkyBuilder's own cloud plane already uses for the same
   * reason.
   */
  private buildSignpost(
    x: number,
    z: number,
    bearingRad: number,
    title: string,
    subtitle: string | null,
    scale = 1
  ) {
    const groundY = sampleTerrainHeight(x, z);
    const postHeight = 2.4 * scale;

    const post = MeshBuilder.CreateCylinder(
      `signpost-${title}-${x.toFixed(0)}-${z.toFixed(0)}`,
      { height: postHeight, diameter: 0.14 * scale },
      this.scene
    );
    post.position = new Vector3(x, groundY + postHeight / 2, z);
    post.material = this.foundationMaterial; // reuses the same stone-grey used for chimneys/foundations elsewhere
    this.shadows?.addShadowCaster(post);

    // The board sits above the post's own top, like a sign mounted on a
    // pole, rather than partway down it — its bottom edge starts just
    // above the post's top and it extends upward from there.
    const boardWidth = 2.2 * scale;
    const boardHeight = 1.1 * scale;
    const boardY = groundY + postHeight + boardHeight / 2 + 0.08;

    const boardMat = new StandardMaterial(`signboardMat-${title}-${x.toFixed(0)}-${z.toFixed(0)}`, this.scene);
    boardMat.diffuseTexture = createSignTexture(this.scene, title, subtitle);
    boardMat.specularColor = Color3.Black();
    // Normal culling, on two separate back-to-back planes rather than one
    // plane with culling disabled — a single plane's back face shows its
    // texture mirrored ("spiegelverkehrt"); two planes each show their
    // own correctly-oriented front.
    boardMat.backFaceCulling = true;

    const front = MeshBuilder.CreatePlane(
      `signboard-front-${title}-${x.toFixed(0)}-${z.toFixed(0)}`,
      { width: boardWidth, height: boardHeight },
      this.scene
    );
    front.position = new Vector3(x, boardY, z);
    front.rotation.y = bearingRad;
    front.material = boardMat;
    this.shadows?.addShadowCaster(front);

    const back = MeshBuilder.CreatePlane(
      `signboard-back-${title}-${x.toFixed(0)}-${z.toFixed(0)}`,
      { width: boardWidth, height: boardHeight },
      this.scene
    );
    back.position = new Vector3(x, boardY, z);
    back.rotation.y = bearingRad + Math.PI;
    back.material = boardMat;
    this.shadows?.addShadowCaster(back);
  }

  /**
   * Ortsschilder — one per outer Bezirk, placed where each of the four
   * main avenue arms crosses out of the Adelsviertel ring (just past
   * ADEL_RING_OUTER_RADIUS), offset a couple of units to the side of the
   * avenue's own centerline so the post doesn't stand in the middle of
   * the road. Each sign's district name comes from nearestDistrict() at
   * that exact point rather than being hand-assigned per bearing — the
   * north arm (bearing 0) sits almost exactly equidistant between
   * Handelsviertel (60°) and Bauernviertel (300°), a near-tie
   * nearestDistrict() already resolves deterministically (strict `<`
   * favors whichever district is checked first — Handelsviertel, given
   * OUTER_DISTRICTS' own order in Districts.ts), so this doesn't need
   * its own special-case for that.
   */
  private buildDistrictSigns() {
    const signRadius = ADEL_RING_OUTER_RADIUS + 4;
    // In the middle of the sidewalk — off the road, and in front of the
    // row houses that stand directly behind the sidewalk's outer edge.
    const sideOffset = MAIN_AVENUE_HALF_WIDTH + SIDEWALK_WIDTH / 2;
    const bearingsDeg = [0, 90, 180, 270];

    for (const bearingDeg of bearingsDeg) {
      const rad = (bearingDeg * Math.PI) / 180;
      const onAvenueX = signRadius * Math.sin(rad);
      const onAvenueZ = signRadius * Math.cos(rad);
      const district = nearestDistrict(onAvenueX, onAvenueZ);

      const perpRad = rad + Math.PI / 2;
      const signX = onAvenueX + Math.sin(perpRad) * sideOffset;
      const signZ = onAvenueZ + Math.cos(perpRad) * sideOffset;
      this.buildSignpost(signX, signZ, rad, district.name, "Bezirk von Kushtar", 1.3);
    }
  }

  /**
   * Stadtschild — a single, larger sign just outside the city wall at
   * the north gate (bearing 0), the same gate the ceremonial avenue
   * toward the palace runs through. "Just one" per the request (not one
   * per gate), so the north gate specifically, as the most prominent of
   * the four.
   */
  private buildCityGateSign() {
    const radius = WALL_RADIUS + 6;
    const x = radius * Math.sin(0);
    const z = radius * Math.cos(0);
    this.buildSignpost(x, z, 0, "KUSHTAR", "Heimat der Königsfamilie Za", 1.6);
  }

  private buildParkSquare(pos: WorldPosition) {
    const size = CELL_SIZE - 2 * LOT_MARGIN + 1;
    const groundY = maxTerrainHeightNear(pos.x, pos.z, size * 0.75);

    const patch = MeshBuilder.CreateGround(
      `park-${pos.x.toFixed(1)}-${pos.z.toFixed(1)}`,
      { width: size, height: size },
      this.scene
    );
    patch.position = new Vector3(pos.x, groundY + 0.03, pos.z);
    patch.material = this.parkMaterial;
    patch.receiveShadows = true;
    // parkMaterial already uses a material-level uScale/vScale (3, 3) and
    // all park squares are the same fixed `size`, so there's no
    // varying-mesh-size stretching here the way there is for streets.

    const bench = MeshBuilder.CreateBox(
      `bench-${pos.x.toFixed(1)}-${pos.z.toFixed(1)}`,
      { width: 1.6, height: 0.4, depth: 0.5 },
      this.scene
    );
    bench.position = new Vector3(pos.x + size * 0.25, groundY + 0.2, pos.z);
    bench.material = this.benchMaterial;
    this.shadows?.addShadowCaster(bench);
  }

  /**
   * The two triangular "gable end" wall sections that close off a pitched
   * roof at each end of the ridge — without these, the two roof slopes
   * meet at the ridge line but leave the triangular wedge underneath them
   * completely open, which is exactly the "you can see into the roof from
   * the side" gap that was reported. Built from raw vertex data (a single
   * 3-vertex triangle, not a primitive) since Babylon doesn't have a bare
   * triangle builder. Uses the WALL material, not the roof material — a
   * gable end is architecturally a triangular extension of the wall, not
   * part of the roof canopy — and spans the wall's actual width (not the
   * roof's overhang-extended width, which sticks out past the wall on
   * purpose).
   */
  private gableEndCapParts(
    width: number,
    depth: number,
    peakHeight: number,
    baseHeight: number,
    material: Material,
    namePrefix: string
  ): Mesh[] {
    const halfWidth = width / 2;
    const makeTriangle = (z: number, name: string) => {
      const mesh = new Mesh(name, this.scene);
      const positions = [-halfWidth, baseHeight, 0, halfWidth, baseHeight, 0, 0, baseHeight + peakHeight, 0];
      const indices = [0, 1, 2];
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      // A simple triangular UV mapping — this mesh is never merged with
      // anything unless every other part also has UVs (MergeMeshes
      // requires an identical attribute set across all source meshes,
      // confirmed directly from the actual runtime error this was
      // missing caused), and every box/cylinder part gets UVs
      // automatically from MeshBuilder, so this needs them too even
      // though nothing here currently varies the texture by UV position.
      const uvs = [0, 0, 1, 0, 0.5, 1];
      const vertexData = new VertexData();
      vertexData.positions = positions;
      vertexData.indices = indices;
      vertexData.normals = normals;
      vertexData.uvs = uvs;
      vertexData.applyToMesh(mesh);
      mesh.position.z = z;
      mesh.material = material;
      return mesh;
    };
    return [makeTriangle(depth / 2, `${namePrefix}-gableFront`), makeTriangle(-depth / 2, `${namePrefix}-gableBack`)];
  }

  /**
   * A pitched gable roof — two angled slabs meeting at a ridge line
   * running along the building's depth — instead of a cone/pyramid.
   * This is the classic peaked-cottage silhouette (Skyrim-style village
   * houses, workshops, shallow-pitched shops all use this), built from
   * two simple rotated boxes rather than a single roof primitive, which
   * is what actually makes it read as a real roof with eaves and a ridge
   * instead of a tent shape. `overhang` extends the roof slightly past
   * the walls on every side, the way an actual roof overhangs its walls.
   * `wallMaterial` is used for the gable end caps this now also builds —
   * see gableEndCapParts.
   */
  private gableRoofParts(
    width: number,
    depth: number,
    peakHeight: number,
    overhang: number,
    baseHeight: number,
    material: Material,
    wallMaterial: Material,
    namePrefix: string
  ): Mesh[] {
    const halfWidth = width / 2 + overhang;
    const slopeLength = Math.sqrt(halfWidth * halfWidth + peakHeight * peakHeight);
    const angle = Math.atan2(peakHeight, halfWidth);
    const thickness = 0.12;
    const roofDepth = depth + overhang * 2;

    const left = MeshBuilder.CreateBox(`${namePrefix}-roofL`, { width: slopeLength, height: thickness, depth: roofDepth }, this.scene);
    left.rotation.z = angle;
    left.position.x = -halfWidth / 2;
    left.position.y = baseHeight + peakHeight / 2;
    left.material = material;

    const right = MeshBuilder.CreateBox(`${namePrefix}-roofR`, { width: slopeLength, height: thickness, depth: roofDepth }, this.scene);
    right.rotation.z = -angle;
    right.position.x = halfWidth / 2;
    right.position.y = baseHeight + peakHeight / 2;
    right.material = material;

    return [left, right, ...this.gableEndCapParts(width, depth, peakHeight, baseHeight, wallMaterial, namePrefix)];
  }

  /** A short stone foundation slab, slightly wider than the walls it sits under — the "raised on a stone base" look real timber/plaster buildings have. */
  private foundationPart(width: number, depth: number, height: number, namePrefix: string): Mesh {
    const f = MeshBuilder.CreateBox(`${namePrefix}-foundation`, { width: width + 0.3, depth: depth + 0.3, height }, this.scene);
    f.position.y = height / 2;
    f.material = this.foundationMaterial;
    return f;
  }

  /** A plank door set into the wall face, plus one low step in front of it. */
  private doorParts(_wallWidth: number, wallDepth: number, doorHeight: number, namePrefix: string): Mesh[] {
    const doorWidth = 0.9;
    const door = MeshBuilder.CreateBox(`${namePrefix}-door`, { width: doorWidth, height: doorHeight, depth: 0.08 }, this.scene);
    door.position.set(0, doorHeight / 2, wallDepth / 2 + 0.02);
    door.material = this.doorMaterial;

    const step = MeshBuilder.CreateBox(`${namePrefix}-step`, { width: doorWidth + 0.4, height: 0.15, depth: 0.5 }, this.scene);
    step.position.set(0, 0.075, wallDepth / 2 + 0.25);
    step.material = this.foundationMaterial;

    return [door, step];
  }

  /** A small stone chimney rising from the roof, offset toward one corner rather than dead-center — that off-center placement is most of what reads as "a real chimney" rather than a decorative spike. */
  private chimneyPart(width: number, depth: number, wallHeight: number, roofPeak: number, namePrefix: string): Mesh {
    const chimney = MeshBuilder.CreateBox(`${namePrefix}-chimney`, { width: 0.45, depth: 0.45, height: roofPeak + 1.1 }, this.scene);
    chimney.position.set(width * 0.28, wallHeight + (roofPeak + 1.1) / 2 - 0.3, depth * 0.22);
    chimney.material = this.foundationMaterial;
    return chimney;
  }

  /** A pair of window shutters flanking a wall-mounted panel — the recognizable "small cottage window" silhouette even without an actual glazed opening cut into the wall. */
  private shutterParts(wallWidth: number, wallDepth: number, sillHeight: number, namePrefix: string, side: 1 | -1, scale = 1): Mesh[] {
    const x = side * wallWidth * 0.3;
    const size = 0.55 * scale;
    const panel = MeshBuilder.CreateBox(`${namePrefix}-windowpanel-${side}`, { width: size, height: size, depth: 0.05 }, this.scene);
    panel.position.set(x, sillHeight, wallDepth / 2 + 0.03);
    panel.material = this.shutterMaterial;
    return [panel];
  }

  /**
   * The apartment-style window grid main-avenue row-houses get, on top
   * of whatever their own archetype (shop/village) already builds —
   * multiple small window panels across the front face, in rows (read
   * as floors) and columns, skipping the ground-floor center position
   * where the door (and, for shops, the sign above it) already sits;
   * plus two vertical columns of stacked windows on each side face.
   * Reuses shutterMaterial (the same small-window-panel look
   * shutterParts already uses elsewhere) rather than a new material —
   * these read as the same kind of window, just many more of them.
   */
  /**
   * A small wood-textured window panel on each of a building's four
   * flat sides (front/back/left/right) — "every building [should] have
   * windows on every side," not just the front the way shutterParts and
   * the shop's own display window already did. Skipped for "hut"
   * (round, no flat side faces to put a window on) and for avenue row-
   * houses (buildApartmentWindows already covers front + both sides
   * far more extensively than a single panel per face would add).
   */
  /**
   * Side and back windows only — for buildings with their own front. The
   * front window is thrown away, not just left out: left out, it was never
   * merged into the building and stayed floating at the world origin
   * (the two stray panels hanging over the plaza).
   */
  private windowsExceptFront(width: number, depth: number, height: number, foundationH: number, namePrefix: string): Mesh[] {
    const [front, ...rest] = this.buildWindowsAllSides(width, depth, height, foundationH, namePrefix);
    front.dispose();
    return rest;
  }

  private buildWindowsAllSides(width: number, depth: number, height: number, foundationH: number, namePrefix: string): Mesh[] {
    // A whole lot bigger than before (cap 0.6 -> 1.3, proportion
    // 0.18x -> 0.35x of width/depth) — per request, for every "single"
    // (non-avenue) house in the district. The front/back offset also
    // had to move out (0.22x -> 0.3x of width) to match — checked
    // numerically against the smallest building footprint this
    // archetype set actually produces (~4.2 units): at the old 0.22x
    // offset, a window this much bigger would have overlapped the
    // centered door (0.9 wide) outright, not just gotten close to it.
    const winSize = Math.min(1.3, width * 0.35, depth * 0.35);
    const y = foundationH + height * 0.55;
    const parts: Mesh[] = [];

    const front = MeshBuilder.CreateBox(`${namePrefix}-win-all-front`, { width: winSize, height: winSize, depth: 0.05 }, this.scene);
    front.position.set(width * 0.3, y, depth / 2 + 0.03);
    front.material = this.windowWoodMaterial;
    parts.push(front);

    const back = MeshBuilder.CreateBox(`${namePrefix}-win-all-back`, { width: winSize, height: winSize, depth: 0.05 }, this.scene);
    back.position.set(-width * 0.3, y, -depth / 2 - 0.03);
    back.material = this.windowWoodMaterial;
    parts.push(back);

    const left = MeshBuilder.CreateBox(`${namePrefix}-win-all-left`, { width: 0.05, height: winSize, depth: winSize }, this.scene);
    left.position.set(-width / 2 - 0.03, y, 0);
    left.material = this.windowWoodMaterial;
    parts.push(left);

    const right = MeshBuilder.CreateBox(`${namePrefix}-win-all-right`, { width: 0.05, height: winSize, depth: winSize }, this.scene);
    right.position.set(width / 2 + 0.03, y, 0);
    right.material = this.windowWoodMaterial;
    parts.push(right);

    return parts;
  }

  private buildApartmentWindows(width: number, depth: number, height: number, foundationH: number, namePrefix: string): Mesh[] {
    const parts: Mesh[] = [];
    const winW = 0.5;
    const winH = 0.62;

    // Front face — multiple rows (floors) x columns, skipping the
    // ground-floor center column where the door/sign already is.
    const frontCols = Math.max(3, Math.round(width / 1.6));
    const frontRows = Math.max(2, Math.round(height / 2.4));
    const centerCol = Math.floor(frontCols / 2);
    for (let row = 0; row < frontRows; row++) {
      const y = foundationH + height * (0.26 + row * (0.62 / Math.max(1, frontRows - 1)));
      for (let col = 0; col < frontCols; col++) {
        if (row === 0 && col === centerCol) continue; // ground floor, center — where the door/sign is
        const x = -width / 2 + (width / (frontCols + 1)) * (col + 1);
        const win = MeshBuilder.CreateBox(`${namePrefix}-win-f-${row}-${col}`, { width: winW, height: winH, depth: 0.05 }, this.scene);
        win.position.set(x, y, depth / 2 + 0.03);
        win.material = this.shutterMaterial;
        parts.push(win);
      }
    }

    // Side faces — two vertical columns (front-ish and back-ish along
    // the building's depth) of stacked windows, one per floor.
    const sideFloors = Math.max(2, Math.round(height / 2.4));
    [-1, 1].forEach((side) => {
      [0.28, 0.72].forEach((depthFrac, colIdx) => {
        const z = -depth / 2 + depth * depthFrac;
        for (let floor = 0; floor < sideFloors; floor++) {
          const y = foundationH + height * (0.24 + floor * (0.64 / Math.max(1, sideFloors - 1)));
          const win = MeshBuilder.CreateBox(
            `${namePrefix}-win-s-${side}-${colIdx}-${floor}`,
            { width: 0.05, height: winH, depth: winW },
            this.scene
          );
          win.position.set((side * width) / 2 + side * 0.03, y, z);
          win.material = this.shutterMaterial;
          parts.push(win);
        }
      });
    });

    return parts;
  }

  /**
   * Composes one of the six fixed house structures from real parts —
   * foundation, walls, a pitched or spired roof, chimney, door, window
   * shutters — rather than a single parametrically-stretched box+cone.
   * Every part here is built in LOCAL space (building footprint centered
   * on the origin, ground at y=0); buildOne merges the result into one
   * mesh and positions that at the building's actual world location.
   *
   * Every wall/roof box gets applyWorldScaledUV called on it right after
   * creation, at BUILDING_TEXTURE_TILE_SIZE — previously nothing here
   * called this at all, so every box face fell back to MeshBuilder's own
   * default per-face UVs, which are NOT consistently oriented across a
   * single box's six faces (front/back get one orientation, left/right
   * another) — that inconsistency is exactly what read as "one side of
   * the house has the texture sideways and the other side has it
   * frontways." Calling this explicitly, with the same fixed tile size,
   * on every wall/roof box forces a single consistent orientation
   * convention across every face of every building.
   */
  private composeBuilding(
    archetype: BuildingArchetype,
    width: number,
    depth: number,
    height: number,
    facadeMat: Material,
    namePrefix: string,
    roofMat: Material
  ): Mesh[] {
    const parts: Mesh[] = [];

    switch (archetype) {
      case "royal": {
        const foundationH = 0.5;
        parts.push(this.foundationPart(width, depth, foundationH, namePrefix));
        const wallH = height;
        const wall = MeshBuilder.CreateBox(`${namePrefix}-wall`, { width, depth, height: wallH }, this.scene);
        wall.position.y = foundationH + wallH / 2;
        wall.material = facadeMat;
        applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(wall);
        // A slightly recessed upper story for a tiered, grander silhouette.
        const upperW = width * 0.7;
        const upperD = depth * 0.7;
        const upperH = height * 0.4;
        const upper = MeshBuilder.CreateBox(`${namePrefix}-upper`, { width: upperW, depth: upperD, height: upperH }, this.scene);
        upper.position.y = foundationH + wallH + upperH / 2;
        upper.material = facadeMat;
        applyWorldScaledUV(upper, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(upper);
        const roof = MeshBuilder.CreateCylinder(`${namePrefix}-roof`, { diameterTop: 0, diameterBottom: Math.max(upperW, upperD) * 1.25, height: height * 0.55, tessellation: 6 }, this.scene);
        roof.position.y = foundationH + wallH + upperH + (height * 0.55) / 2;
        roof.rotation.y = Math.PI / 4;
        roof.material = roofMat;
        parts.push(roof);
        const finial = MeshBuilder.CreateCylinder(`${namePrefix}-finial`, { diameter: 0.18, height: 0.9, tessellation: 6 }, this.scene);
        finial.position.y = foundationH + wallH + upperH + height * 0.55 + 0.45;
        finial.material = this.foundationMaterial;
        parts.push(finial);
        parts.push(...this.doorParts(width, depth, foundationH + Math.min(2.1, wallH * 0.5), namePrefix));
        parts.push(...this.shutterParts(width, depth, foundationH + wallH * 0.65, namePrefix, 1, 1.7)); // Adelsviertel (royal-exclusive archetype) — bigger windows per request
        parts.push(...this.shutterParts(width, depth, foundationH + wallH * 0.65, namePrefix, -1, 1.7));
        break;
      }

      case "church": {
        const foundationH = 0.4;
        parts.push(this.foundationPart(width, depth, foundationH, namePrefix));
        const wall = MeshBuilder.CreateBox(`${namePrefix}-wall`, { width, depth, height }, this.scene);
        wall.position.y = foundationH + height / 2;
        wall.material = facadeMat;
        applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(wall);
        const spireHeight = height * 0.9;
        const spire = MeshBuilder.CreateCylinder(`${namePrefix}-spire`, { diameterTop: 0, diameterBottom: Math.max(width, depth) * 1.05, height: spireHeight, tessellation: 4 }, this.scene);
        spire.position.y = foundationH + height + spireHeight / 2;
        spire.rotation.y = Math.PI / 4;
        spire.material = roofMat;
        parts.push(spire);
        const cross = MeshBuilder.CreateBox(`${namePrefix}-crossV`, { width: 0.1, height: 0.6, depth: 0.1 }, this.scene);
        cross.position.y = foundationH + height + spireHeight + 0.3;
        cross.material = this.foundationMaterial;
        parts.push(cross);
        const crossBar = MeshBuilder.CreateBox(`${namePrefix}-crossH`, { width: 0.35, height: 0.1, depth: 0.1 }, this.scene);
        crossBar.position.y = foundationH + height + spireHeight + 0.42;
        crossBar.material = this.foundationMaterial;
        parts.push(crossBar);
        // A small entry porch — a shallow box overhang above the door.
        const porch = MeshBuilder.CreateBox(`${namePrefix}-porch`, { width: 1.4, height: 0.15, depth: 0.8 }, this.scene);
        porch.position.set(0, foundationH + height * 0.55, depth / 2 + 0.4);
        porch.material = roofMat;
        parts.push(porch);
        parts.push(...this.doorParts(width, depth, foundationH + 2.3, namePrefix));
        break;
      }

      case "shop": {
        const foundationH = 0.3;
        parts.push(this.foundationPart(width, depth, foundationH, namePrefix));
        const wall = MeshBuilder.CreateBox(`${namePrefix}-wall`, { width, depth, height }, this.scene);
        wall.position.y = foundationH + height / 2;
        wall.material = facadeMat;
        applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(wall);
        parts.push(...this.gableRoofParts(width, depth, height * 0.32, 0.4, foundationH + height, roofMat, facadeMat, namePrefix));
        // A storefront awning — a flat overhang jutting out above the door, distinct from the main roof.
        const awning = MeshBuilder.CreateBox(`${namePrefix}-awning`, { width: width * 0.8, height: 0.1, depth: 0.9 }, this.scene);
        awning.position.set(0, foundationH + height * 0.62, depth / 2 + 0.45);
        awning.material = this.shutterMaterial;
        parts.push(awning);
        // A wide display-window panel instead of small shutters — shop,
        // not a cottage. Enlarged (0.55/0.4 -> 0.68/0.5 of width/height)
        // per request — shop is Handelsviertel's own effectively-
        // exclusive archetype now, so this is that district's "bigger
        // windows" request.
        const display = MeshBuilder.CreateBox(`${namePrefix}-display`, { width: width * 0.68, height: height * 0.5, depth: 0.06 }, this.scene);
        display.position.set(0, foundationH + height * 0.35, depth / 2 + 0.03);
        display.material = this.doorMaterial;
        parts.push(display);
        parts.push(...this.doorParts(width, depth, foundationH + Math.min(2.0, height * 0.55), namePrefix));
        break;
      }

      case "hut": {
        const diameter = (width + depth) / 2;
        const wall = MeshBuilder.CreateCylinder(`${namePrefix}-wall`, { diameter, height, tessellation: 12 }, this.scene);
        wall.position.y = height / 2;
        wall.material = this.hutWallMaterial;
        parts.push(wall);
        const roofHeight = height * 0.85;
        const roof = MeshBuilder.CreateCylinder(`${namePrefix}-roof`, { diameterTop: 0, diameterBottom: diameter * 1.2, height: roofHeight, tessellation: 10 }, this.scene);
        roof.position.y = height + roofHeight / 2;
        roof.material = this.thatchRoofMaterial;
        parts.push(roof);
        const chimney = MeshBuilder.CreateCylinder(`${namePrefix}-chimney`, { diameter: 0.3, height: roofHeight * 0.6 + 0.6 }, this.scene);
        chimney.position.set(diameter * 0.15, height + roofHeight * 0.55, diameter * 0.15);
        chimney.material = this.foundationMaterial;
        parts.push(chimney);
        const door = MeshBuilder.CreateBox(`${namePrefix}-door`, { width: 0.7, height: Math.min(1.7, height * 0.75), depth: 0.06 }, this.scene);
        door.position.set(0, Math.min(1.7, height * 0.75) / 2, diameter / 2);
        door.material = this.doorMaterial;
        parts.push(door);
        break;
      }

      case "workshop": {
        const foundationH = 0.3;
        parts.push(this.foundationPart(width, depth, foundationH, namePrefix));
        const wall = MeshBuilder.CreateBox(`${namePrefix}-wall`, { width, depth, height }, this.scene);
        wall.position.y = foundationH + height / 2;
        wall.material = facadeMat;
        applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(wall);
        parts.push(...this.gableRoofParts(width, depth, height * 0.16, 0.5, foundationH + height, roofMat, facadeMat, namePrefix)); // very shallow pitch — near-flat industrial roof
        // A lean-to shed abutting one side — the cluttered, added-onto look a working building accumulates.
        const shedW = width * 0.35;
        const shedD = depth * 0.55;
        const shedH = height * 0.55;
        const shed = MeshBuilder.CreateBox(`${namePrefix}-shed`, { width: shedW, depth: shedD, height: shedH }, this.scene);
        shed.position.set(width / 2 + shedW / 2 - 0.2, foundationH + shedH / 2, -depth / 2 + shedD / 2);
        shed.material = facadeMat;
        applyWorldScaledUV(shed, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(shed);
        // A roof vent — workshops smoke/steam.
        const vent = MeshBuilder.CreateCylinder(`${namePrefix}-vent`, { diameter: 0.35, height: 0.8 }, this.scene);
        vent.position.set(-width * 0.25, foundationH + height + 0.4, 0);
        vent.material = this.foundationMaterial;
        parts.push(vent);
        const wideDoor = MeshBuilder.CreateBox(`${namePrefix}-door`, { width: 1.4, height: Math.min(2.2, height * 0.7), depth: 0.08 }, this.scene);
        wideDoor.position.set(0, Math.min(2.2, height * 0.7) / 2 + foundationH, depth / 2 + 0.02);
        wideDoor.material = this.doorMaterial;
        parts.push(wideDoor);
        break;
      }

      case "barn": {
        // A large, plain gable structure — taller peak than "village"
        // (a real barn roof, not a cottage roof) and no chimney/
        // shutters, just a wide main door and a hayloft opening above
        // it. Reuses the same foundation/gable/door helpers as the
        // other archetypes rather than introducing new geometry
        // primitives, since the actual distinctiveness here is meant
        // to come from scale (barns are placed noticeably bigger, see
        // FARM_SIZE_SCALE / pickArchetype's own size bump for "barn" in
        // generateCityLayout) and the district's own wall/roof
        // materials, not a fundamentally different silhouette.
        const foundationH = 0.35;
        parts.push(this.foundationPart(width, depth, foundationH, namePrefix));
        const wall = MeshBuilder.CreateBox(`${namePrefix}-wall`, { width, depth, height }, this.scene);
        wall.position.y = foundationH + height / 2;
        wall.material = facadeMat;
        applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(wall);
        parts.push(...this.gableRoofParts(width, depth, height * 0.62, 0.45, foundationH + height, roofMat, facadeMat, namePrefix));
        const wideDoor = MeshBuilder.CreateBox(`${namePrefix}-door`, { width: width * 0.3, height: Math.min(2.6, height * 0.75), depth: 0.08 }, this.scene);
        wideDoor.position.set(0, Math.min(2.6, height * 0.75) / 2 + foundationH, depth / 2 + 0.02);
        wideDoor.material = this.doorMaterial;
        parts.push(wideDoor);
        const loftDoor = MeshBuilder.CreateBox(`${namePrefix}-loft`, { width: width * 0.18, height: height * 0.22, depth: 0.06 }, this.scene);
        loftDoor.position.set(0, foundationH + height * 0.88, depth / 2 + 0.02);
        loftDoor.material = this.shutterMaterial;
        parts.push(loftDoor);
        break;
      }

      case "village":
      default: {
        const foundationH = 0.35;
        parts.push(this.foundationPart(width, depth, foundationH, namePrefix));
        const wall = MeshBuilder.CreateBox(`${namePrefix}-wall`, { width, depth, height }, this.scene);
        wall.position.y = foundationH + height / 2;
        wall.material = facadeMat;
        applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
        parts.push(wall);
        parts.push(...this.gableRoofParts(width, depth, height * 0.55, 0.35, foundationH + height, roofMat, facadeMat, namePrefix));
        parts.push(this.chimneyPart(width, depth, foundationH + height, height * 0.55, namePrefix));
        parts.push(...this.doorParts(width, depth, foundationH + Math.min(2.0, height * 0.6), namePrefix));
        parts.push(...this.shutterParts(width, depth, foundationH + height * 0.6, namePrefix, 1));
        break;
      }
    }

    return parts;
  }

  /**
   * A bespoke, one-off structure for the palace landmark specifically —
   * not a scaled-up "royal" archetype. Wide symmetric main hall, a front
   * portico (a row of columns topped with a triangular pediment — reuses
   * the same flat-triangle-with-UVs technique as gableEndCapParts, since
   * that's already verified to merge correctly), and a real dome (a true
   * hemisphere, not a cone) — the combination that actually reads as "a
   * grand parliamentary building" rather than a bigger house. Plus its
   * own garden patch alongside it, using the same ground material as
   * park squares.
   */
  private buildPalace(b: BuildingPlacement) {
    const groundY = sampleTerrainHeight(b.position.x, b.position.z);
    const { width, depth, garden: gardenLayout } = palaceLayout(b);
    const height = b.height;
    const foundationH = 0.6;

    const cols = Math.max(4, Math.round(width * 0.5));
    const rows = Math.max(2, Math.round(height / 1.4));
    const facade = createFacadePair(this.scene, b.colorHex, cols, rows, 11, 0.3, "stone");
    const facadeMat = new StandardMaterial("palaceFacadeMat", this.scene);
    facadeMat.diffuseTexture = facade.diffuse;
    facadeMat.emissiveTexture = facade.emissive;
    facadeMat.emissiveColor = Color3.Black();
    facadeMat.specularColor = Color3.Black();
    facadeMat.backFaceCulling = false; // the pediment triangle below needs this, same reasoning as gableRoofParts
    this.nightGlowMaterials.push(facadeMat);

    const parts: Mesh[] = [];
    parts.push(this.foundationPart(width, depth, foundationH, "palace"));

    const wall = MeshBuilder.CreateBox("palace-wall", { width, depth, height }, this.scene);
    wall.position.y = foundationH + height / 2;
    wall.material = facadeMat;
    parts.push(wall);

    // Front portico: a row of columns plus a pediment, projecting out
    // toward -Z (the palace sits at positive z, facing back toward the
    // plaza at the origin).
    const columnCount = Math.max(4, Math.round(width / 3));
    const columnHeight = height * 0.82;
    const porchDepth = PALACE_PORCH_DEPTH;
    const porchFrontZ = -depth / 2 - porchDepth;
    for (let i = 0; i < columnCount; i++) {
      const cx = -width / 2 + 1 + ((width - 2) / (columnCount - 1)) * i;
      const column = MeshBuilder.CreateCylinder(`palace-column-${i}`, { diameter: 0.55, height: columnHeight, tessellation: 12 }, this.scene);
      column.position.set(cx, foundationH + columnHeight / 2, porchFrontZ);
      column.material = this.foundationMaterial;
      parts.push(column);
    }
    // Flat porch roof the columns support, and the pediment above it —
    // the pediment uses the same raw-triangle-with-UVs approach as
    // gableEndCapParts, just built inline here since it's oriented along
    // a different axis (facing -Z, not capping a Z-running ridge).
    const porchRoof = MeshBuilder.CreateBox("palace-porchroof", { width, depth: porchDepth + 0.6, height: 0.25 }, this.scene);
    porchRoof.position.set(0, foundationH + columnHeight + 0.15, porchFrontZ);
    porchRoof.material = this.foundationMaterial;
    parts.push(porchRoof);

    const pedimentHeight = height * 0.3;
    const pedimentMesh = new Mesh("palace-pediment", this.scene);
    const halfW = width / 2;
    const baseY = foundationH + columnHeight + 0.3;
    const pPositions = [-halfW, baseY, 0, halfW, baseY, 0, 0, baseY + pedimentHeight, 0];
    const pIndices = [0, 1, 2];
    const pNormals: number[] = [];
    VertexData.ComputeNormals(pPositions, pIndices, pNormals);
    const pUvs = [0, 0, 1, 0, 0.5, 1];
    const pVertexData = new VertexData();
    pVertexData.positions = pPositions;
    pVertexData.indices = pIndices;
    pVertexData.normals = pNormals;
    pVertexData.uvs = pUvs;
    pVertexData.applyToMesh(pedimentMesh);
    pedimentMesh.position.z = porchFrontZ;
    pedimentMesh.material = facadeMat;
    parts.push(pedimentMesh);

    // The dome — a true hemisphere, centered on the main roof.
    const domeDiameter = Math.min(width, depth) * 0.6;
    const dome = CreateHemisphere("palace-dome", { diameter: domeDiameter, segments: 16 }, this.scene);
    dome.position.set(0, foundationH + height, 0);
    dome.material = this.roofMaterial;
    parts.push(dome);
    const domeBase = MeshBuilder.CreateCylinder("palace-domebase", { diameter: domeDiameter * 1.08, height: 0.5, tessellation: 24 }, this.scene);
    domeBase.position.set(0, foundationH + height + 0.25, 0);
    domeBase.material = this.foundationMaterial;
    parts.push(domeBase);

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (merged) {
      merged.name = "building-palace-gate";
      merged.position = new Vector3(b.position.x, groundY, b.position.z);
      merged.checkCollisions = true;
      merged.receiveShadows = true;
      this.shadows?.addShadowCaster(merged);
    }

    // Its own garden — a patch of the same ground material as park
    // squares, alongside the palace rather than underneath it.
    const { width: gardenWidth, depth: gardenDepth, x: gardenX } = gardenLayout;
    const gardenGroundY = maxTerrainHeightNear(gardenX, b.position.z, Math.max(gardenWidth, gardenDepth) * 0.5);
    const garden = MeshBuilder.CreateGround("palace-garden", { width: gardenWidth, height: gardenDepth }, this.scene);
    garden.position = new Vector3(gardenX, gardenGroundY + 0.03, b.position.z);
    garden.material = this.parkMaterial;
    garden.receiveShadows = true;
  }

  /**
   * The Rathaus (town hall) — the second of Kushtar's three signature
   * buildings (palace, Rathaus, ancient library), using Adelsviertel's
   * own luxury material pair (Stone Tile Wall/Roof Slates 03) rather
   * than the district's standard Stone Wall 05/Gray Roof 01, same as
   * the small ~5-10% of ordinary Adelsviertel buildings that roll into
   * ADEL_LUXURY_CHANCE — these three landmarks are meant to read as
   * that same luxury tier, just purpose-built rather than a random
   * roll. A prominent clock tower rising off the front face is what
   * actually distinguishes its silhouette from the library's (a dome)
   * and the palace's (a portico + dome) rather than scale alone.
   */
  private buildRathaus(b: BuildingPlacement) {
    const groundY = sampleTerrainHeight(b.position.x, b.position.z);
    const width = b.width;
    const depth = b.depth;
    const height = b.height;
    const foundationH = 0.5;
    const luxury = this.districtMaterials.get("noble");
    const wallMat = luxury?.luxuryWall ?? this.roofMaterial;
    const roofMat = luxury?.luxuryRoof ?? this.roofMaterial;
    if (wallMat instanceof StandardMaterial || wallMat instanceof PBRMaterial) wallMat.backFaceCulling = false;

    const parts: Mesh[] = [];
    parts.push(this.foundationPart(width, depth, foundationH, "rathaus"));

    const wall = MeshBuilder.CreateBox("rathaus-wall", { width, depth, height }, this.scene);
    wall.position.y = foundationH + height / 2;
    wall.material = wallMat;
    applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
    parts.push(wall);

    // A shallow cap rather than a full pitched roof — reads as a
    // civic building's flat/hip roofline, not a house's gable.
    const capH = height * 0.16;
    const cap = MeshBuilder.CreateBox("rathaus-cap", { width: width * 0.97, depth: depth * 0.97, height: capH }, this.scene);
    cap.position.y = foundationH + height + capH / 2;
    cap.material = roofMat;
    parts.push(cap);

    // The clock tower, rising off the entrance (+Z) face.
    const towerW = Math.min(width, depth) * 0.3;
    const towerH = height * 1.35;
    const towerZ = depth / 2 - towerW * 0.4;
    const tower = MeshBuilder.CreateBox("rathaus-tower", { width: towerW, depth: towerW, height: towerH }, this.scene);
    tower.position.set(0, foundationH + towerH / 2, towerZ);
    tower.material = wallMat;
    applyWorldScaledUV(tower, BUILDING_TEXTURE_TILE_SIZE);
    parts.push(tower);
    const spireH = towerH * 0.35;
    const spire = MeshBuilder.CreateCylinder("rathaus-spire", { diameterTop: 0, diameterBottom: towerW * 1.3, height: spireH, tessellation: 4 }, this.scene);
    spire.position.set(0, foundationH + towerH + spireH / 2, towerZ);
    spire.rotation.y = Math.PI / 4;
    spire.material = roofMat;
    parts.push(spire);
    const clockFace = MeshBuilder.CreateDisc("rathaus-clock", { radius: towerW * 0.3, tessellation: 24 }, this.scene);
    clockFace.position.set(0, foundationH + towerH * 0.75, towerZ + towerW / 2 + 0.03);
    clockFace.material = this.doorMaterial;
    parts.push(clockFace);

    parts.push(...this.doorParts(width, depth, foundationH + 2.3, "rathaus"));

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (merged) {
      merged.name = "building-rathaus-hall";
      merged.position = new Vector3(b.position.x, groundY, b.position.z);
      merged.checkCollisions = true;
      merged.receiveShadows = true;
      this.shadows?.addShadowCaster(merged);
    }
  }

  /**
   * The ancient library — the third signature building, using the same
   * Adelsviertel luxury material pair as the Rathaus. A reading-hall
   * dome (smaller than the palace's own) plus a simple front colonnade
   * (columns and a flat porch roof, no pediment) is what distinguishes
   * this silhouette from the other two landmarks.
   */
  private buildLibrary(b: BuildingPlacement) {
    const groundY = sampleTerrainHeight(b.position.x, b.position.z);
    const width = b.width;
    const depth = b.depth;
    const height = b.height;
    const foundationH = 0.5;
    const luxury = this.districtMaterials.get("noble");
    const wallMat = luxury?.luxuryWall ?? this.roofMaterial;
    const roofMat = luxury?.luxuryRoof ?? this.roofMaterial;
    if (wallMat instanceof StandardMaterial || wallMat instanceof PBRMaterial) wallMat.backFaceCulling = false;

    const parts: Mesh[] = [];
    parts.push(this.foundationPart(width, depth, foundationH, "library"));

    const wall = MeshBuilder.CreateBox("library-wall", { width, depth, height }, this.scene);
    wall.position.y = foundationH + height / 2;
    wall.material = wallMat;
    applyWorldScaledUV(wall, BUILDING_TEXTURE_TILE_SIZE);
    parts.push(wall);

    const domeDiameter = Math.min(width, depth) * 0.55;
    const dome = CreateHemisphere("library-dome", { diameter: domeDiameter, segments: 16 }, this.scene);
    dome.position.set(0, foundationH + height, 0);
    dome.material = roofMat;
    parts.push(dome);
    const domeBase = MeshBuilder.CreateCylinder("library-domebase", { diameter: domeDiameter * 1.08, height: 0.4, tessellation: 20 }, this.scene);
    domeBase.position.set(0, foundationH + height + 0.2, 0);
    domeBase.material = this.foundationMaterial;
    parts.push(domeBase);

    // A simple front colonnade off the entrance (+Z) face.
    const columnCount = Math.max(3, Math.round(width / 4));
    const columnHeight = height * 0.72;
    const porchDepth = 1.6;
    const porchZ = depth / 2 + porchDepth / 2 + 0.1;
    for (let i = 0; i < columnCount; i++) {
      const cx = -width / 2 + 1 + ((width - 2) / Math.max(1, columnCount - 1)) * i;
      const column = MeshBuilder.CreateCylinder(`library-column-${i}`, { diameter: 0.45, height: columnHeight, tessellation: 10 }, this.scene);
      column.position.set(cx, foundationH + columnHeight / 2, porchZ);
      column.material = this.foundationMaterial;
      parts.push(column);
    }
    const porchRoof = MeshBuilder.CreateBox("library-porchroof", { width, depth: porchDepth, height: 0.2 }, this.scene);
    porchRoof.position.set(0, foundationH + columnHeight + 0.1, porchZ);
    porchRoof.material = this.foundationMaterial;
    parts.push(porchRoof);

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (merged) {
      merged.name = "building-ancient-library";
      merged.position = new Vector3(b.position.x, groundY, b.position.z);
      merged.checkCollisions = true;
      merged.receiveShadows = true;
      this.shadows?.addShadowCaster(merged);
    }
  }

  /**
   * An explicit ground patch under a building's own footprint (plus some
   * margin), covering whatever the terrain mesh itself would otherwise
   * show through — which, without this, is always grass-toned regardless
   * of district, since the terrain's own texture doesn't know about
   * Bezirk boundaries. This is what makes "buildings stand on the same
   * paving as the sidewalk" (or on green, for the two districts that
   * should) an actual visible surface rather than just the underlying
   * terrain.
   *
   * One uniform material now (groundPatchMaterial, brown_mud_03) across
   * every district — previously this varied per district
   * (groundPatchMaterialFor, since removed) between parkMaterial (green,
   * Adelsviertel/Bauernviertel) and sidewalkMaterial (the other two).
   *
   * Sized to the same lot the building itself uses (CELL_SIZE -
   * 2*LOT_MARGIN) rather than reaching all the way to the street edge
   * (CELL_SIZE - 2*STREET_HALF_WIDTH, a noticeably bigger patch) — the
   * old, larger size was the actual cause of "the floor is so much
   * bigger than the house standing on it": LOT_MARGIN already includes
   * the sidewalk's own width, so a patch sized to it stays close to the
   * building's own footprint instead of visibly overshooting it on every
   * side. This does reopen a strip of bare terrain between the patch's
   * new, smaller edge and the actual street (previously covered by the
   * larger patch) — accepted per request ("make the floor surface
   * smaller") rather than solved by growing the buildings themselves to
   * match the old patch size.
   */
  private buildGroundPatch(x: number, z: number, districtId: string) {
    // Reaches all the way to the new tiny sidewalk's own inner edge
    // (STREET_HALF_WIDTH + MINOR_SIDEWALK_WIDTH) rather than the much
    // larger LOT_MARGIN (which includes the building's own setback, not
    // just the street) — "cover more of its square [cell]" than the
    // previous, smaller size (9 units, 36% of a 25-unit cell), while
    // still meeting the sidewalk with no gap and no overlap. Now 16.6
    // units, ~66% of the cell.
    const size = CELL_SIZE - 2 * (STREET_HALF_WIDTH + MINOR_SIDEWALK_WIDTH);
    const groundY = maxTerrainHeightNear(x, z, size * 0.6);

    // Only Handelsviertel ("trade") keeps the plain square patch — that's
    // the one district shops live in, and shops keep their own regular,
    // "linear" lot shape per request. Every other district's houses get
    // an irregular polygon instead (see buildIrregularGroundPatch) —
    // "not a linear shape... more natural."
    if (districtId === "trade") {
      const patch = MeshBuilder.CreateGround(
        `groundpatch-${x.toFixed(1)}-${z.toFixed(1)}`,
        { width: size, height: size },
        this.scene
      );
      patch.position = new Vector3(x, groundY + 0.02, z);
      patch.material = this.groundPatchMaterial;
      patch.receiveShadows = true;
      applyWorldScaledUV(patch, SIDEWALK_TEXTURE_TILE_SIZE);
      return;
    }

    this.buildIrregularGroundPatch(x, z, size, groundY);
  }

  /**
   * A house's ground patch built as an irregular polygon fan (a center
   * point plus N perimeter points, each at a seeded-jittered radius/
   * angle) rather than a perfect square — "not a linear shape... more
   * natural." Sized so its jittered radius averages out to roughly the
   * same footprint the old square patch covered (targetSize), not
   * smaller or bigger on average, just an irregular outline instead of
   * straight edges and right angles.
   */
  private buildIrregularGroundPatch(x: number, z: number, targetSize: number, groundY: number) {
    const baseRadius = targetSize / 2;
    const sides = 8;
    const positions: number[] = [0, 0, 0]; // center vertex first
    const uvs: number[] = [0.5, 0.5];
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      const jitter = 0.78 + seedFor(x + i * 13.7, z + i * 7.3) * 0.44; // 0.78-1.22x the base radius
      const r = baseRadius * jitter;
      const px = Math.sin(angle) * r;
      const pz = Math.cos(angle) * r;
      positions.push(px, 0, pz);
      uvs.push(0.5 + (px / baseRadius) * 0.5, 0.5 + (pz / baseRadius) * 0.5);
    }
    const indices: number[] = [];
    for (let i = 1; i <= sides; i++) {
      const next = i === sides ? 1 : i + 1;
      indices.push(0, i, next);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);

    const patch = new Mesh(`groundpatch-${x.toFixed(1)}-${z.toFixed(1)}`, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    vertexData.applyToMesh(patch);
    patch.position = new Vector3(x, groundY + 0.02, z);
    patch.material = this.groundPatchMaterial;
    patch.receiveShadows = true;
  }

  /**
   * Bargeboard (the raking trim boards along each gable end's sloped
   * edges), ridge (the beam along the peak, where the two slopes meet),
   * and eaves (trim along each slope's lower, overhanging edge) — the
   * decorative roof-edge detailing every Handelsviertel building gets.
   * Reuses the same halfWidth/slopeLength/angle geometry gableRoofParts
   * itself computes, so this trim aligns with the actual roof slabs
   * it's decorating rather than being independently guessed at.
   *
   * Sized to sit flush against the roof surface rather than protrude
   * above/beyond it — the depth padding (was +0.3 on ridge/eaves,
   * +0.05 on the bargeboard's own Z offset) was pushing the trim
   * visibly past the roof's own gable-end caps, which read as the trim
   * "standing out on top" of the roof rather than tracing its edges.
   */
  private buildRoofTrimParts(
    width: number,
    depth: number,
    peakHeight: number,
    overhang: number,
    baseHeight: number,
    trimMat: Material,
    namePrefix: string
  ): Mesh[] {
    const halfWidth = width / 2 + overhang;
    const slopeLength = Math.sqrt(halfWidth * halfWidth + peakHeight * peakHeight);
    const angle = Math.atan2(peakHeight, halfWidth);
    const roofDepth = depth + overhang * 2;
    const parts: Mesh[] = [];

    // Ridge — sits just barely proud of the peak (0.03 above, was
    // implicitly ~0.06 via a thicker 0.12 box) rather than ballooning
    // above the roof surface.
    const ridge = MeshBuilder.CreateBox(`${namePrefix}-ridge`, { width: 0.16, height: 0.06, depth: roofDepth + 0.05 }, this.scene);
    ridge.position.set(0, baseHeight + peakHeight + 0.02, 0);
    ridge.material = trimMat;
    parts.push(ridge);

    // Eaves — a thin strip along each slope's lower (overhang) edge,
    // flush with the roof's own overhang depth (+0.05 margin, was +0.3).
    [-1, 1].forEach((side) => {
      const eave = MeshBuilder.CreateBox(`${namePrefix}-eave-${side}`, { width: 0.2, height: 0.05, depth: roofDepth + 0.05 }, this.scene);
      eave.position.set(side * halfWidth, baseHeight + 0.02, 0);
      eave.material = trimMat;
      parts.push(eave);
    });

    // Bargeboard — a raking trim board following each slope's own
    // length/angle, at both gable ends (front and back), sitting right
    // against the gable-end cap (+0.02 margin, was +0.05) rather than
    // floating visibly past it.
    [-1, 1].forEach((zSide) => {
      [-1, 1].forEach((xSide) => {
        const barge = MeshBuilder.CreateBox(
          `${namePrefix}-barge-${zSide}-${xSide}`,
          { width: slopeLength, height: 0.06, depth: 0.08 },
          this.scene
        );
        // Matches gableRoofParts' own left/right rotation sign exactly
        // (+angle for negative X, -angle for positive X).
        barge.rotation.z = xSide > 0 ? -angle : angle;
        barge.position.set((xSide * halfWidth) / 2, baseHeight + peakHeight / 2, zSide * (roofDepth / 2 + 0.02));
        barge.material = trimMat;
        parts.push(barge);
      });
    });

    return parts;
  }

  private shopSignMaterials = new Map<string, StandardMaterial>();
  private static readonly SHOP_NAMES = [
    "Kush Emporium", "Green Leaf Trading", "Haze & Co.", "The Budshop", "Kushtar Market Goods", "Greenhouse Wares",
  ];
  /** Pixel size of every shop sign texture — also its aspect ratio in the world. */
  private static readonly SHOP_SIGN_PX = { width: 512, height: 224 };

  /**
   * One shared, self-lit material per sign text — a dark storefront board
   * with bright white lettering that reads clearly by day, at night and
   * from a distance (the glow layer picks up its emissive texture). Cached
   * per name, so however many shops there are, there's one material and
   * texture per distinct name.
   */
  private getShopSignMaterial(name: string): StandardMaterial {
    let mat = this.shopSignMaterials.get(name);
    if (!mat) {
      const texture = createShopSignTexture(this.scene, name, CityBuilder.SHOP_SIGN_PX.width, CityBuilder.SHOP_SIGN_PX.height);
      mat = new StandardMaterial(`shopSignMat-${name}`, this.scene);
      mat.diffuseTexture = texture;
      mat.emissiveTexture = texture;
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.specularColor = Color3.Black();
      this.shopSignMaterials.set(name, mat);
    }
    return mat;
  }

  /**
   * A big, lit signboard mounted flat on a building's front face (local
   * +Z, where the door is), centered above the door at height `y`. The
   * plane is turned to face +Z (CreatePlane's own front faces -Z), so the
   * lettering reads correctly from the street.
   */
  private buildFacadeSign(name: string, wallWidth: number, wallDepth: number, y: number, namePrefix: string, maxWidth = 4.5): Mesh {
    const width = Math.min(wallWidth * 0.85, maxWidth);
    const height = width * (CityBuilder.SHOP_SIGN_PX.height / CityBuilder.SHOP_SIGN_PX.width);
    const sign = MeshBuilder.CreatePlane(`${namePrefix}-sign`, { width, height }, this.scene);
    sign.position.set(0, y + height / 2, wallDepth / 2 + 0.06);
    sign.rotation.y = Math.PI;
    sign.material = this.getShopSignMaterial(name);
    return sign;
  }

  private buildShopSign(width: number, depth: number, height: number, namePrefix: string, seed: number): Mesh {
    const name = CityBuilder.SHOP_NAMES[Math.floor(seed * CityBuilder.SHOP_NAMES.length) % CityBuilder.SHOP_NAMES.length];
    // Just above the storefront awning (composeBuilding's shop case puts it at 62% of the wall height).
    return this.buildFacadeSign(name, width, depth, 0.3 + height * 0.62 + 0.25, namePrefix);
  }

  /**
   * The healing shop ("gas shop") where the player buys items — a bespoke
   * landmark rather than a procedural shop: bigger than any ordinary shop,
   * smooth plastered walls, a steep pyramid roof that stands out on the
   * skyline, and the same lit facade sign every shop has, just larger.
   * Built in local space with its door on +Z, then turned by facingYaw so
   * the door faces the street (see its BUILDINGS entry); the player's
   * interaction point is NPC_PLACEMENTS' "healing-shop" position, just in
   * front of that door.
   */
  private buildHealingShop(b: BuildingPlacement) {
    const groundY = sampleTerrainHeight(b.position.x, b.position.z);
    const { width, depth, height } = b;
    const foundationH = 0.35;
    const tradeMaterials = this.districtMaterials.get("trade");

    // Smooth painted plaster rather than the district's rough brick.
    const plaster = new StandardMaterial("healing-shop-plaster", this.scene);
    plaster.diffuseColor = Color3.FromHexString(b.colorHex);
    plaster.specularColor = new Color3(0.08, 0.08, 0.08);
    plaster.backFaceCulling = false; // the roof's triangular gable caps share it, see gableEndCapParts

    const parts: Mesh[] = [];
    parts.push(this.foundationPart(width, depth, foundationH, b.id));
    const wall = MeshBuilder.CreateBox(`${b.id}-wall`, { width, depth, height }, this.scene);
    wall.position.y = foundationH + height / 2;
    wall.material = plaster;
    parts.push(wall);

    const roofHeight = height * 0.65;
    const roof = MeshBuilder.CreateCylinder(`${b.id}-roof`, { diameterTop: 0, diameterBottom: Math.max(width, depth) * 1.4, height: roofHeight, tessellation: 4 }, this.scene);
    roof.rotation.y = Math.PI / 4; // faces flush over the walls rather than diagonally across them
    roof.position.y = foundationH + height + roofHeight / 2;
    roof.material = tradeMaterials?.houseRoof ?? this.roofMaterial;
    parts.push(roof);

    // Wide double door, a storefront window either side, an awning over the entrance.
    const doorWidth = 2.2;
    const doorHeight = 2.8;
    const door = MeshBuilder.CreateBox(`${b.id}-door`, { width: doorWidth, height: doorHeight, depth: 0.1 }, this.scene);
    door.position.set(0, foundationH + doorHeight / 2, depth / 2 + 0.03);
    door.material = tradeMaterials?.trimMaterial ?? this.doorMaterial;
    parts.push(door);
    [-1, 1].forEach((side) => {
      const win = MeshBuilder.CreateBox(`${b.id}-window-${side}`, { width: width * 0.24, height: height * 0.32, depth: 0.08 }, this.scene);
      win.position.set(side * width * 0.3, foundationH + height * 0.38, depth / 2 + 0.03);
      win.material = this.windowWoodMaterial;
      parts.push(win);
    });
    const awning = MeshBuilder.CreateBox(`${b.id}-awning`, { width: width * 0.9, height: 0.12, depth: 1.4 }, this.scene);
    awning.position.set(0, foundationH + doorHeight + 0.5, depth / 2 + 0.7);
    awning.material = this.shutterMaterial;
    parts.push(awning);
    parts.push(...this.windowsExceptFront(width, depth, height, foundationH, b.id)); // the front has its own storefront

    // The big lit sign, above the awning.
    parts.push(this.buildFacadeSign("GAS SHOP", width, depth, foundationH + doorHeight + 0.85, b.id, width * 0.85));

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!merged) return;
    merged.name = `building-${b.id}`;
    merged.position = new Vector3(b.position.x, groundY, b.position.z);
    if (b.facingYaw) merged.rotation.y = b.facingYaw;
    merged.checkCollisions = true;
    merged.receiveShadows = true;
    this.shadows?.addShadowCaster(merged);
  }

  /**
   * The player's safe house — a cosy plastered cottage with a gable roof,
   * a green front door, a lantern either side and a lit "SAFE HOUSE" sign,
   * so it reads as the player's own place from down the street. Built in
   * local space with the door on +Z, then turned by facingYaw; the
   * interaction spot is the city's SafeHousePlacement.door, just outside.
   */
  private buildSafeHouse(b: BuildingPlacement) {
    const groundY = sampleTerrainHeight(b.position.x, b.position.z);
    const { width, depth, height } = b;
    const foundationH = 0.35;
    const noble = this.districtMaterials.get("noble");

    const plaster = new StandardMaterial(`${b.id}-plaster`, this.scene);
    plaster.diffuseColor = Color3.FromHexString(b.colorHex);
    plaster.specularColor = new Color3(0.06, 0.06, 0.06);
    plaster.backFaceCulling = false; // the gable end caps share it
    const doorMat = new StandardMaterial(`${b.id}-door-mat`, this.scene);
    doorMat.diffuseColor = new Color3(0.13, 0.36, 0.22);
    doorMat.specularColor = new Color3(0.1, 0.1, 0.1);
    const lanternMat = new StandardMaterial(`${b.id}-lantern-mat`, this.scene);
    lanternMat.diffuseColor = new Color3(1, 0.85, 0.5);
    lanternMat.emissiveColor = new Color3(1, 0.78, 0.4);
    lanternMat.disableLighting = true;

    const parts: Mesh[] = [];
    parts.push(this.foundationPart(width, depth, foundationH, b.id));
    const wall = MeshBuilder.CreateBox(`${b.id}-wall`, { width, depth, height }, this.scene);
    wall.position.y = foundationH + height / 2;
    wall.material = plaster;
    parts.push(wall);
    const roofPeak = height * 0.55;
    parts.push(...this.gableRoofParts(width, depth, roofPeak, 0.45, foundationH + height, noble?.houseRoof ?? this.roofMaterial, plaster, b.id));
    parts.push(this.chimneyPart(width, depth, foundationH + height, roofPeak, b.id));

    const doorWidth = 1.5;
    const doorHeight = 2.4;
    const door = MeshBuilder.CreateBox(`${b.id}-door`, { width: doorWidth, height: doorHeight, depth: 0.1 }, this.scene);
    door.position.set(0, foundationH + doorHeight / 2, depth / 2 + 0.03);
    door.material = doorMat;
    parts.push(door);
    const step = MeshBuilder.CreateBox(`${b.id}-step`, { width: doorWidth + 0.8, height: foundationH, depth: 0.7 }, this.scene);
    step.position.set(0, foundationH / 2, depth / 2 + 0.35);
    step.material = this.foundationMaterial;
    parts.push(step);
    const porch = MeshBuilder.CreateBox(`${b.id}-porch`, { width: doorWidth + 1.4, height: 0.12, depth: 1.1 }, this.scene);
    porch.position.set(0, foundationH + doorHeight + 0.35, depth / 2 + 0.55);
    porch.material = this.shutterMaterial;
    parts.push(porch);
    [-1, 1].forEach((side) => {
      const lantern = MeshBuilder.CreateBox(`${b.id}-lantern-${side}`, { width: 0.22, height: 0.32, depth: 0.22 }, this.scene);
      lantern.position.set(side * (doorWidth / 2 + 0.45), foundationH + doorHeight * 0.75, depth / 2 + 0.14);
      lantern.material = lanternMat;
      parts.push(lantern);
      parts.push(...this.shutterParts(width, depth, foundationH + height * 0.45, `${b.id}-front`, side as 1 | -1, 2.2));
    });
    parts.push(...this.windowsExceptFront(width, depth, height, foundationH, b.id)); // the front has its own shuttered windows

    parts.push(this.buildFacadeSign("SAFE HOUSE", width, depth, foundationH + doorHeight + 0.6, b.id, width * 0.6));

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!merged) return;
    merged.name = `building-${b.id}`;
    merged.position = new Vector3(b.position.x, groundY, b.position.z);
    if (b.facingYaw) merged.rotation.y = b.facingYaw;
    merged.checkCollisions = true;
    merged.receiveShadows = true;
    this.shadows?.addShadowCaster(merged);
  }

  private buildOne(b: BuildingPlacement) {
    if (b.id === "palace-gate") {
      this.buildPalace(b);
      return;
    }
    if (b.id === "rathaus-hall") {
      this.buildRathaus(b);
      return;
    }
    if (b.id === "healing-shop") {
      this.buildHealingShop(b);
      return;
    }
    if (b.id === "safe-house") {
      this.buildSafeHouse(b);
      return;
    }
    if (b.id === "ancient-library") {
      this.buildLibrary(b);
      return;
    }

    const groundY = sampleTerrainHeight(b.position.x, b.position.z);
    const isAvenueRow = b.id.startsWith("avenue-row-");
    // Avenue row-houses always use Adelsviertel's own standard materials
    // (Stone Wall 05/Gray Roof 01) regardless of which Bezirk they
    // geographically fall in — the avenue passes through all three outer
    // districts, and this keeps the boulevard's own look consistent
    // along its whole length rather than shifting material with whatever
    // district it happens to be crossing at that point.
    const district = isAvenueRow ? DISTRICTS[0] : nearestDistrict(b.position.x, b.position.z);
    const archetype = b.archetype ?? "village";
    const rawSeed = seedFor(b.position.x, b.position.z);
    const materials = this.districtMaterials.get(district.id);

    // Picks this building's own wall/roof pair from its district's
    // material set — the luxury roll (Adelsviertel's ~5-10% Stone Tile
    // Wall/Roof Slates 03 buildings) takes priority over the regular
    // per-archetype picks, then shop/workshop-specific materials, then
    // the district's own standard house wall/roof as the fallback for
    // everything else (village, hut, barn, church, royal-outside-
    // Adelsviertel, and Adelsviertel's own non-luxury majority).
    let facadeMat: Material;
    let roofMat: Material;
    if (materials) {
      const isLuxury = district.id === "noble" && rawSeed < ADEL_LUXURY_CHANCE && materials.luxuryWall && materials.luxuryRoof;
      if (isLuxury) {
        facadeMat = materials.luxuryWall!;
        roofMat = materials.luxuryRoof!;
      } else if (archetype === "shop" && materials.shopWall) {
        facadeMat = materials.shopWall;
        roofMat = materials.houseRoof;
      } else if (archetype === "workshop" && materials.specialWall && materials.specialRoof) {
        facadeMat = materials.specialWall;
        roofMat = materials.specialRoof;
      } else {
        facadeMat = materials.houseWall;
        roofMat = materials.houseRoof;
      }
    } else {
      // Shouldn't happen once every district has a material set (all
      // four now do) — kept as a robust fallback rather than letting a
      // future district addition crash building generation outright.
      facadeMat = this.roofMaterial;
      roofMat = this.roofMaterial;
    }

    // Gable-roofed archetypes (village/shop/workshop/barn) reuse this
    // same wall material for their triangular gable-end caps too (see
    // gableEndCapParts) — a flat single-sided triangle whose front
    // face's normal ends up pointing inward on one of the two ends.
    // Disabling culling costs nothing visually on the box-shaped wall
    // parts (a closed box's inside is never seen either way) and is
    // what actually makes both gable ends visible from outside instead
    // of just one. Both StandardMaterial and PBRMaterial (everything
    // districtMaterials produces) support this the same way.
    if (facadeMat instanceof StandardMaterial || facadeMat instanceof PBRMaterial) {
      facadeMat.backFaceCulling = false;
    }

    const parts = this.composeBuilding(archetype, b.width, b.depth, b.height, facadeMat, b.id, roofMat);

    // Handelsviertel: every building gets bargeboard/ridge/eaves trim
    // (only shop/village archetypes ever occur here, per this
    // district's archetypeWeights, so the peak/overhang/foundation
    // numbers below only need to cover those two — matched exactly to
    // what composeBuilding's own shop/village cases use internally, or
    // this trim wouldn't align with the actual roof slabs).
    if (district.id === "trade" && materials?.trimMaterial) {
      const isShop = archetype === "shop";
      const roofPeak = isShop ? b.height * 0.32 : b.height * 0.55;
      const overhang = isShop ? 0.4 : 0.35;
      const foundationH = isShop ? 0.3 : 0.35;
      parts.push(
        ...this.buildRoofTrimParts(b.width, b.depth, roofPeak, overhang, foundationH + b.height, materials.trimMaterial, b.id)
      );
    }
    // Every shop gets a signboard above its entrance, "pretty big" per request.
    if (archetype === "shop") {
      parts.push(this.buildShopSign(b.width, b.depth, b.height, b.id, rawSeed));
    }
    // Main-avenue row-houses additionally get the apartment-style window
    // grid — "so it looks like an apartment."
    if (isAvenueRow) {
      const foundationH = archetype === "shop" ? 0.3 : 0.35;
      parts.push(...this.buildApartmentWindows(b.width, b.depth, b.height, foundationH, b.id));
    } else if (archetype !== "hut") {
      // Every other building gets a wood-textured window on each of its
      // four flat sides (at least 2 total, well above the "at least 2"
      // ask) — "make every building have windows on every side," shops
      // included. Hut is skipped (round, no flat side faces); avenue
      // row-houses are handled above instead, kept exactly as they were
      // per request (their own, more extensive window treatment already
      // covers every side).
      const foundationH = archetype === "shop" || archetype === "workshop" ? 0.3 : archetype === "barn" ? 0.35 : archetype === "church" ? 0.4 : archetype === "royal" ? 0.5 : 0.35;
      parts.push(...this.buildWindowsAllSides(b.width, b.depth, b.height, foundationH, b.id));
    }

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!merged) return;
    merged.name = `building-${b.id}`;
    merged.position = new Vector3(b.position.x, groundY, b.position.z);
    if (b.facingYaw) merged.rotation.y = b.facingYaw;
    merged.checkCollisions = true;
    merged.receiveShadows = true;
    this.shadows?.addShadowCaster(merged);
  }
}