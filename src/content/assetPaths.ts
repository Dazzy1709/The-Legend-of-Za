// src/content/assetPaths.ts
// The one place that knows where asset files live under public/assets/.
// Code never writes "/assets/..." itself — it asks here, so moving or
// adding an asset folder is a change to this file only.
//
//   public/assets/
//     characters/<skin>/<skin>.glb   rigged character models (skins)
//     animations/humanoid/*.glb      Mixamo clips shared by every humanoid skin
//     weapons/*.glb                  weapon models
//     textures/<set>/textures/*      PBR texture sets (diffuse/normal/roughness)
//     props/                         trees, rocks, furniture and other world objects
//     vehicles/                      vehicle models
//     sounds/{music,sfx,ambience}/   audio files (see content/audio/sounds.ts)

export const ASSET_ROOT = "/assets";

/** Folder of a character skin's model, e.g. characterFolder("adam") -> "/assets/characters/adam/". */
export function characterFolder(skin: string): string {
  return `${ASSET_ROOT}/characters/${skin}/`;
}

/** The shared humanoid animation library — every skin uses these clips (they're retargeted onto its skeleton). */
export const HUMANOID_ANIMATIONS_FOLDER = `${ASSET_ROOT}/animations/humanoid/`;

export const WEAPONS_FOLDER = `${ASSET_ROOT}/weapons/`;

export const PROPS_FOLDER = `${ASSET_ROOT}/props/`;

export const VEHICLES_FOLDER = `${ASSET_ROOT}/vehicles/`;

/** A PBR texture set's map folder, e.g. textureSetFolder("asphalt") -> "/assets/textures/asphalt/textures/". */
export function textureSetFolder(name: string): string {
  return `${ASSET_ROOT}/textures/${name}/textures/`;
}

/** An audio file, e.g. soundUrl("sfx/punch.mp3"). */
export function soundUrl(file: string): string {
  return `${ASSET_ROOT}/sounds/${file}`;
}
