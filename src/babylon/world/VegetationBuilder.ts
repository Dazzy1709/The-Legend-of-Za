// src/babylon/world/VegetationBuilder.ts
// Scatters simple trees (cylinder trunk + low-poly canopy) across the
// outskirts ring between the city wall and the mountains — breaks up the
// empty grassland and gives the "Skyrim wilderness" belt some texture of
// its own, without needing real tree models.

import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { sampleTerrainHeight } from "./TerrainBuilder";
import { createFoliageTexture } from "./TextureFactory";

interface TreeSpot {
  x: number;
  z: number;
  scale: number;
}

interface SwayingCanopy {
  mesh: Mesh;
  /** Each tree's own phase offset (and slightly different rate) so a whole
   * band of trees doesn't sway in obvious lockstep — the single biggest
   * thing that separates "gentle wind" from "looks like a shader demo." */
  phase: number;
  rateX: number;
  rateZ: number;
  amplitude: number;
}

function seedFor(x: number, z: number): number {
  const s = Math.sin(x * 53.219 + z * 19.373) * 7841.729;
  return s - Math.floor(s);
}

export class VegetationBuilder {
  private swayingCanopies: SwayingCanopy[] = [];
  private elapsed = 0;

  constructor(scene: Scene, spots: TreeSpot[]) {
    const canopyMat = new StandardMaterial("canopyMat", scene);
    canopyMat.diffuseTexture = createFoliageTexture(scene);
    canopyMat.specularColor = Color3.Black();

    const trunkMat = new StandardMaterial("trunkMat", scene);
    trunkMat.diffuseColor = new Color3(0.32, 0.22, 0.14);
    trunkMat.specularColor = Color3.Black();

    spots.forEach((spot, i) => {
      const groundY = sampleTerrainHeight(spot.x, spot.z);
      const trunkHeight = 1.6 * spot.scale;

      const trunk = MeshBuilder.CreateCylinder(
        `tree-trunk-${i}`,
        { height: trunkHeight, diameterTop: 0.15 * spot.scale, diameterBottom: 0.22 * spot.scale },
        scene
      );
      trunk.position = new Vector3(spot.x, groundY + trunkHeight / 2, spot.z);
      trunk.material = trunkMat;
      trunk.checkCollisions = true;

      const canopy = MeshBuilder.CreateSphere(
        `tree-canopy-${i}`,
        { diameter: 2.2 * spot.scale, segments: 6 },
        scene
      );
      canopy.position = new Vector3(spot.x, groundY + trunkHeight + 0.6 * spot.scale, spot.z);
      canopy.scaling.y = 0.85;
      canopy.material = canopyMat;

      // A gentle wind sway — rotating the whole canopy slightly about its
      // own base rather than deforming individual vertices, which is
      // both far cheaper (no per-vertex shader/CPU work, just one
      // rotation write per tree per frame) and plenty convincing for a
      // small low-poly canopy like this one. Seeded per-tree so
      // neighboring trees drift out of sync with each other.
      const treeSeed = seedFor(spot.x + 3.7, spot.z - 8.2);
      const treeSeed2 = seedFor(spot.x - 6.1, spot.z + 2.4);
      this.swayingCanopies.push({
        mesh: canopy,
        phase: treeSeed * Math.PI * 2,
        rateX: 0.5 + treeSeed2 * 0.35,
        rateZ: 0.4 + treeSeed * 0.3,
        amplitude: (0.035 + treeSeed2 * 0.025) * spot.scale,
      });
    });
  }

  /** Call once per frame — advances the wind-sway phase and applies it to every canopy. Cheap: a handful of trig ops and a rotation write per tree, no geometry updates. */
  update(dt: number) {
    this.elapsed += dt;
    for (const c of this.swayingCanopies) {
      c.mesh.rotation.x = Math.sin(this.elapsed * c.rateX + c.phase) * c.amplitude;
      c.mesh.rotation.z = Math.sin(this.elapsed * c.rateZ + c.phase * 1.3) * c.amplitude;
    }
  }

  /** Deterministic sparse scatter within a radial band — same seeding pattern as CityBuilder's grids. */
  static generateBandSpots(innerRadius: number, outerRadius: number, step: number): TreeSpot[] {
    const spots: TreeSpot[] = [];
    for (let gx = -outerRadius; gx <= outerRadius; gx += step) {
      for (let gz = -outerRadius; gz <= outerRadius; gz += step) {
        const dist = Math.hypot(gx, gz);
        if (dist < innerRadius || dist > outerRadius) continue;
        const seed = seedFor(gx, gz);
        if (seed > 0.35) continue; // sparse
        if (gz < -50 && Math.abs(gx) < 22) continue; // keep the lake clear

        spots.push({
          x: gx + (seed - 0.5) * step * 0.6,
          z: gz + (seed - 0.5) * step * 0.6,
          scale: 0.8 + seed * 0.6,
        });
      }
    }
    return spots;
  }
}