// src/babylon/world/WildsBuilder.ts
// The wilds outside the city walls, Skyrim-style: dark pine and spruce
// forests in clusters across the tundra, lone trees and birch groves in
// the open, grey boulders and scrubby bushes — thinning out up the
// foothills and gone above the tree line.
//
// Built for a big world without a big cost:
//  - Every plant/rock kind is one small vertex-coloured mesh drawn many
//    times with thin instances, split into square chunks of the map so
//    the GPU only gets the chunks the camera can see.
//  - Each kind has a detailed and a simple (LOD) version; chunks swap to
//    the simple one further out, and aren't drawn at all past the haze.
//  - Only chunks right around the player cast shadows.
//  - Trees and big rocks are solid via a small pool of invisible
//    colliders that follow the player, not thousands of collision meshes.

import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { CITY_RADIUS, MAP_RADIUS, MOUNTAIN_BASE, fbm, sampleTerrainHeight, smoothstep } from "./TerrainBuilder";

type KindId = "pine" | "spruce" | "birch" | "rock" | "bush";

interface Kind {
  id: KindId;
  hi: Mesh;
  lo: Mesh;
  /** Collider radius at scale 1 (0 = walk-through). */
  solidRadius: number;
  castsShadow: boolean;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  kind: KindId;
}

interface Chunk {
  cx: number;
  cz: number;
  /** Per kind: the detailed and simple copies drawing this chunk's instances. */
  meshes: { kind: Kind; hi: Mesh; lo: Mesh }[];
  solids: Placement[];
  lod: "hi" | "lo" | "off";
  shadowed: boolean;
}

const CHUNK_SIZE = 140;
/** Within this distance a chunk is drawn detailed, out to FAR_DISTANCE simple, and beyond that not at all (it's lost in the haze). */
const NEAR_DISTANCE = 260;
const FAR_DISTANCE = 720;
/** Chunks this close cast shadows. */
const SHADOW_DISTANCE = 110;
/** Placement grid spacing, and the tree line. */
const GRID_STEP = 6.5;
const TREE_LINE = 115;
const ROCK_LINE = 200;
/** Colliders kept around the player. */
const COLLIDER_POOL = 48;
const COLLIDER_RANGE = 26;
const REFRESH_SECONDS = 0.3;

function seed(x: number, z: number, k = 0): number {
  const s = Math.sin(x * 91.17 + z * 47.63 + k * 13.7) * 24634.6345;
  return s - Math.floor(s);
}

/** Bakes a solid colour into a mesh's vertices. */
function paint(mesh: Mesh, color: Color3, jitter = 0) {
  const count = mesh.getTotalVertices();
  const colors: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = 1 + (seed(i, count) - 0.5) * jitter;
    colors.push(color.r * j, color.g * j, color.b * j, 1);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

function merge(name: string, parts: Mesh[], scene: Scene): Mesh {
  const merged = Mesh.MergeMeshes(parts, true, true)!;
  merged.name = name;
  merged.isPickable = false;
  merged.setEnabled(false); // the base shapes themselves are never drawn — chunk copies are
  void scene;
  return merged;
}

function cone(scene: Scene, name: string, height: number, radius: number, y: number, sides: number, color: Color3): Mesh {
  const c = MeshBuilder.CreateCylinder(name, { height, diameterTop: 0, diameterBottom: radius * 2, tessellation: sides }, scene);
  c.position.y = y + height / 2;
  c.bakeCurrentTransformIntoVertices();
  paint(c, color, 0.18);
  return c;
}

function trunk(scene: Scene, name: string, height: number, radius: number, sides: number, color: Color3): Mesh {
  const t = MeshBuilder.CreateCylinder(name, { height, diameterTop: radius * 1.3, diameterBottom: radius * 2, tessellation: sides }, scene);
  t.position.y = height / 2;
  t.bakeCurrentTransformIntoVertices();
  paint(t, color, 0.1);
  return t;
}

/** A lumpy boulder: an icosphere pushed in and out a little, flattened. */
function boulder(scene: Scene, name: string, subdivisions: number, color: Color3): Mesh {
  const r = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions, flat: true }, scene);
  const pos = r.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const k = 0.78 + seed(Math.round(pos[i] * 10), Math.round(pos[i + 2] * 10), Math.round(pos[i + 1] * 10)) * 0.4;
    pos[i] *= k;
    pos[i + 1] *= k * 0.62;
    pos[i + 2] *= k;
  }
  r.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, r.getIndices(), normals);
  r.updateVerticesData(VertexBuffer.NormalKind, normals);
  paint(r, color, 0.25);
  return r;
}

const PINE_GREEN = new Color3(0.16, 0.27, 0.17);
const SPRUCE_GREEN = new Color3(0.12, 0.22, 0.16);
const BIRCH_LEAF = new Color3(0.55, 0.6, 0.28);
const BARK = new Color3(0.3, 0.22, 0.16);
const BIRCH_BARK = new Color3(0.82, 0.8, 0.74);
const STONE = new Color3(0.5, 0.49, 0.47);
const SCRUB = new Color3(0.36, 0.4, 0.22);

export class WildsBuilder {
  private kinds = new Map<KindId, Kind>();
  private chunks: Chunk[] = [];
  private colliders: Mesh[] = [];
  private refreshTimer = 0;

  constructor(scene: Scene, private shadows?: ShadowGenerator) {
    const mat = new StandardMaterial("wilds-mat", scene);
    mat.specularColor = Color3.Black();
    mat.diffuseColor = Color3.White();
    mat.freeze();
    this.buildKinds(scene, mat);
    this.buildChunks(scene, this.place());

    for (let i = 0; i < COLLIDER_POOL; i++) {
      const c = MeshBuilder.CreateCylinder(`wilds-collider-${i}`, { height: 6, diameter: 1 }, scene);
      c.isVisible = false;
      c.isPickable = false;
      c.checkCollisions = true;
      c.setEnabled(false);
      this.colliders.push(c);
    }
  }

  /** The detailed and simple shape of each kind. */
  private buildKinds(scene: Scene, mat: StandardMaterial) {
    const make = (id: KindId, hiParts: Mesh[], loParts: Mesh[], solidRadius: number, castsShadow: boolean) => {
      const hi = merge(`wilds-${id}-hi`, hiParts, scene);
      const lo = merge(`wilds-${id}-lo`, loParts, scene);
      hi.material = mat;
      lo.material = mat;
      this.kinds.set(id, { id, hi, lo, solidRadius, castsShadow });
    };
    // Pine: a tiered conifer about 10 m tall.
    make(
      "pine",
      [
        trunk(scene, "p-t", 3, 0.28, 6, BARK),
        cone(scene, "p-1", 4.4, 2.7, 1.1, 8, PINE_GREEN),
        cone(scene, "p-2", 3.8, 2.1, 3.5, 8, PINE_GREEN.scale(1.08)),
        cone(scene, "p-3", 3.4, 1.4, 5.9, 8, PINE_GREEN.scale(1.16)),
      ],
      [trunk(scene, "p-tl", 2.2, 0.28, 4, BARK), cone(scene, "p-l", 8.4, 2.5, 1.0, 5, PINE_GREEN)],
      0.45,
      true
    );
    // Spruce: taller and narrower.
    make(
      "spruce",
      [
        trunk(scene, "s-t", 3, 0.24, 6, BARK),
        cone(scene, "s-1", 5.2, 2.1, 0.9, 8, SPRUCE_GREEN),
        cone(scene, "s-2", 4.8, 1.55, 4.1, 8, SPRUCE_GREEN.scale(1.1)),
        cone(scene, "s-3", 4.0, 1.0, 7.2, 7, SPRUCE_GREEN.scale(1.2)),
      ],
      [trunk(scene, "s-tl", 2, 0.24, 4, BARK), cone(scene, "s-l", 10.2, 2.0, 0.9, 5, SPRUCE_GREEN)],
      0.4,
      true
    );
    // Birch: pale trunk, round yellow-green crown.
    const crown = (name: string, sub: number, y: number, r: number) => {
      const s = MeshBuilder.CreateIcoSphere(name, { radius: r, subdivisions: sub, flat: true }, scene);
      s.position.y = y;
      s.scaling.y = 1.2;
      s.bakeCurrentTransformIntoVertices();
      paint(s, BIRCH_LEAF, 0.3);
      return s;
    };
    make(
      "birch",
      [trunk(scene, "b-t", 5.5, 0.18, 6, BIRCH_BARK), crown("b-c1", 1, 5.6, 1.9), crown("b-c2", 1, 4.4, 1.4)],
      [trunk(scene, "b-tl", 5, 0.18, 4, BIRCH_BARK), crown("b-cl", 0, 5.4, 2.1)],
      0.3,
      true
    );
    make("rock", [boulder(scene, "r-h", 2, STONE)], [boulder(scene, "r-l", 0, STONE)], 0.85, true);
    const bushHi = MeshBuilder.CreateIcoSphere("u-h", { radius: 0.9, subdivisions: 1, flat: true }, scene);
    bushHi.scaling.y = 0.6;
    bushHi.position.y = 0.3;
    bushHi.bakeCurrentTransformIntoVertices();
    paint(bushHi, SCRUB, 0.35);
    const bushLo = MeshBuilder.CreateIcoSphere("u-l", { radius: 0.9, subdivisions: 0, flat: true }, scene);
    bushLo.scaling.y = 0.6;
    bushLo.position.y = 0.3;
    bushLo.bakeCurrentTransformIntoVertices();
    paint(bushLo, SCRUB, 0.35);
    make("bush", [bushHi], [bushLo], 0, false);
  }

  /** Where everything goes: forests in clusters, scattered trees, rocks and scrub on the open tundra. */
  private place(): Placement[] {
    const out: Placement[] = [];
    const inner = CITY_RADIUS + 18;
    const outer = MAP_RADIUS - 90;
    for (let gx = -outer; gx <= outer; gx += GRID_STEP) {
      for (let gz = -outer; gz <= outer; gz += GRID_STEP) {
        const s1 = seed(gx, gz);
        const s2 = seed(gx, gz, 1);
        const x = gx + (s1 - 0.5) * GRID_STEP * 0.9;
        const z = gz + (s2 - 0.5) * GRID_STEP * 0.9;
        const dist = Math.hypot(x, z);
        if (dist < inner || dist > outer) continue;
        const y = sampleTerrainHeight(x, z);
        const s3 = seed(gx, gz, 2);
        const yaw = s3 * Math.PI * 2;

        // Forest mask: big clustered stands, densest in the middle band of
        // the wilds and thinning up the foothills.
        const forest = smoothstep(0.5, 0.62, fbm(x * 0.0055 + 5, z * 0.0055 - 2, 3)) * (1 - smoothstep(MOUNTAIN_BASE - 80, MOUNTAIN_BASE + 120, dist));
        const nearCity = smoothstep(inner, inner + 60, dist); // a clear apron around the walls
        if (y < TREE_LINE && s3 < forest * 0.85 * nearCity) {
          const conifer = seed(gx, gz, 3);
          const kind: KindId = conifer < 0.55 ? "pine" : conifer < 0.92 ? "spruce" : "birch";
          out.push({ x, y, z, yaw, scale: 0.75 + seed(gx, gz, 4) * 0.6, kind });
          continue;
        }
        // Open ground: the odd lone tree or birch, rocks, scrub.
        const r = seed(gx, gz, 5);
        if (y < TREE_LINE && r < 0.012 * nearCity) {
          out.push({ x, y, z, yaw, scale: 0.8 + s1 * 0.5, kind: s2 < 0.5 ? "birch" : "pine" });
        } else if (y < ROCK_LINE && r > 0.985) {
          out.push({ x, y: y - 0.3, z, yaw, scale: 0.6 + s1 * 1.6, kind: "rock" });
        } else if (y < TREE_LINE && r > 0.955 && r <= 0.985) {
          out.push({ x, y, z, yaw, scale: 0.6 + s1 * 0.7, kind: "bush" });
        }
      }
    }
    return out;
  }

  /** Splits the placements into chunks, each with its own instance buffers per kind. */
  private buildChunks(scene: Scene, placements: Placement[]) {
    const byChunk = new Map<string, Placement[]>();
    for (const p of placements) {
      const key = `${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.z / CHUNK_SIZE)}`;
      const list = byChunk.get(key);
      if (list) list.push(p);
      else byChunk.set(key, [p]);
    }
    const matrix = new Matrix();
    const q = new Quaternion();
    const scale = new Vector3();
    const pos = new Vector3();
    for (const [key, list] of byChunk) {
      const [ix, iz] = key.split(",").map(Number);
      const chunk: Chunk = {
        cx: (ix + 0.5) * CHUNK_SIZE,
        cz: (iz + 0.5) * CHUNK_SIZE,
        meshes: [],
        solids: [],
        lod: "off",
        shadowed: false,
      };
      for (const kind of this.kinds.values()) {
        const ofKind = list.filter((p) => p.kind === kind.id);
        if (ofKind.length === 0) continue;
        const buffer = new Float32Array(ofKind.length * 16);
        ofKind.forEach((p, i) => {
          Quaternion.FromEulerAnglesToRef(0, p.yaw, 0, q);
          scale.setAll(p.scale);
          pos.set(p.x, p.y, p.z);
          Matrix.ComposeToRef(scale, q, pos, matrix);
          matrix.copyToArray(buffer, i * 16);
          if (kind.solidRadius > 0) chunk.solids.push(p);
        });
        const copy = (base: Mesh, lod: string) => {
          // Its own copy of the (tiny) geometry, not a clone sharing it:
          // thin-instance buffers live on the geometry, so chunks sharing
          // one would overwrite each other's trees.
          const m = new Mesh(`wilds-${kind.id}-${lod}-${key}`, scene);
          VertexData.ExtractFromMesh(base).applyToMesh(m);
          m.material = base.material;
          m.isPickable = false;
          m.setEnabled(false);
          m.thinInstanceSetBuffer("matrix", buffer, 16, true);
          m.thinInstanceRefreshBoundingInfo(false);
          m.alwaysSelectAsActiveMesh = false;
          m.doNotSyncBoundingInfo = true;
          m.freezeWorldMatrix();
          return m;
        };
        chunk.meshes.push({ kind, hi: copy(kind.hi, "hi"), lo: copy(kind.lo, "lo") });
      }
      this.chunks.push(chunk);
    }
  }

  /** Chunk detail, shadows and the nearby colliders — call every frame (does real work a few times a second). */
  update(dt: number, playerPos: Vector3, cameraPos: Vector3) {
    this.refreshTimer -= dt;
    if (this.refreshTimer > 0) return;
    this.refreshTimer = REFRESH_SECONDS;

    for (const chunk of this.chunks) {
      const d = Math.hypot(chunk.cx - cameraPos.x, chunk.cz - cameraPos.z) - CHUNK_SIZE * 0.7;
      const lod: Chunk["lod"] = d < NEAR_DISTANCE ? "hi" : d < FAR_DISTANCE ? "lo" : "off";
      if (lod !== chunk.lod) {
        chunk.lod = lod;
        for (const m of chunk.meshes) {
          m.hi.setEnabled(lod === "hi");
          m.lo.setEnabled(lod === "lo");
        }
      }
      const shadowed = lod === "hi" && Math.hypot(chunk.cx - playerPos.x, chunk.cz - playerPos.z) - CHUNK_SIZE * 0.7 < SHADOW_DISTANCE;
      if (shadowed !== chunk.shadowed && this.shadows) {
        chunk.shadowed = shadowed;
        for (const m of chunk.meshes) {
          if (!m.kind.castsShadow) continue;
          if (shadowed) this.shadows.addShadowCaster(m.hi, false);
          else this.shadows.removeShadowCaster(m.hi, false);
        }
      }
    }
    this.placeColliders(playerPos);
  }

  /** Moves the collider pool onto the trees and rocks nearest the player. */
  private placeColliders(playerPos: Vector3) {
    const near: { p: Placement; d: number; r: number }[] = [];
    for (const chunk of this.chunks) {
      if (Math.abs(chunk.cx - playerPos.x) > CHUNK_SIZE / 2 + COLLIDER_RANGE || Math.abs(chunk.cz - playerPos.z) > CHUNK_SIZE / 2 + COLLIDER_RANGE) continue;
      for (const p of chunk.solids) {
        const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
        if (d < COLLIDER_RANGE) near.push({ p, d, r: this.kinds.get(p.kind)!.solidRadius * p.scale });
      }
    }
    near.sort((a, b) => a.d - b.d);
    this.colliders.forEach((c, i) => {
      const n = near[i];
      if (!n) {
        c.setEnabled(false);
        return;
      }
      c.setEnabled(true);
      c.position.set(n.p.x, n.p.y + 3, n.p.z);
      c.scaling.set(n.r * 2, 1, n.r * 2);
    });
  }
}
