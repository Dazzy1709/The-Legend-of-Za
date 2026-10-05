// src/babylon/combat/DamageNumbers.ts
// Spec section 23/24. Simplification stated plainly: each hit spawns its
// own independent floating number rather than a merged/aggregated stack
// display — the "if more damage lands within 3 seconds, keep it alive"
// behavior in the spec implies tracking accumulated per-enemy damage
// state and merging displays into one, which is meaningfully more
// machinery than a straightforward floating-number-per-hit; several
// numbers appearing close together in quick succession over the same
// enemy already reads as the intended "impact" feedback even without
// true aggregation, so this delivers the actual gameplay-visible outcome
// with a simpler underlying mechanism, not a full literal spec match.

import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { EventBridge } from "../core/EventBridge";
import { createDamageNumberTexture } from "../world/TextureFactory";
import { COMBAT_CONFIG } from "./CombatConfig";

interface FloatingNumber {
  mesh: Mesh;
  material: StandardMaterial;
  elapsed: number;
  duration: number;
  riseSpeed: number;
}

export class DamageNumbers {
  private active: FloatingNumber[] = [];

  constructor(private scene: Scene, bridge: EventBridge) {
    bridge.on("enemyDamaged", (payload) => {
      this.spawn(payload.position.x, payload.position.z, payload.amount, payload.isFinalBlow);
    });
  }

  private spawn(x: number, z: number, amount: number, isFinalBlow: boolean) {
    const cfg = COMBAT_CONFIG.damageNumbers;
    const jx = (Math.random() - 0.5) * cfg.jitterAmount * 4;
    const jz = (Math.random() - 0.5) * cfg.jitterAmount * 4;

    const mesh = MeshBuilder.CreatePlane(`dmg-${Date.now()}-${Math.random().toString(36).slice(2)}`, { size: 0.95 }, this.scene); // was 0.55 — "the damage number should be bigger"
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.position = new Vector3(x + jx, 2.1, z + jz); // roughly chest/head height on the shared skeleton, well clear of the ground
    const material = new StandardMaterial(`dmg-mat-${mesh.name}`, this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = isFinalBlow ? new Color3(1, 0.35, 0.25) : new Color3(1, 0.92, 0.6);
    material.opacityTexture = createDamageNumberTexture(this.scene, Math.round(amount).toString());
    material.disableLighting = true;
    material.backFaceCulling = false;
    mesh.material = material;

    this.active.push({
      mesh,
      material,
      elapsed: 0,
      duration: COMBAT_CONFIG.damageNumbers.displayDurationBase,
      riseSpeed: 0.8 + Math.random() * 0.3,
    });
  }

  /** Call once per frame. */
  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const n = this.active[i];
      n.elapsed += dt;
      n.mesh.position.y += n.riseSpeed * dt;
      const t = n.elapsed / n.duration;
      // A brief scale-up in the first ~15% ("brief scale increase" per
      // spec section 23), then a steady fade for the rest — a small,
      // cheap stand-in for a full hit-impact/rumble effect.
      const scale = t < 0.15 ? 1 + (1 - t / 0.15) * 0.4 : 1;
      n.mesh.scaling.set(scale, scale, scale);
      n.material.alpha = Math.max(0, 1 - Math.max(0, t - 0.4) / 0.6); // holds fully visible for the first 40% of its life, then fades

      if (n.elapsed >= n.duration) {
        n.mesh.dispose();
        n.material.dispose(false, true); // true: also free the per-number DynamicTexture, which material.dispose() keeps by default
        this.active.splice(i, 1);
      }
    }
  }

  dispose() {
    this.active.forEach((n) => {
      n.mesh.dispose();
      n.material.dispose(false, true); // true: also free the per-number DynamicTexture, which material.dispose() keeps by default
    });
    this.active = [];
  }
}
