// src/babylon/world/PbrTextureSet.ts
//
// Loads a real, downloaded PBR texture set (the diffuse/normal/roughness
// trio) into a proper Babylon PBRMaterial — for materials where a real
// photographed texture is available, as an alternative to the fully
// procedural canvas textures in TextureFactory.ts.
//
// Expected folder layout on disk (matches how these are typically
// downloaded, e.g. from Poly Haven):
//   public/textures/<name>/textures/<name>_diff_<res>.jpg
//   public/textures/<name>/textures/<name>_nor_gl_<res>.png   (or .exr)
//   public/textures/<name>/textures/<name>_rough_<res>.jpg    (or .png/.exr)
//   public/textures/<name>/<name>_<res>.mtlx                 (not used —
//     see note below)
//
// The .mtlx (MaterialX) file that normally ships alongside these texture
// sets is deliberately NOT parsed here. It's an XML node-graph description
// of the exact same standard_surface shader a PBRMaterial already
// expresses natively — checked the actual file contents rather than
// assuming, and it's just referencing the same diff/rough/normal/disp
// images by name. Writing an XML MaterialX interpreter to reproduce a
// result Babylon's own PBRMaterial already produces directly would add a
// real chunk of complexity for zero visual benefit.
//
// Also worth knowing: any `.exr` source files should be converted to
// `.png` before use here. Verified this isn't optional — Babylon's EXR
// decoder does support several compression modes (PIZ/ZIP/RLE/PXR24) but
// silently produces a 0×0 empty result (no error thrown) for DWAA
// compression, which is Poly Haven's own default for their EXR exports.
// Decoded the same files successfully with OpenCV outside the browser and
// re-exported as PNG, which is what actually ships in the texture folders
// this loader expects.

import { PBRMaterial, Scene, Texture } from "@babylonjs/core";
import { textureSetFolder } from "../../content/assetPaths";

export interface PbrTextureSetOptions {
  /** Folder name under public/assets/textures/, e.g. "asphalt" for assets/textures/asphalt/textures/*. */
  name: string;
  /** Filename of the diffuse/albedo map, relative to the set's textures/ folder. */
  diffuseFile: string;
  /** Filename of the OpenGL-convention (Y+) normal map. Must be a browser-loadable format — see the note above about .exr. Omit for sets that don't ship one. */
  normalFile?: string;
  /** Filename of the roughness map (grayscale, or any RGB image where R=G=B is fine — only the green channel is read). Omit for sets that don't ship one; the surface is then fully rough. */
  roughnessFile?: string;
  /** How many times the texture repeats across the surface's UV space — tune per-mesh, since a road strip and a wide park square need very different tiling density. */
  uScale?: number;
  vScale?: number;
}

/** Builds a real PBRMaterial from a downloaded diffuse/normal/roughness texture trio. */
export function createPbrTextureSetMaterial(scene: Scene, opts: PbrTextureSetOptions): PBRMaterial {
  const baseUrl = textureSetFolder(opts.name);
  const uScale = opts.uScale ?? 8;
  const vScale = opts.vScale ?? 8;

  const albedo = new Texture(baseUrl + opts.diffuseFile, scene);
  const normal = opts.normalFile ? new Texture(baseUrl + opts.normalFile, scene) : null;
  const roughness = opts.roughnessFile ? new Texture(baseUrl + opts.roughnessFile, scene) : null;

  for (const tex of [albedo, normal, roughness]) {
    if (!tex) continue;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.uScale = uScale;
    tex.vScale = vScale;
  }

  const mat = new PBRMaterial(`pbr-${opts.name}`, scene);
  mat.albedoTexture = albedo;
  if (normal) mat.bumpTexture = normal;

  // A dedicated (not glTF-style packed ORM) roughness texture: route it
  // through the metallic/roughness texture slot, reading roughness from
  // its green channel specifically — verified this is the correct,
  // intended API for exactly this case (not a metalness/ORM texture) by
  // checking PBRMaterial's own source rather than assuming: metalness
  // stays a plain scalar (reading from the texture's blue channel
  // defaults to off, confirmed directly), so this can't accidentally make
  // a non-metal surface like asphalt or grass reflective.
  if (roughness) {
    mat.metallicTexture = roughness;
    mat.useRoughnessFromMetallicTextureGreen = true;
  }
  mat.metallic = 0;
  mat.roughness = 1; // neutral multiplier — use the texture's own values as-is, don't scale them down

  return mat;
}