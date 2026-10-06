// src/babylon/characters/DoorStepGreeterManager.ts
// A scattering of stationary villagers standing just outside building
// doors across the city — never wandering, just idling in place, facing
// out toward the street the way someone might linger at their own
// doorstep. Built from the same real skinned ninja rig as CrowdManager's
// wanderers, but deliberately kept as its own small, focused class
// rather than folded into CrowdManager: this behavior has nothing in
// common with wandering/street-walking (no target-picking, no pausing
// logic, no movement at all), and the one thing it does need — where the
// doors actually are — comes from CityBuilder's own exported building-
// placement generators (generateCityLayout/buildAvenueFrontage/
// generateOutskirtsHomesteads), the same pure functions Minimap.tsx
// already reuses to draw the real city layout rather than an
// approximation of it.
//
// Every procedurally generated building's door is built on its local +Z
// face (CityBuilder's composeBuilding/doorParts), and buildOne then
// rotates the whole building by its BuildingPlacement.facingYaw (avenue
// row houses and the organic-district clusters set one; everything else
// is unrotated). So a greeter's spot is worked out in the building's own
// local space and rotated by that same yaw, and the greeter faces the
// same way the door does.

import { Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import { QUALITY } from "../core/Quality";
import { CHARACTER_ACTIVE_RADIUS } from "./CrowdManager";
import {
  buildAvenueFrontage,
  generateCityLayout,
  generateOutskirtsHomesteads,
  PLAZA_CLEARANCE,
} from "../world/CityBuilder";
import { SkeletalCharacter } from "./SkeletalCharacter";
import { sampleTerrainHeight } from "../world/TerrainBuilder";
import type { BuildingPlacement } from "../../types";

// How far in front of a building's door face a greeter stands, and how
// far to the side of the door's own centerline — enough to clearly read
// as "beside the door," not blocking it or standing on top of it.
const DOOR_STANDOFF = 1.1;
const DOOR_SIDE_OFFSET = 1.0;

// Only a fraction of all buildings get a greeter — with 300+ ambient
// crowd members already wandering the streets, giving every single
// building its own doorstep NPC on top of that would be a real
// additional character-count cost for a background detail, and would
// read as crowded rather than "a few people lingering by their door."
// Deterministic (seed-based, not Math.random) so the same buildings get
// greeters on every reload rather than reshuffling.
const GREETER_CHANCE = 0.05 * QUALITY.greeterScale; // fewer on phones — see Quality.ts

function seedFor(x: number, z: number): number {
  const s = Math.sin(x * 63.71 + z * 19.31) * 29104.171;
  return s - Math.floor(s);
}

export class DoorstepGreeterManager {
  private characters: SkeletalCharacter[] = [];

  constructor(scene: Scene, shadows?: ShadowGenerator) {
    const candidates: BuildingPlacement[] = [
      ...generateCityLayout().buildings,
      ...buildAvenueFrontage(),
      ...generateOutskirtsHomesteads(),
    ];

    for (const b of candidates) {
      // Skip anything right at the plaza's own edge — already busy with
      // its own hand-placed crowd groups (see GameEngine's central-core
      // CrowdManager instances).
      if (Math.hypot(b.position.x, b.position.z) < PLAZA_CLEARANCE + 4) continue;
      const roll = seedFor(b.position.x, b.position.z);
      if (roll > GREETER_CHANCE) continue;

      // Alternates which side of the door each greeter stands on, using
      // the same roll rather than a second seed call — purely visual
      // variety so every greeter isn't lined up on an identical offset.
      const side = roll < GREETER_CHANCE / 2 ? -1 : 1;
      const localX = side * (b.width / 4 + DOOR_SIDE_OFFSET);
      const localZ = b.depth / 2 + DOOR_STANDOFF;
      // Same convention as Babylon's rotation.y (and facingYaw everywhere
      // else here): local +Z maps to (sin yaw, cos yaw), local +X to (cos yaw, -sin yaw).
      const yaw = b.facingYaw ?? 0;
      const x = b.position.x + localX * Math.cos(yaw) + localZ * Math.sin(yaw);
      const z = b.position.z - localX * Math.sin(yaw) + localZ * Math.cos(yaw);
      const groundY = sampleTerrainHeight(x, z);
      const id = `greeter-${b.id}`;

      SkeletalCharacter.create(scene, id, ["idle"])
        .then((character) => {
          character.position = new Vector3(x, groundY, z);
          character.setFacing(yaw); // the same direction this building's door faces, outward toward the street
          character.play("idle");
          if (shadows) character.addShadowCasters((m) => shadows.addShadowCaster(m));
          this.characters.push(character);
        })
        .catch((err) => {
          // Most commonly: the scene was disposed mid-load (a fast
          // unmount — React StrictMode's dev-mode double-invoke does
          // this on every initial mount). Nothing to recover — this
          // manager instance is on its way out too.
          console.warn(`Doorstep greeter for ${b.id} failed to load:`, err);
        });
    }
  }

  /** Call once per frame — greeters never move, but still need their idle animation's skeleton advanced each frame like any other skinned character. */
  update(dt: number, playerPos: Vector3) {
    for (const character of this.characters) {
      const p = character.position;
      const near = Math.abs(p.x - playerPos.x) < CHARACTER_ACTIVE_RADIUS && Math.abs(p.z - playerPos.z) < CHARACTER_ACTIVE_RADIUS;
      character.setActive(near); // far away: hidden and not animated
      if (near) character.update(dt);
    }
  }
}