// src/babylon/progression/StatsTracker.ts
// Lifetime numbers for the player's profile: time played, enemies
// defeated, deaths, coins picked up. Counted from the event bridge, kept
// in the save.

import type { SaveGame } from "../../../shared/save";
import type { EventBridge } from "../core/EventBridge";

export type PlayerStats = SaveGame["stats"];

export class StatsTracker {
  private stats: PlayerStats = { playTimeSeconds: 0, enemiesDefeated: 0, deaths: 0, coinsCollected: 0 };

  constructor(bridge: EventBridge) {
    bridge.on("enemyDied", ({ killedByPlayer }) => {
      if (killedByPlayer) this.stats.enemiesDefeated++;
    });
    bridge.on("playerDied", () => this.stats.deaths++);
    bridge.on("goldChanged", (amount) => {
      if (amount > 0) this.stats.coinsCollected += amount;
    });
  }

  update(dt: number) {
    this.stats.playTimeSeconds += dt;
  }

  exportState(): PlayerStats {
    return { ...this.stats, playTimeSeconds: Math.round(this.stats.playTimeSeconds) };
  }

  importState(stats: Partial<PlayerStats>) {
    this.stats = { ...this.stats, ...stats };
  }
}
