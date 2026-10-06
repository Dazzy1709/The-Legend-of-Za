// src/babylon/world/TerrainBuilder.ts
// The ground of the whole world: the flat plateau the capital sits on,
// then wide Skyrim-style wilds — rolling tundra hills and valleys, rising
// into foothills and a ring of snow-capped mountains on the horizon.
//
// `sampleTerrainHeight` is the single source of truth for elevation; the
// player, NPCs, buildings, trees and vehicles all stand on it, so the
// visual mesh and gameplay can never drift apart.
//
// Performance: the world is ~2.3 km across, but the mesh is a polar grid
// whose rings are tight near the city (where you walk) and widen with
// distance (where hills and mountains are big and seen through haze) —
// about 50k vertices for the lot, one draw call.

import { Color3, Mesh, Scene, VertexData } from "@babylonjs/core";
import { createPbrTextureSetMaterial } from "./PbrTextureSet";
import { applyWorldScaledUV } from "./UvUtils";

/** Flat plateau the city sits on. */
export const CITY_RADIUS = 250;
/** The wilds: hills and valleys from the city out to here, where the mountains begin. */
export const MOUNTAIN_BASE = 780;
/** World edge (the far side of the mountain ring). */
export const MAP_RADIUS = 1150;

/** Ring spacing of the terrain mesh: fine near the city, coarse far out. */
const INNER_RING_STEP = 4;
const INNER_DETAIL_RADIUS = CITY_RADIUS + 20;
const OUTER_RING_GROWTH = 0.032; // extra metres of ring spacing per metre beyond INNER_DETAIL_RADIUS
const ANGULAR_SEGMENTS = 360;

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

export function fbm(x: number, z: number, octaves = 4): number {
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

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The single source of truth for world elevation at any (x, z). */
export function sampleTerrainHeight(x: number, z: number): number {
  const dist = Math.sqrt(x * x + z * z);
  const city = fbm(x * 0.05, z * 0.05) * 0.25;
  if (dist <= CITY_RADIUS) return city;

  const out = dist - CITY_RADIUS;
  // Rolling tundra: broad swells and dips (valleys a few metres below
  // the plateau, hilltops up to ~20 m), with small bumps on top. Eases in
  // over the first ~90 m past the plateau so the city edge stays level.
  const ease = smoothstep(0, 90, out);
  const swells = (fbm(x * 0.0085 + 11, z * 0.0085 - 7, 4) - 0.38) * 34;
  const bumps = fbm(x * 0.06, z * 0.06, 2) * 2.2;
  const hills = Math.max(-4, swells) + bumps;

  // Foothills rising into the mountain ring: ridged noise gives sharp
  // crests and valleys rather than soft blobs.
  const ridgeNoise = fbm(x * 0.0042 + 3.1, z * 0.0042 - 8.4, 5);
  const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
  const foothills = smoothstep(MOUNTAIN_BASE - 220, MOUNTAIN_BASE + 60, dist) * (30 + ridge * 60);
  const peaks = smoothstep(MOUNTAIN_BASE, MAP_RADIUS - 120, dist) * Math.pow(ridge, 1.8) * 230;

  return city * (1 - ease) + hills * ease + foothills + peaks;
}

// Ground tints, multiplied over the ground texture. The city plateau
// keeps the texture as it is; the wilds go a muted tundra olive (drier
// gold in patches), steep slopes and high ground turn to bare rock, and
// the peaks to snow.
const PLATEAU = new Color3(1, 1, 1);
// The wilds use a grass texture, tinted toward muted Skyrim tundra.
const TUNDRA = new Color3(0.86, 0.9, 0.68);
const DRY_GRASS = new Color3(1.05, 0.95, 0.68);
const ROCK = new Color3(0.82, 0.8, 0.8);
const SNOW = new Color3(2.1, 2.15, 2.2);
const TERRAIN_TEXTURE_TILE_SIZE = 9; // metres one repeat of the ground texture covers
const WILDS_TEXTURE_TILE_SIZE = 6;
/** The plateau mesh (city ground texture) covers the rings out to here; the wilds mesh (grass) from here on. */
const PLATEAU_MESH_RADIUS = CITY_RADIUS - 6;

function groundColor(x: number, z: number, h: number, slopeUp: number): Color3 {
  const dist = Math.hypot(x, z);
  const wild = smoothstep(CITY_RADIUS - 10, CITY_RADIUS + 40, dist);
  const grass = Color3.Lerp(TUNDRA, DRY_GRASS, smoothstep(0.45, 0.7, fbm(x * 0.02 + 40, z * 0.02 - 40, 3)));
  let c = Color3.Lerp(PLATEAU, grass, wild);
  // Rock where it's steep, or high (greyed down from the grass texture).
  const rockiness = Math.max(smoothstep(0.88, 0.7, slopeUp), smoothstep(55, 95, h));
  c = Color3.Lerp(c, ROCK, rockiness * wild);
  // Snow caps, thinner on steep faces.
  const snow = smoothstep(140, 185, h) * smoothstep(0.55, 0.8, slopeUp);
  return Color3.Lerp(c, SNOW, snow);
}

/** Radii of the mesh's rings, from the centre out to the edge. */
function ringRadii(): number[] {
  const radii = [0];
  let r = 0;
  while (r < MAP_RADIUS + 40) {
    const step = r < INNER_DETAIL_RADIUS ? INNER_RING_STEP : INNER_RING_STEP + (r - INNER_DETAIL_RADIUS) * OUTER_RING_GROWTH;
    r += step;
    radii.push(r);
  }
  return radii;
}

export class TerrainBuilder {
  /** The city plateau's ground. */
  readonly ground: Mesh;
  /** Everything outside it — hills, valleys, mountains. */
  readonly wilds: Mesh;

  constructor(scene: Scene) {
    const radii = ringRadii();
    const positions: number[] = [];
    const indices: number[] = [];
    // Centre vertex, then ANGULAR_SEGMENTS vertices per ring.
    positions.push(0, sampleTerrainHeight(0, 0), 0);
    for (let ri = 1; ri < radii.length; ri++) {
      const r = radii[ri];
      for (let s = 0; s < ANGULAR_SEGMENTS; s++) {
        const a = (s / ANGULAR_SEGMENTS) * Math.PI * 2;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        positions.push(x, sampleTerrainHeight(x, z), z);
      }
    }
    const ringStart = (ri: number) => 1 + (ri - 1) * ANGULAR_SEGMENTS;
    for (let s = 0; s < ANGULAR_SEGMENTS; s++) {
      indices.push(0, ringStart(1) + s, ringStart(1) + ((s + 1) % ANGULAR_SEGMENTS));
    }
    let splitIndex = 0; // index-buffer offset where the wilds rings begin
    for (let ri = 1; ri < radii.length - 1; ri++) {
      if (!splitIndex && radii[ri] >= PLATEAU_MESH_RADIUS) splitIndex = indices.length;
      const a0 = ringStart(ri);
      const b0 = ringStart(ri + 1);
      for (let s = 0; s < ANGULAR_SEGMENTS; s++) {
        const s1 = (s + 1) % ANGULAR_SEGMENTS;
        indices.push(a0 + s, b0 + s, b0 + s1);
        indices.push(a0 + s, b0 + s1, a0 + s1);
      }
    }
    let normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    // Wound the wrong way round for Babylon? Flip so the faces (and normals) point up.
    if (normals[1] < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const t = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = t;
      }
      normals = [];
      VertexData.ComputeNormals(positions, indices, normals);
    }
    const colors: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const c = groundColor(positions[i], positions[i + 2], positions[i + 1], normals[i + 1]);
      colors.push(c.r, c.g, c.b, 1);
    }

    // Two meshes over the same vertices: the plateau with the city's
    // ground texture, the wilds with grass. They share the ring between
    // them, so there's no seam.
    const build = (name: string, tris: number[]) => {
      const mesh = new Mesh(name, scene);
      const data = new VertexData();
      data.positions = positions;
      data.indices = tris;
      data.normals = normals;
      data.colors = colors;
      data.applyToMesh(mesh);
      mesh.checkCollisions = false;
      mesh.receiveShadows = true;
      return mesh;
    };
    this.ground = build("terrain", indices.slice(0, splitIndex));
    this.ground.material = createPbrTextureSetMaterial(scene, {
      name: "brown_mud_03",
      diffuseFile: "brown_mud_03_diff_1k.jpg",
      normalFile: "brown_mud_03_nor_gl_1k.png",
      uScale: 1,
      vScale: 1,
    });
    applyWorldScaledUV(this.ground, TERRAIN_TEXTURE_TILE_SIZE);

    this.wilds = build("terrain-wilds", indices.slice(splitIndex));
    // (Not grass_medium_01: that's a sheet of grass-card cutouts on black
    // for GrassBuilder, and tiled as ground it reads black with green flecks.)
    this.wilds.material = createPbrTextureSetMaterial(scene, {
      name: "leafy_grass",
      diffuseFile: "leafy_grass_diff_512.jpg",
      normalFile: "leafy_grass_nor_gl_512.png",
      roughnessFile: "leafy_grass_rough_512.jpg",
      uScale: 1,
      vScale: 1,
    });
    applyWorldScaledUV(this.wilds, WILDS_TEXTURE_TILE_SIZE);
  }
}
