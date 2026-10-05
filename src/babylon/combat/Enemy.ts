// src/babylon/combat/Enemy.ts
import { Color3, DynamicTexture, GlowLayer, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { SkeletalCharacter, type NinjaAnimation } from "../characters/SkeletalCharacter";
import { sampleTerrainHeight } from "../world/TerrainBuilder";
import type { Combatant } from "./CombatManager";
import type { EnemyArchetypeConfig } from "./CombatConfig";
import { maxHealthForEndurance, sprintSecondsForCardio, statsForLevel, type Stats } from "../progression/Progression";

export type EnemyState = "idle" | "wander" | "alert" | "chase" | "attack" | "hitReaction" | "death" | "return";

/** A brief turn toward the player before the chase starts — the "spotted you" point now plays on the arm while running (see setState), so the enemy never stands still to do it. */
const ALERT_DURATION = 0.3;
/** Once the player has hit this enemy, it keeps chasing until the player is this far away (instead of its usual chaseRadius/returnRadius). */
const PROVOKED_LEASH = 70;
// "Make all enemies attack faster than they are attacking now" — plays
// the attack swing itself faster, not just shortening the cooldown
// after it (already reduced separately in CombatConfig.ts). Each
// archetype's own attackSpeed (the state-duration threshold, tied to
// its real animation duration for sync — see CombatConfig.ts's own
// comments) is correspondingly divided by this same ratio, so the
// state still ends right as the sped-up animation actually finishes
// playing, not before or after it.
const ENEMY_ATTACK_SPEED_RATIO = 1.7; // was 1.3 — "make the enemy attack speed even faster," per follow-up request
/** World size and texture resolution of the "Level N" badge and the name label on the health-bar group. */
const LEVEL_BADGE_SIZE = { width: 0.62, height: 0.2 };
const LEVEL_BADGE_PX = { width: 192, height: 62 };
const NAME_LABEL_SIZE = { width: 1.4, height: 0.24 };
const NAME_LABEL_PX = { width: 350, height: 60 };
/** Beyond this distance from the player an idle enemy is switched off (hidden, not animated). */
const ENEMY_ACTIVE_RADIUS = 90;
const FACING_TURN_RATE = 6; // radians/sec ease toward target facing, not an instant snap
const DEATH_SOLID_DURATION = 10; // seconds a dead body stays fully visible before it starts fading
// The fallingBackDeath clip's own bone motion (measured native duration
// 2.633s) apparently doesn't lower the character's root transform down
// to ground level on its own — likely a retargeting height mismatch —
// so the standing-height root stayed fixed while the animation posed
// the character as if lying down, reading as the body floating in mid-
// air at standing height rather than actually resting on the floor.
// This explicitly lowers the root over the course of the fall instead
// of relying on the clip alone to do it.
const DEATH_FALL_DROP = 0.6; // units — how far the root drops from standing to lying height; this is a reasoned estimate, not something visually verified against the actual rendered result, so it may need retuning either direction
const DEATH_FALL_DURATION = 1.6; // seconds — roughly the first 60% of the clip's own 2.633s, on the assumption the character hits the ground partway through rather than exactly at the clip's end
const TAUNT_CHANCE = 0.3; // fraction of wander pauses that become a taunt/insult instead of a plain idle stand
const TAUNT_DURATION_ESTIMATE = 2.5; // rough clip length — used only to know when it's safe to let "idle" resume overriding it

function seedFor(x: number, z: number): number {
  const s = Math.sin(x * 73.156 + z * 29.417) * 8231.643;
  return s - Math.floor(s);
}

export class Enemy implements Combatant {
  readonly id: string;
  readonly isEnemy = true;
  readonly config: EnemyArchetypeConfig;

  private character: SkeletalCharacter | null = null;
  private radiusMesh: Mesh | null = null;
  /** Billboarded group holding the health bar and the level badge beside it, so the badge stays beside the bar from any angle. */
  private healthBarRoot: TransformNode | null = null;
  private healthBarBg: Mesh | null = null;
  /** "Level 4" in a rounded badge beside the health bar, and the enemy's type above it. */
  private levelBadge: Mesh | null = null;
  private levelBadgeTexture: DynamicTexture | null = null;
  private nameLabel: Mesh | null = null;
  private nameLabelTexture: DynamicTexture | null = null;
  private healthBarFill: Mesh | null = null;
  private healthBarFillMat: StandardMaterial | null = null;
  private readonly healthBarWidth = 1.1;
  /** Grows with distance from the player so the bar stays readable far away (see update()). */
  private healthBarScale = 1;
  private currentHealth: number;
  /** Character level — always the player's level + 3 (EnemyManager keeps it in sync). */
  private level: number;
  private stats: Stats;
  private maxHealth: number;
  /** Seconds of running left (cardio). Out of stamina, a chase drops to a walk until it recovers. */
  private stamina: number;
  private exhausted = false;
  private hasPlayedHeadHit = false; // "only the first time a enemy takes damage" — the state transition (stopping the attack briefly) still happens on every hit; this only gates the visual headHit animation itself
  private position: Vector3;
  private facingYaw = 0;
  private state: EnemyState = "idle";
  private stateTimer = 0;
  /** Set when the player hits this enemy: it chases until the player is PROVOKED_LEASH away, ignoring its usual limits. */
  private provoked = false;
  /** Play the "point" gesture when the next chase starts (only after spotting the player, not after every attack). */
  private pointOnChase = false;
  private timeSinceLastHit = 999; // starts high so an enemy can taunt as soon as it first enters chase, not just after 3s of chasing with no damage taken
  private tauntCooldownTimer = 0;
  private tauntingUntil = -1;
  private home: { x: number; z: number };
  private readonly spawnHome: { x: number; z: number };
  private chaseOrigin: { x: number; z: number };
  private attackCooldownTimer = 0;
  private attackDamageWindowOpen = false;
  private attackHasHitPlayer = false;
  private deathElapsed = 0;
  private deathStartY = 0; // this.position.y captured at the exact moment death begins (not spawn time — the enemy could die anywhere on sloped terrain), so updateDeath's own ground-drop has the correct baseline to ease down from
  private disposed = false;
  /** Set false only once the death collapse+fade has fully finished — EnemyManager uses this to know when it's safe to actually remove/despawn this instance (spec section 22, step 10). */
  despawnReady = false;

  constructor(scene: Scene, id: string, config: EnemyArchetypeConfig, spawnPos: { x: number; z: number }, level: number, shadows?: ShadowGenerator) {
    this.id = id;
    this.config = config;
    this.level = level;
    this.stats = statsForLevel(level);
    this.maxHealth = this.computeMaxHealth();
    this.currentHealth = this.maxHealth;
    this.stamina = sprintSecondsForCardio(this.stats.cardio);
    this.home = { ...spawnPos };
    this.spawnHome = { ...spawnPos };
    this.chaseOrigin = { ...spawnPos };
    const groundY = sampleTerrainHeight(spawnPos.x, spawnPos.z);
    this.position = new Vector3(spawnPos.x, groundY, spawnPos.z);

    // Spec section 13: this enemy's own attack radius is normally
    // hidden, and only becomes visible while the player has this
    // specific enemy locked on — see setRadiusVisible, driven each frame
    // from PlayerController's own getLockedTargetId(). Built once here
    // (not created/destroyed on every lock/unlock) and just toggled.
    this.radiusMesh = MeshBuilder.CreateDisc(`enemy-radius-${id}`, { radius: config.meleeRadius, tessellation: 24 }, scene);
    this.radiusMesh.rotation.x = Math.PI / 2;
    this.radiusMesh.isPickable = false;
    this.radiusMesh.isVisible = false;
    const radiusMat = new StandardMaterial(`enemy-radius-mat-${id}`, scene);
    radiusMat.diffuseColor = new Color3(0.95, 0.75, 0.15);
    radiusMat.emissiveColor = new Color3(0.6, 0.45, 0.05);
    radiusMat.alpha = 0.16;
    radiusMat.backFaceCulling = false;
    this.radiusMesh.material = radiusMat;
    this.radiusMesh.position = this.position.clone();

    // A floating health bar with the enemy's level in a round badge beside
    // it. All three parts hang off one billboarded node (always facing the
    // camera), so the badge stays beside the bar from any angle. The fill
    // drains from the right as health drops. Hidden by default;
    // setHealthBarVisible controls it (see GameEngine.updateCombat).
    this.healthBarRoot = new TransformNode(`enemy-hpbar-${id}`, scene);
    this.healthBarRoot.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.healthBarRoot.setEnabled(false);

    this.healthBarBg = MeshBuilder.CreatePlane(`enemy-hpbar-bg-${id}`, { width: this.healthBarWidth, height: 0.14 }, scene);
    this.healthBarBg.parent = this.healthBarRoot;
    this.healthBarBg.isPickable = false;
    const bgMat = new StandardMaterial(`enemy-hpbar-bg-mat-${id}`, scene);
    bgMat.diffuseColor = Color3.Black();
    bgMat.emissiveColor = new Color3(0.08, 0.08, 0.08);
    bgMat.disableLighting = true;
    this.healthBarBg.material = bgMat;

    this.healthBarFill = MeshBuilder.CreatePlane(`enemy-hpbar-fill-${id}`, { width: this.healthBarWidth, height: 0.1 }, scene);
    this.healthBarFill.parent = this.healthBarRoot;
    this.healthBarFill.position.z = -0.002; // just in front of the background (the camera sees the plane's -Z side)
    this.healthBarFill.isPickable = false;
    this.healthBarFillMat = new StandardMaterial(`enemy-hpbar-fill-mat-${id}`, scene);
    this.healthBarFillMat.diffuseColor = Color3.Black();
    this.healthBarFillMat.emissiveColor = new Color3(0.25, 0.85, 0.25);
    this.healthBarFillMat.disableLighting = true;
    this.healthBarFill.material = this.healthBarFillMat;

    const levelLabel = this.createLabel(scene, `enemy-level-${id}`, LEVEL_BADGE_SIZE, LEVEL_BADGE_PX);
    this.levelBadge = levelLabel.mesh;
    this.levelBadgeTexture = levelLabel.texture;
    this.levelBadge.position.set(-this.healthBarWidth / 2 - LEVEL_BADGE_SIZE.width / 2 - 0.05, 0, -0.002);
    this.drawLevelBadge();

    const nameLabel = this.createLabel(scene, `enemy-name-${id}`, NAME_LABEL_SIZE, NAME_LABEL_PX);
    this.nameLabel = nameLabel.mesh;
    this.nameLabelTexture = nameLabel.texture;
    this.nameLabel.position.set(0, 0.2, -0.002); // just above the bar
    this.drawNameLabel();

    // Keep the bars crisp: the scene's glow layer would otherwise bloom
    // their emissive colors into large blurry smears at a distance.
    scene.effectLayers
      ?.filter((layer): layer is GlowLayer => layer instanceof GlowLayer)
      .forEach((glow) => {
        glow.addExcludedMesh(this.healthBarBg!);
        glow.addExcludedMesh(this.healthBarFill!);
        glow.addExcludedMesh(this.levelBadge!);
        glow.addExcludedMesh(this.nameLabel!);
      });

    SkeletalCharacter.create(
      scene,
      `enemy-${id}`,
      [
        "idle",
        "walkForward",
        "running",
        config.animations.attack,
        config.animations.injuredRun,
        config.animations.death,
        config.animations.spawn,
        "taunt",
        "insult",
        "headHit", // was missing entirely — this is why the animation "wasn't coming at all" for enemies even though the hitReaction state itself was transitioning correctly (stopping the attack): character.play("headHit", ...) was silently failing since the clip had never been loaded/retargeted for this character in the first place
        "point",
      ] as NinjaAnimation[],
      config.skin // the actual fix for the gray-player bug — every enemy previously defaulted to skinId="ninja" here since nothing was ever passed
    )
      .then((character) => {
        if (this.disposed) {
          character.dispose();
          return;
        }
        character.position = this.position;
        if (shadows) character.addShadowCasters((m) => shadows.addShadowCaster(m));
        // Spawn animation plays once, then settles into idle — matches
        // how the melee finisher's own onComplete pattern works
        // elsewhere in this codebase (play with loop=false and an
        // onComplete callback) rather than something new.
        character.play(config.animations.spawn as NinjaAnimation, false, () => {
          if (!this.disposed) character.play("idle");
        });
        this.character = character;
      })
      .catch((err) => console.warn(`Enemy "${id}" character failed to load:`, err));
  }

  // ---- Combatant ----
  isDead(): boolean {
    return this.state === "death";
  }
  isInvulnerable(): boolean {
    return this.state === "death";
  }
  getPosition(): Vector3 {
    return this.position;
  }
  getCurrentHealth(): number {
    return this.currentHealth;
  }
  getMaxHealth(): number {
    return this.maxHealth;
  }
  getLevel(): number {
    return this.level;
  }
  getDefense(): number {
    return this.stats.defense;
  }

  private computeMaxHealth(): number {
    return Math.round(maxHealthForEndurance(this.stats.endurance) * this.config.healthMultiplier);
  }

  /** Re-levels this enemy (the player leveled up) — stats follow the new level, health keeps the same fraction. */
  setLevel(level: number) {
    if (level === this.level || this.isDead()) return;
    const fraction = this.currentHealth / this.maxHealth;
    this.level = level;
    this.stats = statsForLevel(level);
    this.maxHealth = this.computeMaxHealth();
    this.currentHealth = Math.max(1, Math.round(this.maxHealth * fraction));
    this.updateHealthBarFill();
    this.drawLevelBadge();
  }
  receiveDamage(amount: number): number {
    const before = this.currentHealth;
    this.currentHealth = Math.max(0, this.currentHealth - amount);
    const actual = before - this.currentHealth;
    this.timeSinceLastHit = 0; // "only taunt... when they haven't been attacked in 3 seconds" — see updateChase's own taunt roll
    this.updateHealthBarFill();
    if (this.currentHealth <= 0) {
      this.setState("death"); // spec section 21: ATTACK -> DEATH pre-empts everything, including any in-progress hit reaction
    } else {
      this.provoked = true;
      // Hit while not engaged (idle, walking home, spotting): go straight after the player.
      if (this.hasPlayedHeadHit && (this.state === "idle" || this.state === "wander" || this.state === "return" || this.state === "alert")) {
        this.chaseOrigin = { x: this.position.x, z: this.position.z };
        this.setState("chase");
      }
    }
    if (this.currentHealth > 0 && !this.hasPlayedHeadHit) {
      // Only the first hit an enemy ever takes interrupts it into
      // hitReaction at all now — every hit after that no longer stops
      // whatever it's doing (attacking, chasing), matching the same
      // hasPlayedHeadHit gate the visual flinch animation itself
      // already uses (see setState's own hitReaction branch). Before
      // this, every single hit — first or fiftieth — forced this
      // branch regardless, meaning an enemy could never actually
      // attack back while being damaged, only flinch repeatedly. Per
      // request: "make them able to attack even if they take damage."
      this.setState("hitReaction");
    }
    return actual;
  }

  private setState(next: EnemyState) {
    // Note on the STATE_PRIORITY check that used to sit here: it looked
    // like a real guard but never actually returned early, so it did
    // nothing. Investigated adding a real return — but every call site
    // in this class is inside update()'s own switch(this.state), which
    // already means only the current state's own logic can ever call
    // this in the first place (other cases simply don't run when
    // this.state doesn't match them). A real priority check would have
    // incorrectly blocked legitimate downward transitions too — attack
    // finishing and calling setState("chase"), hitReaction finishing
    // and calling setState("chase"/"wander") — since those go from a
    // higher-priority state to a lower one on purpose. So the dead
    // check is removed entirely rather than "fixed": it wasn't actually
    // protecting anything real, given the switch structure itself
    // already prevents the scenario it described.
    if (this.state === "death") return; // death is terminal; nothing un-sets it
    this.state = next;
    this.stateTimer = 0;
    // Several states start a one-shot clip directly with character.play()
    // (point, the attack swing, headHit, death) without going through
    // setAnimation, so lastAnimation can still name whatever looping clip
    // was playing before. Without this reset, the next state's
    // setAnimation("idle"/"running") would be skipped as "already
    // playing" and the enemy would freeze on the one-shot's last frame —
    // e.g. arms out at the end of a punch, which reads as a T-pose.
    this.lastAnimation = null;
    // tauntingUntil is measured on stateTimer, which just restarted at 0 —
    // a value left over from the previous state would read as "still
    // taunting" for seconds and keep the enemy standing frozen in place.
    this.tauntingUntil = -1;
    if (next === "attack") {
      this.attackDamageWindowOpen = false;
      this.attackHasHitPlayer = false;
    }
    if (next === "chase" && this.pointOnChase) {
      // "Spotted you": point at the player with the right arm while
      // already running at them (point.glb is 5.7s; 2.9x shows it in ~2s).
      this.pointOnChase = false;
      this.character?.playUpperBody("point", 2.9, 1800, undefined, ["mixamorig:RightShoulder"]);
    }
    if (next === "death") {
      this.deathStartY = this.position.y; // captured once, here, before updateDeath's own per-frame ease-down begins modifying this.position.y
      this.character?.play(this.config.animations.death as NinjaAnimation, false);
    }
    if (next === "hitReaction") {
      if (!this.hasPlayedHeadHit) {
        // Only the very first hit an enemy ever takes plays this — per
        // request, "make it so that only happens the first time a enemy
        // takes damage." The state transition itself (this branch
        // running at all, which is what actually stops the enemy's
        // attack) still happens on every hit; only the animation call
        // below is gated.
        this.hasPlayedHeadHit = true;
        this.character?.play("headHit", false, undefined, 1.15); // ~1s, matching hitReactionDuration — the same snappier flinch the player has
      }
    }
  }

  /** Seconds since this enemy last took damage (large if never). */
  getTimeSinceLastHit(): number {
    return this.timeSinceLastHit;
  }

  getState(): EnemyState {
    return this.state;
  }

  setRadiusVisible(visible: boolean) {
    if (this.radiusMesh) this.radiusMesh.isVisible = visible;
  }

  /** Driven from GameEngine each frame — spec follow-up: "should also show when in their attacking radius, not just when locking on" (both conditions are checked by the caller; this just applies whatever the caller already decided). */
  setHealthBarVisible(visible: boolean) {
    this.healthBarRoot?.setEnabled(visible);
  }

  /** A text plane on the health-bar group, drawn into its own small transparent texture (unlit, so it reads the same day and night). */
  private createLabel(scene: Scene, name: string, size: { width: number; height: number }, px: { width: number; height: number }) {
    const mesh = MeshBuilder.CreatePlane(name, size, scene);
    mesh.parent = this.healthBarRoot;
    mesh.isPickable = false;
    const texture = new DynamicTexture(`${name}-tex`, px, scene, true);
    texture.hasAlpha = true;
    const material = new StandardMaterial(`${name}-mat`, scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.disableLighting = true;
    mesh.material = material;
    return { mesh, texture };
  }

  /** "Level 4" in a dark rounded badge with a gold rim, beside the health bar. */
  private drawLevelBadge() {
    const tex = this.levelBadgeTexture;
    if (!tex) return;
    const { width: w, height: h } = LEVEL_BADGE_PX;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, w, h);
    const r = h / 2 - 4;
    ctx.beginPath();
    ctx.moveTo(4 + r, 4);
    ctx.arcTo(w - 4, 4, w - 4, h - 4, r);
    ctx.arcTo(w - 4, h - 4, 4, h - 4, r);
    ctx.arcTo(4, h - 4, 4, 4, r);
    ctx.arcTo(4, 4, w - 4, 4, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(20, 16, 12, 0.92)";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#e0a63a";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Level ${this.level}`, w / 2, h / 2 + 2);
    tex.update();
  }

  /** The enemy's type ("Leonard", "James", ...) above the health bar — white with a dark outline, no backing. */
  private drawNameLabel() {
    const tex = this.nameLabelTexture;
    if (!tex) return;
    const { width: w, height: h } = NAME_LABEL_PX;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(this.config.displayName, w / 2, h / 2 + 2);
    ctx.fillStyle = "#fde7c4";
    ctx.fillText(this.config.displayName, w / 2, h / 2 + 2);
    tex.update();
  }

  private updateHealthBarFill() {
    if (!this.healthBarFill) return;
    const frac = Math.max(0, this.currentHealth / this.maxHealth);
    // Drains from the right: shrink, and slide left by half of what's lost.
    this.healthBarFill.scaling.x = Math.max(0.0001, frac);
    this.healthBarFill.position.x = (-(1 - frac) * this.healthBarWidth) / 2;
    if (this.healthBarFillMat) {
      this.healthBarFillMat.emissiveColor = frac > 0.5 ? new Color3(0.25, 0.85, 0.25) : frac > 0.25 ? new Color3(0.9, 0.75, 0.15) : new Color3(0.9, 0.2, 0.15);
    }
  }

  /** Relocates this enemy's wander "home" (e.g. toward a city entry point at night) without moving it there instantly — it still has to walk, via its own ordinary wander/chase movement, same as always. */
  setHome(pos: { x: number; z: number }) {
    this.home = pos;
  }

  /** Reverts to this enemy's original spawn location — called at dawn for any enemy whose home was relocated into the city overnight. */
  resetHomeToSpawn() {
    this.home = { ...this.spawnHome };
  }

  /**
   * Advances this enemy one frame. playerPos/playerCombatant are only
   * used for detection/chase/attack distance checks — actual damage
   * application happens through CombatManager, called by EnemyManager
   * once this method reports its attack damage window is open (see
   * consumeAttackWindow below), keeping this class focused on state/
   * movement rather than owning the damage path itself (spec section 39
   * — Damage System is its own module).
   */
  /** Stamina refills (over ~3s from empty) whenever the enemy isn't running a chase; exhaustion ends at 60%. */
  private recoverStamina(dt: number) {
    const max = sprintSecondsForCardio(this.stats.cardio);
    const runningNow = this.state === "chase" && !this.exhausted;
    if (!runningNow) this.stamina = Math.min(max, this.stamina + (max / 3) * dt);
    if (this.exhausted && this.stamina >= max * 0.6) this.exhausted = false;
  }

  update(dt: number, playerPos: Vector3, playerDistance: number) {
    if (this.disposed) return;
    this.stateTimer += dt;
    this.recoverStamina(dt);
    if (this.attackCooldownTimer > 0) this.attackCooldownTimer -= dt;
    this.timeSinceLastHit += dt;
    if (this.tauntCooldownTimer > 0) this.tauntCooldownTimer -= dt;

    switch (this.state) {
      case "death":
        this.updateDeath(dt);
        return; // death overrides all movement/animation logic below — nothing else runs once dead
      case "idle":
      case "wander":
        this.updateWander(dt);
        if (this.tryAttack(playerPos, playerDistance)) break; // already inside its melee circle: strike right away
        if (playerDistance <= this.config.detectionRadius) {
          this.pointOnChase = true;
          this.setState("alert");
        }
        break;
      case "alert":
        this.faceToward(playerPos, dt);
        if (this.tryAttack(playerPos, playerDistance)) break;
        if (this.stateTimer >= ALERT_DURATION) {
          this.chaseOrigin = { x: this.position.x, z: this.position.z };
          this.setState("chase");
        }
        break;
      case "chase":
        this.updateChase(dt, playerPos, playerDistance);
        break;
      case "attack":
        this.updateAttack(playerPos, playerDistance);
        break;
      case "hitReaction":
        if (this.stateTimer >= this.config.hitReactionDuration) {
          if (this.provoked || playerDistance <= this.config.detectionRadius) this.chaseOrigin = { x: this.position.x, z: this.position.z };
          this.setState(this.provoked || playerDistance <= this.config.detectionRadius ? "chase" : "wander");
        }
        break;
      case "return":
        this.updateReturn(dt);
        break;
    }

    if (this.radiusMesh) {
      this.radiusMesh.position.x = this.position.x;
      this.radiusMesh.position.z = this.position.z;
      this.radiusMesh.position.y = this.position.y + 0.03;
    }
    if (this.healthBarRoot?.isEnabled()) {
      // Constant-ish on-screen size: 1x up close, growing with distance (capped).
      const scale = Math.min(4, Math.max(1, playerDistance / 10));
      if (Math.abs(scale - this.healthBarScale) > 0.01) {
        this.healthBarScale = scale;
        this.healthBarRoot.scaling.setAll(scale);
      }
      const barY = this.position.y + 2.2 + 0.1 * scale; // above the head, rising a little as the bar grows
      this.healthBarRoot.position.set(this.position.x, barY, this.position.z);
    }
    // Far away (and not engaged): hidden and not animated — costs nothing until the player comes near.
    const active = playerDistance < ENEMY_ACTIVE_RADIUS || (this.state !== "idle" && this.state !== "wander");
    this.character?.setActive(active);
    if (active) this.character?.update(dt);
  }

  private updateWander(dt: number) {
    // Enemies don't roam — per request, they "just stand still with
    // idle" until the player comes into range. The one exception is
    // when their home has been moved (EnemyManager relocates it toward a
    // city gate at night and back at dawn): then they walk there, since
    // otherwise the night-time city entry would never actually happen.
    // Taunting/insulting lives in updateChase, gated on actually being
    // in attack mode and not recently hit.
    const awayFromHome = Math.hypot(this.home.x - this.position.x, this.home.z - this.position.z) > 1;
    if (awayFromHome) {
      this.moveToward(this.home, this.config.walkSpeed, dt);
      this.setAnimation(this.getWalkAnimation());
    } else {
      this.setAnimation("idle");
    }
  }

  private updateChase(dt: number, playerPos: Vector3, playerDistance: number) {
    // "They should only taunt when they are in attack mode and haven't
    // been attacked in 3 seconds" — chase is the actual "attack mode"
    // this refers to (actively engaging the player, as opposed to
    // idle/wander, which no longer taunts at all — see updateWander's
    // own comment). Rolled periodically via tauntCooldownTimer rather
    // than every frame, and skipped entirely while already mid-taunt
    // (tauntingUntil) or while a real attack/hitReaction is what should
    // actually be happening.
    if (this.tauntCooldownTimer <= 0 && this.timeSinceLastHit >= 3 && this.stateTimer >= this.tauntingUntil) {
      this.tauntCooldownTimer = 2.5 + seedFor(this.position.x + this.stateTimer, this.position.z) * 2; // next roll attempt in 2.5-4.5s, not every frame
      const tauntSeed = seedFor(this.position.x + this.stateTimer * 3.1, this.position.z - this.stateTimer * 2.7);
      if (tauntSeed < TAUNT_CHANCE && this.character) {
        const clip = tauntSeed < TAUNT_CHANCE / 2 ? "taunt" : "insult";
        this.tauntingUntil = this.stateTimer + TAUNT_DURATION_ESTIMATE;
        this.character.play(clip, false, () => {
          if (!this.disposed) this.lastAnimation = null; // forces the very next setAnimation() call to actually apply, rather than being skipped as a no-op because lastAnimation still says the same clip from before the taunt started
        });
      }
    }
    // Skip movement/re-triggering an animation entirely while a taunt
    // is actively playing — without this, the setAnimation() calls
    // further down would immediately override the taunt clip the very
    // same frame it started. Still faces the player, since standing
    // and taunting while looking away wouldn't read right.
    if (this.stateTimer < this.tauntingUntil) {
      this.faceToward(playerPos, dt);
      return;
    }
    const distFromOrigin = Math.hypot(this.position.x - this.chaseOrigin.x, this.position.z - this.chaseOrigin.z);
    // Provoked (the player hit it): only a very long way away ends the
    // chase. Otherwise the usual chase/return limits apply.
    const giveUp = this.provoked
      ? playerDistance > PROVOKED_LEASH
      : playerDistance > this.config.chaseRadius || distFromOrigin > this.config.returnRadius;
    if (giveUp) {
      this.provoked = false;
      this.setState("return");
      return;
    }
    if (playerDistance <= this.config.meleeRadius && this.attackCooldownTimer <= 0) {
      this.setState("attack");
      return;
    }
    // Stop short of overlapping the player's own skeleton — spec section
    // 17 — rather than walking into melee range and then attacking as
    // one continuous motion.
    const standoff = this.config.meleeRadius * 0.85;
    if (playerDistance > standoff) {
      // Cardio: running drains stamina; once it's empty the enemy keeps
      // chasing at a walk until it has recovered most of it.
      const running = !this.exhausted;
      if (running) {
        this.stamina -= dt;
        if (this.stamina <= 0) {
          this.stamina = 0;
          this.exhausted = true;
        }
      }
      this.moveToward({ x: playerPos.x, z: playerPos.z }, running ? this.config.runSpeed : this.config.walkSpeed, dt);
      this.setAnimation(running ? this.getWalkAnimation() : (this.config.animations.walk as NinjaAnimation));
    } else {
      this.faceToward(playerPos, dt);
      this.setAnimation("idle");
    }
  }

  /** Starts a swing if the player is inside this enemy's melee circle and it's off cooldown. Returns whether it did. */
  private tryAttack(playerPos: Vector3, playerDistance: number): boolean {
    if (playerDistance > this.config.meleeRadius || this.attackCooldownTimer > 0) return false;
    this.faceToward(playerPos, 1); // turn straight to the player for the swing
    this.setState("attack");
    return true;
  }

  private updateAttack(playerPos: Vector3, playerDistance: number) {
    // Facing snaps to the player once, right as the swing starts, then
    // holds for the whole attack — the same "melee snap" the player's
    // own swings use (meleeLockedFacing in PlayerController), rather
    // than continuously re-tracking the player through the entire
    // windup/active/recovery sequence. Per request: enemies should
    // share the same core combat feel as the player, just with their
    // own stats/animations/skin.
    if (this.stateTimer < 0.05) {
      const dx = playerPos.x - this.position.x;
      const dz = playerPos.z - this.position.z;
      if (Math.hypot(dx, dz) > 0.01) {
        this.facingYaw = Math.atan2(dx, dz);
        this.character?.setFacing(this.facingYaw);
      }
    }
    const cfg = this.config;
    const windUp = cfg.attackSpeed * 0.35;
    const windowEnd = cfg.attackSpeed * 0.6;
    if (this.stateTimer < windUp) {
      this.attackDamageWindowOpen = false;
    } else if (this.stateTimer < windowEnd) {
      // Active damage window — EnemyManager reads attackDamageWindowOpen
      // via consumeAttackWindow() and, if the player is genuinely still
      // within range right now, calls CombatManager.applyDamage exactly
      // once for this swing (attackHasHitPlayer guards the "once" part
      // here too, as a second backstop alongside CombatManager's own
      // per-attack-instance tracking).
      this.attackDamageWindowOpen = playerDistance <= cfg.meleeRadius && !this.attackHasHitPlayer;
    } else {
      this.attackDamageWindowOpen = false;
      if (this.stateTimer >= cfg.attackSpeed) {
        this.attackCooldownTimer = cfg.attackCooldown;
        this.setState("chase"); // re-evaluate range next frame via chase's own attack-range check, rather than deciding it again here
      }
    }
    if (this.stateTimer < 0.05) this.character?.play(cfg.animations.attack as NinjaAnimation, false, undefined, ENEMY_ATTACK_SPEED_RATIO);
  }

  /** EnemyManager calls this once per frame per enemy; a true result means "this enemy's swing is live right now — go ahead and try CombatManager.applyDamage against the player." Marks attackHasHitPlayer itself so a single swing can't repeatedly report an open window after the first successful hit. */
  consumeAttackWindow(): boolean {
    if (!this.attackDamageWindowOpen) return false;
    this.attackHasHitPlayer = true;
    this.attackDamageWindowOpen = false;
    return true;
  }

  /** Raw damage of one hit: strength, scaled by this archetype — the player's defense is applied by CombatManager. */
  getAttackDamage(): number {
    return this.stats.strength * this.config.damageMultiplier;
  }

  private updateReturn(dt: number) {
    const arrived = this.moveToward(this.home, this.config.walkSpeed, dt);
    this.setAnimation(arrived ? "idle" : this.getWalkAnimation());
    if (arrived) this.setState("wander");
  }

  /** Death — spec section 22: the death clip itself is started once in setState; this lowers the body onto the ground, keeps it fully visible for DEATH_SOLID_DURATION, then fades it out over the rest of deathDespawnDelay. */
  private updateDeath(dt: number) {
    this.deathElapsed += dt;
    // Lowers the root toward the ground over DEATH_FALL_DURATION,
    // easing out (fast at first, settling toward the end) to read as
    // gravity rather than a linear slide — see DEATH_FALL_DROP's own
    // comment for why this is needed at all: the fallingBackDeath
    // clip's own bone motion wasn't bringing the body down to the
    // floor on its own.
    if (this.deathElapsed <= DEATH_FALL_DURATION) {
      const t = this.deathElapsed / DEATH_FALL_DURATION;
      const eased = 1 - (1 - t) * (1 - t); // ease-out quad
      this.position.y = this.deathStartY - DEATH_FALL_DROP * eased;
      // update()'s own switch statement returns immediately after
      // calling this method for the "death" case specifically — which
      // means the position-sync line every other state relies on
      // (character.position = this.position, after the switch) never
      // runs at all once an enemy is dead. Whatever the character's
      // last synced position was at the instant death began is where
      // it would otherwise stay forever, completely independent of
      // whatever this.position.y is doing above — this is the actual,
      // confirmed reason the ease-down needs its own explicit sync
      // right here rather than relying on the normal per-frame path.
      if (this.character) this.character.position = this.position;
    }
    // The fall itself is now the real fallingBackDeath clip (triggered
    // once in setState), not a procedural rotation — this only still
    // handles the body lingering afterward: fully visible for
    // DEATH_SOLID_DURATION, then fading out over what's left of
    // deathDespawnDelay.
    if (this.character && this.deathElapsed > DEATH_SOLID_DURATION) {
      // Absolute 10-second mark, not a percentage of deathDespawnDelay
      // — "the body stays for 10 seconds and then starts disappearing"
      // is a fixed duration regardless of which archetype died or how
      // long its own total despawn delay happens to be.
      const fadeDuration = Math.max(0.1, this.config.deathDespawnDelay - DEATH_SOLID_DURATION);
      const fadeT = Math.max(0, 1 - (this.deathElapsed - DEATH_SOLID_DURATION) / fadeDuration);
      this.character.root.getChildMeshes().forEach((m) => (m.visibility = fadeT));
    }
    if (this.deathElapsed >= this.config.deathDespawnDelay) this.despawnReady = true;
  }

  private moveToward(target: { x: number; z: number }, speed: number, dt: number): boolean {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const step = Math.min(dist, speed * dt);
    const nx = this.position.x + (dx / dist) * step;
    const nz = this.position.z + (dz / dist) * step;
    this.position.set(nx, sampleTerrainHeight(nx, nz), nz);
    this.faceToward(new Vector3(target.x, 0, target.z), dt);
    if (this.character) this.character.position = this.position;
    return false;
  }

  private faceToward(target: Vector3, dt: number) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    if (Math.hypot(dx, dz) < 0.01) return;
    const targetYaw = Math.atan2(dx, dz);
    let diff = targetYaw - this.facingYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxStep = FACING_TURN_RATE * dt;
    this.facingYaw += Math.max(-maxStep, Math.min(maxStep, diff));
    this.character?.setFacing(this.facingYaw);
  }

  private lastAnimation: NinjaAnimation | null = null;
  private setAnimation(name: NinjaAnimation) {
    if (!this.character || this.lastAnimation === name) return;
    this.lastAnimation = name;
    this.character.play(name);
  }

  /** Below 50% health, the injured-run clip replaces the ordinary walk animation for every kind of movement (wander/chase/return) — per request. */
  private getWalkAnimation(): NinjaAnimation {
    const injured = this.currentHealth / this.maxHealth < 0.5;
    if (injured) return this.config.animations.injuredRun as NinjaAnimation;
    // "The enemies should have the same run animation as the user" — the
    // player uses "running" while sprinting/chasing and "walkForward"
    // for ordinary movement (see PlayerController's own sprinting
    // check); this now mirrors that distinction instead of always
    // playing "walkForward" regardless of actual speed. Only the chase
    // state actually moves at config.runSpeed (updateChase, below) —
    // wander and return both use the slower walkSpeed — so that's the
    // one state this checks for.
    return this.state === "chase" ? "running" : (this.config.animations.walk as NinjaAnimation);
  }

  dispose() {
    this.disposed = true;
    this.character?.dispose();
    this.radiusMesh?.dispose();
    this.healthBarBg?.dispose();
    this.healthBarFill?.dispose();
    this.levelBadge?.dispose();
    this.levelBadgeTexture?.dispose();
    this.nameLabel?.dispose();
    this.nameLabelTexture?.dispose();
    this.healthBarRoot?.dispose();
  }
}