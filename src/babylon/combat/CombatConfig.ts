// src/babylon/combat/CombatConfig.ts
import type { CharacterSkinId } from "../characters/SkeletalCharacter";
import type { WeaponKind } from "../../types";
// Every combat balance value lives here, nowhere else — section 41/36 of
// the spec requires this explicitly ("do not scatter values throughout
// the code", "these values should be easy to modify later").

export type EnemyArchetypeId = "leonard" | "james" | "adam" | "zombie";

export interface EnemyArchetypeConfig {
  id: EnemyArchetypeId;
  displayName: string;
  /** Which CharacterSkinId (see SkeletalCharacter.ts) this archetype's model uses. Real bug fixed here: every enemy previously had no skinId passed at all when its character was created, silently defaulting to "ninja" — the player's own model — meaning every enemy and the player shared not just a model but, since instantiateModelsToScene is called with cloneMaterials=false, the exact same underlying material objects. Disposing one enemy's character (its own SkeletalCharacter.dispose()) was disposing state genuinely shared with the player's own materials, which is what actually made the player's own model go flat gray after a couple of kills. */
  skin: CharacterSkinId;
  /** Scales the level-based max health (endurance x 8) — this archetype's own toughness. */
  healthMultiplier: number;
  /** Scales the level-based raw damage (strength) — how hard this archetype hits. */
  damageMultiplier: number;
  meleeRadius: number;
  /** Seconds the wind-up + active window + recovery together take, roughly — drives how often this archetype can throw a swing. */
  attackSpeed: number;
  /** Seconds after an attack fully resolves before another can begin. */
  attackCooldown: number;
  walkSpeed: number;
  runSpeed: number;
  detectionRadius: number;
  chaseRadius: number;
  /** Beyond this distance from where the chase started, give up and return/wander instead. */
  returnRadius: number;
  hitReactionDuration: number;
  deathDespawnDelay: number;
  canEnterCityAtNight: boolean;
  spawnMinDistanceFromPlayer: number;
  spawnMaxDistanceFromPlayer: number;
  maxPopulation: number;
  /** Animation names from the shared clip library (see SkeletalCharacter's NinjaAnimation) this archetype plays. Hit reaction always uses the shared "headHit" clip (see Enemy.setState). */
  animations: {
    idle: string;
    walk: string;
    attack: string;
    /** Played once on spawn, before settling into idle/wander — per request, every enemy now spawns with a kip-up. */
    spawn: string;
    /** Replaces the walk animation while chasing/fleeing once this enemy's own health drops under 50%. */
    injuredRun: string;
    /** Played once on death, before the body lingers and fades (see Enemy.updateDeath). */
    death: string;
  };
}

/**
 * Four archetypes, sharing the same skeleton/animation set (per spec
 * section 40 — don't duplicate the skeletal/animation systems) but
 * independently tunable on every other axis the spec calls for. Typed
 * directly rather than cast, so a missing field is a compile error
 * instead of a NaN at runtime.
 */
const ENEMY_ARCHETYPES: EnemyArchetypeConfig[] = [
  {
    id: "leonard",
    displayName: "Leonard",
    skin: "leonard", // was "brute"/warriorFemale — id now matches the character it uses, per request
    healthMultiplier: 1.5,
    damageMultiplier: 1.2,
    meleeRadius: 2.2,
    attackSpeed: 1.29, // was 1.69, before that 2.2 — ENEMY_ATTACK_SPEED_RATIO went up again (1.3 -> 1.7) per "make the enemy attack speed even faster," so this shrinks again to match: 2.2s native duration / 1.7 ≈ 1.29s
    attackCooldown: 0.15, // was 0.3, before that 1.1 — attackSpeed grew substantially (1.6→2.2) for animation sync, so the full attack cycle was already taking much longer than before; this stayed at the old value on top of that, pushing the real gap between attacks past 3 seconds and reading as "waiting too long." The longer attack state itself now provides the real spacing — this only needs to cover the brief beat after a swing finishes before the next one can start.
    walkSpeed: 1.6,
    runSpeed: 3.7, // was 3.2 — "the enemies run should also be made a bit faster"
    detectionRadius: 14,
    chaseRadius: 22,
    returnRadius: 30,
    hitReactionDuration: 1.0, // the flinch (Head_Hit at 1.15x, ~1s) before the enemy fights back / chases
    deathDespawnDelay: 13, // 10s fully visible + 3s fade, per request ("the body stays for 10 seconds and then starts disappearing")
    canEnterCityAtNight: false,
    spawnMinDistanceFromPlayer: 20,
    spawnMaxDistanceFromPlayer: 55,
    maxPopulation: 6,
    animations: {
      idle: "idle",
      walk: "walkForward",
      attack: "hookPunch",
      spawn: "kipUp",
      injuredRun: "injuredRun",
      death: "fallingBackDeath",
    },
  },
  {
    id: "james",
    displayName: "James",
    skin: "james", // was "skirmisher"/wizard — id now matches the character it uses, per request
    healthMultiplier: 0.75,
    damageMultiplier: 0.8,
    meleeRadius: 1.9,
    attackSpeed: 0.47, // was 0.62, before that 0.8 — same reasoning as Leonard's own attackSpeed: 0.8s native / 1.7 ≈ 0.47s
    attackCooldown: 0.3, // was 0.5, before that 0.7 — smaller adjustment than the others below, since James's own attackSpeed barely changed (0.9→0.8)
    walkSpeed: 2.0,
    runSpeed: 5.3, // was 4.6 — "the enemies run should also be made a bit faster"
    detectionRadius: 16,
    chaseRadius: 26,
    returnRadius: 34,
    hitReactionDuration: 1.0, // the flinch (Head_Hit at 1.15x, ~1s) before the enemy fights back / chases
    deathDespawnDelay: 13, // 10s fully visible + 3s fade, per request ("the body stays for 10 seconds and then starts disappearing")
    canEnterCityAtNight: true,
    spawnMinDistanceFromPlayer: 18,
    spawnMaxDistanceFromPlayer: 50,
    maxPopulation: 8,
    animations: {
      idle: "idle",
      walk: "walkForward",
      attack: "punching",
      spawn: "kipUp",
      injuredRun: "injuredRun",
      death: "fallingBackDeath",
    },
  },
  {
    id: "adam",
    displayName: "Adam",
    skin: "adam", // was "stalker"/men — id now matches the character it uses, per request
    healthMultiplier: 1.0,
    damageMultiplier: 1.0,
    meleeRadius: 2.0,
    attackSpeed: 1.41, // was 1.85, before that 2.4 — same reasoning as Leonard's own attackSpeed: 2.4s native / 1.7 ≈ 1.41s
    attackCooldown: 0.15, // was 0.3, before that 0.9 — same reasoning as Leonard's own cooldown: attackSpeed grew substantially (1.1→2.4) for animation sync, so this needed to shrink to compensate rather than stack on top of an already much-longer attack state
    walkSpeed: 1.4,
    runSpeed: 4.4, // was 3.8 — "the enemies run should also be made a bit faster"
    detectionRadius: 20,
    chaseRadius: 30,
    returnRadius: 38,
    hitReactionDuration: 1.0, // the flinch (Head_Hit at 1.15x, ~1s) before the enemy fights back / chases
    deathDespawnDelay: 13, // 10s fully visible + 3s fade, per request ("the body stays for 10 seconds and then starts disappearing")
    canEnterCityAtNight: true,
    spawnMinDistanceFromPlayer: 22,
    spawnMaxDistanceFromPlayer: 60,
    maxPopulation: 5,
    animations: {
      idle: "idle",
      walk: "walkForward",
      attack: "meleeAttack360", // kept from before, since only two new punch-style attacks arrived and the other two archetypes already claimed them — swap this to something else if you'd rather all four use only the new clips
      spawn: "kipUp",
      injuredRun: "injuredRun",
      death: "fallingBackDeath",
    },
  },
  {
    id: "zombie",
    displayName: "Zombie",
    skin: "adam", // zombie.glb was removed per request — reusing Adam's skin here rather than leaving this archetype unassigned. Now that another archetype is literally named/id'd "adam" too, this is worth flagging clearly: Zombie and Adam will look identical in-game. Swap this to "james" or "leonard" if you'd rather every archetype look distinct.
    // Rough starting values for a slow, tough, relentless archetype —
    // I don't have your own intended numbers for this one, so these
    // are a reasonable guess to get it working, not a balance pass.
    // Every number here is independently yours to retune in this one
    // file.
    healthMultiplier: 1.25,
    damageMultiplier: 0.95,
    meleeRadius: 2.1,
    attackSpeed: 1.29, // was 1.69, before that 2.2 — same reasoning as Leonard's own attackSpeed (this archetype shares the same attack clip): 2.2s native / 1.7 ≈ 1.29s
    attackCooldown: 0.3, // was 0.5, before that 1.2 — same reasoning as Leonard/Adam's own cooldowns (attackSpeed grew substantially, 1.4→2.2, for animation sync), kept a touch higher than theirs since zombies are meant to feel more methodical/slower overall
    walkSpeed: 1.1,
    runSpeed: 2.3, // was 2.0 — "the enemies run should also be made a bit faster," though kept proportionally slower than the other three still — the classic slow-zombie feel
    detectionRadius: 15,
    chaseRadius: 24,
    returnRadius: 32,
    hitReactionDuration: 1.0, // the flinch (Head_Hit at 1.15x, ~1s) before the enemy fights back / chases
    deathDespawnDelay: 13,
    canEnterCityAtNight: true,
    spawnMinDistanceFromPlayer: 20,
    spawnMaxDistanceFromPlayer: 55,
    maxPopulation: 6,
    animations: {
      idle: "idle",
      walk: "walkForward",
      attack: "hookPunch",
      spawn: "kipUp",
      injuredRun: "injuredRun",
      death: "fallingBackDeath",
    },
  },
];

export interface GunConfig {
  /** Rounds per magazine — firing the last one starts a reload automatically. */
  magazineSize: number;
  /** Seconds a reload takes (shown as the small ring under the crosshair). */
  reloadSeconds: number;
}

/**
 * Every firearm's handling, keyed by WeaponKind (damage comes from the
 * weapon's level — see Progression.weaponDamageForLevel). A weapon kind listed here is
 * treated as a gun everywhere (firing, ammo, reloading, aiming) — adding a
 * new gun means adding its WeaponKind, its model in Weapons.ts, and an
 * entry here. Spare magazines are unlimited; only the current magazine
 * runs out.
 */
export const GUN_CONFIGS: Partial<Record<WeaponKind, GunConfig>> = {
  gun: { magazineSize: 12, reloadSeconds: 2.0 }, // Reloading.glb is 3.3s, so it plays at ~1.67x to fit
};

export function getGunConfig(kind: WeaponKind | null | undefined): GunConfig | null {
  return (kind && GUN_CONFIGS[kind]) || null;
}

export const COMBAT_CONFIG = {
  player: {
    /** Same value drives both the visible radius circle and the actual hit-detection radius — spec section 3 is explicit that these must never differ. */
    meleeRadius: 3.3, // weapons and punches alike
    /** Half-angle in radians either side of the attack direction — a full attack arc of ~100 degrees total, forgiving for action combat without hitting enemies behind the player. */
    attackArcHalfAngle: (50 * Math.PI) / 180,
    /** Each of the finisher's three damage windows hits for this share of a normal swing (so the finisher totals 1.5 swings). */
    finisherWindowMultiplier: 0.5,
    lockOnRadius: 10, // was 12 — a small reduction, per request ("just a very tiny bit")
    lockOnMaxDistance: 16, // beyond this from the player, lock-on auto-clears
    lockOnForwardConeHalfAngle: (70 * Math.PI) / 180,
    comboResetTime: 2.0, // reuses this project's existing MELEE_COMBO_WINDOW value/role
  },
  enemyArchetypes: ENEMY_ARCHETYPES,
  spawn: {
    /** How often (seconds) the population manager reconsiders spawning. */
    tickInterval: 3,
    /** Outside-city ring this spawns within — reuses CITY_RADIUS/MOUNTAIN_BASE from TerrainBuilder rather than a second, competing boundary definition (spec section 30). */
  },
  damageNumbers: {
    displayDurationBase: 1.1,
    /** Extending window per spec section 24 — new damage within this many seconds keeps the stack alive/resets its own fade timer. */
    stackResetWindow: 3,
    jitterAmount: 0.18,
  },
} as const;