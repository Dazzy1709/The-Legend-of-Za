// src/babylon/world/GrassBuilder.ts
// Real 3D grass — small alpha-cutout "cross-quad" cards (two crossed
// planes, the standard cheap-foliage technique) scattered across the
// terrain using thin instances, not a flat ground texture. grass_medium_01
// is a card *atlas*: several distinct grass-tuft cutouts sharing one
// 1024x1024 sheet (with a separate alpha/opacity mask, since the diffuse
// is a JPG and can't carry its own alpha channel), rather than a tileable
// ground material — so this deliberately does not reuse
// PbrTextureSet.ts's createPbrTextureSetMaterial helper, which wraps/tiles
// its textures; each grass card instead samples one fixed sub-rectangle of
// the atlas, at CLAMP wrap, never tiled.

import { Color3, Matrix, Mesh, PBRMaterial, Quaternion, Scene, Texture, Vector3, VertexData } from "@babylonjs/core";
import { sampleTerrainHeight } from "./TerrainBuilder";
import { textureSetFolder } from "../../content/assetPaths";

function seedFor(x: number, z: number): number {
  const s = Math.sin(x * 91.345 + z * 47.853) * 5237.914;
  return s - Math.floor(s);
}

/**
 * One sub-rectangle of the atlas, in source-image pixels (top-left
 * origin, 1024x1024) — found by thresholding the alpha channel and
 * taking the five clean, non-overlapping tuft-clump blobs in the
 * atlas's lower third (the scattered individual blade/leaf shapes
 * filling the rest of the sheet aren't self-contained card cutouts the
 * same way). cardAspect is height/width of the crop, used so each
 * card's own plane isn't stretched off the crop's real proportions.
 */
interface AtlasVariant {
  px: [number, number, number, number]; // x0, y0, x1, y1
}

const ATLAS_SIZE = 1024;
const ATLAS_VARIANTS: AtlasVariant[] = [
  { px: [199, 759, 559, 927] },
  { px: [598, 774, 937, 885] },
  { px: [244, 904, 513, 1024] },
  { px: [590, 882, 809, 1024] },
  { px: [25, 891, 207, 1024] },
];

function pxToUv([x0, y0, x1, y1]: [number, number, number, number]) {
  // Babylon's Texture defaults to invertY=true (the standard WebGL
  // convention), so v=0 is the *bottom* of the source file and v=1 is
  // the top — hence 1 - y/size here, not y/size directly.
  return { u0: x0 / ATLAS_SIZE, u1: x1 / ATLAS_SIZE, v0: 1 - y1 / ATLAS_SIZE, v1: 1 - y0 / ATLAS_SIZE };
}

/**
 * Builds one "cross-quad" card mesh for a given atlas variant: two
 * vertical planes crossed at 90 degrees, both mapped to the same UV
 * crop. A single flat plane reads as a cardboard cutout from the side;
 * crossing two gives a grass tuft actual volume from every angle for
 * the cost of 8 vertices instead of 4 — the standard technique for
 * billboard/card foliage.
 */
function buildCardMesh(scene: Scene, variant: AtlasVariant, name: string): Mesh {
  const { px } = variant;
  const cropWidthPx = px[2] - px[0];
  const cropHeightPx = px[3] - px[1];
  const height = 0.6; // was 1 — shorter grass, per request ("maybe not as high")
  const width = height * (cropWidthPx / cropHeightPx);
  const { u0, u1, v0, v1 } = pxToUv(px);

  const hw = width / 2;
  // Two crossed planes, each centered on its own vertical axis with its
  // bottom edge at y=0 (so the card's own origin is at the grass tuft's
  // root, planted at the terrain surface) rather than centered at y=0.
  const positions = [
    // Plane A (along X)
    -hw, 0, 0, hw, 0, 0, hw, height, 0, -hw, height, 0,
    // Plane B (along Z, rotated 90°)
    0, 0, -hw, 0, 0, hw, 0, height, hw, 0, height, -hw,
  ];
  const uvs = [
    u0, v0, u1, v0, u1, v1, u0, v1,
    u0, v0, u1, v0, u1, v1, u0, v1,
  ];
  // Both faces of both planes (double-sided winding baked into the
  // index buffer itself, rather than relying on backFaceCulling=false
  // on the material, which would also disable culling for every other
  // user of this shared material) — a grass card needs to read from
  // any side, not just the one its winding order happens to face.
  const indices = [
    0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7, 4, 6, 5, 4, 7, 6,
  ];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  return mesh;
}

function createGrassMaterial(scene: Scene): PBRMaterial {
  const baseUrl = textureSetFolder("grass_medium_01");
  const albedo = new Texture(baseUrl + "grass_medium_01_diff_1k.jpg", scene);
  const opacity = new Texture(baseUrl + "grass_medium_01_alpha_1k.png", scene);
  const normal = new Texture(baseUrl + "grass_medium_01_nor_gl_1k.png", scene);
  const roughness = new Texture(baseUrl + "grass_medium_01_rough_1k.png", scene);
  // CLAMP, not the WRAP_ADDRESSMODE + tiling every other PBR material in
  // this project uses (see PbrTextureSet.ts) — this is a fixed-crop
  // atlas sample per card, not a tiled surface; wrapping would bleed in
  // neighboring atlas cells at the crop's own edges.
  for (const tex of [albedo, opacity, normal, roughness]) {
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  }

  const mat = new PBRMaterial("grassCardMat", scene);
  mat.albedoTexture = albedo;
  // A real photo-sourced grass diffuse can read duller/less saturated
  // than expected once it's actually lit in-scene (interacting with
  // ambient/sun balance and the PBR metallic-roughness model) rather
  // than viewed as a flat texture swatch — I can't render this myself to
  // confirm exactly why it reads "not green," so rather than guess at
  // the lighting interaction, this tints albedoColor toward a punchy
  // green directly, which guarantees the visible result regardless of
  // what's causing the texture alone to under-deliver on it.
  mat.albedoColor = new Color3(0.62, 1.0, 0.48);
  // The alpha file has no actual alpha channel — verified directly: it's
  // 16-bit grayscale (mode I;16), shape encoded as pixel *brightness*,
  // not real transparency. opacityTexture reads from a texture's alpha
  // channel by default; since this file doesn't have one, the browser
  // synthesizes alpha=255 (fully opaque) everywhere when decoding it,
  // which is exactly why this rendered as solid rectangular plates
  // instead of a grass cutout. getAlphaFromRGB tells the material to
  // read opacity from the texture's RGB/luminance value instead, which
  // is what this file actually encodes the shape in.
  opacity.getAlphaFromRGB = true;
  mat.opacityTexture = opacity;
  mat.bumpTexture = normal;
  mat.metallicTexture = roughness; // same green-channel-roughness convention as PbrTextureSet.ts
  mat.useRoughnessFromMetallicTextureGreen = true;
  mat.metallic = 0;
  mat.backFaceCulling = false;
  // Alpha-test (a hard cutoff), not alpha-blend — blended transparent
  // cards need back-to-front sorting to look right and thousands of
  // instanced grass cards make that impractical; alpha-test has no
  // sorting requirement and is the standard technique for foliage cards.
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.45;
  mat.ambientColor = new Color3(1, 1, 1);
  return mat;
}

/** Grass is split into square chunks this many units across, so each chunk can be culled on its own. */
const GRASS_CHUNK_SIZE = 40;
/** Chunks whose center is farther than this from the player aren't drawn at all. */
const GRASS_DRAW_DISTANCE = 85;

interface GrassChunk {
  centerX: number;
  centerZ: number;
  meshes: Mesh[];
  visible: boolean;
}

export class GrassBuilder {
  private chunks: GrassChunk[] = [];

  /**
   * Builds the grass in chunks: one set of the five tuft-card meshes per
   * GRASS_CHUNK_SIZE square, each thin-instanced with that square's tufts
   * and given real bounds — so off-screen chunks are frustum-culled and
   * distant ones switched off (see update), instead of drawing every tuft
   * in the city every frame (the old single batch had to be forced
   * always-visible, which cost several ms a frame).
   */
  constructor(scene: Scene, spots: { x: number; z: number }[]) {
    const material = createGrassMaterial(scene);
    const templates = ATLAS_VARIANTS.map((v, i) => {
      const mesh = buildCardMesh(scene, v, `grass-card-${i}`);
      mesh.material = material;
      mesh.isPickable = false; // grass shouldn't intercept the crowd's own building raycasts or anything else querying the scene
      mesh.setEnabled(false); // only its per-chunk copies are drawn
      return mesh;
    });

    // Group every tuft by chunk and by card variant. The variant is
    // seeded off the position (not Math.random), so the same spot always
    // gets the same card on reload; five different tuft silhouettes
    // scattered together reads as a real meadow.
    const byChunk = new Map<string, { cx: number; cz: number; matrices: Matrix[][] }>();
    for (const spot of spots) {
      const cx = Math.floor(spot.x / GRASS_CHUNK_SIZE);
      const cz = Math.floor(spot.z / GRASS_CHUNK_SIZE);
      const key = `${cx},${cz}`;
      let chunk = byChunk.get(key);
      if (!chunk) {
        chunk = { cx, cz, matrices: templates.map(() => []) };
        byChunk.set(key, chunk);
      }
      const variantIndex = Math.floor(seedFor(spot.x, spot.z) * templates.length) % templates.length;
      const groundY = sampleTerrainHeight(spot.x, spot.z);
      const rotSeed = seedFor(spot.x + 4.1, spot.z - 2.7);
      const scaleSeed = seedFor(spot.x - 6.3, spot.z + 8.9);
      const scale = 0.75 + scaleSeed * 0.6;
      const rotationY = rotSeed * Math.PI * 2;
      chunk.matrices[variantIndex].push(
        Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationAxis(Vector3.Up(), rotationY), new Vector3(spot.x, groundY, spot.z))
      );
    }

    for (const [key, chunk] of byChunk) {
      const meshes: Mesh[] = [];
      chunk.matrices.forEach((matrices, i) => {
        if (matrices.length === 0) return;
        const mesh = templates[i].clone(`grass-${key}-${i}`);
        mesh.setEnabled(true);
        mesh.isPickable = false;
        const flat = new Float32Array(matrices.length * 16);
        matrices.forEach((m, j) => m.copyToArray(flat, j * 16));
        mesh.thinInstanceSetBuffer("matrix", flat, 16, true);
        mesh.thinInstanceRefreshBoundingInfo(); // bounds cover this chunk's tufts, so frustum culling works
        meshes.push(mesh);
      });
      this.chunks.push({
        centerX: (chunk.cx + 0.5) * GRASS_CHUNK_SIZE,
        centerZ: (chunk.cz + 0.5) * GRASS_CHUNK_SIZE,
        meshes,
        visible: true,
      });
    }
  }

  /** Call once per frame: switches off chunks far from the player. */
  update(playerPos: Vector3) {
    for (const chunk of this.chunks) {
      const visible = Math.hypot(chunk.centerX - playerPos.x, chunk.centerZ - playerPos.z) < GRASS_DRAW_DISTANCE;
      if (visible === chunk.visible) continue;
      chunk.visible = visible;
      chunk.meshes.forEach((m) => m.setEnabled(visible));
    }
  }

  /**
   * No wind sway yet, unlike VegetationBuilder's trees. That approach
   * (rotate each canopy mesh individually, once per frame) doesn't scale
   * to grass: with potentially tens of thousands of thin instances,
   * there's no per-instance mesh/transform to individually rotate the
   * cheap way trees do it — a real version would need a custom vertex
   * shader reading a shared time uniform, which is a genuinely separate
   * task from getting grass placed and rendering at all. Left as a
   * static field of grass for now rather than a half-implemented sway
   * that wouldn't actually move anything.
   */
  /**
   * Grass clustered around a given list of points (each building's own
   * ground-patch center) rather than grid-scanning an area — "grass only
   * be on the pavement of almost all buildings." keepChance close to but
   * under 1 is what makes this "almost all" rather than literally every
   * single one — some natural variation, not a rule ("except
   * Adelsviertel") applied with no exceptions of its own.
   */
  static generateGrassSpotsAroundPoints(
    points: { x: number; z: number }[],
    spotsPerPoint: number,
    jitterRadius: number,
    keepChance = 0.88
  ): { x: number; z: number }[] {
    const spots: { x: number; z: number }[] = [];
    points.forEach((p) => {
      if (seedFor(p.x * 7.1, p.z * 6.3) > keepChance) return; // this building's own lawn stays bare
      for (let j = 0; j < spotsPerPoint; j++) {
        const angleSeed = seedFor(p.x * 3.1 + j * 7.7, p.z * 2.9 + j * 11.3);
        const distSeed = seedFor(p.x * 5.3 + j * 13.1, p.z * 4.1 + j * 9.7);
        const angle = angleSeed * Math.PI * 2;
        const dist = distSeed * jitterRadius;
        spots.push({ x: p.x + Math.sin(angle) * dist, z: p.z + Math.cos(angle) * dist });
      }
    });
    return spots;
  }
}