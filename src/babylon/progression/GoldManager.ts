// src/babylon/progression/GoldManager.ts
// "Drop 10 gold that the user can then walk over and picks up
// automatically" — listens for a killing blow via the existing
// enemyDamaged event (isFinalBlow already tells us exactly this, no
// separate death-position tracking needed), spawns a small pickup, and
// auto-collects it once the player gets close enough.

import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { EventBridge } from "../core/EventBridge";
import { sampleTerrainHeight } from "../world/TerrainBuilder";

const GOLD_PER_KILL = 10;
const PICKUP_RADIUS = 1.4;
const BOB_HEIGHT = 0.12;
const BOB_SPEED = 2.4;
const SPIN_SPEED = 2.0;

interface GoldPickup {
  mesh: Mesh;
  baseY: number;
  phase: number;
}

export class GoldManager {
  private pickups: GoldPickup[] = [];
  private goldCount = 0;
  private sharedMaterial: StandardMaterial;

  constructor(private scene: Scene, private bridge: EventBridge) {
    this.sharedMaterial = new StandardMaterial("gold-coin-mat", scene);
    this.sharedMaterial.diffuseColor = new Color3(0.85, 0.68, 0.15);
    this.sharedMaterial.emissiveColor = new Color3(0.55, 0.42, 0.08);
    this.sharedMaterial.specularColor = new Color3(1, 0.9, 0.5);

    bridge.on("enemyDamaged", (payload) => {
      if (payload.isFinalBlow) this.spawnGold(payload.position.x, payload.position.z);
    });
  }

  private spawnGold(x: number, z: number) {
    const groundY = sampleTerrainHeight(x, z) + 0.25;
    const mesh = MeshBuilder.CreateCylinder(
      `gold-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      { diameter: 0.3, height: 0.06, tessellation: 12 },
      this.scene
    );
    mesh.position.set(x, groundY, z);
    mesh.material = this.sharedMaterial;
    mesh.isPickable = false;
    this.pickups.push({ mesh, baseY: groundY, phase: Math.random() * Math.PI * 2 });
  }

  /** Call once per frame. */
  update(dt: number, playerPos: Vector3) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.phase += dt * BOB_SPEED;
      p.mesh.position.y = p.baseY + Math.sin(p.phase) * BOB_HEIGHT;
      p.mesh.rotation.y += dt * SPIN_SPEED;

      const dist = Vector3.Distance(new Vector3(p.mesh.position.x, playerPos.y, p.mesh.position.z), playerPos);
      if (dist <= PICKUP_RADIUS) {
        p.mesh.dispose();
        this.pickups.splice(i, 1);
        this.goldCount += GOLD_PER_KILL;
        // Emits the amount just gained (GOLD_PER_KILL), not the running
        // total — the reducer's own ADD_GOLD action (the actual fix for
        // "coins collected but not added to the gold bag": player.gold
        // in the reducer, which HUD displays, is a completely separate
        // value from this class's own goldCount, and nothing was ever
        // updating it) adds this to its own existing total, so it needs
        // a delta here, not an absolute value this.goldCount already is.
        this.bridge.emit("goldChanged", GOLD_PER_KILL);
      }
    }
  }

  getGoldCount(): number {
    return this.goldCount;
  }

  dispose() {
    this.pickups.forEach((p) => p.mesh.dispose());
    this.pickups = [];
    this.sharedMaterial.dispose();
  }
}
