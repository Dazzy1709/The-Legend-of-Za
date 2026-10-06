// src/babylon/core/GameEngine.ts
import {
  Color3,
  ImageProcessingConfiguration,
  Color4,
  DefaultRenderingPipeline,
  ColorCurves,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  KeyboardEventTypes,
  Logger,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { QUALITY, markLoadSettled, markLoadStarted } from "./Quality";
import { CityBuilder, CITY_SPAN, WALL_RADIUS } from "../world/CityBuilder";
import { CrowdManager } from "../characters/CrowdManager";
import { ADEL_RING_OUTER_RADIUS } from "../world/Districts";
import { DistrictTracker } from "../world/DistrictTracker";
import { DoorstepGreeterManager } from "../characters/DoorStepGreeterManager";
import { LoadingTracker } from "./LoadingTracker";
import { EventBridge } from "./EventBridge";
// Side-effect import — registers createDefaultEnvironment() and its sibling
// helpers onto Scene. This is a `declare module` augmentation, not part of
// the main @babylonjs/core barrel export by default (the same category of
// thing as the glTF loader plugin) — checked this directly rather than
// assuming it'd just be there.
import "@babylonjs/core/Helpers/sceneHelpers";
import { NPCManager } from "../characters/NPCManager";
import { CombatManager } from "../combat/CombatManager";
import { EnemyManager } from "../combat/EnemyManager";
import { DamageNumbers } from "../combat/DamageNumbers";
import { GoldManager } from "../progression/GoldManager";
import { killXp, purchaseXp, ProgressionSystem, type ProgressionSnapshot } from "../progression/Progression";
import { playLevelUpEffect } from "../progression/LevelUpEffect";
import type { StatName } from "../../types";
import { PlayerController } from "../player/PlayerController";
import { SkyBuilder } from "../world/SkyBuilder";
import { WeatherSystem } from "../world/WeatherSystem";
import { sampleTerrainHeight, TerrainBuilder } from "../world/TerrainBuilder";
import { createWaterTexture } from "../world/TextureFactory";
import { VegetationBuilder } from "../world/VegetationBuilder";
import { WildsBuilder } from "../world/WildsBuilder";
import { GrassBuilder, MeadowGrass } from "../world/GrassBuilder";
import type { WeaponKind } from "../combat/Weapons";
import { LAKE_CENTER, LAKE_RADIUS } from "../../content/cities/kushtar/placements";
import { getCity, STARTING_CITY_ID } from "../../content/cities";
import type { CityDefinition } from "../../content/cities/cityTypes";
import type { WorldPosition } from "../../types";
import { InteractableManager } from "../interaction/InteractableManager";
import { CutsceneDirector } from "../cutscenes/CutsceneDirector";
import type { CutsceneEvent } from "../cutscenes/types";
import { CUTSCENES, type CutsceneId } from "../../content/cutscenes";
import type { SaveGame } from "../../../shared/save";
import { MissionManager, type MissionStatus } from "../story/MissionManager";
import { StatsTracker } from "../progression/StatsTracker";

/** Everything the engine itself keeps in a save (the UI adds gold, items, weapons and reputation). */
export type EngineState = Pick<SaveGame, "progression" | "vehicles" | "world" | "stats"> & {
  player: Omit<SaveGame["player"], "gold" | "equippedWeapon" | "ownedWeapons">;
  story: Omit<SaveGame["story"], "reputation">;
};

export interface GameEngineOptions {
  /** Continue from this save (null/undefined: a new game). */
  save?: SaveGame | null;
  /**
   * Picking up after a page refresh: skip the opening shot and fade straight
   * in where the player was (a mission cutscene that was cut off still replays).
   */
  resume?: boolean;
}
import { SoundManager } from "../audio/SoundManager";
import { SpeechBubbles } from "../speech/SpeechBubbles";
import { Budmobile, BUDMOBILE_INTERACT_RADIUS } from "../vehicles/Budmobile";
import { BUDMOBILE } from "../../content/vehicles/vehicles";

/** How long "YOU DIED" shows before the screen fades to black and the player respawns. */
const DEATH_SCREEN_MS = 3500;
/** Fades to and from black (death respawn, resting at a safe house). */
const FADE_OUT_MS = 450;
const FADE_IN_MS = 600;
/** Time spent "asleep" in the dark at a safe house. */
const REST_DARK_MS = 700;
/** A short beat after everything has loaded before the intro starts moving. */
const INTRO_START_DELAY_MS = 300;
/** Play starts by this point even if something never finishes loading (a slow phone, a stuck file). */
const LOAD_MAX_WAIT_MS = 60_000;
/** How often the loading screen hears how far the load has got. */
const LOADING_REPORT_MS = 150;

const DAY_LENGTH_SECONDS = 600; // one full day/night cycle — slow enough that the light drifts rather than visibly sweeps
const GROUND_OFFSET = 1;

function districtCrowdSeed(n: number): number {
  const s = Math.sin(n * 78.233 + 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Splits a target NPC total for one district into multiple small
 * CrowdManager groups (rather than one huge group at a single point,
 * which reads as a mob, not dispersed townsfolk), scattered across that
 * district's own actual geometry — the Adelsviertel's full ring
 * (bearingCenterDeg=null), or an outer Bezirk's bearing wedge otherwise —
 * using the same deterministic sine-hash seeding CityBuilder itself uses
 * for procedural placement, so the layout is stable across reloads
 * rather than reshuffling every time. This is what actually makes "each
 * district has a set number of NPCs" a real, checkable number instead of
 * an ad-hoc scatter of hand-picked points.
 *
 * `wanderRadius` (default 16, was a fixed 6) is each group's own roaming
 * radius around its spawn point — 6 was reported as reading like tight
 * little clumps with visible gaps between them, since with ~13 spawn
 * points fanned across a district spanning well over a hundred units,
 * a 6-unit wander circle is small enough that neighboring groups' own
 * territories never come close to meeting. 16 is sized against the
 * district's own geometry (see the call sites below): with 13-14 points
 * spread across ~130 radial units and a 110° bearing fan, the rough
 * average spacing between neighboring spawn points works out to roughly
 * 25-30 units, so a 16-unit wander radius means adjacent groups' ranges
 * genuinely overlap rather than leaving dead space between them, without
 * being so large that every group in the district blurs into one mass.
 */
function generateDistrictCrowdManagers(
  scene: Scene,
  shadows: ShadowGenerator,
  seedOffset: number,
  totalCount: number,
  groupSize: number,
  innerRadius: number,
  outerRadius: number,
  bearingCenterDeg: number | null,
  bearingSpreadDeg: number,
  wanderRadius = 26 // was 16 — "more spread out throughout their respective districts": each group's own NPCs were clustering tightly around their one spawn point within the district; a wider radius per group is what actually spreads that clustering out, not more groups or a wider spawn-center spread (which was already fairly even, since spawn centers are already picked at a random bearing/radius across the whole district ring)
): CrowdManager[] {
  const managers: CrowdManager[] = [];
  let remaining = totalCount;
  let i = 0;
  while (remaining > 0) {
    const count = Math.min(groupSize, remaining);
    const s1 = districtCrowdSeed(seedOffset + i * 2);
    const s2 = districtCrowdSeed(seedOffset + i * 2 + 1);
    const bearing = bearingCenterDeg === null ? s1 * 360 : bearingCenterDeg + (s1 - 0.5) * 2 * bearingSpreadDeg;
    const radius = innerRadius + s2 * (outerRadius - innerRadius);
    const rad = (bearing * Math.PI) / 180;
    const x = radius * Math.sin(rad);
    let z = radius * Math.cos(rad);
    // Same lake-clearance rule generateOutskirtsHomesteads() (CityBuilder)
    // respects — nudges a point that would land in the lake itself just
    // outside that band rather than skipping the group (and its share of
    // the district's total) entirely.
    if (z < -80 && Math.abs(x) < 32) z = -75;
    managers.push(new CrowdManager(scene, { x, z }, wanderRadius, count, 1.5, shadows));
    remaining -= count;
    i++;
  }
  return managers;
}

/**
 * Owns the whole 3D world: engine, scene, terrain, city, sky, lighting,
 * player, NPCs, crowd, vehicles, and the day/night cycle. React
 * never touches Babylon objects directly — it talks to this class and
 * listens on `bridge`.
 */
export class GameEngine {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly bridge: EventBridge;

  private player: PlayerController;
  private npcManager: NPCManager;
  private combatManager!: CombatManager;
  private enemyManager!: EnemyManager;
  private damageNumbers!: DamageNumbers;
  private currentBrightness = 1; // set each frame by updateDayNightCycle, read by updateCombat
  private goldManager!: GoldManager;
  private progression!: ProgressionSystem;
  private grass: GrassBuilder;
  private meadowGrass: MeadowGrass;
  private crowdManagers: CrowdManager[] = [];
  private doorstepGreeters: DoorstepGreeterManager;
  private districtTracker: DistrictTracker;
  private city: CityBuilder;
  private vegetation: VegetationBuilder;
  private wilds: WildsBuilder;
  private sky: SkyBuilder;
  private weather: WeatherSystem;
  private ambient: HemisphericLight;
  private sun: DirectionalLight;
  private shadowGenerator: ShadowGenerator;

  private elapsed = 0;
  /** The city the player is in. */
  private cityDef: CityDefinition;
  /** Where the player comes back after dying — the city's spawn point until saving is added. */
  private respawnPoint: WorldPosition;
  private interactables!: InteractableManager;
  private cutscenes!: CutsceneDirector;
  private disposed = false;
  private sounds = new SoundManager();
  private budmobile!: Budmobile;
  private speech!: SpeechBubbles;
  /** Player input is on only when nothing is holding it off: */
  private inputEnabled = true;
  /** — a menu/dialogue/overlay in React, */
  private uiPaused = false;
  /** — or a cutscene, a safe-house rest or the death sequence in the engine. */
  private sequenceRunning = false;
  private positionSyncTimer = 0;
  private lastAimingState = false;
  private static readonly ENEMY_HEALTHBAR_AIM_RANGE = 70;
  private static readonly ENEMY_HEALTHBAR_AFTER_HIT_SECONDS = 4;
  private static readonly POSITION_SYNC_INTERVAL = 0.1; // throttle React updates to ~10/sec
  /**
   * Atmospheric haze. Plain exponential (not squared) fog: it fades the
   * middle distance gently and keeps going, so far hills and the mountain
   * ring stay visible as soft silhouettes instead of vanishing — the
   * Skyrim view. Weather multiplies it (see updateDayNightCycle).
   */
  private static readonly BASE_FOG_DENSITY = 0.0019;

  private missions!: MissionManager;
  private stats!: StatsTracker;

  constructor(canvas: HTMLCanvasElement, options: GameEngineOptions = {}) {
    // Suppresses Babylon's own internal warning-level logging (kept:
    // error-level, still worth seeing) — specifically found to matter
    // because retargetAnimationGroup logs one warning line PER missing
    // bone whenever a source animation clip references a joint a target
    // skeleton doesn't have (e.g. detailed per-finger bones some
    // character models simply don't include), and this project has
    // confirmed instances of that across multiple skins/animations —
    // easily dozens of log calls per character load, multiplied across
    // ~300 crowd NPCs plus every continuously-spawning enemy. Missing a
    // finger bone is genuinely harmless (that one joint just doesn't
    // animate; the character still works), but the sheer volume of
    // console output this was producing is a real, ongoing cost, not a
    // one-time startup blip — this needed fixing regardless of whether
    // it turns out to be connected to the combat timing issues, since
    // logging at this volume is worth eliminating on its own.
    Logger.LogLevels = Logger.ErrorLogLevel;
    this.bridge = new EventBridge();
    markLoadStarted(); // see Quality.ts — a crash from here on makes the next start lighter
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    // Phones: image textures load at most this big (Babylon scales larger ones down) — see Quality.ts.
    if (QUALITY.maxTextureSize > 0) this.engine.getCaps().maxTextureSize = Math.min(this.engine.getCaps().maxTextureSize, QUALITY.maxTextureSize);
    this.scene = new Scene(this.engine);
    this.scene.collisionsEnabled = true;
    // Babylon ray-picks the whole scene on every pointer move by default
    // (for hover events this game never uses). With the camera driven by
    // mouse movement that was a full-scene raycast per mouse event.
    this.scene.skipPointerMovePicking = true;
    this.scene.clearColor = new Color4(0.53, 0.7, 0.85, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP;
    this.scene.fogDensity = GameEngine.BASE_FOG_DENSITY;
    this.scene.fogColor = new Color3(0.6, 0.72, 0.8);

    this.ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
    this.ambient.intensity = 0.65;
    // Sky light from above, warm earthy bounce from below — gives shaded
    // sides depth and colour instead of a flat grey.
    this.ambient.diffuse = new Color3(0.9, 0.92, 1);
    this.ambient.groundColor = new Color3(0.48, 0.42, 0.34);
    this.ambient.specular = Color3.Black();
    this.sun = new DirectionalLight("sun", new Vector3(-0.5, -1, -0.3), this.scene);
    this.sun.intensity = 1.5;
    this.sun.position = new Vector3(0, 60, 0); // shadow map needs a source position, not just a direction — kept updated relative to the player each frame in updateDayNightCycle
    // A fixed, explicit frustum size rather than the default auto-sizing
    // (which stretches the orthographic frustum to cover every shadow-
    // caster in the scene — across this city's 400+-unit span, that
    // spread a shadow map so thin shadows were effectively invisible).
    // 90 units covers a generous radius around the player — comfortably
    // past the view distance anything would actually need a visible
    // shadow at — while staying tight enough that resolution is
    // concentrated where it's actually seen.
    this.sun.shadowFrustumSize = 90;
    this.sun.autoUpdateExtends = false;
    // shadowFrustumSize only constrains the orthographic frustum's
    // width/height (the X/Y extent) — it says nothing about the near/far
    // depth range along the light's own view direction, which is a
    // separate setting (shadowMinZ/shadowMaxZ). With autoUpdateExtends
    // off, that range isn't being auto-computed from the scene either,
    // so it likely defaults to something that doesn't actually cover the
    // real distance from the light (60 units back from the player) to
    // the geometry around the player — which would silently clip every
    // shadow out even with the width/height correctly constrained above.
    // 1 to 200 comfortably covers "right at the light" out past anything
    // shadowFrustumSize's own 90-unit radius could contain.
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 200;

    // 2048, up from 1024 — with the frustum now constrained to a tight
    // radius around the player instead of the whole city, resolution
    // per world-unit is already much higher than before even at the old
    // size; the bump makes edges crisper still rather than leaving that
    // headroom unused.
    this.shadowGenerator = new ShadowGenerator(QUALITY.shadowMapSize, this.sun); // was 2048 — a real, ongoing per-frame cost (this re-renders for every shadow caster, every frame — currently ~60+ NPCs/enemies plus buildings), not just a one-time load cost. 1024 is still enough resolution at this camera distance; 2048 was 4x the memory/fill-rate cost for a difference that's hard to see in practice.
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 36; // soft-edged shadows (TF2-style), not crisp ones
    this.shadowGenerator.darkness = 0.5; // shadows are a soft shade, never near-black

    // PBRMaterial (used for the real photographed textures in CityBuilder —
    // asphalt roads, grass squares) relies on environment/IBL lighting for
    // its ambient and specular response, not just direct lights the way
    // StandardMaterial does. Verified directly that without this, those
    // surfaces would only receive light from the sun/hemispheric light
    // above with zero indirect contribution, looking noticeably darker and
    // flatter than the StandardMaterial buildings and sidewalks right next
    // to them. createSkybox/createGround are both off since SkyBuilder and
    // TerrainBuilder already provide this world's actual sky and ground
    // geometry — this call exists purely to supply the IBL texture PBR
    // materials read from, not to add any new visible geometry. Pulls its
    // default environment texture from Babylon's own asset CDN
    // (assets.babylonjs.com) — confirmed with the user this external
    // dependency is fine before adding it, since everything else in this
    // project is deliberately self-contained with no outside image assets.
    //
    // cameraContrast/cameraExposure/toneMappingEnabled are explicitly
    // overridden to neutral here — checked Babylon's own source and found
    // that createDefaultEnvironment's real defaults for these are contrast
    // 1.2, exposure 0.8, and tone mapping ON, none of which I asked for.
    // Those three are GLOBAL scene.imageProcessingConfiguration settings
    // applied to the entire final rendered frame, not per-material — which
    // is exactly why they were washing out everything with a glossy/glowing
    // look uniformly (roofs, roads, even sprites, which don't use PBR or
    // read the environment texture at all). All I actually needed was the
    // environment texture itself for PBR's IBL response.
    this.scene.createDefaultEnvironment({
      createSkybox: false,
      createGround: false,
      cameraContrast: 1,
      cameraExposure: 1,
      toneMappingEnabled: false,
    });

    this.sky = new SkyBuilder(this.scene);
    this.weather = new WeatherSystem(this.scene);
    new TerrainBuilder(this.scene);
    this.cityDef = getCity(STARTING_CITY_ID);
    this.respawnPoint = this.cityDef.spawnPoint;
    this.city = new CityBuilder(this.scene, this.cityDef.buildings, this.shadowGenerator);
    const parkSpots = this.city.getParkPositions().map((p) => ({ x: p.x, z: p.z, scale: 1 }));
    this.vegetation = new VegetationBuilder(this.scene, parkSpots); // trees in the city's parks
    this.wilds = new WildsBuilder(this.scene, this.shadowGenerator); // forests, rocks and scrub outside the walls
    // Grass confined to the pavement/lawn of almost every building,
    // excluding Adelsviertel — replaces the previous outskirts-belt and
    // farm-district scatters entirely, per "only be on the pavement...
    // except for the ones in the Adelsviertel." getGroundPatchPositions
    // reuses the district each lot was already assigned during city
    // generation (see CityBuilder's own groundPatches), so this doesn't
    // reimplement district-boundary geometry a third time.
    const lawnSpots = this.city
      .getGroundPatchPositions()
      .filter((p) => p.districtId !== "noble");
    // spotsPerPoint 5->8 ("a bit more grass"), keepChance 0.88->0.97
    // ("increase the houses where there is grass on the lawn" — more
    // lawns get grass, not just a denser version of the same ~88%).
    const buildingGrassSpots = GrassBuilder.generateGrassSpotsAroundPoints(lawnSpots, 8, 4.5, 0.97);
    this.grass = new GrassBuilder(this.scene, buildingGrassSpots);
    this.meadowGrass = new MeadowGrass(this.scene, WALL_RADIUS + 6); // grass across the wilds, around the player
    this.buildLake();

    // Bloom in the post-process pipeline (below) picks up whatever a
    // GlowLayer marks as emissive — this is what makes lit windows actually
    // glow at night instead of just being a bright flat patch.
    // (Not on phones — it renders the scene again every frame; see Quality.ts.)
    if (QUALITY.glowLayer) {
      const glow = new GlowLayer("cityGlow", this.scene);
      glow.intensity = 0.6;
    }

    const spawn = this.cityDef.spawnPoint;
    this.player = new PlayerController(this.scene, canvas, new Vector3(spawn.x, sampleTerrainHeight(spawn.x, spawn.z) + GROUND_OFFSET, spawn.z));
    this.player.addShadowCasters((m) => this.shadowGenerator.addShadowCaster(m));

    // Combat systems — CombatManager is the single centralized damage
    // path (spec section 3/34/39); EnemyManager owns every Enemy
    // instance and needs a reference back to the player (for its own
    // chase/attack distance checks), which is why PlayerController's own
    // combat wiring (setCombatSystems) happens as a late-bound call
    // after EnemyManager exists, rather than the two being constructed
    // in either order without one needing the other's output first.
    this.combatManager = new CombatManager(this.bridge);
    // A brief camera shake whenever the player actually lands a hit —
    // "when the user does damage it still feels non-effective."
    // enemyDamaged already fires exactly on that event (any player
    // swing that connects), so this is the one place that needs to
    // know about it, not PlayerController's own attack code.
    this.bridge.on("enemyDamaged", () => this.player.triggerHitShake());
    // Speech bubbles — enemy barks now; anyone can talk through it later.
    this.speech = new SpeechBubbles(this.scene, () => this.scene.activeCamera);
    this.enemyManager = new EnemyManager(
      this.scene,
      this.combatManager,
      () => this.player.getPosition(),
      this.player,
      this.shadowGenerator,
      this.speech
    );
    this.player.setCombatSystems(this.combatManager, this.bridge, () => this.enemyManager.getAllAsCombatants());

    // Leveling: the player's level, stats and weapon levels. Enemies are
    // always 1-2 levels above the player (ENEMY_LEVEL_ABOVE), so they're
    // re-leveled whenever the player's level changes.
    this.progression = new ProgressionSystem(this.bridge);
    this.player.setProgression(this.progression);
    this.enemyManager.setPlayerLevel(this.progression.getLevel());
    this.bridge.on("enemyDied", ({ level, killedByPlayer, weapon }) => {
      // Kills are the main XP source — the weapon that landed the blow gets the same XP.
      if (killedByPlayer) this.progression.grantXp(killXp(level), weapon);
    });
    this.bridge.on("progressionChanged", () => {
      this.player.refreshMaxHealth(); // level-ups and endurance buffs change max health
      this.enemyManager.setPlayerLevel(this.progression.getLevel());
    });
    this.bridge.on("levelUp", () => {
      playLevelUpEffect(this.scene, () => this.player.getPosition());
      this.bridge.emit("requestSave", { reason: "level-up" });
    });
    this.bridge.on("weaponLevelUp", () =>
      playLevelUpEffect(this.scene, () => this.player.getPosition(), new Color3(1, 0.85, 0.45))
    );
    this.damageNumbers = new DamageNumbers(this.scene, this.bridge);
    this.goldManager = new GoldManager(this.scene, this.bridge);

    this.npcManager = new NPCManager(this.scene, this.cityDef.npcs, this.player, this.bridge, this.shadowGenerator);
    this.interactables = new InteractableManager(
      this.scene,
      this.cityDef.safeHouses.map((h) => ({ id: h.id, kind: "safeHouse" as const, label: h.name, action: "rest at", position: h.door, radius: 2.2 })),
      () => this.player.getPosition(),
      this.bridge,
      () => this.npcManager.getNearbyId() !== null
    );
    this.bridge.on("interactableUsed", ({ id, kind }) => {
      if (kind === "safeHouse") void this.restAtSafeHouse(id);
      else if (kind === "vehicle") this.budmobile.mount();
    });
    this.bridge.on("playerDied", () => {
      this.budmobile.forceDismount(); // knocked off if riding
      void this.runDeathSequence();
    });
    // ~120 ambient NPCs total: 20 in the hand-placed core (plaza, two
    // market stalls, palace forecourt, one extra Adelsviertel spot), 29
    // along the four avenue arms, 16 street-walkers, and 56 from
    // generateDistrictCrowdManagers below (Adelsviertel 18,
    // Handelsviertel 16, Handwerksviertel 11, Bauernviertel 11). Every
    // group stays small (2-5 people) since each crowd member is a full
    // skinned, independently-animated character, not a sprite — if frame
    // rate suffers, the per-district totals below are the first thing to
    // scale back.
    this.crowdManagers = [
      // Central core — unchanged.
      new CrowdManager(this.scene, { x: 0, z: 0 }, 14, 4, 3, this.shadowGenerator, "wander", true), // the plaza — conversations enabled. Reduced further, 7 -> 4, per performance request ("big lag").
      new CrowdManager(this.scene, { x: -15, z: 13 }, 4, 4, 1, this.shadowGenerator, "wander", true), // market-stall-1
      new CrowdManager(this.scene, { x: 15, z: 13 }, 4, 4, 1, this.shadowGenerator, "wander", true), // market-stall-2
      new CrowdManager(this.scene, { x: 0, z: 72 }, 6, 5, 2, this.shadowGenerator), // palace forecourt
      // One more Adelsviertel-ring spot, away from both avenues and the palace.
      new CrowdManager(this.scene, { x: 28, z: -28 }, 6, 3, 1, this.shadowGenerator), // Adelsviertel, south-east of the plaza

      // North avenue arm. Wander radius widened (5 -> 12) for the same
      // reason as generateDistrictCrowdManagers above — 5 units read as
      // a tight, static-looking clump right at each point.
      new CrowdManager(this.scene, { x: 7, z: 45 }, 12, 3, 1, this.shadowGenerator),
      new CrowdManager(this.scene, { x: -7, z: 100 }, 12, 3, 1, this.shadowGenerator),
      new CrowdManager(this.scene, { x: 7, z: 150 }, 12, 2, 1, this.shadowGenerator),
      // South avenue arm — kept clear of the lake exclusion zone (z < -80 near x=0).
      new CrowdManager(this.scene, { x: 7, z: -45 }, 12, 3, 1, this.shadowGenerator),
      new CrowdManager(this.scene, { x: -7, z: -70 }, 12, 2, 1, this.shadowGenerator),
      // East avenue arm.
      new CrowdManager(this.scene, { x: 45, z: 7 }, 12, 3, 1, this.shadowGenerator),
      new CrowdManager(this.scene, { x: 100, z: -7 }, 12, 3, 1, this.shadowGenerator),
      new CrowdManager(this.scene, { x: 150, z: 7 }, 12, 2, 1, this.shadowGenerator),
      // West avenue arm.
      new CrowdManager(this.scene, { x: -45, z: -7 }, 12, 3, 1, this.shadowGenerator),
      new CrowdManager(this.scene, { x: -100, z: 7 }, 12, 3, 1, this.shadowGenerator),
      new CrowdManager(this.scene, { x: -150, z: -7 }, 12, 2, 1, this.shadowGenerator),

      // Street-walkers — long-distance travelers following the actual
      // street grid (CrowdManager's "streetWalk" mode) rather than
      // wandering near one spot, so these are the ones actually visible
      // crossing the city on the sidewalks. Spread across several
      // starting points so they aren't all converging from one corner;
      // radius/clearance are unused in this mode (each member picks its
      // own distant destination independently) so they're passed as a
      // nominal 1/0.
      new CrowdManager(this.scene, { x: 0, z: 40 }, 1, 3, 0, this.shadowGenerator, "streetWalk"),
      new CrowdManager(this.scene, { x: 40, z: 0 }, 1, 3, 0, this.shadowGenerator, "streetWalk"),
      new CrowdManager(this.scene, { x: 0, z: -40 }, 1, 3, 0, this.shadowGenerator, "streetWalk"),
      new CrowdManager(this.scene, { x: -40, z: 0 }, 1, 3, 0, this.shadowGenerator, "streetWalk"),
      new CrowdManager(this.scene, { x: 60, z: 60 }, 1, 2, 0, this.shadowGenerator, "streetWalk"),
      new CrowdManager(this.scene, { x: -60, z: -60 }, 1, 2, 0, this.shadowGenerator, "streetWalk"),
    ];
    this.doorstepGreeters = new DoorstepGreeterManager(this.scene, this.shadowGenerator);
    // Systematic per-district generation — reaches an exact, deliberate
    // total rather than an ad-hoc scatter. Split so the total (core +
    // avenue arms above, plus this) comes out to ~300: Adelsviertel gets
    // less here since it already has the plaza/market/palace core on top
    // of this; the three outer Bezirke split the rest, weighted slightly
    // toward Handelsviertel as the busiest, most commercial district.
    this.crowdManagers.push(
      // Adelsviertel — the ring, any bearing (bearingCenterDeg=null),
      // avoiding the innermost ring (already covered by the core spots).
      ...generateDistrictCrowdManagers(this.scene, this.shadowGenerator, 1000, 18, 4, 25, ADEL_RING_OUTER_RADIUS, null, 0), // was 36 — halved for performance ("big lag")
      // Handelsviertel (trade, bearing 60°).
      ...generateDistrictCrowdManagers(this.scene, this.shadowGenerator, 2000, 16, 5, ADEL_RING_OUTER_RADIUS + 5, CITY_SPAN - 10, 60, 55), // was 31 — halved for performance
      // Handwerksviertel (craft, bearing 180°).
      ...generateDistrictCrowdManagers(this.scene, this.shadowGenerator, 3000, 11, 5, ADEL_RING_OUTER_RADIUS + 5, CITY_SPAN - 10, 180, 55), // was 21 — halved for performance
      // Bauernviertel (farm, bearing 300°).
      ...generateDistrictCrowdManagers(this.scene, this.shadowGenerator, 4000, 11, 5, ADEL_RING_OUTER_RADIUS + 5, CITY_SPAN - 10, 300, 55) // was 21 — halved for performance
    );
    this.districtTracker = new DistrictTracker(this.player, this.bridge);

    this.freezeStaticMeshes();
    this.createBudmobile();
    this.stats = new StatsTracker(this.bridge);
    this.createMissions();
    this.setupPostProcessing();
    this.setupWeaponWheelToggle();
    this.setupLockOnToggle();
    this.cutscenes = new CutsceneDirector(this.player.camera, this.bridge, (event) => this.handleCutsceneEvent(event));
    this.setupCutsceneSkip();
    if (options.save) this.applySave(options.save);
    // The story starts (or picks up) once the opening shot has settled.
    if (options.resume) this.fadeInWhenReady(() => this.missions.beginStory());
    else this.playLoadIn(true, () => this.missions.beginStory());

    this.engine.runRenderLoop(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.elapsed += dt;
      this.updateDayNightCycle(dt);
      this.progression.update(dt);
      this.stats.update(dt);
      this.budmobile.update(dt); // before the player, who is placed on it
      this.player.update(dt);
      try {
        this.updateCombat(dt);
      } catch (err) {
        // Final safety net: even with per-enemy isolation inside
        // EnemyManager itself, this guarantees nothing in combat
        // processing can ever take the rest of this frame's systems
        // (NPCs, crowds, etc.) hostage the way one uncaught exception
        // silently could before.
        console.error("updateCombat threw — isolated, rest of the frame still runs:", err);
      }
      this.npcManager.update(dt);
      const bud = this.budmobile.getPosition();
      this.interactables.setPosition(BUDMOBILE.id, bud.x, bud.z);
      this.interactables.setAvailable(BUDMOBILE.id, this.budmobile.isParked());
      this.interactables.update(dt);
      this.cutscenes.update(dt);
      const playerPos = this.player.getPosition();
      this.crowdManagers.forEach((c) => c.update(dt, playerPos));
      this.doorstepGreeters.update(dt, playerPos);
      this.grass.update(playerPos);
      this.meadowGrass.update(playerPos);
      this.vegetation.update(dt);
      this.wilds.update(dt, playerPos, this.player.camera.globalPosition);
      this.districtTracker.update(dt);
      this.syncPositionToReact(dt);
      this.syncAimingToReact();
      this.scene.render();
    });

    window.addEventListener("resize", this.handleResize);
  }

  private handleResize = () => this.engine.resize();

  /** React's side of the input switch — false while a menu, dialogue or overlay is open. */
  setInputEnabled(enabled: boolean) {
    this.uiPaused = !enabled;
    this.refreshInputEnabled();
  }

  private refreshInputEnabled() {
    const enabled = !this.uiPaused && !this.sequenceRunning;
    this.inputEnabled = enabled;
    this.player.setInputEnabled(enabled);
    // No talking to people or using things from up on the Budmobile.
    const riding = this.budmobile?.hasRider() ?? false;
    this.npcManager.setEnabled(enabled && !riding);
    this.interactables?.setEnabled(enabled && !riding);
  }

  /**
   * The Budmobile, parked beside the safe house. It stays wherever the
   * player leaves it. E hops on (through the interactables, like any
   * usable thing) and, while riding, E hops off.
   */
  private createBudmobile() {
    const parking = this.cityDef.safeHouses[0]?.parking ?? { ...this.cityDef.spawnPoint, yaw: 0 };
    this.budmobile = new Budmobile(this.scene, BUDMOBILE, parking, this.player, this.bridge, (running) => this.setSequenceRunning(running));
    this.interactables.add(this.scene, {
      id: BUDMOBILE.id,
      kind: "vehicle",
      label: "the Budmobile",
      action: "ride",
      position: { x: parking.x, z: parking.z },
      radius: BUDMOBILE_INTERACT_RADIUS,
      showMarker: false,
    });
    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key.toLowerCase() === "e" && this.inputEnabled) this.budmobile.tryDismount();
    });
    this.bridge.on("rideChanged", () => this.refreshInputEnabled());
  }

  /** Where the Budmobile is, and whether it's being ridden — for the minimap. */
  getVehicleMarker(): { x: number; z: number; ridden: boolean } {
    const p = this.budmobile.getPosition();
    return { x: p.x, z: p.z, ridden: this.budmobile.hasRider() };
  }

  /** Holds player input off for the length of an engine-run sequence (cutscene, rest, death). */
  private setSequenceRunning(running: boolean) {
    this.sequenceRunning = running;
    this.refreshInputEnabled();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------- Sequences ----------

  /**
   * The load-in shot, at the start of the game and after every respawn:
   * from high above, the camera circles down onto the player and settles
   * straight behind them — the way they'll be facing when play begins.
   * The screen starts black and fades in as it begins; input (and the
   * HUD) come back only once the camera is exactly in place.
   * `waitForWorld` holds it until the scene has finished loading.
   */
  private playLoadIn(waitForWorld: boolean, then?: () => void) {
    this.setSequenceRunning(true);
    this.player.setCameraOverride(true);
    const end = this.player.getCameraRestPose();
    this.cutscenes.prepare(CUTSCENES.loadIn, end, () => {
      this.player.setCameraOverride(false);
      this.setSequenceRunning(false);
      // Skipped before it began? The black still has to clear.
      this.bridge.emit("screenFade", { opacity: 0, durationMs: 400 });
      then?.();
    });
    const start = () => {
      if (this.disposed) return;
      this.bridge.emit("screenFade", { opacity: 0, durationMs: 1200 });
      this.cutscenes.begin();
    };
    if (waitForWorld) this.whenLoaded(() => setTimeout(start, INTRO_START_DELAY_MS));
    else setTimeout(start, 150);
  }

  /** Resuming after a refresh: no opening shot — the camera starts behind the player and the black lifts once the world has loaded. */
  private fadeInWhenReady(then: () => void) {
    this.setSequenceRunning(true);
    let started = false;
    const start = () =>
      setTimeout(() => {
        if (this.disposed || started) return;
        started = true;
        const pose = this.player.getCameraRestPose();
        const camera = this.player.camera;
        camera.alpha = pose.alpha;
        camera.beta = pose.beta;
        camera.radius = pose.radius;
        camera.setTarget(pose.target, false, false, true); // keep the angles just set
        this.setSequenceRunning(false);
        this.bridge.emit("screenFade", { opacity: 0, durationMs: 700 });
        then();
      }, INTRO_START_DELAY_MS);
    this.whenLoaded(start);
  }

  /**
   * Calls `then` once the world and every model in it have loaded (or
   * LOAD_MAX_WAIT_MS has passed), reporting progress to the loading screen
   * meanwhile.
   */
  private whenLoaded(then: () => void) {
    const tracker = LoadingTracker.for(this.scene);
    const report = setInterval(() => {
      if (this.disposed) return clearInterval(report);
      this.bridge.emit("loadingProgress", { ...tracker.progress(), done: false });
    }, LOADING_REPORT_MS);
    tracker.whenDone(() => {
      clearInterval(report);
      markLoadSettled();
      this.bridge.emit("loadingProgress", { fraction: 1, secondsLeft: 0, done: true });
      then();
    }, LOAD_MAX_WAIT_MS);
  }

  /** Space / Enter / Escape skip a skippable cutscene. */
  private setupCutsceneSkip() {
    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type !== KeyboardEventTypes.KEYDOWN || !this.cutscenes.isActive()) return;
      const key = kbInfo.event.key;
      if (key === " " || key === "Enter" || key === "Escape") this.cutscenes.skip();
    });
  }

  /**
   * Plays a story cutscene, ending on the camera behind the player; input
   * is off while it runs. If another sequence (a rest, the death screen,
   * another cutscene) is running, it waits for that to finish first.
   */
  playCutscene(id: CutsceneId, done?: () => void) {
    if (this.disposed) return;
    if (this.sequenceRunning || this.cutscenes.isActive() || this.player.isDead()) {
      setTimeout(() => this.playCutscene(id, done), 400);
      return;
    }
    this.budmobile.forceDismount();
    this.setSequenceRunning(true);
    this.player.setCameraOverride(true);
    this.cutscenes.prepare(CUTSCENES[id], this.player.getCameraRestPose(), () => {
      this.player.setCameraOverride(false);
      this.setSequenceRunning(false);
      done?.();
    });
    this.cutscenes.begin();
  }

  /** Carries out a cutscene's timeline event (see babylon/cutscenes/types.ts for the kinds). */
  private handleCutsceneEvent(event: CutsceneEvent) {
    switch (event.type) {
      case "fade":
        this.bridge.emit("screenFade", { opacity: event.opacity, durationMs: event.durationMs });
        break;
      case "sound":
        this.sounds.play(event.soundId);
        break;
      case "flag":
        this.missions.addFlag(event.flag);
        break;
      case "say": {
        const npc = this.cityDef.npcs.find((n) => n.id === event.npcId);
        if (!npc) break;
        const at = new Vector3(npc.position.x, sampleTerrainHeight(npc.position.x, npc.position.z), npc.position.z);
        this.speech.say(`npc-${npc.id}`, () => at, event.text, { seconds: event.seconds ?? 3, heightAbove: 2.6 });
        break;
      }
    }
  }

  /** Story mode: missions, their objectives and cutscenes. */
  private createMissions() {
    this.missions = new MissionManager(this.bridge, {
      grantXp: (amount) => this.progression.grantXp(amount),
      grantGold: (amount) => this.bridge.emit("goldChanged", amount),
      playCutscene: (id, done) => this.playCutscene(id, done),
      npcPosition: (npcId) => this.cityDef.npcs.find((n) => n.id === npcId)?.position ?? null,
      safeHousePosition: () => this.cityDef.safeHouses[0]?.door ?? null,
      vehiclePosition: () => {
        const p = this.budmobile.getPosition();
        return { x: p.x, z: p.z };
      },
    });
  }

  /** Records a story flag (saved with the game). */
  addStoryFlag(flag: string) {
    this.missions.addFlag(flag);
  }

  /** Whether the story has recorded `flag` (e.g. "chapter-1-complete"). */
  hasStoryFlag(flag: string): boolean {
    return this.missions.hasFlag(flag);
  }

  getMissionStatus(): MissionStatus | null {
    return this.missions.getStatus();
  }

  /** Where the current objective is (minimap marker), or null. */
  getObjectiveMarker(): { x: number; z: number } | null {
    return this.missions.getObjectiveMarker();
  }

  // ---------- Saving ----------

  /** The engine's part of a save — see EngineState. */
  exportState(): EngineState {
    // Saved while dead: you'll be back at the respawn point. While riding: standing beside the Budmobile.
    let at = this.player.getPosition();
    const bud = this.budmobile.getPose();
    if (this.player.isDead()) at = new Vector3(this.respawnPoint.x, 0, this.respawnPoint.z);
    else if (this.budmobile.hasRider()) at = new Vector3(bud.x - Math.sin(bud.yaw) * 2.8, 0, bud.z - Math.cos(bud.yaw) * 2.8);
    return {
      player: {
        cityId: this.cityDef.id,
        x: at.x,
        z: at.z,
        facing: this.player.getFacingYaw(),
        health: this.player.isDead() ? this.player.getMaxHealth() : this.player.getCurrentHealth(),
        respawn: { ...this.respawnPoint },
      },
      progression: this.progression.exportState(),
      story: this.missions.exportState(),
      vehicles: { budmobile: bud },
      world: { clock: this.elapsed },
      stats: this.stats.exportState(),
    };
  }

  /** Puts the world back the way a save left it. Called once, before the opening shot. */
  private applySave(save: SaveGame) {
    this.progression.importState(save.progression);
    this.player.refreshMaxHealth();
    this.enemyManager.setPlayerLevel(this.progression.getLevel());
    this.respawnPoint = { ...save.player.respawn };
    this.player.restoreState(save.player.x, save.player.z, save.player.facing, save.player.health);
    const bud = save.vehicles.budmobile;
    if (bud) this.budmobile.setPose(bud);
    this.elapsed = save.world.clock ?? 0;
    this.stats.importState(save.stats);
    this.missions.importState(save.story);
  }

  /** Player settings (services/settings): look speed, inverted look, volume. */
  applySettings(settings: { lookSensitivity: number; invertLookY: boolean; masterVolume: number }) {
    this.player.setLookSettings(settings.lookSensitivity, settings.invertLookY);
    this.sounds.setMasterVolume(settings.masterVolume);
  }

  isCutscenePlaying(): boolean {
    return this.cutscenes.isActive();
  }

  /** Skips the cutscene that's playing, if it allows it (the touch "Skip" button). */
  skipCutscene() {
    this.cutscenes.skip();
  }

  /**
   * Pokémon-style rest: the screen goes dark for a moment, the player
   * wakes up at full health (and stamina), and a notification says so.
   */
  private async restAtSafeHouse(id: string) {
    if (this.sequenceRunning || this.player.isDead()) return;
    const house = this.cityDef.safeHouses.find((h) => h.id === id);
    if (!house) return;
    this.setSequenceRunning(true);
    this.bridge.emit("screenFade", { opacity: 1, durationMs: FADE_OUT_MS });
    await this.wait(FADE_OUT_MS + 50);
    if (this.disposed) return;
    this.player.restoreFully();
    await this.wait(REST_DARK_MS);
    if (this.disposed) return;
    this.bridge.emit("screenFade", { opacity: 0, durationMs: FADE_IN_MS });
    // Resting is saving: you'll come back here if you die.
    this.respawnPoint = { ...house.door };
    this.bridge.emit("safeHouseRested", { name: house.name });
    this.bridge.emit("requestSave", { reason: "rest" });
    await this.wait(FADE_IN_MS * 0.5);
    if (this.disposed) return;
    this.setSequenceRunning(false);
  }

  /**
   * Death: the fall plays and "YOU DIED" stays up while the player lies
   * there (no moving, no attacking). Then the screen fades to black, the
   * player is put back on their feet at the respawn point, the Budmobile
   * is back at the safe house, and the load-in shot plays again.
   */
  private async runDeathSequence() {
    this.setSequenceRunning(true);
    await this.wait(DEATH_SCREEN_MS);
    if (this.disposed) return;
    this.bridge.emit("screenFade", { opacity: 1, durationMs: FADE_OUT_MS });
    await this.wait(FADE_OUT_MS + 100);
    if (this.disposed) return;
    const p = this.respawnPoint;
    this.player.respawn(new Vector3(p.x, sampleTerrainHeight(p.x, p.z) + GROUND_OFFSET, p.z));
    this.budmobile.returnHome();
    this.bridge.emit("playerRespawned", undefined);
    this.playLoadIn(false); // ends the sequence (input back) once the camera is in place
  }

  /** Plays a sound from content/audio/sounds.ts. */
  playSound(id: string) {
    this.sounds.play(id);
  }

  /** Where the player respawns after dying — for when saving at a safe house is added. */
  setRespawnPoint(point: WorldPosition) {
    this.respawnPoint = point;
  }

  /** Equips (or, with null, holsters) the player's weapon — called from React once the weapon wheel selection is made. */
  setEquippedWeapon(kind: WeaponKind | null) {
    this.player.equipWeapon(kind);
  }

  getEquippedWeaponKind(): WeaponKind | null {
    return this.player.getEquippedWeaponKind();
  }

  /** Q opens the weapon wheel; 1/2/3 pick a weapon directly (the same slots the HUD dock shows) — only while input is enabled, so neither fires while a dialogue/combat overlay is up. */
  private setupWeaponWheelToggle() {
    const hotkeys: Record<string, WeaponKind> = { "1": "sword", "2": "pickaxe", "3": "gun" };
    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (!this.inputEnabled) return;
      if (kbInfo.type !== KeyboardEventTypes.KEYDOWN) return;
      const key = kbInfo.event.key.toLowerCase();
      if (key === "q") {
        this.bridge.emit("weaponWheelToggled", undefined);
      } else if (hotkeys[key]) {
        this.bridge.emit("weaponHotkey", hotkeys[key]);
      }
    });
  }

  /** V toggles melee lock-on — spec section 7: "the player must press a dedicated lock-on button." Was Tab; switched away from it since Tab is commonly intercepted for browser/OS focus-navigation before a page's own keydown handler ever sees it, which — unlike an ordinary bound key — doesn't reliably depend on this app's own code at all. Same input-enabled guard as the weapon wheel toggle, for the same reason. */
  private setupLockOnToggle() {
    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (!this.inputEnabled) return;
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key.toLowerCase() === "v") {
        this.player.toggleLockOn();
      }
    });
  }

  // ---------- Touch controls (mobile has no keyboard, so every keyboard
  // action needs an equivalent a touch UI can call directly) ----------

  /** The on-screen joystick — x/z each in [-1, 1], analog. Pass (0, 0) on release. */
  setVirtualMove(x: number, z: number) {
    this.player.setVirtualMove(x, z);
  }

  setVirtualSprint(active: boolean) {
    this.player.setVirtualSprint(active);
  }

  /** Same effect as holding/releasing Space. */
  setJumpHeld(pressed: boolean) {
    this.player.setVirtualKey(" ", pressed);
  }

  /** Applies a real-time heal from a UI-triggered item use (e.g. a healing leaf) — delegates straight to the player's own heal(). */
  healPlayer(amount: number): boolean {
    return this.player.heal(amount);
  }

  /** Same effect as pressing/releasing the left mouse button (attack is edge-triggered on the press). */
  setAttackHeld(pressed: boolean) {
    this.player.setAttackHeld(pressed);
  }

  /** The touch aim button — toggles aim, since touch has no right button to hold. */
  triggerAimToggle() {
    this.player.toggleAim();
  }

  /** Same effect as pressing E — talks to the NPC in range, or uses the thing in range (safe house door). */
  triggerInteract() {
    if (this.budmobile.hasRider()) this.budmobile.tryDismount();
    else if (this.npcManager.getNearbyId()) this.npcManager.triggerInteract();
    else this.interactables.triggerInteract();
  }

  /** Switches whichever NPC is speaking to its talking animation — called from React whenever the active dialogue's NPC changes. */
  setTalkingNpc(npcId: string | null) {
    this.npcManager.setTalkingNpc(npcId);
  }

  getPlayerPosition(): Vector3 {
    return this.player.getPosition();
  }

  /** Current body facing, in radians — for the minimap's direction arrow. */
  getPlayerFacing(): number {
    return this.player.getFacingYaw();
  }

  /** The camera's own look direction, in the same yaw convention as getPlayerFacing() — for the minimap's rotation, which should track where the player is actually looking, not which way the character body happens to be walking. */
  getCameraForwardYaw(): number {
    return this.player.getCameraForwardYaw();
  }

  /** 0-1, the melee combo follow-up window's remaining fraction — for a UI countdown indicator. See PlayerController.getMeleeComboWindowFraction(). */
  getMeleeComboWindowFraction(): number {
    return this.player.getMeleeComboWindowFraction();
  }

  /** 0-1, how much of the current gun reload is left — for the reload ring. 0 when not reloading. */
  // ---------- Leveling (used by the React UI) ----------

  getProgression(): ProgressionSnapshot {
    return this.progression.getSnapshot();
  }

  /** XP for buying something in the shop (half the price). */
  grantPurchaseXp(price: number) {
    this.progression.grantXp(purchaseXp(price));
  }

  /** XP for finishing a conversation with an NPC (small, with a per-NPC cooldown). */
  grantInteractionXp(npcId: string) {
    this.progression.grantInteractionXp(npcId);
  }

  /** A temporary stat boost from an item. */
  applyStatBuff(stat: StatName, amount: number, seconds: number, source: string) {
    this.progression.addBuff(stat, amount, seconds, source);
  }

  /** Remaining seconds on each active buff — the HUD polls this for its countdowns. */
  getBuffTimers(): { source: string; stat: StatName; amount: number; remaining: number }[] {
    return this.progression.getBuffs().map((b) => ({ ...b }));
  }

  /** 0-1 sprint stamina, and whether the player is out of breath. */
  getStamina(): { fraction: number; exhausted: boolean } {
    return this.player.getStamina();
  }

  getReloadFraction(): number {
    return this.player.getReloadFraction();
  }

  /** The equipped gun's ammo, or null when no gun is equipped. */
  getAmmo(): { inMagazine: number; magazineSize: number; reloading: boolean } | null {
    return this.player.getAmmo();
  }

  /** Throttled so React re-renders ~10x/sec instead of every frame. */
  private syncPositionToReact(dt: number) {
    this.positionSyncTimer += dt;
    if (this.positionSyncTimer < GameEngine.POSITION_SYNC_INTERVAL) return;
    this.positionSyncTimer = 0;
    const pos = this.player.getPosition();
    this.bridge.emit("positionChanged", { x: pos.x, z: pos.z });
  }

  /** Only emits on an actual change, not every frame — cheap enough to just check directly, no throttling needed. */
  private syncAimingToReact() {
    const aiming = this.player.isAiming();
    if (aiming !== this.lastAimingState) {
      this.lastAimingState = aiming;
      this.bridge.emit("aimingChanged", aiming);
    }
  }

  dispose() {
    this.disposed = true;
    markLoadSettled(0); // closed normally (back to the menu) — not a crash
    this.sounds.dispose();
    this.budmobile?.dispose();
    this.speech?.dispose();
    window.removeEventListener("resize", this.handleResize);
    this.player.dispose();
    this.enemyManager.dispose();
    this.damageNumbers.dispose();
    this.goldManager.dispose();
    this.weather.dispose();
    this.engine.dispose();
  }

  /**
   * The look: soft, painterly light in the spirit of Team Fortress 2 —
   * gentle contrast, calm (not punchy) colour, warm light against cool
   * shade — all inside the one image-processing pass the pipeline already
   * runs, so it costs nothing extra per frame.
   *  - Neutral filmic tone mapping (KHR PBR Neutral): highlights roll off
   *    softly without the saturation/contrast push ACES adds.
   *  - Exposure and saturation held back so it never looks over-bright.
   *  - Softer bloom, only on genuinely bright things, and a light vignette.
   */
  private setupPostProcessing() {
    // Phones skip the HDR buffer, bloom and sharpening (memory and GPU time — see Quality.ts); the colour grading below stays.
    const fancy = QUALITY.fancyPostProcessing;
    const pipeline = new DefaultRenderingPipeline("defaultPipeline", fancy, this.scene, [this.player.camera]);
    pipeline.fxaaEnabled = false; // the engine's own hardware antialiasing already covers it
    pipeline.bloomEnabled = fancy;
    pipeline.bloomThreshold = 0.78;
    pipeline.bloomWeight = 0.22;
    pipeline.bloomKernel = 32;
    pipeline.bloomScale = 0.5;
    pipeline.sharpenEnabled = fancy;
    pipeline.sharpen.edgeAmount = 0.12;
    const ip = pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    ip.exposure = 1.05;
    ip.contrast = 1.08;
    const curves = new ColorCurves();
    curves.globalSaturation = -12;
    curves.shadowsHue = 220; // a hint of cool in the shade
    curves.shadowsDensity = 8;
    curves.shadowsSaturation = 4;
    curves.highlightsHue = 35; // warm light
    curves.highlightsDensity = 14;
    curves.highlightsSaturation = 6;
    ip.colorCurvesEnabled = true;
    ip.colorCurves = curves;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.4;
    pipeline.imageProcessing.vignetteStretch = 0.3;
    pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);
  }

  /**
   * Everything built so far that never moves (terrain, city, wall,
   * streets, props, grass) gets its world matrix frozen, so Babylon stops
   * recomputing thousands of them every frame. Characters, weapons and
   * effects are created later (or move), so they're unaffected; the few
   * moving things that already exist are skipped by name.
   */
  private freezeStaticMeshes() {
    const moving = (name: string) =>
      name === "player" ||
      name.startsWith("player-") ||
      name.startsWith("tree-canopy") || // sways in the wind
      name === "skyDome" ||
      name.startsWith("wilds-collider") || // moved onto the trees nearest the player
      name.startsWith("budmobile") ||
      name === "cloudLayer" ||
      name === "sunDisc";
    for (const mesh of this.scene.meshes) {
      if (!moving(mesh.name)) mesh.freezeWorldMatrix();
    }
  }

  /** A still, reflective-ish pond for atmosphere — purely visual, no collision. */
  private buildLake() {
    const lake = MeshBuilder.CreateDisc("lake", { radius: LAKE_RADIUS, tessellation: 48 }, this.scene);
    lake.rotation.x = Math.PI / 2;
    const groundY = sampleTerrainHeight(LAKE_CENTER.x, LAKE_CENTER.z);
    lake.position = new Vector3(LAKE_CENTER.x, groundY - 0.15, LAKE_CENTER.z);
    const mat = new StandardMaterial("lakeMat", this.scene);
    mat.diffuseTexture = createWaterTexture(this.scene);
    mat.specularColor = new Color3(0.3, 0.3, 0.3);
    mat.alpha = 0.85;
    lake.material = mat;
  }

  /** Rotates the sun, drives the sky shader, and lerps ambient/fog across a compressed day/night cycle. */
  private updateDayNightCycle(dt: number) {
    const t = (this.elapsed % DAY_LENGTH_SECONDS) / DAY_LENGTH_SECONDS;
    const angle = t * Math.PI * 2;

    const playerPos = this.player.getPosition();
    const dir = new Vector3(Math.cos(angle) * 0.6, -Math.max(0.15, Math.sin(angle)), -0.3);
    this.sun.direction = dir;
    // Offset from the *player's* current position, not world origin —
    // this was the actual reason shadows were effectively invisible.
    // ShadowGenerator's orthographic frustum for a directional light
    // auto-sizes to cover every shadow-caster in the scene; with the
    // light's position pinned near (0,0,0) regardless of where the
    // player actually is, and shadowFrustumSize left unset (see below),
    // that frustum was stretching to cover the whole 400+-unit city at
    // once, spreading a 1024x1024 shadow map so thin across that area
    // that shadows became imperceptible anywhere. Centering the light on
    // the player each frame, combined with an explicit fixed
    // shadowFrustumSize (set once in the constructor, not auto-computed
    // from scene content), keeps the shadow map's resolution
    // concentrated on the area actually visible around the player.
    this.sun.position = playerPos.add(dir.scale(-60));

    const weatherNow = this.weather.update(dt, playerPos);
    this.sky.update(this.sun.direction, weatherNow.sky, playerPos.x, playerPos.z, dt);

    const brightness = Math.max(0, Math.sin(angle));
    this.currentBrightness = brightness; // read by updateCombat(), called separately from the main render loop — see that method for why combat processing was deliberately pulled out of this one
    // Cool blue-grey atmospheric haze by day — distant buildings and hills fade into it.
    this.scene.fogColor = Color3.Lerp(new Color3(0.04, 0.05, 0.1), new Color3(0.62, 0.7, 0.8), brightness);
    // Weather dims the same day/night intensities rather than replacing
    // them — noon under a storm is still meaningfully brighter than
    // midnight under the same storm, just dimmer than a clear noon.
    // TF2-style: a strong, even fill from the sky and a gentler sun, so
    // shaded sides stay readable and the light reads soft and painted
    // rather than harsh.
    this.ambient.intensity = (0.3 + brightness * 0.5) * weatherNow.lightMultiplier;
    this.sun.intensity = (0.35 + brightness * 1.45) * weatherNow.lightMultiplier;
    // A warm-to-neutral color shift as the sun climbs (low angle = warm
    // low light, overhead = closer to neutral white) — real sunlight
    // isn't a flat white at every time of day, and a fixed-color
    // directional light was part of why the lighting read as flat
    // rather than dynamic.
    const warmth = 1 - brightness;
    this.sun.diffuse = Color3.Lerp(new Color3(1, 0.96, 0.9), new Color3(1, 0.82, 0.62), warmth * 0.6);
    this.scene.fogDensity = GameEngine.BASE_FOG_DENSITY * weatherNow.fogDensityMultiplier;
    this.city.setNightIntensity(1 - brightness);
  }

  /**
   * All combat/enemy per-frame processing — deliberately its own
   * top-level method, called from the main render loop after
   * player.update() rather than folded into updateDayNightCycle (which
   * is where it used to live, purely because that's where the
   * brightness value it needs was already being computed). That
   * coupling was a real structural risk: if anything earlier in
   * updateDayNightCycle ever threw, everything after it in the same
   * callback — including the player's own per-frame update, which is
   * where lock-on validity gets rechecked — would silently not run that
   * frame. Splitting this out means a problem in combat processing can
   * no longer take the player's own update hostage, and vice versa.
   */
  private updateCombat(dt: number) {
    const playerPos = this.player.getPosition();
    // Real-time enemies hold still while a dialogue, the shop or a
    // sequence (rest, death, cutscene) has input paused — otherwise they could keep hitting a
    // player who can't move or fight back.
    if (this.inputEnabled) this.enemyManager.update(dt, this.currentBrightness);

    // Spec section 13: an enemy's attack radius is normally hidden, only
    // shown for whichever one (if any) the player currently has locked
    // on — this is the per-frame sync between PlayerController's own
    // lock-on state and each Enemy's radiusMesh visibility.
    const lockedId = this.player.getLockedTargetId();
    this.enemyManager.getAllEnemies().forEach((e) => {
      const isLocked = e.id === lockedId;
      e.setRadiusVisible(isLocked);
      // Health bar, Call of Duty style: shown while the crosshair is on
      // the enemy (out to ENEMY_HEALTHBAR_AIM_RANGE), for a few seconds
      // after it's been hit, when it's locked on, or when the player is
      // inside its attack radius. Never over a body that's mid-collapse.
      const alive = !e.isDead();
      const withinAttackRadius = alive && Vector3.Distance(playerPos, e.getPosition()) <= e.config.meleeRadius;
      const aimedAt = alive && this.player.isAimingAt(e, GameEngine.ENEMY_HEALTHBAR_AIM_RANGE);
      const recentlyHit = alive && e.getTimeSinceLastHit() < GameEngine.ENEMY_HEALTHBAR_AFTER_HIT_SECONDS;
      e.setHealthBarVisible(alive && (isLocked || withinAttackRadius || aimedAt || recentlyHit));
    });
    this.speech.update(dt);
    this.damageNumbers.update(dt);
    this.goldManager.update(dt, playerPos);
  }
}