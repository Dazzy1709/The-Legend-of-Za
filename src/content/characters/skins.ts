// src/content/characters/skins.ts
// Every character model (skin) in the game. To add one: put its rigged
// .glb in public/assets/characters/<id>/ and add an entry below — it
// plays every clip in the shared animation library automatically.

import { characterFolder } from "../assetPaths";

/**
 * Every "skin" (base mesh + skeleton) a SkeletalCharacter can be built
 * from — the model file/folder, plus its own import scale, since a
 * different model asset isn't guaranteed to be modeled at the same
 * real-world scale the ninja rig happens to be. Add a new skin here by
 * giving it a folder under public/assets/characters/ (see content/assetPaths.ts) with the
 * model file inside it (matching modelFile) — nothing else about this
 * file needs to change, since every skin still shares the exact same
 * animation clip library (content/animations/humanoidAnimations.ts):
 * animations are retargeted onto *whichever* skeleton a given character
 * instance has, they aren't tied to one specific model, so adding a
 * skin never means adding new animation files too, as long as its
 * skeleton uses the same Mixamo-style "mixamorig:" bone naming the
 * animation clips themselves were baked against.
 */
export interface CharacterSkinDef {
  baseUrl: string;
  modelFile: string;
  /** Matches NINJA_IMPORT_SCALE's own role — brings this skin's own modeled scale in line with the rest of this world's props/terrain. Not guaranteed to be the same number as another skin's own scale, since that depends entirely on how each model was originally authored. */
  importScale: number;
  /** The root/hip and ground-reference (a planted foot) bone names this skin's own skeleton actually uses — animation retargeting needs an exact string match against real node names, and not every model uses the same naming convention for what's otherwise the same Mixamo rig (e.g. watcher.glb used underscores — "mixamorig_Hips" — instead of the colon style below). Defaults (ROOT_BONE_NAME/GROUND_BONE_NAME) assume "mixamorig:Hips"; override per-skin for any model that T-poses instead of animating — that specific symptom means retargeting couldn't find a bone by this name at all. Left undefined (using the default) for the five new skins below since I haven't seen their own actual bone names — if any of them T-pose, this is the fix, the same one watcher.glb needed. */
  rootBoneName?: string;
  groundBoneName?: string;
}

export const CHARACTER_SKINS = {
  ninja: { baseUrl: characterFolder("ninja"), modelFile: "ninja.glb", importScale: 0.9 },
  seller: { baseUrl: characterFolder("seller"), modelFile: "seller.glb", importScale: 0.9 },
  wizard: { baseUrl: characterFolder("wizard"), modelFile: "wizard.glb", importScale: 0.7 },
  warriorFemale: { baseUrl: characterFolder("warriorFemale"), modelFile: "warriorFemale.glb", importScale: 1.1 },
  men: { baseUrl: characterFolder("men"), modelFile: "men.glb", importScale: 0.9 },
  women: { baseUrl: characterFolder("women"), modelFile: "women.glb", importScale: 0.7 },
  // Zombie skin removed — replaced with Adam, James, and Leonard per
  // request, so no enemy archetype references "zombie" as a skin
  // anymore (see CombatConfig.ts). The zombie.glb path was also never
  // actually uploaded, so nothing here was pointing at a real file
  // regardless.
  leonard: { baseUrl: characterFolder("leonard"), modelFile: "leonard.glb", importScale: 0.9 },
  // Both files now actually arrived and are fixed the same way every
  // other Mixamo-derived model here needed (mixamorigN: -> mixamorig:).
  // importScale is a real, reasoned starting point rather than a blind
  // guess this time — I measured each model's own overall bounding box
  // across every mesh part (not just the first one; Adam has 7 separate
  // mesh parts, so its first accessor alone wasn't the whole body) and
  // both come out to roughly 1.8 native units tall, already close to
  // ordinary meter-scale rather than something like Watcher's original
  // centimeter-scale problem — so 1.0 (no real correction) is the
  // sensible starting value, not a placeholder guess needing a big
  // fix. Still worth checking next to the other characters in-scene.
  james: { baseUrl: characterFolder("james"), modelFile: "james.glb", importScale: 1.0 },
  adam: { baseUrl: characterFolder("adam"), modelFile: "adam.glb", importScale: 1.0 },
  // warriorMale.glb's own bone names already use the correct colon
  // convention natively — no patching needed. Scale is a real, verified
  // measurement this time (read directly from the vertex buffer, not
  // relying on accessor min/max metadata, which was unreliable for
  // watcher.glb): 1.833 native units tall, right in line with adam/
  // james/leonard's own ~1.8, so 1.0 (no correction) is confirmed
  // correct rather than an unverified guess.
  warriorMale: { baseUrl: characterFolder("warriorMale"), modelFile: "warriorMale.glb", importScale: 1.0 },
} satisfies Record<string, CharacterSkinDef>;

export type CharacterSkinId = keyof typeof CHARACTER_SKINS;
