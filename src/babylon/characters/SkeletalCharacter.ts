// src/babylon/characters/SkeletalCharacter.ts
//
// A real skinned, bone-animated character — the ninja model you provided
// (Mixamo-rigged: 52 bones, "mixamorig:" naming) plus its matching
// animation clips, retargeted per-instance via Babylon's native
// AnimatorAvatar.retargetAnimationGroup().
//
// Architecture (verified headlessly before writing this — see the
// conversation this shipped in for the exact numbers):
//  - The 59MB base model loads exactly ONCE per page load, as an
//    AssetContainer (not added to the scene directly).
//  - Every character instance (player, each NPC, every crowd member) is
//    created via `container.instantiateModelsToScene()` — this was the
//    part that took real trial and error to get right. A naive
//    `mesh.clone()` does NOT independently clone the attached Skeleton
//    (confirmed directly: two "cloned" characters shared one skeleton and
//    always showed identical poses); even explicitly cloning the skeleton
//    and reassigning it still produced two characters moving in lockstep,
//    because glTF-imported bones are linked to specific TransformNodes and
//    a plain clone doesn't relink those bindings to the new hierarchy.
//    `instantiateModelsToScene` is Babylon's own purpose-built answer to
//    this exact problem and is the only approach that verified correctly:
//    independent Skeleton objects, independent animation, while still
//    sharing one copy of the underlying vertex/texture data.
//  - Each of the 13 animation clips (small files — tens to hundreds of KB
//    each) also loads once and is cached; retargeting that cached source
//    onto a given instance's own skeleton is what actually produces the
//    per-instance, independently-playable AnimationGroup.
//
// A quirk worth knowing about, not a bug: the source clips don't carry a
// position channel on the hip bone (Mixamo commonly exports walk/run
// cycles "in place"), so `fixRootPosition`/`fixGroundReference` log a
// notice and skip the translation-correction step — the rotation-driven
// leg motion itself still retargets correctly (verified: 8 distinct foot
// heights across a walk cycle, correctly alternating). This is actually
// the behavior a character *controller* wants — the animation supplies
// the visual leg motion, your own movement code supplies the actual
// translation, and the two don't fight each other.

import {
  AbstractMesh,
  AnimationGroup,
  AnimationGroupMask,
  AnimationGroupMaskMode,
  AnimatorAvatar,
  AssetContainer,
  type BaseTexture,
  type Node,
  PBRMaterial,
  Quaternion,
  Scene,
  SceneLoader,
  Skeleton,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
// Side-effect import — registers the glTF/.glb SceneLoader plugin. Without
// this, Babylon has no plugin capable of parsing .glb at all: it logs
// "Unable to find a plugin to load .glb files. Trying to use .babylon
// default plugin", silently attempts to parse the binary glTF data with
// the wrong (legacy .babylon JSON) parser, and produces an AssetContainer
// with zero root nodes — which is what was actually throwing "Cannot read
// properties of undefined (reading 'scaling')" a few lines into create()
// below, not a real scene-disposal race. Every one of this file's own
// headless tests explicitly imported this already, which is exactly why
// that testing never caught its absence from the real app's own source.
import { GLTFFileLoader, GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF";
import { LoadingTracker } from "../core/LoadingTracker";
import { QUALITY } from "../core/Quality";
import { HUMANOID_ANIMATIONS_FOLDER } from "../../content/assetPaths";
import { HUMANOID_ANIMATION_FILES, type HumanoidAnimation as NinjaAnimation } from "../../content/animations/humanoidAnimations";
import { CHARACTER_SKINS, type CharacterSkinDef, type CharacterSkinId } from "../../content/characters/skins";

// The glTF loader starts each file's first animation by default. For the
// animation-clip files that's actively harmful: retargetAnimationGroup
// reads the source skeleton's *current* pose as its rest pose, so once a
// source clip has been playing for a while, every character retargeted
// afterwards (enemies, which spawn over time, most of all) got values
// relative to a mid-animation pose — arms stuck near a T-pose even
// though the clip was "playing". Nothing here relies on auto-start (every
// clip is played explicitly via SkeletalCharacter.play), so it's off for
// every glTF load.
SceneLoader.OnPluginActivatedObservable.add((plugin) => {
  if (plugin instanceof GLTFFileLoader) plugin.animationStartMode = GLTFLoaderAnimationStartMode.NONE;
});

// The animation and skin lists live with the rest of the game content.
export type { HumanoidAnimation as NinjaAnimation } from "../../content/animations/humanoidAnimations";
export { CHARACTER_SKINS } from "../../content/characters/skins";
export type { CharacterSkinDef, CharacterSkinId } from "../../content/characters/skins";


const MODEL_BASE_URL = HUMANOID_ANIMATIONS_FOLDER; // the shared animation clip library's own folder — see getAnimationSource, which always loads from here regardless of which skin is being animated

const ROOT_BONE_NAME = "mixamorig:Hips";
const GROUND_BONE_NAME = "mixamorig:LeftFoot";
/**
 * A clip's natural length in seconds. AnimationGroup.from/to are in
 * frames at the clip's own frame rate — Babylon's glTF loader uses 60fps
 * for every clip here — so read it from the clip rather than assuming
 * one. (This used to assume 30fps, which made every computed one-shot
 * length twice the real one: hit reactions, shots and spawns all held
 * for double their actual time before control returned.)
 */
function clipSeconds(group: AnimationGroup): number {
  const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
  return (group.to - group.from) / fps;
}
/** The ninja model's own scale reads very large next to the rest of this world's props/terrain; brings it in line with the old rig's human-ish proportions. */
export const NINJA_IMPORT_SCALE = 0.9;

/**
 * Cache keyed per-Scene (WeakMap, not a bare module-level promise) — this
 * matters more than it might look. A single shared static cache broke
 * badly under React StrictMode's dev-mode double-mount (mount -> cleanup
 * -> mount again): the first mount's scene starts the 59MB fetch, gets
 * disposed almost immediately by the cleanup, and then the *second*
 * mount's scene would get handed back that same cached promise — which
 * resolves to an AssetContainer bound to the first, now-disposed scene.
 * Every instantiateModelsToScene() call after that fails with exactly
 * "Scene has been disposed", and nothing ever renders. A WeakMap keyed by
 * the actual Scene instance means each scene gets its own independent
 * load, and a disposed scene's entry is simply never reused — while also
 * letting it be garbage-collected naturally once nothing references that
 * scene anymore, with no manual cleanup needed.
 */
class NinjaAssets {
  // Keyed per-Scene, then per-skin — a scene with both the ninja rig and
  // watcher in it (e.g. the default crowd mixing skins) needs each
  // skin's own base model cached independently, not sharing one slot.
  private static containerPromises = new WeakMap<Scene, Map<CharacterSkinId, Promise<AssetContainer>>>();
  private static sourcePromises = new WeakMap<Scene, Map<NinjaAnimation, Promise<AnimationGroup>>>();

  static getContainer(scene: Scene, skinId: CharacterSkinId): Promise<AssetContainer> {
    let sceneCache = this.containerPromises.get(scene);
    if (!sceneCache) {
      sceneCache = new Map();
      this.containerPromises.set(scene, sceneCache);
    }
    let promise = sceneCache.get(skinId);
    if (!promise) {
      const skin = CHARACTER_SKINS[skinId];
      promise = LoadingTracker.for(scene)
        .track((onProgress) => SceneLoader.LoadAssetContainerAsync(skin.baseUrl, skin.modelFile, scene, onProgress))
        .then((container) => {
          if (!QUALITY.characterDetailMaps) dropDetailMaps(container);
          return container;
        });
      sceneCache.set(skinId, promise);
    }
    return promise;
  }

  static getAnimationSource(scene: Scene, name: NinjaAnimation): Promise<AnimationGroup> {
    let sceneCache = this.sourcePromises.get(scene);
    if (!sceneCache) {
      sceneCache = new Map();
      this.sourcePromises.set(scene, sceneCache);
    }
    let promise = sceneCache.get(name);
    if (!promise) {
      promise = LoadingTracker.for(scene)
        .track((onProgress) => SceneLoader.ImportMeshAsync("", MODEL_BASE_URL, HUMANOID_ANIMATION_FILES[name], scene, onProgress))
        .then((result) => {
          // Belt and braces alongside animationStartMode=NONE above: the
          // source skeleton must stay at rest for retargeting to be right.
          result.animationGroups.forEach((g) => g.stop());
          return result.animationGroups[0];
        });
      sceneCache.set(name, promise);
    }
    return promise;
  }
}

/**
 * Phones: keeps only a skin's colour maps, freeing its normal and
 * metal/roughness maps (2048px each, so most of a character's memory) —
 * see Quality.ts.
 */
function dropDetailMaps(container: AssetContainer) {
  const dropped = new Set<BaseTexture>();
  for (const material of container.materials) {
    if (!(material instanceof PBRMaterial)) continue;
    for (const texture of [material.bumpTexture, material.metallicTexture]) if (texture) dropped.add(texture);
    // glTF's metallic factor (default 1) multiplies the map — without the map it would turn everything to dark metal.
    if (material.metallicTexture) material.metallic = 0;
    material.bumpTexture = null;
    material.metallicTexture = null;
  }
  for (const texture of dropped) {
    container.textures.splice(container.textures.indexOf(texture), 1);
    texture.dispose();
  }
}

/**
 * Freezes the root bone's own *position* channel to its first-frame
 * value — Mixamo bakes walk/run cycles "in place," so a residual
 * position channel would otherwise double up with this game's own
 * movement code, sliding the character further than intended every
 * step.
 *
 * Deliberately position-only, not rotation — an earlier version of this
 * also froze rotation/rotationQuaternion on the root bone, to stop a
 * clip's own baked hip rotation from visually fighting
 * PlayerController's setFacing() (first noticed on the gun's "stuck
 * facing the shot direction" bug). That turned out to be the wrong
 * layer to fix it at: freezing hip rotation for *every* clip also
 * strips the real, intended hip/torso rotation a melee swing's own
 * animation needs to read as a natural, full-range motion instead of a
 * stiff, truncated one — which is exactly what started happening once
 * this covered melee too. The facing problem is now solved directly and
 * independently instead, via PlayerController's own explicit
 * meleeLockedFacing/isStrafing checks overriding facingYaw itself, which
 * doesn't care what any clip does to the hip bone — so this doesn't need
 * to (and shouldn't) touch rotation at all anymore.
 */
function removeRootMotion(animationGroup: AnimationGroup, rootBoneName: string) {
  for (const targeted of animationGroup.targetedAnimations) {
    const target = targeted.target;
    const animation = targeted.animation;

    if (
      animation.targetProperty !== "position" ||
      !(target instanceof TransformNode)
    ) {
      continue;
    }

    if (!target.name.includes(rootBoneName)) {
      continue;
    }

    const keys = animation.getKeys();

    if (keys.length === 0) continue;

    const firstValue = keys[0].value as Vector3;

    animation.setKeys(
      keys.map((key) => ({
        ...key,
        value: new Vector3(
          firstValue.x,
          firstValue.y,
          firstValue.z
        ),
      }))
    );
  }
}

export class SkeletalCharacter {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly skeleton: Skeleton;
  private readonly mesh: AbstractMesh;
  private readonly avatar: AnimatorAvatar;
  private readonly rootBoneName: string;
  private readonly groundBoneName: string;
  private readonly animations = new Map<NinjaAnimation, AnimationGroup>();
  private readonly skinId: CharacterSkinId;
  /** What this instance's node names start with (instantiateModelsToScene's name prefix). */
  private readonly namePrefix: string;
  /**
   * Retargeted clips shared by every instance of the same skin (same
   * skeleton, same scale): the first instance retargets a clip, and the
   * rest get a group pointing at their own bones but reusing its keyframes.
   * Retargeting copies every keyframe, so without this each crowd member
   * held its own copy of every clip — hundreds of MB, enough to crash
   * Safari on a phone.
   */
  private static sharedClips = new WeakMap<Scene, Map<string, { group: AnimationGroup; prefix: string }>>();
  private current: AnimationGroup | null = null;
  private playToken = 0;
  /** Node names under given root bones, cached per root-bone list — see bonesUnder(). */
  private boneNameCache = new Map<string, string[]>();
  /** While an upper-body overlay plays: the clip itself, and the mask that holds the base clip off those same bones. */
  private overlay: { group: AnimationGroup; lowerBodyMask: AnimationGroupMask; token: number; rootKey: string; held: boolean } | null = null;
  /** Separate from playToken, so starting an overlay never cancels a full-body clip's pending onComplete. */
  private overlayToken = 0;

  private constructor(
    scene: Scene,
    root: TransformNode,
    skeleton: Skeleton,
    mesh: AbstractMesh,
    avatar: AnimatorAvatar,
    skinId: CharacterSkinId,
    namePrefix: string
  ) {
    this.scene = scene;
    this.skinId = skinId;
    this.namePrefix = namePrefix;
    this.root = root;
    this.skeleton = skeleton;
    this.mesh = mesh;
    this.avatar = avatar;
    const skin = CHARACTER_SKINS[skinId] as CharacterSkinDef; // the literal object type from `satisfies` below doesn't carry the optional rootBoneName/groundBoneName fields for skins that don't set them; this cast restores the full interface shape
    this.rootBoneName = skin.rootBoneName ?? ROOT_BONE_NAME;
    this.groundBoneName = skin.groundBoneName ?? GROUND_BONE_NAME;
  }

  /** Creates one independent, animatable instance. Cheap after the first call — see the architecture note above. */
  static async create(
    scene: Scene,
    name: string,
    preloadAnimations: NinjaAnimation[] = ["idle", "walkForward"],
    skinId: CharacterSkinId = "ninja"
  ): Promise<SkeletalCharacter> {
    const container = await NinjaAssets.getContainer(scene, skinId);
    // The 59MB base fetch is the one await here genuinely long enough for
    // the owning scene to have been disposed in the meantime (a component
    // unmount, a StrictMode cleanup, navigating away) — bail out cleanly
    // rather than trying to instantiate into a scene that's gone.
    if (scene.isDisposed) {
      throw new Error(`SkeletalCharacter.create("${name}"): scene was disposed while the model was loading`);
    }

    // cloneMaterials: true — the actual, confirmed root cause of "one
    // enemy's skin turns another enemy of the same type gray." With
    // this false (as it was), every instance of the same skin — every
    // Brute, every Skirmisher, all of them sharing "leonard" or
    // whichever skin, since multiple of the same archetype are alive at
    // once — shared the literal same material objects. Disposing one
    // instance (its own death/despawn) was disposing state every other
    // living instance of that skin still depended on. Cloning is cheap
    // here: Babylon's material clone is a shallow copy that still
    // references the same underlying textures, so this doesn't
    // duplicate GPU texture memory — only the small per-material
    // property object, which is what actually needed to be independent
    // per character.
    const instantiated = container.instantiateModelsToScene((n) => `${name}_${n}`, true);
    // The model's own built-in clips are never played (the shared humanoid library is) — drop this instance's copies.
    instantiated.animationGroups.forEach((g) => g.dispose());
    const root = instantiated.rootNodes[0] as TransformNode;
    root.scaling.scaleInPlace(CHARACTER_SKINS[skinId].importScale);
    // Hidden until animations are ready and the first one has actually
    // started playing, a few lines below — instantiateModelsToScene
    // makes the mesh visible immediately, in its raw bind pose, and
    // nothing plays on it until the Promise.all beneath this finishes.
    // With many characters loading at once at startup, that await can
    // genuinely take several seconds, during which every one of them
    // would otherwise sit there visibly T-posed — exactly the reported
    // symptom. Hiding it for this window means each character now pops
    // in already animating instead.
    root.setEnabled(false);
    const mesh = root.getChildMeshes().find((m) => !!m.skeleton) as AbstractMesh;
    const skeleton = instantiated.skeletons[0];
    // _disposeResources: false — Babylon's own default here is true,
    // and AnimatorAvatar.dispose() with that default calls
    // rootNode.dispose(false, true), where that final true explicitly
    // disposes materials AND textures. cloneMaterials: true above
    // already gives each character instance its own material object,
    // but Babylon's material clone is shallow — the cloned materials
    // still point to the exact same underlying texture objects as
    // every other instance of that skin. So disposing one enemy's
    // avatar was deleting the shared GPU texture out from under every
    // other living enemy of the same skin, regardless of each having
    // its own material. Disabled here; this class's own dispose()
    // below now handles cleanup itself, deliberately *not* touching
    // materials/textures at all.
    const avatar = new AnimatorAvatar(name, root, false);

    const character = new SkeletalCharacter(scene, root, skeleton, mesh, avatar, skinId, `${name}_`);
    // Each clip's own retargeting is isolated — a bone-name mismatch on
    // one specific clip for one specific skin (plausible: different
    // downloaded models don't all necessarily share identical skeleton
    // naming) previously meant Promise.all rejected as a whole, which
    // silently threw away the entire character — mesh, skeleton, and
    // every other animation that *would* have loaded fine, not just the
    // one broken clip. Now a failed clip logs a warning and is simply
    // unavailable for this character (play() already no-ops safely on a
    // clip that was never loaded), while everything else that succeeded
    // still works.
    await Promise.all(
      preloadAnimations.map((anim) =>
        character.loadAnimation(anim).catch((err) => {
          console.warn(`SkeletalCharacter "${name}" (skin "${skinId}"): animation "${anim}" failed to load/retarget — continuing without it:`, err);
        })
      )
    );

    if (scene.isDisposed) {
      instantiated.rootNodes.forEach((n) => n.dispose());
      throw new Error(`SkeletalCharacter.create("${name}"): scene was disposed while animations were loading`);
    }

    if (preloadAnimations.length > 0) character.play(preloadAnimations[0]);
    root.setEnabled(true); // re-shown now that the first animation is already playing — see the setEnabled(false) call above for the full reasoning
    return character;
  }

  /** Keeps a copy of a freshly retargeted clip for later instances of this skin (see sharedClips). It isn't played itself. */
  private shareClip(name: NinjaAnimation, retargeted: AnimationGroup) {
    let clips = SkeletalCharacter.sharedClips.get(this.scene);
    if (!clips) {
      clips = new Map();
      SkeletalCharacter.sharedClips.set(this.scene, clips);
    }
    const key = `${this.skinId}|${name}`;
    if (clips.has(key)) return;
    // Its own group (sharing the keyframes), so this instance disposing its clips later doesn't empty it.
    const template = retargeted.clone(`${key}_shared`, (target) => target);
    template.stop();
    clips.set(key, { group: template, prefix: this.namePrefix });
  }

  /** Gives this instance a clip another instance of its skin already retargeted, pointed at its own bones. False if there isn't one yet (or it doesn't fit). */
  private useSharedClip(name: NinjaAnimation): boolean {
    const shared = SkeletalCharacter.sharedClips.get(this.scene)?.get(`${this.skinId}|${name}`);
    if (!shared) return false;
    const ownNodes = new Map<string, Node>();
    for (const node of this.root.getDescendants(false)) ownNodes.set(node.name, node);
    const targets: Node[] = [];
    for (const targeted of shared.group.targetedAnimations) {
      const targetName: string = targeted.target?.name ?? "";
      const own = targetName.startsWith(shared.prefix) ? ownNodes.get(this.namePrefix + targetName.slice(shared.prefix.length)) : undefined;
      if (!own) return false;
      targets.push(own);
    }
    let i = 0;
    const group = shared.group.clone(`${name}_retargeted`, () => targets[i++]); // cloneAnimations false: the keyframes are shared
    group.stop();
    this.animations.set(name, group);
    return true;
  }

  /** Loads + retargets one clip onto this instance's own skeleton, if not already loaded. Safe to call repeatedly. */
  async loadAnimation(name: NinjaAnimation): Promise<void> {
    if (this.animations.has(name)) return;
    const source = await NinjaAssets.getAnimationSource(this.scene, name);
    if (this.scene.isDisposed) return; // the character itself is about to be garbage; no point retargeting onto a dead scene
    if (this.animations.has(name)) return; // loaded meanwhile by another call
    if (this.useSharedClip(name)) return;

    const retargeted = this.avatar.retargetAnimationGroup(source, {
      animationGroupName: `${name}_retargeted`,
      rootNodeName: this.rootBoneName,
      groundReferenceNodeName: this.groundBoneName,
      fixGroundReference: true,
      fixRootPosition: true,
    });
    removeRootMotion(retargeted, this.rootBoneName);
    // Blends into this clip from whatever pose was actually showing the
    // instant it starts playing, rather than cutting instantly — Babylon
    // tracks this per bone/property on the Animation object itself, not
    // per AnimationGroup, so this works across a full switch between two
    // entirely different groups (e.g. running -> a melee swing) exactly
    // the same way it would within one. blendingSpeed 0.15 is well above
    // Babylon's own default (0.01, a much longer blend meant for subtler
    // transitions) — picked to be quick enough not to noticeably delay a
    // combat action's own start, while still smoothing over what was a
    // hard, visible cut, especially reported between a fast, high-motion
    // clip like running and a melee swing's starting pose.
    //
    // Scoped to just the melee attack chain's clips plus headHit, not
    // every animation — applying it globally (the first version of
    // this) made walk/run/idle and every other transition feel slower
    // too, which was never asked for. headHit was added after repeated
    // feedback that it "snaps completely" even at a slow speedRatio —
    // this is the actual fix for that: speed alone can't smooth an
    // instant pose-to-pose cut, only blending can, and this clip was
    // never included here before now.
    if (
      name === "meleeAttackDownward" ||
      name === "meleeAttackHorizontal" ||
      name === "meleeAttack360" ||
      name === "meleeComboV2" ||
      name === "headHit" ||
      name === "punching" ||
      name === "hookPunch" ||
      name === "budMount" ||
      name === "budHover" ||
      name === "budDismount"
    ) {
      for (const targeted of retargeted.targetedAnimations) {
        targeted.animation.enableBlending = true;
        targeted.animation.blendingSpeed = 0.15;
      }
    }
    retargeted.stop();
    this.animations.set(name, retargeted);
    this.shareClip(name, retargeted);
  }

  /**
   * Switches the active animation. No-ops if it's already playing (looping
   * only — a one-shot can always be restarted), or if it hasn't been
   * loaded via loadAnimation()/preloadAnimations yet. `onComplete` fires
   * once the clip's own duration has elapsed — gated on a per-call token,
   * not on `this.current` still pointing at the same group (verified that
   * check alone is insufficient: restarting the *same* clip mid-attack
   * keeps `current` pointing at the identical object, so an interrupted
   * call's stale timer would still pass an object-identity check; a
   * monotonic token distinguishes "this exact play() call" from any later
   * one, including a restart of the same clip).
   *
   * `speedRatio` (default 1) plays the clip faster/slower than its baked
   * rate via AnimationGroup's own speedRatio property — by default the
   * completion timer is divided by it too, so a sped-up clip's onComplete
   * still fires at the moment it actually visually finishes.
   *
   * `explicitDurationMs`, if given, overrides that computed timing
   * entirely — for a one-shot that should hand control back to the
   * caller sooner than its own visual playback actually finishes,
   * without needing to speed up the clip itself to get there. This is
   * what actually lets combat swings play at something closer to their
   * natural, weighty speed while still cutting back to movement control
   * quickly: since play() is called again immediately once control
   * returns (its own stop(true) cuts the previous group off mid-motion),
   * the swing visibly gets interrupted partway through rather than
   * playing out to its own natural end — "slower motion, quicker
   * cutoff" are two independent knobs once this is set, not the same
   * one.
   */
  play(name: NinjaAnimation, loop = true, onComplete?: () => void, speedRatio = 1, explicitDurationMs?: number) {
    const group = this.animations.get(name);
    if (!group) return;
    // A full-body one-shot (a melee swing, a hit reaction, death) takes
    // over the whole skeleton, so any upper-body overlay ends here — as
    // does an overlay of this very clip (it can't be base and overlay at once).
    if (!loop || this.overlay?.group === group) this.stopUpperBody();
    if (loop && group === this.current && group.speedRatio === speedRatio) return;
    if (this.current) {
      this.current.stop(true);
      this.current.mask = null;
    }
    group.speedRatio = speedRatio;
    // While an overlay owns the upper body, the new base clip only drives the legs/hips.
    group.mask = this.overlay ? this.overlay.lowerBodyMask : null;
    group.play(loop);
    this.current = group;
    const myToken = ++this.playToken; // invalidates any pending one-shot timer from a previous call, looping or not
    if (onComplete && !loop) {
      const durationMs =
        explicitDurationMs ?? Math.max(0, (clipSeconds(group) / speedRatio) * 1000);
      setTimeout(() => {
        if (this.playToken === myToken) onComplete();
      }, durationMs);
    }
  }

  /** Node names of the given root bones and every bone below them in the hierarchy. */
  private bonesUnder(rootBones: string[]): string[] {
    const key = rootBones.join("|");
    let names = this.boneNameCache.get(key);
    if (!names) {
      const roots = new Set(rootBones);
      const isUnder = (bone: (typeof this.skeleton.bones)[number]): boolean => {
        for (let b: typeof bone | null = bone; b; b = b.getParent()) {
          if (roots.has(b.name)) return true;
        }
        return false;
      };
      names = this.skeleton.bones
        .filter(isUnder)
        .map((b) => b.getTransformNode()?.name)
        .filter((n): n is string => !!n);
      this.boneNameCache.set(key, names);
    }
    return names;
  }

  /**
   * Plays a one-shot clip on part of the body only — by default the
   * upper body (spine and everything above it), or just the bones under
   * `rootBones` — while whatever base clip is playing (walk, run, strafe,
   * idle) keeps driving everything else. E.g. firing a gun with the arms
   * while the legs keep walking, the way GTA layers shooting over
   * movement. Ends after `durationMs` (or the clip's own length), then
   * hands those bones back to the base clip. Restarting it (another shot)
   * just restarts the overlay.
   */
  playUpperBody(
    name: NinjaAnimation,
    speedRatio = 1,
    durationMs?: number,
    onComplete?: () => void,
    rootBones: string[] = ["mixamorig:Spine"]
  ) {
    const group = this.animations.get(name);
    if (!group || group === this.current) return;
    const token = this.startOverlay(group, rootBones, speedRatio, false);
    const ms = durationMs ?? Math.max(0, (clipSeconds(group) / speedRatio) * 1000);
    setTimeout(() => {
      if (this.overlay?.token !== token) return; // replaced by a newer overlay or a full-body clip
      this.stopUpperBody();
      onComplete?.();
    }, ms);
  }

  /**
   * Like playUpperBody, but loops and stays on until stopUpperBody() (or
   * a full-body clip, or another overlay) ends it — e.g. holding the arms
   * in the gun-aiming pose while the legs walk. Calling it again with the
   * same clip and bones is a no-op, so it's safe to call every frame.
   */
  holdUpperBody(name: NinjaAnimation, rootBones: string[] = ["mixamorig:Spine"]) {
    const group = this.animations.get(name);
    if (!group || group === this.current) return;
    if (this.overlay?.held && this.overlay.group === group && this.overlay.rootKey === rootBones.join("|")) return;
    this.startOverlay(group, rootBones, 1, true);
  }

  /** Which clip is currently overlaid on part of the body, and whether it's a held (looping) one. */
  /** The full-body clip playing now (not an upper-body overlay). */
  getCurrentAnimation(): NinjaAnimation | null {
    for (const [name, group] of this.animations) {
      if (group === this.current) return name;
    }
    return null;
  }

  getUpperBodyOverlay(): { name: NinjaAnimation; held: boolean } | null {
    if (!this.overlay) return null;
    for (const [name, group] of this.animations) {
      if (group === this.overlay.group) return { name, held: this.overlay.held };
    }
    return null;
  }

  private startOverlay(group: AnimationGroup, rootBones: string[], speedRatio: number, loop: boolean): number {
    const names = this.bonesUnder(rootBones);
    const rootKey = rootBones.join("|");
    // A different clip or a different set of bones: end the old overlay cleanly first.
    if (this.overlay && (this.overlay.group !== group || this.overlay.rootKey !== rootKey)) this.stopUpperBody();
    const lowerBodyMask = this.overlay?.lowerBodyMask ?? new AnimationGroupMask(names, AnimationGroupMaskMode.Exclude);
    const token = ++this.overlayToken;
    this.overlay = { group, lowerBodyMask, token, rootKey, held: loop };

    if (this.current) this.current.mask = lowerBodyMask;
    group.mask = new AnimationGroupMask(names, AnimationGroupMaskMode.Include);
    group.stop(true);
    group.speedRatio = speedRatio;
    group.play(loop);
    return token;
  }

  /** A bone's animated TransformNode by its Mixamo name (e.g. "mixamorig:Spine2") — for procedural adjustments layered on top of the animation. */
  getBoneNode(name: string): TransformNode | null {
    return this.findBone(name)?.getTransformNode() ?? null;
  }

  /** Ends any upper-body overlay and gives the upper body back to the base clip. */
  stopUpperBody() {
    if (!this.overlay) return;
    this.overlay.group.stop(true);
    this.overlay.group.mask = null;
    this.overlay = null;
    if (this.current) this.current.mask = null; // un-pauses the base clip's upper-body bones
  }

  /** A loaded clip's natural length in seconds at speedRatio 1, or 0 if it isn't loaded. */
  getAnimationDuration(name: NinjaAnimation): number {
    const group = this.animations.get(name);
    return group ? clipSeconds(group) : 0;
  }

  isAnimationLoaded(name: NinjaAnimation): boolean {
    return this.animations.has(name);
  }

  getCurrentAnimationName(): NinjaAnimation | null {
    let found: NinjaAnimation | null = null;
    this.animations.forEach((group, name) => {
      if (group === this.current) found = name;
    });
    return found;
  }

  private squashTimer = 0;

  /** A quick whole-body squash-and-stretch — call right when landing from a jump. Same technique the old procedural rig used, reapplied here to `root.scaling`. */
  playLandSquash() {
    this.squashTimer = 0.18;
  }

  /**
   * Call once per frame — drives the landing-squash decay. (The skeleton
   * itself is re-posed by Babylon during rendering, only for characters
   * actually on screen; this used to force it for every character every
   * frame, a large cost with ~150 characters in the city.)
   */
  update(dt = 0) {
    if (this.squashTimer > 0) {
      this.squashTimer = Math.max(0, this.squashTimer - dt);
      const progress = 1 - this.squashTimer / 0.18;
      const arc = Math.sin(progress * progress * (3 - 2 * progress) * Math.PI);
      this.root.scaling.y = 1 - arc * 0.14;
      this.root.scaling.x = 1 + arc * 0.07;
      this.root.scaling.z = 1 + arc * 0.07;
    } else if (!this.root.scaling.equalsToFloats(1, 1, 1)) {
      const ease = Math.min(1, dt * 10);
      this.root.scaling.x += (1 - this.root.scaling.x) * ease;
      this.root.scaling.y += (1 - this.root.scaling.y) * ease;
      this.root.scaling.z += (1 - this.root.scaling.z) * ease;
    }
  }

  private active = true;

  /**
   * Switches a far-away character off entirely — hidden and its
   * animations paused, so it costs nothing to draw or animate — and back
   * on when it's near again (animations resume where they were).
   */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.root.setEnabled(active);
    const groups = [this.current, this.overlay?.group].filter((g): g is AnimationGroup => !!g);
    for (const g of groups) {
      if (active) g.play(g.loopAnimation);
      else g.pause();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  set position(v: Vector3) {
    this.root.position = v;
  }

  /**
   * The imported root has a `rotationQuaternion` already set — Babylon's
   * glTF loader bakes in a fixed rotation to correct for glTF's coordinate
   * convention, and once that's set, Babylon *always* uses it over the
   * plain `.rotation` Euler property, silently ignoring any further writes
   * to `.rotation` entirely. Verified this directly: setting `.rotation.y`
   * to a drastically different value produced zero change to the world
   * matrix. That's why facing never actually updated before — every
   * character was stuck at whatever that one baked orientation happened to
   * be, regardless of movement or camera direction. The fix has to go
   * through the quaternion instead, composing the desired yaw with that
   * same baked 180° offset (measured as exactly Math.PI, confirmed against
   * the actual foot geometry: at yaw 0 the character's own toes point
   * along world +Z, matching what the rest of the game already assumes as
   * "forward").
   */
  setFacing(yawRadians: number) {
    if (!this.root.rotationQuaternion) this.root.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromEulerAnglesToRef(0, yawRadians, 0, this.root.rotationQuaternion);
  }

  /** Facing plus a lean — pitch (nose down positive) and roll — e.g. tilting with a vehicle the character rides. */
  setOrientation(yawRadians: number, pitchRadians: number, rollRadians: number) {
    if (!this.root.rotationQuaternion) this.root.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromEulerAnglesToRef(pitchRadians, yawRadians, rollRadians, this.root.rotationQuaternion);
  }

  /** Finds a bone by its Mixamo name (e.g. "mixamorig:RightHand") — for attaching weapons or reading world positions. */
  findBone(name: string) {
    return this.skeleton.bones.find((b) => b.name === name) ?? null;
  }

  /**
   * The real TransformNode a weapon should parent to for a given hand —
   * NOT the same as searching the scene by name, since every instance's
   * nodes get prefixed (e.g. "player_mixamorig:RightHand") by
   * instantiateModelsToScene. bone.getTransformNode() resolves to the
   * correct per-instance node directly; verified this returns genuinely
   * different, correctly-offset nodes for two different character
   * instances before relying on it here.
   */
  getHandNode(side: "left" | "right"): TransformNode | null {
    const bone = this.findBone(side === "right" ? "mixamorig:RightHand" : "mixamorig:LeftHand");
    return bone?.getTransformNode() ?? null;
  }

  addShadowCasters(register: (mesh: AbstractMesh) => void) {
    register(this.mesh);
  }

  dispose() {
    this.animations.forEach((g) => g.dispose());
    // avatar.dispose() is now a no-op (constructed with
    // _disposeResources: false above) — this handles actual cleanup
    // itself instead, deliberately leaving materials/textures alone
    // since those may still be in active use by other living
    // instances of the same skin. root.dispose() with no arguments
    // uses Babylon's own defaults: it recurses through every child
    // mesh (freeing their geometry, transforms, and this instance's
    // own per-character cloned material objects) but does NOT touch
    // materials or textures — exactly the split needed here. The
    // skeleton is disposed separately since, unlike materials/
    // textures, instantiateModelsToScene gives each character
    // instance its own independent skeleton (needed for independent
    // per-character animation) — never shared, always safe to clean
    // up per-instance.
    this.root.dispose();
    this.skeleton.dispose();
  }
}