// src/babylon/combat/Weapons.ts
// The player's weapons — the sword and 1911 pistol models, and a blocky
// pickaxe — each built as its own TransformNode group so
// they can be parented straight onto the equipping character's right hand
// (now the ninja skeleton's actual "mixamorig:RightHand" bone transform,
// via SkeletalCharacter.getHandNode — see PlayerController.equipWeapon)
// and follow that hand's real bone animation automatically, whatever clip
// happens to be playing.

import { AssetContainer, Color3, Mesh, MeshBuilder, Scene, SceneLoader, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { LoadingTracker } from "../core/LoadingTracker";
import type { WeaponKind } from "../../types";
import { WEAPONS_FOLDER } from "../../content/assetPaths";

export type { WeaponKind };

export interface WeaponHandle {
  kind: WeaponKind;
  root: TransformNode;
  /** Only present for the gun — the point tracers/muzzle flashes spawn from, in world space via getAbsolutePosition(). */
  muzzle?: TransformNode;
  dispose(): void;
}

function mat(scene: Scene, name: string, hex: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  return m;
}

export function createWeapon(scene: Scene, kind: WeaponKind, ownerName: string): WeaponHandle {
  const root = new TransformNode(`weapon-${kind}-${ownerName}`, scene);
  const parts: Mesh[] = [];

  // None of a weapon's own geometry should ever be hit by its owner's own
  // raycasts — the gun's muzzle point sits only ~0.02 units past its own
  // barrel's tip, so without this every shot immediately self-hit the
  // barrel and never actually travelled anywhere. Verified this exact
  // failure with the real equip transform before adding the fix; applied
  // to all three weapon kinds since a sword/pickaxe swing hit-detection
  // would hit the same class of bug later.
  const markUnpickable = () => parts.forEach((p) => (p.isPickable = false));

  if (kind === "sword") {
    // The Sword.glb model, laid out like the old blocky sword so the
    // existing grip offset/angle in PlayerController still fit: blade
    // along +Y, crossguard just below root's origin, the grip below that
    // (root sits where the hand closes, just under the guard).
    const pivot = new TransformNode(`swordPivot-${ownerName}`, scene);
    pivot.parent = root;
    pivot.scaling.setAll(SWORD_SCALE);
    pivot.position.y = SWORD_GUARD_Y - SWORD_GUARD_CENTER * SWORD_SCALE;
    const disposeModel = attachWeaponModel(scene, pivot, "Sword.glb", `${ownerName}-sword`, () => weaponMaterials(scene).steel);
    return {
      kind,
      root,
      dispose: () => {
        disposeModel();
        pivot.dispose();
        root.dispose();
      },
    };
  }

  if (kind === "pickaxe") {
    const handleMat = mat(scene, `pickHandleMat-${ownerName}`, "#5c4530");
    const headMat = mat(scene, `pickHeadMat-${ownerName}`, "#6b6b70");

    const handle = MeshBuilder.CreateCylinder(`pickHandle-${ownerName}`, { height: 0.7, diameter: 0.05 }, scene);
    handle.parent = root;
    handle.position.y = 0.2;
    handle.material = handleMat;
    parts.push(handle);

    // Two angled boxes meeting at the top of the handle, forming the
    // classic pickaxe head silhouette.
    const headL = MeshBuilder.CreateBox(`pickHeadL-${ownerName}`, { width: 0.32, height: 0.06, depth: 0.06 }, scene);
    headL.parent = root;
    headL.position = new Vector3(-0.14, 0.52, 0);
    headL.rotation.z = 0.5;
    headL.material = headMat;
    parts.push(headL);

    const headR = MeshBuilder.CreateBox(`pickHeadR-${ownerName}`, { width: 0.32, height: 0.06, depth: 0.06 }, scene);
    headR.parent = root;
    headR.position = new Vector3(0.14, 0.52, 0);
    headR.rotation.z = -0.5;
    headR.material = headMat;
    parts.push(headR);

    markUnpickable();
    return {
      kind,
      root,
      dispose: () => {
        parts.forEach((p) => p.dispose());
        root.dispose();
      },
    };
  }

  // gun — the 1911 model (public/assets/weapons/1911.glb), loaded once
  // per scene and instanced per equip. `root` is the grip: the model sits
  // under a pivot that turns its barrel to +Z (glTF file has it on -Z),
  // scales it to real pistol size and shifts it so the grip's center lands
  // on root's origin — so wherever root is placed in the hand, the hand
  // holds the grip. The muzzle sits at the barrel tip. The model loads
  // asynchronously; the gun is simply invisible for that first moment.
  const pivot = new TransformNode(`gunPivot-${ownerName}`, scene);
  pivot.parent = root;
  pivot.rotation.y = Math.PI;
  pivot.scaling.setAll(PISTOL_SCALE);
  pivot.position.copyFrom(PISTOL_GRIP_CENTER.multiplyByFloats(1, 1, -1).scale(-PISTOL_SCALE)); // undo the grip's offset after the 180° turn

  const muzzle = new TransformNode(`gunMuzzle-${ownerName}`, scene);
  muzzle.parent = pivot;
  muzzle.position.copyFrom(PISTOL_MUZZLE);

  const disposeModel = attachWeaponModel(scene, pivot, "1911.glb", `${ownerName}-1911`, (meshName) => {
    const { gunMetal, grip } = weaponMaterials(scene);
    return meshName.endsWith("Cube.001") ? grip : gunMetal;
  });

  return {
    kind,
    root,
    muzzle,
    dispose: () => {
      disposeModel();
      muzzle.dispose();
      pivot.dispose();
      root.dispose();
    },
  };
}

/** 1911.glb is modeled ~9.2 units long; this brings it to a ~24cm pistol. */
const PISTOL_SCALE = 0.026;
/** The grip's center and the barrel's tip, in the model file's own units/axes (barrel along -Z, grip down/back at +Z). */
const PISTOL_GRIP_CENTER = new Vector3(0, -0.75, 2.85);
const PISTOL_MUZZLE = new Vector3(0, 2.1, -4.6);

/** Sword.glb runs from the pommel (y -4.7) through the crossguard (y 0-0.5) to the tip (y 18.7); this makes it ~0.8 long, like the old blocky sword. */
const SWORD_SCALE = 0.034;
const SWORD_GUARD_CENTER = 0.25;
/** Where the old blocky sword's crossguard sat relative to root — the model's guard goes to the same place. */
const SWORD_GUARD_Y = -0.02;

const weaponContainers = new WeakMap<Scene, Map<string, Promise<AssetContainer>>>();
function loadWeaponContainer(scene: Scene, file: string): Promise<AssetContainer> {
  let byFile = weaponContainers.get(scene);
  if (!byFile) {
    byFile = new Map();
    weaponContainers.set(scene, byFile);
  }
  let promise = byFile.get(file);
  if (!promise) {
    promise = LoadingTracker.for(scene).track((onProgress) => SceneLoader.LoadAssetContainerAsync(WEAPONS_FOLDER, file, scene, onProgress));
    byFile.set(file, promise);
  }
  return promise;
}

/**
 * Loads a weapon model (once per scene, from public/assets/weapons/) and
 * puts a copy under `parent`, giving each part the material `materialFor`
 * picks. Returns a dispose function; disposing before the load finishes
 * just means the copy is never created. Every part is unpickable, so the
 * owner's own bullets/raycasts never hit their weapon.
 */
function attachWeaponModel(
  scene: Scene,
  parent: TransformNode,
  file: string,
  namePrefix: string,
  materialFor: (meshName: string) => StandardMaterial
): () => void {
  let disposed = false;
  const nodes: TransformNode[] = [];
  loadWeaponContainer(scene, file)
    .then((container) => {
      if (disposed || scene.isDisposed) return;
      const instance = container.instantiateModelsToScene((n) => `${namePrefix}-${n}`, false);
      instance.rootNodes.forEach((node) => {
        node.parent = parent;
        nodes.push(node as TransformNode);
        node.getChildMeshes(false).forEach((m) => {
          m.isPickable = false;
          m.material = materialFor(m.name);
        });
      });
    })
    .catch((err) => console.warn(`Weapon model ${file} failed to load:`, err));
  return () => {
    disposed = true;
    nodes.forEach((n) => n.dispose());
  };
}

const weaponMaterialCache = new WeakMap<Scene, { gunMetal: StandardMaterial; grip: StandardMaterial; steel: StandardMaterial }>();
/** Shared finishes for the weapon models (the files ship without usable materials — the sword's is even fully transparent). */
function weaponMaterials(scene: Scene) {
  let mats = weaponMaterialCache.get(scene);
  if (!mats) {
    const gunMetal = new StandardMaterial("weaponGunMetal", scene);
    gunMetal.diffuseColor = Color3.FromHexString("#2f3236");
    gunMetal.specularColor = new Color3(0.45, 0.45, 0.45);
    gunMetal.specularPower = 48;
    const grip = new StandardMaterial("weaponGrip", scene);
    grip.diffuseColor = Color3.FromHexString("#4a3020");
    grip.specularColor = new Color3(0.1, 0.1, 0.1);
    const steel = new StandardMaterial("weaponSteel", scene);
    steel.diffuseColor = Color3.FromHexString("#b9bec6");
    steel.specularColor = new Color3(0.6, 0.6, 0.6);
    steel.specularPower = 64;
    steel.backFaceCulling = false; // the sword file is single-sided in places
    mats = { gunMetal, grip, steel };
    weaponMaterialCache.set(scene, mats);
  }
  return mats;
}
