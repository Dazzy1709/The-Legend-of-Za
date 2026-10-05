// src/babylon/world/DistrictTracker.ts
// Watches the player's position and emits a "districtChanged" bridge event
// whenever they cross from one Bezirk into another (or into/out of the
// city's built-up area entirely). React turns that into a toast — see
// App.tsx — so each district actually announces itself to the player.

import { PLAZA_CLEARANCE, CITY_SPAN } from "./CityBuilder";
import { nearestDistrict } from "./Districts";
import { EventBridge } from "../core/EventBridge";
import { PlayerController } from "../player/PlayerController";

const CHECK_INTERVAL = 0.3; // seconds between checks — no need to test every frame

export class DistrictTracker {
  private lastDistrictId: string | null = null;
  private timer = 0;

  constructor(private player: PlayerController, private bridge: EventBridge) {}

  update(dt: number) {
    this.timer += dt;
    if (this.timer < CHECK_INTERVAL) return;
    this.timer = 0;

    const pos = this.player.getPosition();
    const dist = Math.hypot(pos.x, pos.z);

    // Only "in" a named Bezirk while actually within the built-up ring —
    // the plaza and the open country beyond the city don't belong to any
    // district.
    const current = dist >= PLAZA_CLEARANCE && dist <= CITY_SPAN ? nearestDistrict(pos.x, pos.z) : null;
    const currentId = current?.id ?? null;

    if (currentId !== this.lastDistrictId) {
      this.lastDistrictId = currentId;
      if (current) {
        this.bridge.emit("districtChanged", current.name);
      }
    }
  }
}
