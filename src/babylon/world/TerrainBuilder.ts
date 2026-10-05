// src/babylon/world/TerrainBuilder.ts
// Builds a single ground mesh whose elevation and color are both driven by
// `sampleTerrainHeight`/`colorForHeight` below — the same functions are
// exported and reused elsewhere (e.g. by a player controller, to walk on
// slopes, and by a city/building placer, to seat buildings correctly), so
// the visual mesh and the gameplay world can never drift apart.

import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { createPbrTextureSetMaterial } from "./PbrTextureSet";
import { applyWorldScaledUV } from "./UvUtils";

export const CITY_RADIUS = 200; // flat plateau where the city sits
export const MOUNTAIN_BASE = 300; // rolling outskirts end / mountains begin
export const MAP_RADIUS = 320; // world edge
const MAP_SIZE = MAP_RADIUS * 2 + 20;
const SUBDIVISIONS = 160;

// ---------- deterministic value noise (no external noise library) ----------

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const h00 = hash(xi, zi);
  const h10 = hash(xi + 1, zi);
  const h01 = hash(xi, zi + 1);
  const h11 = hash(xi + 1, zi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

function fbm(x: number, z: number, octaves = 4): number {
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise(x * freq, z * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / max; // 0..1
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The single source of truth for world elevation at any (x, z). */
export function sampleTerrainHeight(x: number, z: number): number {
  const dist = Math.sqrt(x * x + z * z);

  if (dist <= CITY_RADIUS) {
    // Flat plateau for the city — faint noise so it isn't a billiard table.
    return fbm(x * 0.05, z * 0.05) * 0.25;
  }

  const rollingHills = fbm(x * 0.045, z * 0.045) * 3.5;

  if (dist <= MOUNTAIN_BASE) {
    const t = smoothstep(CITY_RADIUS, MOUNTAIN_BASE, dist);
    return rollingHills * t;
  }

  const mountainT = smoothstep(MOUNTAIN_BASE, MAP_RADIUS, dist);
  const ridge = fbm(x * 0.018, z * 0.018, 5);
  const peakiness = Math.pow(ridge, 1.4);
  return rollingHills + 4 + peakiness * 34 * mountainT;
}

const GRASS = new Color3(1, 1, 1); // neutral — lets brown_mud_03 show through untinted across the flat city plateau, rather than multiplying it toward green the way the old grass tint did
const ROCK = new Color3(0.47, 0.44, 0.39);
const SNOW = new Color3(0.9, 0.92, 0.95);
const TERRAIN_TEXTURE_TILE_SIZE = 9; // real-world size, in units, one repeat of the ground texture represents — see applyWorldScaledUV

function colorForHeight(h: number): Color3 {
  if (h < 1.5) return GRASS;
  if (h < 8) return Color3.Lerp(GRASS, ROCK, smoothstep(1.5, 8, h));
  if (h < 26) return ROCK;
  return Color3.Lerp(ROCK, SNOW, smoothstep(26, 34, h));
}

export class TerrainBuilder {
  readonly ground: Mesh;

  constructor(scene: Scene) {
    this.ground = MeshBuilder.CreateGround(
      "terrain",
      { width: MAP_SIZE, height: MAP_SIZE, subdivisions: SUBDIVISIONS, updatable: true },
      scene
    );

    const positions = this.ground.getVerticesData(VertexBuffer.PositionKind) as number[];
    const colors: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      const h = sampleTerrainHeight(x, z);
      positions[i + 1] = h;
      const c = colorForHeight(h);
      colors.push(c.r, c.g, c.b, 1);
    }
    this.ground.updateVerticesData(VertexBuffer.PositionKind, positions);
    this.ground.setVerticesData(VertexBuffer.ColorKind, colors);

    const normals: number[] = [];
    VertexData.ComputeNormals(positions, this.ground.getIndices()!, normals);
    this.ground.updateVerticesData(VertexBuffer.NormalKind, normals);

    const mat = createPbrTextureSetMaterial(scene, {
      name: "brown_mud_03",
      diffuseFile: "brown_mud_03_diff_1k.jpg",
      normalFile: "brown_mud_03_nor_gl_1k.png",
      uScale: 1,
      vScale: 1,
    });
    this.ground.material = mat;
    // The terrain mesh is ~660 units across — without this, PBRMaterial's
    // default UVs (0->1 across the whole mesh) would smear a single
    // texture repeat over the entire map. Needs the normals computed
    // just above first, since applyWorldScaledUV reads them.
    applyWorldScaledUV(this.ground, TERRAIN_TEXTURE_TILE_SIZE);

    // Height following is handled by sampling `sampleTerrainHeight` directly
    // (e.g. from a player controller) rather than physics collision against
    // the terrain mesh, so player Y stays perfectly smooth on slopes instead
    // of fighting the collision solver. Buildings can still block movement
    // via their own checkCollisions elsewhere.
    this.ground.checkCollisions = false;
    this.ground.receiveShadows = true;
  }
}