// src/babylon/combat/EnemyManager.ts
import { Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import { QUALITY, scaledCount } from "../core/Quality";
import { Enemy } from "./Enemy";
import { COMBAT_CONFIG, type EnemyArchetypeConfig } from "./CombatConfig";
import { CombatManager, type Combatant } from "./CombatManager";
import { CITY_RADIUS } from "../world/TerrainBuilder";
import { ENEMY_LEVEL_ABOVE, MAX_CHARACTER_LEVEL } from "../progression/Progression";

/** Enemies roam the belt of wilds just outside the city, out to this far from the walls' plateau. */
const SPAWN_BELT_WIDTH = 240;
import { WALL_RADIUS } from "../world/CityBuilder";
import type { SpeechBubbles } from "../speech/SpeechBubbles";

const NIGHT_BRIGHTNESS_THRESHOLD = 0.15;

function seedFor(x: number, z: number): number {
  const s = Math.sin(x * 61.71 + z * 38.29) * 4127.912;
  return s - Math.floor(s);
}

/**
 * Owns every Enemy instance: spawning within population limits, the
 * day/night city-entry behavior, per-frame state updates, and turning a
 * live enemy attack-damage-window into an actual CombatManager call
 * against the player — the "Enemy Population Manager" and half of the
 * "Enemy AI Controller" role from spec section 39 (the other half, an
 * individual enemy's own state machine, is Enemy.ts).
 *
 * Simplification, stated plainly rather than left implicit: night-time
 * city entry (spec section 29) here is not real pathfinding through
 * city streets toward a specific gate. When night falls, some fraction
 * of this enemy's own archetype's canEnterCityAtNight population gets
 * its wander "home" relocated to a point just inside whichever of the
 * four city gates is closest to the player, and reverts back outside at
 * dawn — the enemy walks there itself frame by frame (Enemy.updateWander),
 * so it's a real, gradual approach, not a teleport, but it walks in a
 * straight line and does not navigate around walls or buildings.
 * A full street-aware path would be a genuinely separate pathfinding
 * task on top of this.
 */
/** How far above an enemy's feet the player's middle can be and still be hit (standing is about 1). */
const ENEMY_REACH_ABOVE = 2.6;

export class EnemyManager {
  private enemies: Enemy[] = [];
  private spawnTickTimer = 0;
  private wasNight = false;
  /** The player's level, kept in sync by GameEngine via setPlayerLevel. */
  private playerLevel = 1;
  /** How many levels above the player each enemy is — rolled once at spawn (ENEMY_LEVEL_ABOVE). */
  private levelsAbove = new WeakMap<Enemy, number>();

  constructor(
    private scene: Scene,
    private combat: CombatManager,
    private getPlayerPosition: () => Vector3,
    private playerCombatant: Combatant,
    private shadows?: ShadowGenerator,
    /** Speech bubbles for enemy barks. */
    private speech?: SpeechBubbles
  ) {}

  update(dt: number, brightness: number) {
    const playerPos = this.getPlayerPosition();
    const isNight = brightness < NIGHT_BRIGHTNESS_THRESHOLD;
    if (isNight !== this.wasNight) {
      this.onDayNightTransition(isNight, playerPos);
      this.wasNight = isNight;
    }

    for (const enemy of this.enemies) {
      // Each enemy's own update is isolated — a thrown error from one
      // enemy (e.g. a stale reference during its death/despawn
      // sequence) must not abort the whole loop and leave every enemy
      // after it in iteration order unprocessed for the rest of the
      // game. This was a real structural risk regardless of whether any
      // specific error is actually occurring: nothing here previously
      // stopped one bad frame of state from silently freezing every
      // other enemy's own combat processing indefinitely.
      try {
        // Ground distance, matching the melee circle drawn on the ground —
        // full 3D distance counted the player's chest-height tracking point,
        // so the player had to be well inside the circle to be "in range".
        // Height counts only once the player is well above them (flying
        // the Budmobile) — then they're out of reach, however close below.
        const ep = enemy.getPosition();
        const above = Math.max(0, playerPos.y - ep.y - ENEMY_REACH_ABOVE);
        const dist = Math.hypot(ep.x - playerPos.x, ep.z - playerPos.z, above);
        enemy.update(dt, playerPos, dist);

        if (enemy.consumeAttackWindow()) {
          const attackInstanceId = this.combat.beginAttackInstance();
          this.combat.applyDamage(enemy, this.playerCombatant, enemy.getAttackDamage(), attackInstanceId);
          this.combat.endAttackInstance(attackInstanceId);
        }
      } catch (err) {
        console.error(`Enemy "${enemy.id}" update threw — isolated, other enemies still processed this frame:`, err);
      }
    }

    // Cleanup finished deaths — frees population headroom for the next
    // spawn tick rather than counting a lingering, fully-faded corpse
    // against its own archetype's maxPopulation (spec section 32: "when
    // an enemy dies and is fully cleaned up, the population manager
    // should be notified so another enemy can eventually spawn").
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].despawnReady) {
        // Same isolation as the main update loop above, applied here
        // too — this loop was missing it. Left unguarded, a disposal
        // that throws for any reason would skip its own splice (that
        // enemy stays in the array forever, its despawnReady still
        // true, meaning this exact same dispose() call gets retried —
        // and potentially rethrows — every single frame from then on),
        // and since this loop runs before the spawn-tick code just
        // below it in this same method, a stuck throw here would also
        // silently stop new enemies from ever spawning again, not just
        // block damage.
        try {
          this.enemies[i].dispose();
        } catch (err) {
          console.error(`Enemy "${this.enemies[i].id}" dispose() threw — removing it from the array anyway so it can't get stuck retrying every frame:`, err);
        }
        this.enemies.splice(i, 1);
      }
    }

    this.spawnTickTimer += dt;
    if (this.spawnTickTimer >= COMBAT_CONFIG.spawn.tickInterval) {
      this.spawnTickTimer = 0;
      this.trySpawn(playerPos);
    }
  }

  private onDayNightTransition(isNight: boolean, playerPos: Vector3) {
    for (const enemy of this.enemies) {
      if (!enemy.config.canEnterCityAtNight) continue;
      if (isNight) {
        if (seedFor(enemy.getPosition().x, enemy.getPosition().z) > 0.4) continue; // only some of this archetype's population makes the trip, not all of it
        // Gates sit at bearings 0/90/180/270 (see CityBuilder.buildCityWall).
        const playerBearing = Math.atan2(playerPos.x, playerPos.z);
        const gate = Math.round(playerBearing / (Math.PI / 2)) * (Math.PI / 2);
        const entryRadius = WALL_RADIUS - 10;
        // Spread along the wall so several enemies don't stack on one point.
        const spread = (seedFor(enemy.getPosition().z, enemy.getPosition().x) - 0.5) * 12;
        enemy.setHome({
          x: Math.sin(gate) * entryRadius + Math.cos(gate) * spread,
          z: Math.cos(gate) * entryRadius - Math.sin(gate) * spread,
        });
      } else {
        enemy.resetHomeToSpawn();
      }
    }
  }

  private trySpawn(playerPos: Vector3) {
    for (const config of COMBAT_CONFIG.enemyArchetypes) {
      const currentCount = this.enemies.filter((e) => e.config.id === config.id && !e.isDead()).length;
      if (currentCount >= Math.max(1, scaledCount(config.maxPopulation, QUALITY.enemyScale))) continue; // fewer on phones — see Quality.ts

      const spot = this.pickSpawnSpot(playerPos, config);
      if (!spot) continue;
      const id = `${config.id}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
      const above = ENEMY_LEVEL_ABOVE.min + Math.floor(Math.random() * (ENEMY_LEVEL_ABOVE.max - ENEMY_LEVEL_ABOVE.min + 1));
      const enemy = new Enemy(this.scene, id, config, spot, this.levelFor(above), this.shadows, this.speech);
      this.levelsAbove.set(enemy, above);
      this.enemies.push(enemy);
    }
  }

  private pickSpawnSpot(playerPos: Vector3, config: EnemyArchetypeConfig): { x: number; z: number } | null {
    for (let attempt = 0; attempt < 12; attempt++) {
      // Samples directly from the valid outside-city ring around world
      // origin, rather than as an offset from the player's own
      // position — the previous player-relative approach
      // (playerPos + up to spawnMaxDistanceFromPlayer in a random
      // direction) could never actually land past the city wall
      // whenever the player was well inside the city: with
      // spawnMaxDistanceFromPlayer maxing at 60 units against a
      // 200-unit CITY_RADIUS, no offset from a city-dwelling player's
      // own position could ever reach the ring at all. That was the
      // real reason lock-on never had anything to find — not a
      // targeting bug, but zero enemies ever actually spawning during
      // ordinary in-city play.
      const angle = Math.random() * Math.PI * 2;
      const ringDist = CITY_RADIUS + 10 + Math.random() * SPAWN_BELT_WIDTH;
      const x = Math.sin(angle) * ringDist;
      const z = Math.cos(angle) * ringDist;
      const distFromPlayer = Math.hypot(x - playerPos.x, z - playerPos.z);
      // Still respects "don't spawn on top of the player" via the min
      // distance; the max distance is no longer enforced at spawn time
      // — population caps already bound how many enemies exist, and
      // detectionRadius/lockOnRadius are what make a given enemy
      // actually relevant once the player gets near it, so a spawn
      // simply existing somewhere else in the ring isn't a problem the
      // way finding zero valid spawns at all was.
      if (distFromPlayer < config.spawnMinDistanceFromPlayer) continue;
      return { x, z };
    }
    return null;
  }

  /** The player's level changed: every enemy is re-leveled in place (keeping its health fraction and its 1-2 levels' lead). */
  setPlayerLevel(level: number) {
    this.playerLevel = level;
    for (const enemy of this.enemies) enemy.setLevel(this.levelFor(this.levelsAbove.get(enemy) ?? ENEMY_LEVEL_ABOVE.min));
  }

  private levelFor(above: number): number {
    return Math.min(MAX_CHARACTER_LEVEL, this.playerLevel + above);
  }

  getAllAsCombatants(): Combatant[] {
    return this.enemies;
  }

  getAllEnemies(): Enemy[] {
    return this.enemies;
  }

  getEnemyById(id: string): Enemy | undefined {
    return this.enemies.find((e) => e.id === id);
  }

  dispose() {
    this.enemies.forEach((e) => e.dispose());
    this.enemies = [];
  }
}