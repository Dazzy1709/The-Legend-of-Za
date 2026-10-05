// src/babylon/player/PlayerController.ts
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DynamicTexture,
  KeyboardEventTypes,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  Ray,
  Scene,
  Space,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import {type NinjaAnimation, SkeletalCharacter } from "../characters/SkeletalCharacter";
import { sampleTerrainHeight } from "../world/TerrainBuilder";
import { createWeapon, type WeaponHandle, type WeaponKind } from "../combat/Weapons";
import { COMBAT_CONFIG, getGunConfig } from "../combat/CombatConfig";
import { CombatManager, type Combatant } from "../combat/CombatManager";
import { EventBridge } from "../core/EventBridge";
import { maxHealthForEndurance, sprintSecondsForCardio, statForLevel, type ProgressionSystem } from "../progression/Progression";

const MOVE_SPEED = 3; // units/sec at full acceleration
const SPRINT_MULTIPLIER = 3.5;
const JUMP_SPEED = 9;
const GRAVITY = -25;
const GROUND_OFFSET = 1; // capsule half-height above the terrain surface
const ACCEL = 17.5; // how fast velocity ramps toward the target — smooths starts/stops
const MOUSE_SENSITIVITY = 0.003;
const AIM_SENSITIVITY_MULTIPLIER = 0.7; // a little slower while aiming, for precision — not so slow it feels stuck
const TERRAIN_FOLLOW_SPEED = 12; // how fast Y catches up to the ground when not jumping
const FACING_TURN_RATE = 60; // how fast the character's body eases toward its movement direction each second — turning left visibly turns the character left, not just sidesteps
const CAMERA_TARGET_HEIGHT = 1.1; // look at roughly chest/head height, not the capsule's center
/** The closest the player can zoom the camera in (the ground can still pull it closer — see applyCameraGroundClamp). */
const CAMERA_MIN_RADIUS = 3;
/** How far above the ground the camera always stays. */
const CAMERA_GROUND_CLEARANCE = 0.35;
/** The closest the ground may push the camera in toward the player. */
const CAMERA_GROUND_MIN_RADIUS = 0.6;
const CHARACTER_Y_OFFSET = -0.89; // converts the capsule's tracked center to the character rig's feet-level anchor
const AIM_CAMERA_RADIUS = 4.5;
const AIM_RADIUS_EASE_RATE = 6;
const MUZZLE_FLASH_LIFETIME = 0.06;
const BULLET_RANGE = 40;
const BULLET_SPEED = 140; // units/sec — fast, snappy, but a 40-unit shot still takes ~0.3s, so it's genuinely watchable in flight
// A bright core plus a trailing streak — much bigger than a single small
// shape, so there's actually something visible for the few frames a
// short-range shot is in flight at this speed.
const BULLET_CORE_DIAMETER = 0.16;
const BULLET_STREAK_LENGTH = 1.4;
const BULLET_STREAK_DIAMETER = 0.09;
const SHELL_GRAVITY = -20;
const SHELL_GROUND_CLEARANCE = 0.02;
const SHELL_EJECT_SPEED = 2.2; // sideways speed, units/sec
const SHELL_EJECT_UP_SPEED = 2.4;
const SHELL_LIFETIME_AFTER_LAND = 2.5; // seconds a landed shell stays visible before it fades away
const MOVE_ANIM_THRESHOLD = 0.3; // units/sec below which the character is considered "not moving" for animation purposes
const DIRECTION_DEADZONE = 0.25; // how strongly a movement vector must lean forward/back vs left/right before that axis "wins" the animation pick
// How long after firing a shot sprinting is disallowed — a short beat so
// a shot reads as a deliberate stop-and-fire, without making it feel slow
// to break back into a run.
const SPRINT_LOCKOUT_AFTER_SHOT = 0.15;
/** The bones a shot (and a reload) animates — both arms from the shoulders down. Legs, hips, spine and head keep the walk/run/strafe clip, so walking and shooting both show at once. */
const SHOT_OVERLAY_BONES = ["mixamorig:LeftShoulder", "mixamorig:RightShoulder"];
/** Small upward camera kick per shot (radians) — recoil feel without throwing off aim. */
const SHOT_RECOIL = 0.012;
/** How fast (per second, eased) the body turns back to face the crosshair with a gun out — quick, but not an instant snap. */
const GUN_FACE_TURN_RATE = 18;
/** After running out of stamina, sprinting is allowed again once it's refilled to this fraction. */
const EXHAUSTION_RECOVERED = 0.3;
/** How far the arms kick up per shot (radians), and how fast that settles back (per second, exponential). */
const ARM_RECOIL_KICK = 0.16;
/**
 * The aim clip puts both hands in the same spot on this rig, so they
 * overlap. Swinging the left (support) arm out by this much, about the
 * vertical, sets its hand just beside and a little behind the gun hand.
 */
const SUPPORT_ARM_SPREAD = -0.24;
/** The same for the lowered, two-handed gun idle (its hands sit the other side of the shoulder line, hence the sign). */
const SUPPORT_ARM_SPREAD_IDLE = 0.12;
const ARM_RECOIL_RECOVERY = 14;
/** After a shot the arms stay in the aiming pose this long (seconds), then go back to the walk/run/idle arms — unless still aiming. */
const AIM_POSE_HOLD_AFTER_SHOT = 0.6;
/** The torso pitches with the camera so the gun points where you look — this caps how far (radians) up or down. */
const MAX_AIM_PITCH = 0.9;
/** The hit reaction always shows for at least this long, then moving cuts it short so the run picks straight back up. */
const HEAD_HIT_MIN_SECONDS = 0.3;
// How long after a melee combo's first hit finishes the player has to
// land the follow-up before the chain resets back to the first attack —
// Skyrim/Smite-style: you can't cancel into the next hit early (the
// first swing always plays out fully), but there's a real window
// afterward to continue the combo rather than it always resetting
// instantly.
const MELEE_COMBO_WINDOW = 2.0;
// The longest single swing in MELEE_CHAIN is under 2.5s (the finisher's
// own cutoffMs) — 3.5s gives real margin above that while still being
// far short of "the player would notice their character standing
// there not attacking." This is a safety net, not a normal-path timer:
// meleeLockedFacing is meant to clear via the swing's own onComplete
// callback every time. But that callback only fires if nothing else
// has called .play() on the player's character since the swing
// started (SkeletalCharacter.play() invalidates any pending callback
// from an earlier call the moment a newer one starts) — so any
// interruption of the melee animation mid-swing, from any source,
// permanently stranded meleeLockedFacing as non-null with nothing to
// ever clear it again. And because update() force-holds facingYaw
// equal to meleeLockedFacing every single frame while it's set, a
// stuck lock didn't just misdirect one swing — it froze the player's
// entire body facing in place forever, silently making every future
// attack, at any enemy, aim at whatever direction happened to be
// locked at the moment it got stuck.
const MELEE_LOCKED_FACING_MAX_HOLD = 3.5;
// Same underlying risk as meleeLockedFacing above, and the more severe
// half of it: actionAnimationPlaying = false lives in that exact same
// onComplete callback (plus an equivalent one on the gun-firing path),
// so anything that stops that callback from firing leaves this stuck
// true too — and attack()'s very first line is `if
// (this.actionAnimationPlaying) return`, so a stuck-true value doesn't
// just misdirect the next swing, it blocks every future swing from
// starting at all, melee or gun. 4.0s covers the longest melee swing
// (under 2.5s) plus real margin, same reasoning as the constant above.
const ACTION_ANIMATION_MAX_HOLD = 4.0;
const HIT_SHAKE_DURATION = 0.12; // seconds — brief on purpose, a punch not a wobble
const HIT_SHAKE_MAGNITUDE = 0.018; // radians — small; this is meant to read as impact feedback, not disorient the player mid-fight
// Safety net for playingHeadHit — same reasoning as
// MELEE_LOCKED_FACING_MAX_HOLD/ACTION_ANIMATION_MAX_HOLD: the flag is
// supposed to clear via headHit's own onComplete callback, but that
// callback only fires if nothing else called .play() on this character in
// the meantime. Since playingHeadHit also drives isInvulnerable(), a
// stuck-true value would make the player permanently unable to take
// damage. The clip plays for about 1s (HEAD_HIT_SPEED); 2.2s is margin.
const HEAD_HIT_MAX_HOLD = 2.2;
/** Body facing at spawn — also the reference facing WEAPON_UP_WORLD_ROTATION was tuned at (see orientMeleeWeaponUp). */
const SPAWN_FACING_YAW = -Math.PI / 2;
/** The gameplay camera's resting tilt and distance. */
const CAMERA_REST_BETA = Math.PI / 2.6;
const CAMERA_REST_RADIUS = 8;

/**
 * The orbit-camera angle that puts the camera straight behind a body
 * facing `yaw` (yaw: 0 = +Z, atan2(x, z) convention), looking the way it
 * faces. The camera looks along (-cos alpha, -sin alpha).
 */
export function cameraAlphaBehind(yaw: number): number {
  return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
}

interface ActiveBullet {
  core: Mesh;
  streak: Mesh;
  direction: Vector3;
  start: Vector3;
  end: Vector3;
  elapsed: number;
  duration: number;
  willHit: boolean;
  /** The enemy this bullet will hit on arrival, if any — damage is applied when the bullet visibly lands, not when it's fired. */
  target: Combatant | null;
  /** Raw damage this bullet deals on arrival (strength + the gun's level damage), and the gun that fired it. */
  damage: number;
  weapon: WeaponKind;
}

interface ActiveShell {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  landed: boolean;
  ageSinceLanded: number;
}

/** Orients a mesh built along its local Y axis (a cylinder, by default) to point along `direction`, in place. */
function orientAlongDirection(mesh: Mesh, direction: Vector3) {
  const up = Vector3.Up();
  const dot = Vector3.Dot(up, direction);
  if (dot < 0.9999 && dot > -0.9999) {
    const rotAxis = Vector3.Cross(up, direction).normalize();
    const angle = Math.acos(dot);
    mesh.rotationQuaternion = null;
    mesh.rotate(rotAxis, angle);
  } else if (dot < 0) {
    mesh.rotate(Vector3.Right(), Math.PI);
  }
}

function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

export class PlayerController implements Combatant {
  readonly id = "player";
  readonly isEnemy = false;
  /** Level, stats, weapon levels — set by GameEngine right after construction (setProgression). */
  private progression: ProgressionSystem | null = null;
  private currentHealth: number = maxHealthForEndurance(statForLevel(1));
  /** Seconds of sprint left (cardio). Empty = exhausted until it refills to EXHAUSTION_RECOVERED. */
  private stamina = sprintSecondsForCardio(statForLevel(1));
  private exhausted = false;
  /** True on frames the player is actually sprinting (input + stamina + not locked out) — drives speed, stamina and the run animation. */
  private sprinting = false;
  private combatManager: CombatManager | null = null;
  private bridge: EventBridge | null = null;
  private getEnemies: (() => Combatant[]) | null = null;
  private lockedTarget: Combatant | null = null;
  private meleeRadiusMesh: Mesh | null = null;
  private meleeRadiusMaterial: StandardMaterial | null = null;
  private deathHandled = false;
  private playingHeadHit = false;
  private headHitElapsed = 0;
  private readonly spawnPosition: Vector3;
  private disposedFlag = false;
  /** Seconds left holding the arms in the aiming pose after a shot. */
  private aimPoseHold = 0;
  /** Current upward arm-recoil angle (radians) — kicked by each shot, settles back to 0. */
  private armRecoil = 0;
  private afterAnimationsObserver: import("@babylonjs/core").Observer<Scene> | null = null;
  /** Shared, lazily-created materials for per-shot effects (muzzle flash, bullet, spark, shell) — one each, reused by every shot rather than a new material per mesh that was never disposed. */
  private effectMaterials = new Map<string, StandardMaterial>();
  readonly mesh: Mesh;
  readonly camera: ArcRotateCamera;
  /**
   * Nullable — the real skinned ninja model loads asynchronously (a glTF
   * fetch + per-instance animation retargeting), so it isn't available the
   * instant the controller is constructed. Everything that touches it
   * guards for null; movement/physics/combat logic all work identically
   * whether or not the visual has finished loading, it just won't be
   * visible yet.
   */
  private character: SkeletalCharacter | null = null;
  private pendingShadowRegister: ((mesh: import("@babylonjs/core").AbstractMesh) => void) | null = null;

  private keys: Record<string, boolean> = {};
  private inputEnabled = true;
  private velocity = Vector3.Zero(); // horizontal velocity, smoothed toward target each frame
  private velocityY = 0;
  private jumping = false;
  /** Locked in once, at the moment the jump starts (based on input at takeoff) — not re-evaluated every frame while airborne. Without this, changing movement direction mid-air (e.g. jumping forward, then pressing sideways) would switch to a different jump clip and restart the animation from frame 0, which read as the jump animation randomly resetting mid-air. Actual movement/translation is completely unaffected by this — it's driven separately by `velocity`, so redirecting in the air already worked fine; only the animation choice needed locking. */
  private airborneAnimation: NinjaAnimation | null = null;
  private facingYaw = SPAWN_FACING_YAW; // current body facing — eased toward movement direction each frame, held while standing still
  private shakeTimeRemaining = 0;
  private shakeOffsetAlpha = 0;
  private shakeOffsetBeta = 0;
  private pointerLocked = false;
  private useMouseLook: boolean;
  private pointerLockChangeHandler?: () => void;
  private mouseMoveHandler?: (e: PointerEvent) => void;
  /** Rounds left in each gun's magazine, by weapon kind — kept across weapon swaps. Missing = full. */
  private ammoInMagazine = new Map<WeaponKind, number>();
  /** Seconds left on the current reload (0 = not reloading), and the reload's total length. */
  private reloadRemaining = 0;
  private reloadDuration = 0;
  private prevReloadKey = false;
  private prevAimKey = false;
  /** Left mouse button (or the touch attack button) currently held — attack/fire is edge-triggered on its press. */
  private attackHeld = false;
  private prevAttackHeld = false;
  /** Right mouse button currently held — aims while held, like most shooters. */
  private aimHeld = false;
  /** Toggled aim — by the R key, or the touch aim button (touch has no right button to hold). */
  private aimToggled = false;
  private canvasMouseDownHandler?: (e: PointerEvent) => void;
  private mouseUpHandler?: (e: PointerEvent) => void;
  /** Mouse buttons (the `buttons` bitmask) held as of the last pointer event — compared to spot presses and releases. */
  private heldButtons = 0;
  private contextMenuHandler?: (e: MouseEvent) => void;
  private equippedWeapon: WeaponHandle | null = null;
  private aiming = false;
  private preAimRadius: number | null = null;
  private activeBullets: ActiveBullet[] = [];
  private activeShells: ActiveShell[] = [];
  private virtualMove = { x: 0, z: 0 };
  private virtualSprint = false;
  /** True while a one-shot melee/shoot animation is playing — suppresses the movement-driven animation picker until it finishes. */
  private actionAnimationPlaying = false;
  /** Safety net for actionAnimationPlaying — see the reset logic in update(). */
  private actionAnimationElapsed = 0;
  /** Counts down after firing a shot — sprinting (both movement speed and animation) is disallowed while this is above 0. See SPRINT_LOCKOUT_AFTER_SHOT. */
  private sprintLockoutTimer = 0;
  /** Index into MELEE_CHAIN of whichever hit plays next if a follow-up press lands within the window — 0 whenever there's no active chain (the next press always starts fresh from MELEE_CHAIN[0] in that case, regardless of what this holds). */
  private comboNextHitIndex = 0;
  /** Counts down once a hit finishes; > 0 means a follow-up press right now continues the chain (plays MELEE_CHAIN[comboNextHitIndex]) rather than restarting it. Reaching 0 resets the chain back to the start. */
  private comboWindowTimer = 0;
  /** The facing direction a melee attack locked in at the moment it started — held fixed for the attack's whole duration (see update()'s facing block) rather than continuing to track movement/camera, the same "commit to a direction" feel Smite's directional abilities have. */
  private meleeLockedFacing: number | null = null;
  /** True while sprinting with a gun and not aiming/shooting — the body faces the run direction instead of the crosshair. */
  private gunSprinting = false;
  /** Seconds left in the current melee swing (0 = not swinging), and which hit of MELEE_CHAIN it is. */
  private meleeSwingRemaining = 0;
  private meleeSwingIndex = 0;
  /** Safety net for meleeLockedFacing — see the reset logic in update(). */
  private meleeLockedFacingElapsed = 0;

  constructor(private scene: Scene, private canvas: HTMLCanvasElement, spawn: Vector3) {
    this.mesh = MeshBuilder.CreateCapsule("player", { height: 1.8, radius: 0.35 }, scene);
    this.mesh.position = spawn;
    // A clone, not the same reference as this.mesh.position — that one
    // gets mutated continuously by ordinary movement, so it can't also
    // double as "the fixed point to return to on respawn."
    this.spawnPosition = spawn.clone();
    // No checkCollisions here on purpose: moveWithCollisions() below doesn't
    // actually read this flag at all (it always collision-checks against
    // the scene, regardless) — the only thing this flag would do is make
    // the player mesh itself an *obstacle* for other collision-aware
    // objects. Since the camera orbits right around this same mesh
    // (camera.target = player position), that turned the camera's own
    // collision sweep into a fight against its own target — it would jam
    // up almost immediately after the first bit of movement, unable to
    // pull back out to its normal orbit distance. Buildings/walls still
    // block the player fine via their own checkCollisions=true.
    this.mesh.ellipsoid = new Vector3(0.35, 0.9, 0.35);

    // The melee radius indicator — a flat, semi-transparent disc that
    // tracks the player's own position every frame (see update()). Its
    // own radius is COMBAT_CONFIG.player.meleeRadius, the exact same
    // constant resolveMeleeDamageWindow's own hit-detection query uses —
    // spec section 3 is explicit that the visual and the real hitbox
    // must never differ, so this isn't a separately-tuned "looks about
    // right" number.
    this.meleeRadiusMesh = MeshBuilder.CreateDisc(
      "player-melee-radius",
      { radius: COMBAT_CONFIG.player.meleeRadius, tessellation: 32 },
      scene
    );
    this.meleeRadiusMesh.rotation.x = Math.PI / 2; // a disc defaults to standing vertical; lie it flat on the ground
    this.meleeRadiusMesh.isPickable = false;
    this.meleeRadiusMesh.isVisible = false; // only shown while a melee weapon is actually equipped — see the weapon-kind check in update()
    this.meleeRadiusMaterial = new StandardMaterial("player-melee-radius-mat", scene);
    // White/neutral and mostly transparent rather than red — a red
    // "damage zone" reads as a warning/hazard indicator; this is meant
    // to be a subtle, mostly-see-through range guide.
    this.meleeRadiusMaterial.diffuseColor = new Color3(1, 1, 1);
    this.meleeRadiusMaterial.emissiveColor = new Color3(0.85, 0.85, 0.85);
    this.meleeRadiusMaterial.alpha = 0.035; // was 0.1 — "almost completely transparent," just barely a hint of a ring now rather than a visible disc
    this.meleeRadiusMaterial.backFaceCulling = false;
    this.meleeRadiusMesh.material = this.meleeRadiusMaterial;
    // The capsule stays purely for collision — the visible character is the
    // real skinned ninja model (loading async, below), matching the
    // NPCs/crowd so "Clipper Zaza" reads as part of the same world.
    this.mesh.isVisible = false;

    const mat = new StandardMaterial("playerMat", scene);
    mat.diffuseColor = new Color3(0.85, 0.65, 0.2);
    mat.specularColor = Color3.Black();
    this.mesh.material = mat;

    // Kick off the character load without blocking the constructor — the
    // rest of PlayerController (movement, camera, input) works immediately;
    // the visible model just pops in once it's ready, a moment later.
    SkeletalCharacter.create(scene, "player", [
      "idle",
      "walkForward",
      "walkBackward",
      "running",
      "runningBackward",
      "jumping",
      "jumpingForward",
      "jumpingBackward",
      "pistolIdle",
      "pistolAiming",
      "pistolStrafeLeft",
      "pistolStrafeRight",
      "pistolStrafeForward",
      "pistolStrafeBackward",
      "pistolRun",
      "reload",
      "punching",
      "hookPunch",
      "meleeAttackDownward",
      "meleeAttackHorizontal",
      "meleeAttack360",
      "meleeComboV2",
      "headHit",
      "fallingBackDeath",
      "budMount",
      "budHover",
      "budDismount",
    ]).then((character) => {
      this.character = character;
      character.position = this.mesh.position.add(new Vector3(0, CHARACTER_Y_OFFSET, 0));
      // A weapon may have already been equipped (via the wheel) before the
      // model finished loading — attach it now that there's a hand to
      // attach it to. Same for shadow-caster registration, requested by
      // GameEngine right after construction, before the model exists yet.
      this.attachEquippedWeaponToHand();
      if (this.pendingShadowRegister) character.addShadowCasters(this.pendingShadowRegister);
    }).catch((err) => {
      // Most commonly: the scene was disposed while the model was still
      // loading (a fast unmount — React StrictMode's dev-mode double-
      // invoke does this on every initial mount). Nothing to recover —
      // this controller instance is on its way out too — but this keeps
      // it from surfacing as an uncaught promise rejection in the console.
      console.warn("Player character failed to load:", err);
    });

    // Third-person camera. Orbits freely around the player via mouse-drag
    // (desktop, pointer-locked) or touch-drag (mobile) — see
    // setupMouseLook()/attachControl below — completely independent of
    // which way the character's body is currently facing. It starts
    // straight behind the character, looking the way they face.
    this.camera = new ArcRotateCamera(
      "camera",
      cameraAlphaBehind(SPAWN_FACING_YAW),
      CAMERA_REST_BETA,
      CAMERA_REST_RADIUS,
      this.mesh.position.add(new Vector3(0, CAMERA_TARGET_HEIGHT, 0)),
      scene
    );
    this.camera.lowerRadiusLimit = CAMERA_MIN_RADIUS;
    this.camera.upperRadiusLimit = 16;
    this.camera.lowerBetaLimit = 0.06; // just short of straight down
    // Well past level, so the camera can drop low and look up — the
    // ground pulls it in toward the player there (applyCameraGroundClamp)
    // rather than letting it sink below the floor.
    this.camera.upperBetaLimit = 2.75;
    this.camera.panningSensibility = 0; // orbit-only, never pans away from the player
    this.useMouseLook = !isCoarsePointer();
    this.camera.attachControl(canvas, true); // touch-drag to look on mobile, plus wheel-zoom
    // On desktop the mouse already turns the camera just by moving (see
    // setupMouseLook), so Babylon's own click-drag orbit would double up.
    if (!isCoarsePointer()) this.camera.inputs.removeByType("ArcRotateCameraPointersInput");

    // Babylon's default camera inertia is 0.9 — a heavy damping factor
    // applied to all rotation input, meaning any fresh drag/look input has
    // to "wind up" over many frames before it visibly responds. Minecraft's
    // own mouse look has zero smoothing at all — 1:1 direct response — so
    // this needs to be fully off, not just reduced.
    this.camera.inertia = 0;

    this.setupMouseLook();
    // Procedural gun pose (aim pitch + recoil) has to be layered on top of
    // the animation every frame, i.e. right after the animation system
    // has written this frame's bone rotations.
    this.afterAnimationsObserver = scene.onAfterAnimationsObservable.add(() => this.applyGunPose());

    scene.onKeyboardObservable.add((kbInfo) => {
      const key = kbInfo.event.key.toLowerCase();
      this.keys[key] = kbInfo.type === KeyboardEventTypes.KEYDOWN;
    });
  }

  /**
   * Desktop: click the canvas to lock the pointer, then mouse movement
   * directly sets the camera angle — no smoothing, no easing, the same 1:1
   * response Minecraft's own mouse look has. Touch devices skip this and
   * keep the default drag-to-orbit from attachControl above, since pointer
   * lock isn't a good fit for mobile.
   */
  private setupMouseLook() {
    if (!this.useMouseLook) return;

    // Left button: attack/fire. Right button: aim while held. The first
    // click on an unlocked canvas only captures the mouse — it doesn't
    // also fire a shot.
    //
    // Pointer events, not mouse events: Babylon cancels the canvas's
    // pointerdown, and the browser then drops every mousedown/mousemove/
    // mouseup until the button is released — so holding a button and
    // dragging never turned the camera. Pointer events always arrive.
    // A pointer only gets one pointerdown however many buttons are
    // pressed (a second button arrives as a pointermove), so presses and
    // releases are read off the `buttons` bitmask on every event.
    const applyButtons = (buttons: number) => {
      const pressed = buttons & ~this.heldButtons;
      const released = this.heldButtons & ~buttons;
      this.heldButtons = buttons;
      if (pressed & 1) this.attackHeld = true;
      if (pressed & 2) this.aimHeld = true;
      if (released & 1) this.attackHeld = false;
      if (released & 2) this.aimHeld = false;
    };
    this.canvasMouseDownHandler = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !this.inputEnabled) return;
      this.draggingLook = true;
      if (document.pointerLockElement !== this.canvas) {
        this.heldButtons = e.buttons; // this press only captures the mouse
        this.capturePointer();
        return;
      }
      applyButtons(e.buttons);
    };
    this.canvas.addEventListener("pointerdown", this.canvasMouseDownHandler);
    // Released anywhere, not just over the canvas.
    this.mouseUpHandler = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.buttons === 0) this.draggingLook = false;
      applyButtons(e.buttons);
    };
    document.addEventListener("pointerup", this.mouseUpHandler);
    // Right-click aims, so it must never open the browser's context menu.
    this.contextMenuHandler = (e: MouseEvent) => e.preventDefault();
    this.canvas.addEventListener("contextmenu", this.contextMenuHandler);

    this.pointerLockChangeHandler = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.attackHeld = false;
        this.aimHeld = false;
      }
    };
    document.addEventListener("pointerlockchange", this.pointerLockChangeHandler);

    // The camera follows the mouse whenever it moves over the game — no
    // click needed — and while a button is held it keeps following even
    // once the cursor leaves the game area. Clicking also captures the
    // pointer (pointer lock) for unlimited turning. Moving over the
    // HUD/menus without a button held doesn't turn the camera.
    this.mouseMoveHandler = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !this.inputEnabled) return;
      if (this.draggingLook || this.pointerLocked) applyButtons(e.buttons); // a second button pressed or released mid-hold
      if (e.buttons === 0) this.draggingLook = false;
      if (!this.pointerLocked && e.target !== this.canvas && !this.draggingLook) return;
      const sensitivity = this.aiming ? MOUSE_SENSITIVITY * AIM_SENSITIVITY_MULTIPLIER : MOUSE_SENSITIVITY;
      const lower = this.camera.lowerBetaLimit ?? 0.06;
      const upper = this.camera.upperBetaLimit ?? Math.PI - 0.06;
      this.camera.alpha -= e.movementX * sensitivity;
      this.camera.beta = Math.min(upper, Math.max(lower, this.camera.beta - e.movementY * sensitivity));
    };
    document.addEventListener("pointermove", this.mouseMoveHandler);
  }

  /**
   * Hides the cursor and hands all mouse movement to the camera (pointer
   * lock), so the camera can turn without limit and the cursor never hits
   * the window edge. Requested directly inside the click (browsers only
   * allow it during a user action — an earlier version first asked for
   * raw, unaccelerated input, which macOS browsers refuse, and the plain
   * fallback then arrived too late to be allowed, so the lock never took).
   * If locking isn't allowed at all (e.g. an embedded frame), mouse-move
   * look without the lock still works.
   */
  private capturePointer() {
    const request = this.canvas.requestPointerLock?.() as Promise<void> | undefined;
    request?.catch?.(() => {});
  }

  /**
   * Moves the camera's look-at point to the player. Plain `camera.target =`
   * makes Babylon recompute the camera's angle from where the camera stood
   * last frame, which threw away any mouse turning since then whenever
   * the player had moved — so looking around felt stuck while walking or
   * aiming. Passing cloneAlphaBetaRadius keeps the angle and zoom as they
   * are and just moves the camera along with the player.
   */
  private followCameraTarget() {
    this.camera.setTarget(this.mesh.position.add(new Vector3(0, CAMERA_TARGET_HEIGHT, 0)), false, false, true);
  }

  /** Whether the mouse was captured when a menu/dialogue paused input — so it's captured again when the game resumes. */
  private relockOnResume = false;
  /** A mouse button pressed on the game is still held — camera keeps following the mouse even outside the game area. */
  private draggingLook = false;

  setInputEnabled(enabled: boolean) {
    if (enabled === this.inputEnabled) return;
    this.inputEnabled = enabled;
    if (!enabled) {
      this.keys = {};
      this.attackHeld = false;
      this.aimHeld = false;
      this.aimToggled = false;
      this.relockOnResume = document.pointerLockElement === this.canvas;
      if (this.relockOnResume) document.exitPointerLock();
    } else if (this.relockOnResume && this.useMouseLook) {
      // Closing a menu is itself a click, so the browser still allows the lock here.
      this.relockOnResume = false;
      this.capturePointer();
    }
  }

  /**
   * Removes the raw `document`/`canvas` listeners this controller attached.
   * Without this, React 18 StrictMode's dev-mode double-mount (mount ->
   * cleanup -> mount again, on every initial render) leaves a second,
   * stale set of these listeners permanently attached — since they're
   * plain DOM listeners, not scoped to the Babylon scene, disposing the
   * engine/scene doesn't remove them on its own.
   */
  dispose() {
    this.disposedFlag = true;
    if (this.canvasMouseDownHandler) this.canvas.removeEventListener("pointerdown", this.canvasMouseDownHandler);
    if (this.mouseUpHandler) document.removeEventListener("pointerup", this.mouseUpHandler);
    if (this.contextMenuHandler) this.canvas.removeEventListener("contextmenu", this.contextMenuHandler);
    if (this.pointerLockChangeHandler) document.removeEventListener("pointerlockchange", this.pointerLockChangeHandler);
    if (this.mouseMoveHandler) document.removeEventListener("pointermove", this.mouseMoveHandler);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.effectMaterials.forEach((m) => m.dispose());
    if (this.afterAnimationsObserver) this.scene.onAfterAnimationsObservable.remove(this.afterAnimationsObserver);
    this.effectMaterials.clear();
  }

  getPosition(): Vector3 {
    return this.mesh.position;
  }

  /** Returns the shared effect material named `key`, creating it with `setup` the first time it's asked for. */
  private effectMaterial(key: string, setup: (mat: StandardMaterial) => void): StandardMaterial {
    let mat = this.effectMaterials.get(key);
    if (!mat) {
      mat = new StandardMaterial(key, this.scene);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      setup(mat);
      this.effectMaterials.set(key, mat);
    }
    return mat;
  }

  // ---- Combatant ----
  isDead(): boolean {
    return this.currentHealth <= 0;
  }
  isInvulnerable(): boolean {
    // "While the user is in the Head_Hit animation, he can't take
    // damage" — bracketed by the animation's own start/onComplete
    // below, so this window matches the clip's actual playback length
    // (already accounting for its 2x speedRatio) rather than a
    // separately-guessed timer that could drift out of sync with it.
    return this.playingHeadHit;
  }
  getCurrentHealth(): number {
    return this.currentHealth;
  }
  getMaxHealth(): number {
    return this.progression?.getMaxHealth() ?? maxHealthForEndurance(statForLevel(1));
  }
  getLevel(): number {
    return this.progression?.getLevel() ?? 1;
  }
  getDefense(): number {
    return this.progression?.getStats().defense ?? statForLevel(1);
  }

  setProgression(progression: ProgressionSystem) {
    this.progression = progression;
    this.currentHealth = this.getMaxHealth();
    this.stamina = progression.getSprintSeconds();
    this.lastMaxHealth = this.getMaxHealth();
  }

  private lastMaxHealth = maxHealthForEndurance(statForLevel(1));

  /**
   * Call when level/stats change. A higher max health (level up, an
   * endurance buff) adds the difference to current health; a lower one
   * (a buff wearing off) just caps it.
   */
  refreshMaxHealth() {
    const max = this.getMaxHealth();
    if (max === this.lastMaxHealth) return;
    if (!this.isDead()) {
      this.currentHealth = max > this.lastMaxHealth ? this.currentHealth + (max - this.lastMaxHealth) : Math.min(this.currentHealth, max);
    }
    this.lastMaxHealth = max;
    this.bridge?.emit("playerHealthChanged", { current: this.currentHealth, max });
  }

  /** 0-1 stamina for the HUD bar, and whether the player is exhausted (can't sprint until it refills). */
  getStamina(): { fraction: number; exhausted: boolean } {
    const max = this.progression?.getSprintSeconds() ?? sprintSecondsForCardio(statForLevel(1));
    return { fraction: Math.max(0, Math.min(1, this.stamina / max)), exhausted: this.exhausted };
  }

  /** Raw damage of one attack with `weapon` (null = unarmed): strength + the weapon's level damage, times `multiplier`. The target's defense comes off in CombatManager. */
  private rawDamage(weapon: WeaponKind | null, multiplier = 1): number {
    const strength = this.progression?.getStats().strength ?? statForLevel(1);
    const weaponDamage = weapon ? (this.progression?.getWeaponDamage(weapon) ?? 0) : 0;
    return (strength + weaponDamage) * multiplier;
  }
  receiveDamage(amount: number): number {
    const before = this.currentHealth;
    this.currentHealth = Math.max(0, this.currentHealth - amount);
    if (this.currentHealth <= 0 && !this.deathHandled) {
      // The actual critical bug this was covering for: there was no
      // recovery path from this at all. isDead() correctly guards
      // CombatManager's own applyDamage against a dead source ever
      // landing a hit — which is exactly right *while* dead — but
      // nothing ever un-set deathHandled/restored health, so once the
      // player's own health reached 0 even once, every future swing
      // for the rest of the session would silently do nothing,
      // forever, with no death screen or health bar anywhere in the
      // UI to explain why. Fighting multiple enemies clustered
      // together (more simultaneous attackers landing hits) made this
      // far more likely to trigger than fighting them one at a time
      // from a safer distance — which lines up exactly with "only
      // after killing several in close range."
      this.deathHandled = true;
      // Death overrides whatever was playing, mid-swing or not — that's
      // fine (even desirable: the player should visibly die regardless
      // of what they were doing), but interrupting a swing this way is
      // exactly the "another .play() call fires before the swing's own
      // onComplete" scenario that used to permanently strand
      // actionAnimationPlaying/meleeLockedFacing — the safety nets
      // would still catch it eventually, but resetting both explicitly
      // right here means there's no window at all between dying and
      // respawning where either could be left in a stale state.
      this.actionAnimationPlaying = false;
      this.actionAnimationElapsed = 0;
      this.meleeLockedFacing = null;
      this.meleeLockedFacingElapsed = 0;
      this.meleeSwingRemaining = 0;
      // Down for good until GameEngine's death sequence respawns them:
      // the fall plays in full (arms included, so no aim/reload overlay)
      // and holds on its last frame.
      this.aiming = false;
      this.aimToggled = false;
      this.aimPoseHold = 0;
      this.reloadRemaining = 0;
      this.velocity.set(0, 0, 0);
      this.character?.stopUpperBody();
      this.character?.play("fallingBackDeath", false);
    } else if (amount > 0) {
      // Now allowed to interrupt an active swing — it used to skip
      // entirely whenever actionAnimationPlaying was true, on the
      // reasoning that forcing a new animation here would invalidate
      // the swing's own onComplete callback and strand that flag. But
      // getting hit while attacking is one of the most common combat
      // scenarios there is, and skipping it there meant this basically
      // never showed up in real play ("still not there" even after the
      // animation itself was fixed and working). Interrupting is
      // handled the same explicit-reset way the death branch above
      // already does it — actionAnimationPlaying/meleeLockedFacing are
      // cleared here directly rather than left for their own safety
      // nets to eventually catch, so there's no window where either
      // could read as stuck.
      this.actionAnimationPlaying = false;
      this.actionAnimationElapsed = 0;
      this.meleeLockedFacing = null;
      this.meleeLockedFacingElapsed = 0;
      // speedRatio 1.1 — was 2.0, then 1.3, then 1.0, then 0.7, still
      // reading as "too snappy/fast" the whole way down. Turns out the
      // actual cause wasn't speed at all: blending had never been
      // enabled for headHit specifically (checked SkeletalCharacter's
      // own retargeting setup — it was scoped to just the melee attack
      // chain), so every entry into this animation was a hard,
      // instant pose cut regardless of playback speed. That's now
      // fixed at the source. The clip used to be overridden by the
      // movement animations on the very next frame (see
      // updateCharacterVisual), which is why it never seemed to play at
      // any speed; now that it plays through, 1.15x (about 1s) keeps it
      // snappy without being too brief to read.
      this.playingHeadHit = true;
      this.character?.play(
        "headHit",
        false,
        () => {
          this.playingHeadHit = false;
          if (!this.deathHandled) this.character?.play("idle");
        },
        PlayerController.HEAD_HIT_SPEED
      );
    }
    return before - this.currentHealth;
  }

  /** Applies a real-time heal from a UI-triggered item use (e.g. a healing leaf) — capped at max, and emits the same playerHealthChanged event damage does. */
  heal(amount: number): boolean {
    if (this.isDead()) return false;
    this.currentHealth = Math.min(this.getMaxHealth(), this.currentHealth + amount);
    this.bridge?.emit("playerHealthChanged", { current: this.currentHealth, max: this.getMaxHealth() });
    this.spawnHealBubbles();
    return true;
  }

  /** "Little green bubbles for a short amount of time around the user sprite, very small" — a brief particle burst around the player's own position on healing. */
  private spawnHealBubbles() {
    // A fresh texture every burst, rather than the previous cached/
    // shared one — that approach (create once, reuse, dispose(false)
    // to avoid destroying the shared object) turned out to still only
    // work for the first burst in practice, and chasing the exact
    // mechanism further wasn't worth it when this alternative sidesteps
    // the whole shared-resource question: each burst's own texture
    // disposes together with its own particle system (the library's
    // own default), nothing survives to be reused incorrectly, and
    // regenerating a tiny 64x64 canvas gradient per heal is trivial
    // computationally — heals aren't frequent enough for this to matter.
    const size = 64;
    const tex = new DynamicTexture("heal-bubble-tex", size, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.7, "rgba(255,255,255,0.6)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    tex.update();

    const ps = new ParticleSystem("heal-bubbles", 40, this.scene);
    ps.particleTexture = tex;
    ps.emitter = this.mesh.position.add(new Vector3(0, 0.9, 0));
    ps.minEmitBox = new Vector3(-0.35, -0.3, -0.35);
    ps.maxEmitBox = new Vector3(0.35, 0.9, 0.35);
    ps.color1 = new Color4(0.3, 1.0, 0.5, 0.9);
    ps.color2 = new Color4(0.5, 1.0, 0.7, 0.7);
    ps.colorDead = new Color4(0.3, 1.0, 0.5, 0);
    ps.minSize = 0.055; // was 0.04 — "a tiny bit bigger"
    ps.maxSize = 0.13; // was 0.1
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 0.9; // "for a short amount of time"
    ps.emitRate = 60;
    ps.direction1 = new Vector3(-0.3, 1, -0.3);
    ps.direction2 = new Vector3(0.3, 1, 0.3);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.7;
    ps.gravity = new Vector3(0, 0.4, 0); // drifts gently upward, like rising bubbles, rather than falling like normal particles
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    // Stops emitting new particles almost immediately (a burst, not a
    // sustained effect) and disposes itself (texture included — its
    // own, not shared, so the default disposeTexture=true is correct
    // and desired here) once every particle already emitted has
    // finished its own lifetime — self-cleaning, nothing for the
    // caller to track or remember to dispose.
    setTimeout(() => ps.stop(), 150);
    setTimeout(() => ps.dispose(), 150 + ps.maxLifeTime * 1000 + 200);
  }

  /** A brief camera punch on landing a hit — "when the user does damage it still feels non-effective." Called from GameEngine on the enemyDamaged event, not from here directly, since this class has no reason to know when its own attacks actually connect (CombatManager does). */
  triggerHitShake() {
    this.shakeTimeRemaining = HIT_SHAKE_DURATION;
  }

  /**
   * Full health, back on their feet at `position` (default: the original
   * spawn point). Called by GameEngine's death sequence.
   */
  respawn(position?: Vector3) {
    this.currentHealth = this.getMaxHealth();
    this.deathHandled = false;
    this.restoreStamina();
    this.mesh.position.copyFrom(position ?? this.spawnPosition);
    this.setFacingYaw(SPAWN_FACING_YAW);
    this.velocity.set(0, 0, 0);
    this.velocityY = 0;
    this.character?.play("idle"); // fallingBackDeath played once (loop=false) and would otherwise stay frozen on its last frame through the whole respawn wait
    this.bridge?.emit("playerHealthChanged", { current: this.currentHealth, max: this.getMaxHealth() });
  }

  /** The camera sitting at rest straight behind the player — where a load-in cutscene ends. */
  getCameraRestPose(): { alpha: number; beta: number; radius: number; target: Vector3 } {
    return {
      alpha: cameraAlphaBehind(this.facingYaw),
      beta: CAMERA_REST_BETA,
      radius: CAMERA_REST_RADIUS,
      target: this.mesh.position.add(new Vector3(0, CAMERA_TARGET_HEIGHT, 0)),
    };
  }

  /** True while a vehicle (the Budmobile) drives the player — see setExternalControl. */
  private externalControl = false;

  /**
   * Hands the player's body to a vehicle (true) or takes it back (false).
   * While handed over, the player doesn't move, attack or aim on their
   * own; the vehicle sets the position, facing and animation, and reads
   * the controls through getFlightInput(). The weapon is put away.
   */
  setExternalControl(active: boolean) {
    if (active === this.externalControl) return;
    this.externalControl = active;
    this.velocity.set(0, 0, 0);
    this.aiming = false;
    this.aimToggled = false;
    this.aimPoseHold = 0;
    this.attackHeld = false;
    this.reloadRemaining = 0;
    this.meleeSwingRemaining = 0;
    this.meleeLockedFacing = null;
    this.character?.stopUpperBody();
    this.equippedWeapon?.root.setEnabled(!active);
    if (!active && !this.isDead()) this.character?.play("idle");
  }

  isExternallyControlled(): boolean {
    return this.externalControl;
  }

  getCharacter(): SkeletalCharacter | null {
    return this.character;
  }

  /** Turns the body (and the capsule) to face `yaw`. */
  setFacingYaw(yaw: number) {
    this.facingYaw = yaw;
    this.mesh.rotation.y = yaw;
    this.character?.setFacing(yaw);
  }

  /**
   * The movement controls as flight input: `x`/`z` is the wished
   * direction in the world (relative to where the camera looks; length
   * up to 1), plus rise (Space / jump button), sink (C or Ctrl / attack
   * button on touch) and boost (Shift / sprint).
   */
  getFlightInput(): { x: number; z: number; up: boolean; down: boolean; boost: boolean } {
    const forward = new Vector3(-Math.cos(this.camera.alpha), 0, -Math.sin(this.camera.alpha));
    const right = new Vector3(forward.z, 0, -forward.x);
    let x: number;
    let z: number;
    if (Math.hypot(this.virtualMove.x, this.virtualMove.z) > 0.05) {
      x = forward.x * this.virtualMove.z + right.x * this.virtualMove.x;
      z = forward.z * this.virtualMove.z + right.z * this.virtualMove.x;
    } else {
      let f = 0;
      let r = 0;
      if (this.keys["w"] || this.keys["arrowup"]) f += 1;
      if (this.keys["s"] || this.keys["arrowdown"]) f -= 1;
      if (this.keys["d"] || this.keys["arrowright"]) r += 1;
      if (this.keys["a"] || this.keys["arrowleft"]) r -= 1;
      const len = Math.hypot(f, r) || 1;
      x = (forward.x * f + right.x * r) / len;
      z = (forward.z * f + right.z * r) / len;
    }
    return {
      x,
      z,
      up: !!this.keys[" "],
      down: !!this.keys["c"] || !!this.keys["control"] || this.attackHeld,
      boost: !!this.keys["shift"] || this.virtualSprint,
    };
  }

  /** Resting at a safe house: full health and a full stamina bar, with the heal sparkle. */
  restoreFully() {
    if (this.isDead()) return;
    this.currentHealth = this.getMaxHealth();
    this.restoreStamina();
    this.bridge?.emit("playerHealthChanged", { current: this.currentHealth, max: this.getMaxHealth() });
    this.spawnHealBubbles();
  }

  private restoreStamina() {
    this.stamina = this.progression?.getSprintSeconds() ?? sprintSecondsForCardio(statForLevel(1));
    this.exhausted = false;
  }

  /**
   * Wires the player into the combat systems built in GameEngine —
   * called once, after CombatManager/EnemyManager exist, rather than
   * threaded through the constructor: EnemyManager itself needs a
   * reference to this player (for chase/attack distance checks), so
   * constructing player -> combat -> enemies -> back into player would
   * be circular if this weren't a late-bound setter instead.
   */
  setCombatSystems(combat: CombatManager, bridge: EventBridge, getEnemies: () => Combatant[]) {
    this.combatManager = combat;
    this.bridge = bridge;
    this.getEnemies = getEnemies;
    bridge.emit("playerHealthChanged", { current: this.currentHealth, max: this.getMaxHealth() });
  }

  /**
   * Manual lock-on toggle (spec section 7: "the player must press a
   * dedicated lock-on button"). Selecting a new target when none is
   * locked; clearing the current one if one already is — a second press
   * cancels rather than re-searching, matching "the player manually
   * cancels lock-on" as one of the few things that's allowed to drop a
   * lock (spec section 8).
   */
  toggleLockOn() {
    if (this.lockedTarget) {
      this.lockedTarget = null;
      this.bridge?.emit("lockOnChanged", { enemyId: null });
      return;
    }
    if (!this.getEnemies) return;
    const cfg = COMBAT_CONFIG.player;
    const myPos = this.getPosition();
    const forward = new Vector3(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw)).normalize();

    const candidates = this.getEnemies()
      .filter((e) => !e.isDead())
      .map((e) => {
        const toTarget = e.getPosition().subtract(myPos);
        toTarget.y = 0;
        const dist = toTarget.length();
        return { enemy: e, dist, toTarget };
      })
      .filter((c) => c.dist <= cfg.lockOnRadius && c.dist > 0.01);

    // Prefer targets within the forward cone; only fall back to "closest
    // regardless of facing" if nothing forward-facing qualifies (spec
    // section 8: "do not select enemies far behind the player unless
    // there is no reasonable forward target").
    const forwardCandidates = candidates.filter((c) => {
      const angle = Math.acos(Vector3.Dot(forward, c.toTarget.normalize()));
      return angle <= cfg.lockOnForwardConeHalfAngle;
    });
    const pool = forwardCandidates.length > 0 ? forwardCandidates : candidates;
    if (pool.length === 0) return;

    pool.sort((a, b) => a.dist - b.dist);
    this.lockedTarget = pool[0].enemy;
    this.bridge?.emit("lockOnChanged", { enemyId: this.lockedTarget.id });
  }

  /** Called every frame — drops the lock if the target died, went out of range, or otherwise became invalid, per spec section 8/35 ("lock-on must clear automatically" when locked onto something that dies; "the target moves beyond the maximum lock-on distance"). */
  private updateLockOnValidity() {
    if (!this.lockedTarget) return;
    if (this.lockedTarget.isDead()) {
      this.lockedTarget = null;
      this.bridge?.emit("lockOnChanged", { enemyId: null });
      return;
    }
    const dist = Vector3.Distance(this.getPosition(), this.lockedTarget.getPosition());
    if (dist > COMBAT_CONFIG.player.lockOnMaxDistance) {
      this.lockedTarget = null;
      this.bridge?.emit("lockOnChanged", { enemyId: null });
    }
  }

  getLockedTargetId(): string | null {
    return this.lockedTarget?.id ?? null;
  }

  /** Registers a shadow-caster callback for the character mesh — applied immediately if the model has already loaded, or queued for when it does. */
  addShadowCasters(register: (mesh: import("@babylonjs/core").AbstractMesh) => void) {
    if (this.character) this.character.addShadowCasters(register);
    else this.pendingShadowRegister = register;
  }

  /** On-screen joystick input — x/z each in [-1, 1], magnitude encodes how far it's pushed (analog, not just 8-way). Called continuously while touched; pass (0, 0) on release. */
  setVirtualMove(x: number, z: number) {
    this.virtualMove.x = Math.max(-1, Math.min(1, x));
    this.virtualMove.z = Math.max(-1, Math.min(1, z));
  }

  setVirtualSprint(active: boolean) {
    this.virtualSprint = active;
  }

  /** The touch attack button — same as holding the left mouse button. */
  setAttackHeld(pressed: boolean) {
    this.attackHeld = pressed;
  }

  /** The touch aim button — touch has no right button to hold, so it toggles aim instead. */
  toggleAim() {
    this.aimToggled = !this.aimToggled;
  }

  /** Lets a touch button simulate a physical key — used for jump, which already reads `this.keys[" "]` every frame regardless of what set it. */
  setVirtualKey(key: string, pressed: boolean) {
    this.keys[key] = pressed;
  }

  /**
   * A melee weapon is parented directly to "mixamorig:RightHand"'s own
   * TransformNode (see attachEquippedWeaponToHand), and that bone's
   * origin sits at the wrist joint, not out at the palm — with zero
   * position offset (the previous behavior) the whole weapon sat back
   * toward the forearm instead of actually gripped in the hand. This
   * nudges the weapon's root along the hand bone's own local axis (the
   * same axis its child finger bones extend along in this rig) out to
   * roughly where a closed fist actually is, so the grip lands in the
   * palm instead of at the wrist.
   *
   * This is a single tunable value, not a derived/verified one — nudge
   * it directly (small steps) if a weapon still reads as sitting
   * slightly off. Each axis below is labeled with what it visibly moved
   * last time this was tuned by eye, as a starting point for further
   * adjustment:
   *  - x: moves the grip inward/outward across the palm
   *  - y: moves the grip up/down along the bone, toward the fingers (+)
   *       or back toward the wrist (-)
   *  - z: shifts the grip forward/back through the palm
   */
  private static readonly MELEE_HAND_GRIP_OFFSET = new Vector3(-0.01, 0.07, 0.05); // was (-0.04, 0.09, 0.05) — "sit a bit higher in the hand and also be a tiny bit more forward from the body." Y (the grip-direction axis identified in the previous adjustment) raised back up a little, and Z (the axis perpendicular to the palm, pointing away from the back of the hand — the most likely "forward from the body" axis) increased slightly too. Still not visually verified against the actual rendered result; this is the one value to keep nudging in whichever direction it's still off.

  /** The pistol's rotation and grip position relative to the "mixamorig:RightHand" bone — see equipWeapon. */
  private static readonly PISTOL_GRIP_ROTATION = new Quaternion(-0.4534, -0.4368, -0.57, 0.528);
  private static readonly PISTOL_GRIP_OFFSET = new Vector3(0, 0.08, 0.02);

  /** Swaps the held weapon — pass null to holster. Safe to call with the currently-equipped kind (no-op). */
  equipWeapon(kind: WeaponKind | null) {
    if (this.equippedWeapon?.kind === kind) return;
    this.reloadRemaining = 0; // switching weapons abandons a reload in progress (the magazine keeps what it had)
    this.aimToggled = false; // a new weapon starts un-aimed
    this.character?.stopUpperBody();
    if (this.aiming && kind !== "gun") this.setAiming(false); // don't leave the aim pose/zoom stuck on a weapon that can't aim
    this.equippedWeapon?.dispose();
    this.equippedWeapon = null;

    if (!kind) return;

    const weapon = createWeapon(this.scene, kind, "player");
    // Each weapon's model is built pointing "up" from its grip origin.
    // Melee weapons (sword/pickaxe) get their actual "point down"
    // orientation from orientMeleeWeaponUp(), called every frame in
    // update() — a fixed value here couldn't reliably produce that in
    // world space at all, since it's applied in the hand bone's own
    // (non-obvious) local space. This is just a reasonable starting
    // value before that first runs. The gun stays fixed here, since it
    // doesn't need this treatment — aiming forward is already what a
    // held, ready-to-fire gun should look like regardless of the hand
    // bone's own orientation quirks.
    if (kind === "sword" || kind === "pickaxe") {
      weapon.root.rotation.x = Math.PI;
      // See MELEE_HAND_GRIP_OFFSET — moves the grip from the wrist joint
      // into the palm. orientMeleeWeaponUp() only ever touches
      // rotation, never position, so this holds for as long as the
      // weapon stays equipped.
      weapon.root.position.copyFrom(PlayerController.MELEE_HAND_GRIP_OFFSET);
    } else {
      // The pistol's root is its grip (see Weapons.ts). This places it in
      // the palm and turns it so that, in the aiming pose, the barrel points
      // straight along the aim and the gun stands upright — worked out from
      // the right hand bone's actual orientation in Pistol_Aiming, then
      // checked by eye. Outside that pose it simply follows the hand.
      weapon.root.rotationQuaternion = PlayerController.PISTOL_GRIP_ROTATION.clone();
      weapon.root.position.copyFrom(PlayerController.PISTOL_GRIP_OFFSET);
    }
    this.equippedWeapon = weapon;
    this.attachEquippedWeaponToHand();
  }

  /** Parents the currently-equipped weapon mesh to the character's hand — split out because the character may not have finished loading yet when equipWeapon() is first called. */
  private attachEquippedWeaponToHand() {
    if (!this.equippedWeapon || !this.character) return;
    const hand = this.character.getHandNode("right");
    if (hand) this.equippedWeapon.root.parent = hand;
  }

  /**
   * Forces a melee weapon to point straight down in *world* space,
   * regardless of whatever orientation the hand bone itself currently
   * has — needed because a fixed local rotation (what this replaced)
   * can't actually guarantee a world-space result at all: the weapon is
   * parented to the hand bone, so its final world orientation is the
   * hand's own world rotation combined with the weapon's local one, and
   * the hand bone's rest orientation isn't simply "pointing down the
   * arm" the way a hand hanging at rest might suggest — Mixamo bones
   * carry their own, generally non-obvious rotation. A fixed local
   * value can only ever be correct for one specific hand orientation;
   * this computes the correct local rotation fresh from whatever the
   * hand's *current* world rotation actually is, every time it's
   * called, so it holds regardless of pose. Verified the actual formula
   * numerically (two different, arbitrary simulated hand rotations) —
   * inverse(handWorldRotation) composed with the desired world
   * orientation reliably makes the weapon's own "up" axis point at
   * world (0,-1,0) either way.
   *
   * Deliberately NOT called during a melee swing (see the
   * actionAnimationPlaying guard at the call site) — during the attack
   * itself the weapon should swing naturally with the hand's own
   * animated motion, not be held artificially locked downward through
   * it.
   */
  private static readonly WEAPON_UP_WORLD_ROTATION = Quaternion.FromEulerAngles(-Math.PI / 80, 0, 0.5); // was Quaternion.Identity() (straight up, no tilt) — "the melee weapon should lean more forward to go along with the hand," i.e. a natural grip angle rather than perfectly vertical. The old "down" rotation was a full Math.PI around this same X axis, so a modest lean in the opposite rotational direction (-20deg here) is the reasoned starting point for a forward tilt, not something visually verified against the actual rendered result — if it leans the wrong way or too far, this is the one value to adjust, in either sign or magnitude.

  private orientMeleeWeaponUp() {
    if (!this.equippedWeapon || !this.character) return;
    if (this.equippedWeapon.kind !== "sword" && this.equippedWeapon.kind !== "pickaxe") return;
    const hand = this.character.getHandNode("right");
    if (!hand) return;
    hand.computeWorldMatrix(true);
    // WEAPON_UP_WORLD_ROTATION is the look tuned at spawn facing; turn it
    // with the body so the weapon keeps the same angle relative to the
    // character whichever way it faces, instead of a fixed world angle.
    // Matrices rather than quaternion products so the order is explicit:
    // Babylon composes row-vector style (world = local x parent).
    const desiredWorld = Matrix.Identity();
    PlayerController.WEAPON_UP_WORLD_ROTATION.toRotationMatrix(desiredWorld);
    const bodyTurn = Matrix.RotationY(this.facingYaw - SPAWN_FACING_YAW);
    const handWorld = Matrix.Identity();
    hand.absoluteRotationQuaternion.toRotationMatrix(handWorld);
    const local = desiredWorld.multiply(bodyTurn).multiply(Matrix.Invert(handWorld));
    this.equippedWeapon.root.rotationQuaternion = Quaternion.FromRotationMatrix(local);
  }

  getEquippedWeaponKind(): WeaponKind | null {
    return this.equippedWeapon?.kind ?? null;
  }

  /**
   * With a gun: hold the arms in the aiming pose while aiming or right
   * after a shot, otherwise let them follow the walk/run/idle clip. Left
   * alone while a reload (its own arm overlay) is playing.
   */
  private updateGunArms() {
    if (!this.character) return;
    const overlay = this.character.getUpperBodyOverlay();
    if (this.reloadRemaining > 0) return;
    const hasGun = !!getGunConfig(this.equippedWeapon?.kind);
    const wantAimArms = hasGun && (this.aiming || this.aimPoseHold > 0) && !this.playingHeadHit;
    if (wantAimArms) {
      this.character.holdUpperBody("pistolAiming", SHOT_OVERLAY_BONES);
    } else if (overlay?.held && overlay.name === "pistolAiming") {
      this.character.stopUpperBody();
    }
  }

  /**
   * Runs right after the animation system each frame. With a gun out:
   * pitches the chest with the camera so the gun points where the player
   * is looking — up and down, following the mouse/trackpad or touch-drag
   * just like movement does — and adds the arms' upward recoil kick.
   * Purely additive on top of whatever the clips set this frame.
   */
  private applyGunPose() {
    if (!this.character || !getGunConfig(this.equippedWeapon?.kind) || this.isDead()) return;
    if (this.gunSprinting) return; // running the other way from the camera — no aim lean
    // Character's right-hand axis in world space (local +X turned by the body's yaw).
    const right = new Vector3(Math.cos(this.facingYaw), 0, -Math.sin(this.facingYaw));
    // beta > PI/2 means the orbit camera sits below its target, i.e. looking up.
    const pitchUp = Math.max(-MAX_AIM_PITCH, Math.min(MAX_AIM_PITCH, this.camera.beta - Math.PI / 2));
    // Babylon is left-handed: a positive turn about "right" tips forward
    // downward, so looking up needs a negative one. Split across two spine
    // bones so the bend reads as a natural lean, not a hinge.
    for (const bone of ["mixamorig:Spine1", "mixamorig:Spine2"]) {
      this.character.getBoneNode(bone)?.rotate(right, -pitchUp * 0.5, Space.WORLD);
    }
    // Two hands on the gun, side by side rather than through each other
    // (the aim pose plays on the arms while moving, on the whole body
    // standing still — either way, whenever the gun is up).
    const gunUp = (this.aiming || this.aimPoseHold > 0) && this.reloadRemaining <= 0 && !this.playingHeadHit;
    if (gunUp) {
      this.character.getBoneNode("mixamorig:LeftArm")?.rotate(Vector3.Up(), SUPPORT_ARM_SPREAD, Space.WORLD);
    } else if (this.character.getCurrentAnimation() === "pistolIdle" && !this.character.getUpperBodyOverlay()) {
      this.character.getBoneNode("mixamorig:LeftArm")?.rotate(Vector3.Up(), SUPPORT_ARM_SPREAD_IDLE, Space.WORLD);
    }
    if (this.armRecoil > 0.001) {
      for (const bone of ["mixamorig:RightArm", "mixamorig:LeftArm"]) {
        this.character.getBoneNode(bone)?.rotate(right, -this.armRecoil, Space.WORLD);
      }
    }
  }

  private getRoundsInMagazine(): number {
    const kind = this.equippedWeapon?.kind;
    const gun = getGunConfig(kind);
    if (!kind || !gun) return 0;
    return this.ammoInMagazine.get(kind) ?? gun.magazineSize;
  }

  /** Starts reloading the equipped gun, unless it's already reloading or its magazine is full. */
  private startReload() {
    const gun = getGunConfig(this.equippedWeapon?.kind);
    if (!gun || this.reloadRemaining > 0 || this.getRoundsInMagazine() >= gun.magazineSize) return;
    this.reloadDuration = gun.reloadSeconds;
    this.reloadRemaining = gun.reloadSeconds;
    // The reload clip on the arms only, like the shot — legs and torso keep
    // walking/running, so the player can reload on the move. Its speed is
    // fitted to the gun's reload time, so the animation and the actual
    // reload always finish together.
    const clipSeconds = this.character?.getAnimationDuration("reload") ?? 0;
    if (clipSeconds > 0) {
      this.character?.playUpperBody("reload", clipSeconds / gun.reloadSeconds, gun.reloadSeconds * 1000, undefined, SHOT_OVERLAY_BONES);
    }
  }

  private updateReload(dt: number) {
    if (this.reloadRemaining <= 0) return;
    this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
    const kind = this.equippedWeapon?.kind;
    const gun = getGunConfig(kind);
    if (this.reloadRemaining === 0 && kind && gun) this.ammoInMagazine.set(kind, gun.magazineSize);
  }

  /** 0-1, how much of the current reload is left (1 = just started, 0 = not reloading) — for the reload ring. */
  getReloadFraction(): number {
    return this.reloadDuration > 0 ? this.reloadRemaining / this.reloadDuration : 0;
  }

  /** The equipped gun's ammo, or null when no gun is equipped. */
  getAmmo(): { inMagazine: number; magazineSize: number; reloading: boolean } | null {
    const gun = getGunConfig(this.equippedWeapon?.kind);
    if (!gun) return null;
    return { inMagazine: this.getRoundsInMagazine(), magazineSize: gun.magazineSize, reloading: this.reloadRemaining > 0 };
  }

  isAiming(): boolean {
    return this.aiming;
  }

  /** Current body facing, in radians — for anything outside this controller that needs it (e.g. a minimap direction arrow), rather than recomputing it independently. */
  getFacingYaw(): number {
    return this.facingYaw;
  }

  /**
   * The camera's own forward direction, expressed as a yaw in the exact
   * same convention as getFacingYaw() (atan2(x, z) — 0 = world +z/north,
   * increasing toward +x/east) — NOT the same value as getFacingYaw()
   * itself. The body's facing now always tracks its own travel
   * direction (see update()), which is genuinely a different direction
   * from wherever the camera is currently pointed whenever the player is
   * strafing, standing still while looking around, or mid-turn — this
   * is specifically for anything that should track where the player is
   * actually looking (e.g. the minimap's rotation), not which way the
   * character model happens to be walking.
   */
  getCameraForwardYaw(): number {
    const alpha = this.camera.alpha;
    const fx = -Math.cos(alpha);
    const fz = -Math.sin(alpha);
    return Math.atan2(fx, fz);
  }

  /** 0-1, the melee combo follow-up window's remaining fraction (1 = window just opened, 0 = expired or not active) — for a UI countdown indicator. 0 whenever there's no active window, not just when it's expired, so the UI can use "> 0" to decide whether to show anything at all. */
  getMeleeComboWindowFraction(): number {
    return this.comboWindowTimer / MELEE_COMBO_WINDOW;
  }

  /** Playback speed of the hit reaction — Head_Hit.glb is 1.167s natively, so ~1s here. */
  private static readonly HEAD_HIT_SPEED = 1.15;

  /**
   * The full 4-hit melee combo, in order. Each entry plays back at
   * `speed` (a speedRatio passed to SkeletalCharacter.play()) and is cut
   * off after `cutoffMs` regardless of the clip's own full length —
   * these are deliberately two independent knobs, not one: an earlier
   * version sped the clips themselves way up (3.0x/4.2x) to make the
   * combo feel snappy, but that made the swings' own motion look
   * unnaturally fast. Then an even earlier version kept speed close to
   * natural (1.1x) but that meant the cutoff — needed to keep the combo
   * feeling quick — landed so early relative to the clip's own slower
   * pace that the swing barely read as happening before being
   * interrupted. 1.4x is the middle ground: real weight to the motion
   * (not a "quick swoop"), while still moving fast enough that a
   * meaningful, visible chunk of each swing plays out before the next
   * action interrupts it — since play() for whatever comes next (the
   * following combo hit, or movement once the chain ends) fires the
   * instant control returns, cutting the previous clip off mid-motion
   * rather than letting it sit through its own full, lengthy tail.
   *
   * cutoffMs is set to roughly 65% of each clip's own full length at its
   * `speed` — was previously a smaller, non-uniform fraction per hit
   * (26%-54%, aiming for comparable absolute visible time rather than a
   * consistent percentage), but that read as cutting off too fast across
   * the board, so this switched to a larger, consistent fraction of each
   * clip's own length instead. Order in this array is the actual combo
   * order (Downward -> Horizontal -> Combo V2 -> 360) — 360 was moved to
   * last/4th (was 3rd) and Combo V2 to 3rd (was 4th) on request, so this
   * is also where the hit order itself lives, not just timing.
   *
   * Natural lengths, measured directly from each clip's own baked
   * keyframe data before picking speed/cutoffMs, not guessed: Downward
   * 1.83s, Horizontal 1.43s, 360 2.43s, Combo V2 3.47s, all confirmed
   * 30fps.
   *
   * Starting points, not measured results — I can't watch any of this
   * play out myself, so if a swing still cuts off before it reads as
   * happening, or the motion itself still looks too fast/slow, `speed`
   * and `cutoffMs` on the relevant entry are the two independent
   * numbers to adjust for it specifically, without needing to retune
   * the whole chain.
   */
  private static readonly MELEE_CHAIN: { animation: NinjaAnimation; speed: number; cutoffMs: number }[] = [
    { animation: "meleeAttackDownward", speed: 1.4, cutoffMs: 850 }, // full ~1.31s at 1.4x, ~65% shown
    { animation: "meleeAttackHorizontal", speed: 1.4, cutoffMs: 665 }, // full ~1.02s at 1.4x, ~65% shown
    { animation: "meleeAttack360", speed: 1.6, cutoffMs: 1050 }, // full ~1.74s at 1.4x, ~65% shown — swapped into 4th/last (was 3rd)
    { animation: "meleeComboV2", speed: 1.4, cutoffMs: 2450 }, // the real, correct finisher clip (converted from the user's original .fbx upload — see HUMANOID_ANIMATION_FILES' own comment on meleeComboV2), measured native duration 3.458s, so ~2.47s at 1.4x; cutoffMs shows nearly all of it, since this is the finisher and it's a long, deliberate combo move worth playing out close to fully. The 3 hit windows below are timed against this real duration, not a guess.
  ];

  /**
   * Melee weapons swing through MELEE_CHAIN, one hit per press, chaining
   * to the next hit only on a follow-up press within the window; the
   * gun fires. No-op with nothing equipped.
   *
   * The melee branch deliberately ignores a press while the previous
   * swing is still playing (`actionAnimationPlaying`) rather than
   * interrupting it — every swing always plays to its own (cut-off,
   * see MELEE_CHAIN) end before anything else can happen, matching
   * Skyrim's own melee commitment rather than allowing attack-spam to
   * cancel animations early. Whether *this* particular press continues
   * the chain or restarts it from the first hit depends on
   * comboWindowTimer, which only starts counting down once the
   * previous hit's own animation has actually finished (set in its
   * onComplete below) — so the follow-up window begins after a swing
   * ends, not from when it started. Landing the final hit (or letting
   * the window lapse at any point) resets back to the first hit.
   */
  /**
   * Spec section 4/26: hits 1-3 of the chain are single 40-damage swings
   * (one damage window each); the 4th/final animation is a genuine
   * three-swing finisher, and must land three independent 20-damage
   * windows within its own single clip, not one lump 60-damage hit.
   * There's no animation-marker/event system on these clips (checked —
   * this project's animation playback has no such hook anywhere), so
   * per spec section 26's own fallback ("use timed attack windows...
   * if animation events/markers are [not] available"), each window is a
   * scheduled callback at a fraction of the swing's own already-
   * established wall-clock cutoffMs duration.
   */
  private scheduleAttackDamageWindows(hitIndex: number, cutoffMs: number) {
    const isFinalHit = hitIndex === PlayerController.MELEE_CHAIN.length - 1;
    // Was [0.3, 0.55, 0.8] — "way too late," per direct feedback on
    // this specific swing only (the other 3 hits' own [0.5] single
    // window isn't part of this complaint). Shifted meaningfully
    // earlier: this clip's actual visible swing motions almost
    // certainly land earlier in its timeline than the back half, which
    // is more likely follow-through/recovery than active striking.
    const windowFractions = isFinalHit ? [0.12, 0.28, 0.45] : [0.5];
    const multiplier = isFinalHit ? COMBAT_CONFIG.player.finisherWindowMultiplier : 1;
    const weapon = this.equippedWeapon?.kind ?? null; // the weapon this swing started with gets the credit

    windowFractions.forEach((frac) => {
      setTimeout(() => {
        if (this.disposedFlag) return;
        this.resolveMeleeDamageWindow(this.rawDamage(weapon, multiplier), weapon);
      }, cutoffMs * frac);
    });
  }

  /** One damage window's worth of hit detection — finds every valid enemy in the melee radius+arc right now and damages each exactly once, via one fresh CombatManager attack instance per window (spec section 4: "each swing can hit a valid enemy once during its own damage window", and section 27: multiple enemies can share one window's hit, but not multiple windows' worth from the same window). */
  private resolveMeleeDamageWindow(damage: number, weapon: WeaponKind | null) {
    if (!this.combatManager || !this.getEnemies) {
      // Was a completely silent early-return before — if combatManager
      // or getEnemies were ever unset after being set once in
      // setCombatSystems (they never should be, since nothing else
      // reassigns them, but this makes that assumption visible instead
      // of an invisible dead end), this is exactly the kind of thing
      // that would look identical to "damage just stops working" with
      // literally nothing in the console to explain why.
      console.warn("resolveMeleeDamageWindow: combatManager or getEnemies missing — damage window silently skipped.");
      return;
    }
    const cfg = COMBAT_CONFIG.player;
    const facing = this.meleeLockedFacing ?? this.facingYaw;
    const targets = this.combatManager.findTargetsInArc(
      this.getPosition(),
      facing,
      cfg.meleeRadius,
      cfg.attackArcHalfAngle,
      this.getEnemies(),
      false // excludeIsEnemy=false: this is a player attack, so it should only ever hit isEnemy targets, which findTargetsInArc's own c.isEnemy===excludeIsEnemy check already guarantees
    );
    const attackInstanceId = this.combatManager.beginAttackInstance();
    try {
      // Each target's own applyDamage call is isolated — a killing blow
      // can trigger a chain of side effects (death state, a death
      // animation play call, gold drop, etc.), and if any one of those
      // ever threw, an unguarded forEach would abort right there: the
      // remaining targets in *this same swing* would never get damaged,
      // and — worse — endAttackInstance below would never run, since a
      // thrown error skips everything after it. The finally block
      // guarantees cleanup happens regardless.
      targets.forEach((t) => {
        try {
          this.combatManager!.applyDamage(this, t, damage, attackInstanceId, weapon);
        } catch (err) {
          console.error(`applyDamage threw for target "${t.id}" — isolated, other targets in this swing still processed:`, err);
        }
      });
    } finally {
      this.combatManager.endAttackInstance(attackInstanceId);
    }
  }

  attack() {
    // Any new attack (melee or gun) calls character.play() on this same
    // character, which invalidates whatever animation's own onComplete
    // callback was still pending — including headHit's. Since headHit
    // was changed to be interruptible (see receiveDamage's own comment)
    // so it can now fire even mid-swing, the reverse became newly
    // possible too: attacking again while headHit is still playing
    // would silently strand playingHeadHit at true forever, since its
    // onComplete (the only place that clears it) would simply never
    // run. That's a much worse failure than a skipped animation — it
    // permanently blocks isInvulnerable() at true, meaning the player
    // could never take damage, or therefore ever play headHit, again.
    // Explicitly resetting it here, the same way headHit's own branch
    // resets actionAnimationPlaying/meleeLockedFacing when it
    // interrupts a swing, closes that loop in both directions.
    this.playingHeadHit = false;
    this.headHitElapsed = 0;
    if (!this.equippedWeapon) {
      this.punch();
      return;
    }
    const gun = getGunConfig(this.equippedWeapon.kind);
    if (gun) {
      if (this.reloadRemaining > 0) return; // can't fire mid-reload
      const rounds = this.getRoundsInMagazine();
      if (rounds <= 0) {
        this.startReload();
        return;
      }
      this.ammoInMagazine.set(this.equippedWeapon.kind, rounds - 1);
      this.fireGun(this.rawDamage(this.equippedWeapon.kind), this.equippedWeapon.kind);
      if (rounds - 1 <= 0) this.startReload(); // last round fired — reload straight away
      return;
    }
    if (this.meleeSwingRemaining > 0) return; // a swing is already committed to playing out

    // The swing goes the way the body is facing, never where the camera
    // looks — turning the camera doesn't spin the character round.
    this.beginMeleeCommit();
    this.meleeLockedFacingElapsed = 0; // fresh swing, fresh safety-net budget
    // Lock-on biases the swing's own facing toward the locked target —
    // spec section 9: "calculate the attack direction toward the locked
    // enemy... do not extend the attack radius." This only changes which
    // way the swing faces, never whether it can reach.
    this.updateLockOnValidity();
    if (this.lockedTarget) {
      const toTarget = this.lockedTarget.getPosition().subtract(this.getPosition());
      if (Math.hypot(toTarget.x, toTarget.z) > 0.01) {
        this.meleeLockedFacing = Math.atan2(toTarget.x, toTarget.z);
      }
    }

    const hitIndex = this.comboWindowTimer > 0 ? this.comboNextHitIndex : 0;
    const hit = PlayerController.MELEE_CHAIN[hitIndex];
    this.comboWindowTimer = 0; // consumed either way — a fresh window opens when this swing ends, unless it was the finisher
    this.meleeSwingIndex = hitIndex;
    this.meleeSwingRemaining = hit.cutoffMs / 1000;
    this.bridge?.emit("comboChanged", { hitIndex, resetting: false });
    this.scheduleAttackDamageWindows(hitIndex, hit.cutoffMs);

    // The full-body swing, so its whole form shows. The player can still
    // move, slowly (MELEE_SWING_MOVE_FACTOR). Its end is timed by
    // meleeSwingRemaining (see finishMeleeSwing), not by the animation,
    // so nothing can leave the swing stuck.
    this.character?.play(hit.animation, false, undefined, hit.speed, hit.cutoffMs);
  }

  /**
   * Unarmed attack: a punch, the same moves the enemies throw —
   * alternating a quick jab and a heavier hook, one punch per press.
   * Unlike weapon swings there's no combo chain or finisher; each punch
   * stands alone. Damage is strength alone (no weapon); reach matches a weapon.
   */
  private punch() {
    if (this.meleeSwingRemaining > 0) return;
    const p = PlayerController.PUNCHES[this.nextPunch];
    this.nextPunch = (this.nextPunch + 1) % PlayerController.PUNCHES.length;

    this.beginMeleeCommit(); // punch the way the body is facing
    this.updateLockOnValidity();
    if (this.lockedTarget) {
      const toTarget = this.lockedTarget.getPosition().subtract(this.getPosition());
      if (Math.hypot(toTarget.x, toTarget.z) > 0.01) this.meleeLockedFacing = Math.atan2(toTarget.x, toTarget.z);
    }
    this.meleeSwingIndex = -1; // not part of the weapon combo chain
    this.meleeSwingRemaining = p.cutoffMs / 1000;
    setTimeout(() => {
      if (this.disposedFlag) return;
      this.resolveMeleeDamageWindow(this.rawDamage(null, p.damageMultiplier), null);
    }, p.cutoffMs * p.hitFraction);
    this.character?.play(p.animation, false, undefined, p.speed, p.cutoffMs);
  }

  /**
   * Starts a melee swing or punch: the facing locks to wherever the body
   * already points, and the player stops dead — no walking until the
   * animation has played out.
   */
  private beginMeleeCommit() {
    this.meleeLockedFacing = this.facingYaw;
    this.meleeLockedFacingElapsed = 0;
    this.velocity.set(0, 0, 0);
    this.sprinting = false;
  }

  /** Index into PUNCHES of the next unarmed punch. */
  private nextPunch = 0;

  /**
   * The unarmed punches, alternated. Timings from the clips themselves:
   * Punching.glb (0.8s) lands ~0.2s in; Hook_Punch.glb (2.2s) winds up
   * and lands ~0.9s in. `hitFraction` is when the hit lands, as a share
   * of `cutoffMs` (how long the punch takes before you can act again).
   */
  private static readonly PUNCHES: { animation: NinjaAnimation; speed: number; cutoffMs: number; hitFraction: number; damageMultiplier: number }[] = [
    { animation: "punching", speed: 1.3, cutoffMs: 600, hitFraction: 0.3, damageMultiplier: 1 },
    { animation: "hookPunch", speed: 1.6, cutoffMs: 940, hitFraction: 0.6, damageMultiplier: 1.25 },
  ];

  /** Called when a swing's time is up: frees the facing lock and opens the combo window for the next hit (or resets after the finisher). */
  private finishMeleeSwing() {
    this.meleeLockedFacing = null;
    this.meleeLockedFacingElapsed = 0;
    if (this.meleeSwingIndex < 0) return; // a punch: no combo chain
    const isLastHit = this.meleeSwingIndex === PlayerController.MELEE_CHAIN.length - 1;
    if (isLastHit) {
      this.comboNextHitIndex = 0; // chain complete — next press starts over from the first hit
    } else {
      this.comboNextHitIndex = this.meleeSwingIndex + 1;
      this.comboWindowTimer = MELEE_COMBO_WINDOW;
    }
  }

  /** Holds the gun up in an aiming pose and eases the camera in closer. Ignored unless a gun is equipped. */
  setAiming(active: boolean) {
    const canAim = active && this.equippedWeapon?.kind === "gun";
    if (canAim && !this.aiming) {
      this.preAimRadius = this.camera.radius; // entering aim — remember the zoom level to restore later
    }
    this.aiming = canAim;
  }

  /**
   * Muzzle flash + a real bullet that travels from the gun to wherever the
   * crosshair is actually aimed, plus an ejected shell casing that
   * actually falls under gravity.
   *
   * Explicitly re-snaps facing to the camera direction right before
   * firing, rather than relying solely on update()'s per-frame lock —
   * belt-and-suspenders so a shot always visibly reads as fired exactly
   * where the crosshair is pointed, with nothing (an animation transition,
   * an interrupted turn) able to leave even one stale frame between "was
   * facing something else" and "fires."
   */
  private fireGun(damage: number, weapon: WeaponKind) {
    if (!this.equippedWeapon?.muzzle) return;

    const alphaNow = this.camera.alpha;
    const snapForward = new Vector3(-Math.cos(alphaNow), 0, -Math.sin(alphaNow));
    this.facingYaw = Math.atan2(snapForward.x, snapForward.z);
    this.mesh.rotation.y = this.facingYaw;
    this.character?.setFacing(this.facingYaw);

    // GTA-style: the arms snap to (and stay in) the aiming pose — see
    // updateGunArms — with a small upward kick per shot (applyGunPose),
    // while the legs and torso keep whatever walk/run/strafe clip is
    // going, so walking and shooting both show at once.
    this.aimPoseHold = AIM_POSE_HOLD_AFTER_SHOT;
    this.armRecoil = Math.min(ARM_RECOIL_KICK * 1.6, this.armRecoil + ARM_RECOIL_KICK);
    this.updateGunArms();
    // The view kicks up a little too (beta grows = the orbit camera drops = it looks higher).
    this.camera.beta = Math.min(this.camera.upperBetaLimit ?? Math.PI - 0.06, this.camera.beta + SHOT_RECOIL);

    // Can't sprint for a moment after firing, whether the shot was fired
    // standing still or on the move.
    this.sprintLockoutTimer = SPRINT_LOCKOUT_AFTER_SHOT;

    const muzzleWorldPos = this.equippedWeapon.muzzle.getAbsolutePosition().clone();

    // Deliberately NOT `camera.target.subtract(camera.position)` — Babylon
    // only recomputes `camera.position` lazily (inside getViewMatrix(),
    // normally triggered by scene.render()), so reading it here, before
    // render has run for this frame, returns wherever the camera was at
    // the *end of the previous frame*. Deriving the direction straight from
    // alpha/beta instead has no dependency on any lazily-updated camera
    // state at all.
    const alpha = this.camera.alpha;
    const beta = this.camera.beta;
    const direction = new Vector3(
      -Math.cos(alpha) * Math.sin(beta),
      -Math.cos(beta),
      -Math.sin(alpha) * Math.sin(beta)
    );

    // The camera's own position, freshly derived the same way (never read
    // camera.position directly, same staleness reasoning as above) —
    // needed so the shot can be aimed from where the crosshair actually
    // is, not from the gun.
    const cameraTarget = this.camera.target instanceof Vector3 ? this.camera.target : this.mesh.position;
    const radius = this.camera.radius;
    const cameraPos = cameraTarget.add(
      new Vector3(
        Math.cos(alpha) * Math.sin(beta) * radius,
        Math.cos(beta) * radius,
        Math.sin(alpha) * Math.sin(beta) * radius
      )
    );

    const forward = new Vector3(-Math.cos(alpha), 0, -Math.sin(alpha));
    const right = new Vector3(forward.z, 0, -forward.x);

    this.spawnMuzzleFlash(muzzleWorldPos);
    this.spawnBullet(muzzleWorldPos, direction, cameraPos, damage, weapon);
    this.spawnShellCasing(muzzleWorldPos, right, forward);
  }

  private spawnMuzzleFlash(position: Vector3) {
    const flash = MeshBuilder.CreateSphere("muzzleFlash", { diameter: 0.18 }, this.scene);
    flash.position = position;
    // Critical: this spawns at literally the exact same point fireGun()'s
    // raycast starts from, one line before that raycast runs. A ray
    // starting inside/at a mesh's own position hits it immediately — every
    // single shot was self-hitting its own muzzle flash before this was
    // added, which is what made bullets look like they never left the gun.
    flash.isPickable = false;
    flash.material = this.effectMaterial("muzzleFlashMat", (m) => (m.emissiveColor = new Color3(1, 0.85, 0.4)));
    setTimeout(() => flash.dispose(), MUZZLE_FLASH_LIFETIME * 1000);
  }

  /**
   * Fires a real, visible projectile: a bright core plus a trailing streak
   * behind it. The raycast to find the landing point starts from
   * `aimOrigin` (the camera's position) rather than `origin` (the muzzle)
   * — that's what makes the shot land on whatever's actually under the
   * crosshair rather than wherever a line drawn from the gun happens to
   * go, which is a parallel but different line. The *visible* bullet still
   * starts at the muzzle and animates to that same landing point, so it
   * reads as fired from the gun and converging on the target.
   */
  private spawnBullet(origin: Vector3, direction: Vector3, aimOrigin: Vector3, damage: number, weapon: WeaponKind) {
    const ray = new Ray(aimOrigin, direction, BULLET_RANGE);
    const hit = this.scene.pickWithRay(ray, (mesh) => mesh !== this.mesh && mesh.isPickable !== false);
    // Enemies are tested geometrically (closest live enemy whose body the
    // aim ray passes through, in front of whatever world geometry the ray
    // hit) rather than via the pick result, since nothing maps a picked
    // skinned-mesh part back to its Enemy instance.
    const worldHitDist = hit?.hit ? hit.distance : BULLET_RANGE;
    const target = this.findGunTarget(aimOrigin, direction, worldHitDist);
    // Hitscan, like Garry's Mod: the hit lands the instant you fire; the
    // tracer below is just the visual flying to the same point.
    if (target) this.applyGunDamage(target.enemy, damage, weapon);
    const endPoint = target
      ? aimOrigin.add(direction.scale(target.distance))
      : hit?.pickedPoint ?? aimOrigin.add(direction.scale(BULLET_RANGE));
    const bulletDirection = endPoint.subtract(origin).normalize();
    const distance = Vector3.Distance(origin, endPoint);

    const core = MeshBuilder.CreateSphere("bulletCore", { diameter: BULLET_CORE_DIAMETER }, this.scene);
    core.position = origin.clone();
    core.isPickable = false;
    core.material = this.effectMaterial("bulletCoreMat", (m) => (m.emissiveColor = new Color3(1, 0.98, 0.85)));

    const streak = MeshBuilder.CreateCylinder(
      "bulletStreak",
      { height: BULLET_STREAK_LENGTH, diameter: BULLET_STREAK_DIAMETER },
      this.scene
    );
    orientAlongDirection(streak, bulletDirection);
    streak.isPickable = false;
    streak.material = this.effectMaterial("bulletStreakMat", (m) => {
      m.emissiveColor = new Color3(1, 0.82, 0.4);
      m.alpha = 0.75;
    });

    this.activeBullets.push({
      core,
      streak,
      direction: bulletDirection.clone(),
      start: origin.clone(),
      end: endPoint,
      elapsed: 0,
      duration: Math.max(0.02, distance / BULLET_SPEED),
      willHit: !!hit?.hit || !!target,
      target: null, // damage was already applied at fire time (hitscan)
      damage,
      weapon,
    });
  }

  /**
   * Where the crosshair is pointing: a ray from the camera's position
   * along its look direction. Derived from alpha/beta/radius rather than
   * camera.position, which Babylon only refreshes during render (see
   * fireGun's own note).
   */
  getAimRay(): { origin: Vector3; direction: Vector3 } {
    const alpha = this.camera.alpha;
    const beta = this.camera.beta;
    const direction = new Vector3(-Math.cos(alpha) * Math.sin(beta), -Math.cos(beta), -Math.sin(alpha) * Math.sin(beta));
    const target = this.camera.target instanceof Vector3 ? this.camera.target : this.mesh.position;
    const origin = target.subtract(direction.scale(this.camera.radius));
    return { origin, direction };
  }

  /** True if the crosshair ray passes through this combatant's body (same body model as gun targeting, slightly more forgiving), within `maxDistance`. */
  isAimingAt(target: Combatant, maxDistance: number): boolean {
    const { origin, direction } = this.getAimRay();
    const center = target.getPosition().add(new Vector3(0, 1.0, 0));
    const along = Vector3.Dot(center.subtract(origin), direction);
    if (along < 0 || along > maxDistance) return false;
    const closest = origin.add(direction.scale(along));
    return Math.hypot(closest.x - center.x, closest.z - center.z) <= 0.7 && Math.abs(closest.y - center.y) <= 1.0;
  }

  /** The nearest live enemy the aim ray passes through (treating each as a vertical body ~0.45 units in radius, chest-height centered), no farther than `maxDistance` along the ray. */
  private findGunTarget(origin: Vector3, direction: Vector3, maxDistance: number): { enemy: Combatant; distance: number } | null {
    if (!this.getEnemies) return null;
    const BODY_RADIUS = 0.45;
    const BODY_CENTER_HEIGHT = 1.0;
    let best: { enemy: Combatant; distance: number } | null = null;
    for (const enemy of this.getEnemies()) {
      if (enemy.isDead()) continue;
      const center = enemy.getPosition().add(new Vector3(0, BODY_CENTER_HEIGHT, 0));
      const along = Vector3.Dot(center.subtract(origin), direction);
      if (along < 0 || along > maxDistance + BODY_RADIUS) continue;
      const closest = origin.add(direction.scale(along));
      // Horizontal miss distance against the body radius, vertical against roughly head-to-knee height.
      const dx = closest.x - center.x;
      const dz = closest.z - center.z;
      if (Math.hypot(dx, dz) > BODY_RADIUS || Math.abs(closest.y - center.y) > 0.9) continue;
      if (!best || along < best.distance) best = { enemy, distance: along };
    }
    return best;
  }

  private applyGunDamage(target: Combatant, damage: number, weapon: WeaponKind) {
    if (!this.combatManager || this.disposedFlag) return;
    const attackInstanceId = this.combatManager.beginAttackInstance();
    try {
      this.combatManager.applyDamage(this, target, damage, attackInstanceId, weapon);
    } finally {
      this.combatManager.endAttackInstance(attackInstanceId);
    }
  }

  /** Advances every in-flight bullet; disposes it and spawns a hit spark on arrival. Called every frame from update(). */
  private updateBullets(dt: number) {
    if (this.activeBullets.length === 0) return;
    const stillFlying: ActiveBullet[] = [];

    for (const bullet of this.activeBullets) {
      bullet.elapsed += dt;
      const t = Math.min(1, bullet.elapsed / bullet.duration);
      const pos = Vector3.Lerp(bullet.start, bullet.end, t);
      bullet.core.position = pos;
      bullet.streak.position = pos.subtract(bullet.direction.scale(BULLET_STREAK_LENGTH / 2));

      if (t >= 1) {
        bullet.core.dispose();
        bullet.streak.dispose();
        if (bullet.willHit) this.spawnHitSpark(bullet.end);
        if (bullet.target) this.applyGunDamage(bullet.target, bullet.damage, bullet.weapon);
      } else {
        stillFlying.push(bullet);
      }
    }

    this.activeBullets = stillFlying;
  }

  private spawnHitSpark(position: Vector3) {
    const spark = MeshBuilder.CreateSphere("hitSpark", { diameter: 0.12 }, this.scene);
    spark.position = position;
    spark.isPickable = false;
    spark.material = this.effectMaterial("hitSparkMat", (m) => (m.emissiveColor = new Color3(1, 0.95, 0.7)));
    setTimeout(() => spark.dispose(), MUZZLE_FLASH_LIFETIME * 2 * 1000);
  }

  /** Ejects a small brass shell casing sideways from the gun — real gravity, real tumbling rotation, lands on the actual terrain height under it. */
  private spawnShellCasing(origin: Vector3, right: Vector3, forward: Vector3) {
    const shell = MeshBuilder.CreateCylinder("shell", { height: 0.09, diameter: 0.035 }, this.scene);
    shell.position = origin.clone();
    shell.rotation.x = Math.PI / 2; // lying on its side, like a real casing in flight
    // A quick second shot fires from this same muzzle point before the
    // previous shell has fallen clear — without this, that second shot's
    // raycast could self-hit the still-airborne casing from the first.
    shell.isPickable = false;

    shell.material = this.effectMaterial("shellMat", (m) => {
      m.diffuseColor = new Color3(0.72, 0.58, 0.24);
      m.emissiveColor = new Color3(0.18, 0.14, 0.05);
      m.specularColor = new Color3(0.4, 0.35, 0.2);
    });

    const jitter = (Math.random() - 0.5) * 0.6;
    const velocity = right
      .scale(SHELL_EJECT_SPEED + jitter)
      .add(new Vector3(0, SHELL_EJECT_UP_SPEED, 0))
      .add(forward.scale(-0.5 - Math.random() * 0.4)); // kicks slightly backward, away from the direction fired

    this.activeShells.push({
      mesh: shell,
      velocity,
      angularVelocity: new Vector3(
        8 + Math.random() * 10,
        6 + Math.random() * 8,
        8 + Math.random() * 10
      ),
      landed: false,
      ageSinceLanded: 0,
    });
  }

  /** Falls each ejected shell under gravity, tumbles it, settles it on the ground, and cleans it up after a couple of seconds. Called every frame from update(). */
  private updateShells(dt: number) {
    if (this.activeShells.length === 0) return;
    const stillActive: ActiveShell[] = [];

    for (const shell of this.activeShells) {
      if (!shell.landed) {
        shell.velocity.y += SHELL_GRAVITY * dt;
        shell.mesh.position.addInPlace(shell.velocity.scale(dt));
        shell.mesh.rotation.x += shell.angularVelocity.x * dt;
        shell.mesh.rotation.y += shell.angularVelocity.y * dt;
        shell.mesh.rotation.z += shell.angularVelocity.z * dt;

        const groundY = sampleTerrainHeight(shell.mesh.position.x, shell.mesh.position.z);
        if (shell.mesh.position.y <= groundY + SHELL_GROUND_CLEARANCE) {
          shell.mesh.position.y = groundY + SHELL_GROUND_CLEARANCE;
          shell.landed = true;
          shell.velocity.setAll(0);
        }
      } else {
        shell.ageSinceLanded += dt;
        if (shell.ageSinceLanded >= SHELL_LIFETIME_AFTER_LAND) {
          shell.mesh.dispose();
          continue;
        }
      }
      stillActive.push(shell);
    }

    this.activeShells = stillActive;
  }

  update(dt: number) {
    // Last frame's ground pull-in is undone first, so zooming and aiming
    // work on the camera distance the player actually chose.
    this.camera.radius += this.groundPullIn;
    this.groundPullIn = 0;
    this.camera.lowerRadiusLimit = CAMERA_MIN_RADIUS;
    this.updateFrame(dt);
    if (!this.cameraOverride) this.applyCameraGroundClamp();
  }

  /** How much the ground pushed the camera in this frame (undone at the start of the next). */
  private groundPullIn = 0;
  /** A cutscene is driving the camera — no ground clamp. */
  private cameraOverride = false;

  /** While true (a cutscene), the camera is left entirely to whoever is driving it. */
  setCameraOverride(active: boolean) {
    this.cameraOverride = active;
  }

  /**
   * Keeps the camera above the ground. Swinging it low (looking up) would
   * otherwise sink it into the floor; instead, like GTA, it slides in
   * along its line toward the player, staying just above the ground —
   * so looking up from low down shows the player from near their feet.
   */
  private applyCameraGroundClamp() {
    const cosBeta = Math.cos(this.camera.beta);
    if (cosBeta >= 0) return; // camera above the look-at point — the ground can't be in the way
    const target = this.camera.target;
    const sinBeta = Math.sin(this.camera.beta);
    const cosAlpha = Math.cos(this.camera.alpha);
    const sinAlpha = Math.sin(this.camera.alpha);
    const desired = this.camera.radius;
    let radius = desired;
    // Twice: the ground height under the pulled-in camera can differ a little from under the far one.
    for (let i = 0; i < 2; i++) {
      const x = target.x + radius * cosAlpha * sinBeta;
      const z = target.z + radius * sinAlpha * sinBeta;
      const minY = sampleTerrainHeight(x, z) + CAMERA_GROUND_CLEARANCE;
      const y = target.y + radius * cosBeta;
      if (y >= minY) break;
      radius = Math.max(CAMERA_GROUND_MIN_RADIUS, (target.y - minY) / -cosBeta);
    }
    if (radius >= desired) return;
    this.groundPullIn = desired - radius;
    this.camera.lowerRadiusLimit = Math.min(CAMERA_MIN_RADIUS, radius); // or Babylon clamps it straight back out
    this.camera.radius = radius;
  }

  private updateFrame(dt: number) {
    // Undoes last frame's shake offset before anything else touches the
    // camera this frame — mouse-look sets camera.alpha/beta directly
    // from its own event listener (outside this update loop entirely),
    // so removing exactly what was added last frame, rather than
    // assuming some fixed base value, is what keeps the shake from
    // either accumulating drift or fighting the player's own look
    // input.
    this.camera.alpha -= this.shakeOffsetAlpha;
    this.camera.beta -= this.shakeOffsetBeta;

    // Safety net for actionAnimationPlaying — see ACTION_ANIMATION_MAX_HOLD's
    // own comment. Unconditional (not nested inside the melee-only block
    // below) since this flag also gates gun-firing, and needs to unstick
    // regardless of which weapon triggered it.
    if (this.actionAnimationPlaying) {
      this.actionAnimationElapsed += dt;
      if (this.actionAnimationElapsed > ACTION_ANIMATION_MAX_HOLD) {
        console.warn("actionAnimationPlaying held past its safety timeout — force-clearing. Same underlying cause as the meleeLockedFacing warning: the swing/shot's own onComplete callback never fired.");
        this.actionAnimationPlaying = false;
        this.actionAnimationElapsed = 0;
      }
    } else {
      this.actionAnimationElapsed = 0;
    }

    // Same safety-net pattern, for playingHeadHit — see
    // HEAD_HIT_MAX_HOLD's own comment for why a stuck-true value here
    // is a more serious failure than the other two flags' own stuck
    // states (permanent invulnerability, not just a frozen animation
    // or misdirected swing).
    if (this.playingHeadHit) {
      this.headHitElapsed += dt;
      if (this.headHitElapsed > HEAD_HIT_MAX_HOLD) {
        console.warn("playingHeadHit held past its safety timeout — force-clearing. Left unfixed, this would leave the player permanently unable to take damage.");
        this.playingHeadHit = false;
        this.headHitElapsed = 0;
      }
    } else {
      this.headHitElapsed = 0;
    }

    if (this.meleeRadiusMesh) {
      this.meleeRadiusMesh.position.x = this.mesh.position.x;
      this.meleeRadiusMesh.position.z = this.mesh.position.z;
      // The capsule's own position.y is its *center* (GROUND_OFFSET,
      // currently 1 unit, above the true floor) — using it directly
      // here was the actual bug behind the disc reading as floating at
      // roughly waist height rather than sitting on the ground under
      // the player's own feet. sampleTerrainHeight gives the real floor
      // height at this x/z, independent of the capsule's own vertical
      // offset from it.
      this.meleeRadiusMesh.position.y = sampleTerrainHeight(this.mesh.position.x, this.mesh.position.z) + 0.03;
      // Only visible with a melee weapon actually in hand — spec-
      // adjacent follow-up request, not shown constantly regardless of
      // what (if anything) is equipped.
      // Shown for melee weapons and bare fists (punches reach just as far) — not with a gun.
      this.meleeRadiusMesh.isVisible = !getGunConfig(this.equippedWeapon?.kind);
    }
    this.updateLockOnValidity();
    if (this.externalControl) {
      // A vehicle is driving: it places the body and plays its clips.
      // The camera still follows (and mouse look still turns it).
      this.velocity.set(0, 0, 0);
      this.shakeOffsetAlpha = 0;
      this.shakeOffsetBeta = 0;
      this.equippedWeapon?.root.setEnabled(false);
      this.followCameraTarget();
      this.character?.update(dt);
      return;
    }
    if (!this.inputEnabled || this.deathHandled) {
      // Paused (menu, dialogue, cutscene) or dead: no movement or
      // attacks, but the body still animates in place — idle, or the
      // death fall — and still settles onto the ground.
      this.velocity.set(0, 0, 0);
      this.shakeOffsetAlpha = 0;
      this.shakeOffsetBeta = 0;
      this.updateVerticalMotion(dt, false);
      this.followCameraTarget();
      this.updateCharacterVisual(dt, 0, 0);
      this.character?.setFacing(this.facingYaw); // e.g. through a cutscene, already facing the way play starts
      return;
    }

    // Movement is always relative to the camera's current facing (its
    // "alpha"), so "forward" is whatever direction the camera is looking
    // at that instant — this is what makes W consistently move toward the
    // top of the screen no matter how the camera has been turned. Note
    // this is about which world-direction W moves the character, not
    // which way the character's body faces — see the facing block below.
    const forward = new Vector3(-Math.cos(this.camera.alpha), 0, -Math.sin(this.camera.alpha));
    const right = new Vector3(forward.z, 0, -forward.x);

    // Two input sources: the on-screen joystick (analog — partial
    // deflection gives partial speed, exactly the vector's own magnitude
    // since forward/right are an orthonormal basis) or the keyboard
    // (digital — always full speed in whichever combination of directions
    // is held, normalized so diagonals aren't faster). Whichever the
    // player is actually using wins; they're never combined.
    this.sprintLockoutTimer = Math.max(0, this.sprintLockoutTimer - dt);
    this.updateReload(dt);
    // Sprinting needs stamina (cardio): it drains while sprinting and
    // refills otherwise; run it dry and you're exhausted until it's back
    // to EXHAUSTION_RECOVERED.
    const canSprint = this.sprintLockoutTimer <= 0 && !this.exhausted && this.stamina > 0;
    // Counts down only once a combo hit has actually finished (set in
    // attack()'s onComplete, not here) — reaching 0 means the follow-up
    // window has expired, so the next attack press starts the chain
    // over from the first hit rather than continuing it.
    if (this.meleeSwingRemaining > 0) {
      this.meleeSwingRemaining = Math.max(0, this.meleeSwingRemaining - dt);
      if (this.meleeSwingRemaining === 0) this.finishMeleeSwing();
    }
    if (this.comboWindowTimer > 0) {
      this.comboWindowTimer = Math.max(0, this.comboWindowTimer - dt);
      if (this.comboWindowTimer === 0) this.comboNextHitIndex = 0;
    }
    const joystickMagnitude = Math.hypot(this.virtualMove.x, this.virtualMove.z);
    let targetVelocity: Vector3;
    let localForwardAxis = 0; // -1..1, how much of the *input* points forward/backward (independent of speed)
    let localRightAxis = 0;
    if (joystickMagnitude > 0.05) {
      const wish = forward.scale(this.virtualMove.z).add(right.scale(this.virtualMove.x));
      this.sprinting = this.virtualSprint && canSprint;
      const speed = MOVE_SPEED * (this.sprinting ? SPRINT_MULTIPLIER : 1);
      targetVelocity = wish.scale(speed);
      localForwardAxis = this.virtualMove.z;
      localRightAxis = this.virtualMove.x;
    } else {
      let wish = Vector3.Zero();
      if (this.keys["w"] || this.keys["arrowup"]) { wish = wish.add(forward); localForwardAxis += 1; }
      if (this.keys["s"] || this.keys["arrowdown"]) { wish = wish.subtract(forward); localForwardAxis -= 1; }
      if (this.keys["d"] || this.keys["arrowright"]) { wish = wish.add(right); localRightAxis += 1; }
      if (this.keys["a"] || this.keys["arrowleft"]) { wish = wish.subtract(right); localRightAxis -= 1; }
      this.sprinting = !!this.keys["shift"] && canSprint && wish.length() > 0.001;
      const speed = MOVE_SPEED * (this.sprinting ? SPRINT_MULTIPLIER : 1);
      targetVelocity = wish.length() > 0.001 ? wish.normalize().scale(speed) : Vector3.Zero();
    }
    // Gun up (aiming, or just fired): running only straight ahead. Strafing
    // or backing up while shooting is a walk.
    const gunUp = !!getGunConfig(this.equippedWeapon?.kind) && (this.aiming || this.aimPoseHold > 0);
    const mostlyForward = localForwardAxis > 0.5 && Math.abs(localRightAxis) < 0.5;
    if (this.sprinting && gunUp && !mostlyForward) {
      this.sprinting = false;
      targetVelocity = targetVelocity.scale(1 / SPRINT_MULTIPLIER);
    }
    this.updateStamina(dt);

    // A melee swing or punch roots the player: no walking until the
    // animation has played out.
    if (this.meleeSwingRemaining > 0) {
      targetVelocity = Vector3.Zero();
      this.sprinting = false;
    }

    // Ease current velocity toward the target instead of snapping — this is
    // the "smoother" feel: quick taps don't jerk the character, and
    // stopping glides to a halt over a couple of frames.
    const accelT = Math.min(1, ACCEL * dt);
    this.velocity = Vector3.Lerp(this.velocity, targetVelocity, accelT);

    if (this.velocity.length() > 0.01) {
      this.mesh.moveWithCollisions(this.velocity.scale(dt));
    }

    // Facing behavior: with a gun equipped, the character faces the
    // camera direction — crosshair-style, WASD becomes pure strafing —
    // since aiming needs to track where the camera's actually pointed.
    // Otherwise (unarmed, sword, pickaxe) the character turns to face
    // wherever it's actually moving, like a standard third-person action
    // game: pushing left visibly turns the character to face left instead
    // of just sidestepping while still facing the camera. Either way the
    // camera itself is completely unaffected — it orbits freely on the
    // player's own mouse/touch input regardless of which way the body
    // faces.
    //
    // Exception: a melee swing in progress (meleeLockedFacing set in
    // attack()) skips all of this entirely — facing was already snapped
    // to the camera direction the instant the swing started and stays
    // exactly there for the swing's whole duration, regardless of
    // subsequent movement or camera turning. That's the actual "commits
    // to a direction" feel being asked for: without this, a strafe/turn
    // mid-swing would keep re-aiming the attack's own direction, the
    // same way isStrafing already continuously re-aims for guns.
    if (this.meleeLockedFacing !== null) {
      // Safety net — see MELEE_LOCKED_FACING_MAX_HOLD's own comment for
      // why this exists at all. Normal path: this stays at 0 because
      // attack()'s onComplete callback resets meleeLockedFacing (and
      // isn't reached from here again) well before dt could ever
      // accumulate this far.
      this.meleeLockedFacingElapsed += dt;
      if (this.meleeLockedFacingElapsed > MELEE_LOCKED_FACING_MAX_HOLD) {
        console.warn("meleeLockedFacing held past its safety timeout — force-clearing. This means the swing's own onComplete callback never fired (likely interrupted by another animation mid-swing); if this warning keeps appearing, that interruption is the thing to track down.");
        this.meleeLockedFacing = null;
        this.meleeLockedFacingElapsed = 0;
      } else {
        this.facingYaw = this.meleeLockedFacing;
      }
    } else {
      // GTA-style gun movement: aiming, shooting or walking, the body faces
      // the crosshair and strafes; sprinting (without aiming/shooting) it
      // turns and runs the way it's going, gun in hand — instead of
      // sliding sideways in a walk-speed strafe at sprint speed.
      const hasGun = !!getGunConfig(this.equippedWeapon?.kind);
      this.gunSprinting = hasGun && this.sprinting && !this.aiming && this.aimPoseHold <= 0;
      const isStrafing = hasGun && !this.gunSprinting;
      if (isStrafing) {
        // Eased rather than snapped, so leaving a sprint swings the body back round to the crosshair smoothly.
        let delta = Math.atan2(forward.x, forward.z) - this.facingYaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        this.facingYaw += delta * Math.min(1, dt * GUN_FACE_TURN_RATE);
      } else if (this.velocity.length() > 0.05) {
        const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
        let delta = targetYaw - this.facingYaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // wrap to [-PI, PI] so it always turns the short way
        this.facingYaw += delta * Math.min(1, dt * FACING_TURN_RATE);
      }
      // else: standing still and not strafing — hold the last facing
      // rather than snapping back to the camera direction.
    }
    this.mesh.rotation.y = this.facingYaw;
    this.character?.setFacing(this.facingYaw);

    this.updateVerticalMotion(dt);
    this.followCameraTarget();
    this.updateCharacterVisual(dt, localForwardAxis, localRightAxis);
    // After updateCharacterVisual (which just ran character.update(dt),
    // so the hand bone's pose for this frame is already resolved) and
    // gated on not being mid-swing — see orientMeleeWeaponUp's own
    // comment for why a melee weapon needs this every frame rather than
    // a fixed rotation set once at equip time.
    if (!this.actionAnimationPlaying && this.meleeSwingRemaining <= 0) this.orientMeleeWeaponUp();
    this.updateWeaponInput(dt);
    this.aimPoseHold = Math.max(0, this.aimPoseHold - dt);
    this.armRecoil *= Math.exp(-ARM_RECOIL_RECOVERY * dt);
    this.updateGunArms();
    this.updateBullets(dt);
    this.updateShells(dt);

    // New offset for *next* frame's undo step above — computed and
    // applied last, after every other camera-affecting thing this
    // frame (mouse-look's own listener runs independently of this
    // method, so there's nothing later in this same frame to conflict
    // with).
    if (this.shakeTimeRemaining > 0) {
      this.shakeTimeRemaining = Math.max(0, this.shakeTimeRemaining - dt);
      const strength = (this.shakeTimeRemaining / HIT_SHAKE_DURATION) * HIT_SHAKE_MAGNITUDE;
      this.shakeOffsetAlpha = (Math.random() - 0.5) * 2 * strength;
      this.shakeOffsetBeta = (Math.random() - 0.5) * 2 * strength;
    } else {
      this.shakeOffsetAlpha = 0;
      this.shakeOffsetBeta = 0;
    }
    this.camera.alpha += this.shakeOffsetAlpha;
    this.camera.beta += this.shakeOffsetBeta;
  }

  /**
   * F attacks/fires and R toggles aim (the left/right mouse buttons do the
   * same: left click fires, holding right click aims); G reloads. Attacks
   * are edge-triggered — one action per press.
   */
  private updateStamina(dt: number) {
    const max = this.progression?.getSprintSeconds() ?? sprintSecondsForCardio(statForLevel(1));
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt);
      if (this.stamina === 0) this.exhausted = true;
    } else {
      // Refills over ~4s from empty whenever you're not actually sprinting.
      this.stamina = Math.min(max, this.stamina + (max / 4) * dt);
    }
    if (this.exhausted && this.stamina >= max * EXHAUSTION_RECOVERED) this.exhausted = false;
    if (this.stamina > max) this.stamina = max; // cardio buff ended
  }

  private updateWeaponInput(dt: number) {
    const attackDown = this.attackHeld || !!this.keys["f"];
    if (attackDown && !this.prevAttackHeld) {
      this.attack();
    }
    this.prevAttackHeld = attackDown;

    const aimKey = !!this.keys["r"];
    if (aimKey && !this.prevAimKey) this.aimToggled = !this.aimToggled;
    this.prevAimKey = aimKey;

    const reloadKey = !!this.keys["g"];
    if (reloadKey && !this.prevReloadKey) this.startReload();
    this.prevReloadKey = reloadKey;

    const wantAim = (this.aimHeld || this.aimToggled) && !!getGunConfig(this.equippedWeapon?.kind);
    if (wantAim !== this.aiming) this.setAiming(wantAim);

    if (this.aiming) {
      this.camera.radius += (AIM_CAMERA_RADIUS - this.camera.radius) * Math.min(1, dt * AIM_RADIUS_EASE_RATE);
    } else if (this.preAimRadius !== null) {
      this.camera.radius += (this.preAimRadius - this.camera.radius) * Math.min(1, dt * AIM_RADIUS_EASE_RATE);
      if (Math.abs(this.camera.radius - this.preAimRadius) < 0.05) this.preAimRadius = null;
    }
  }

  /**
   * Keeps the visible character rig tracking the (invisible) collision
   * capsule, and picks which of the ninja's animation clips should be
   * playing right now — based on equipped weapon, movement speed, and
   * which direction (relative to facing) the player is actually moving.
   * `localForwardAxis`/`localRightAxis` are the raw -1..1 input axes (not
   * world-space velocity), so a light joystick push still correctly picks
   * a walk (not run) animation regardless of how movement easing has
   * smoothed the actual velocity.
   */
  private updateCharacterVisual(dt: number, localForwardAxis: number, localRightAxis: number) {
    if (!this.character) return;
    this.character.position.x = this.mesh.position.x;
    this.character.position.y = this.mesh.position.y + CHARACTER_Y_OFFSET;
    this.character.position.z = this.mesh.position.z;
    this.character.update(dt);
    if (this.deathHandled) return; // the death fall plays out and holds

    // A one-shot attack/fire or hit-reaction animation is playing itself
    // out — don't let the movement picker below interrupt it; it'll resume
    // control via the onComplete callback passed to play() when the clip
    // actually finishes. headHit was missing from this check, so the
    // picker replaced it with idle/walk on the very next frame — no
    // speedRatio could make it visible while that was happening.
    if (this.playingHeadHit) {
      // Moving (or jumping) after a brief minimum ends the hit reaction
      // early so the walk/run comes straight back, instead of the player
      // sliding along stuck in the flinch for its full length.
      const wantsToMove = Math.abs(localForwardAxis) > 0.05 || Math.abs(localRightAxis) > 0.05 || this.jumping;
      if (wantsToMove && this.headHitElapsed >= HEAD_HIT_MIN_SECONDS) {
        this.playingHeadHit = false;
        this.headHitElapsed = 0;
      } else {
        return;
      }
    }
    // A full-body swing or punch is playing — let it finish.
    if (this.actionAnimationPlaying || this.meleeSwingRemaining > 0) return;

    const speed = this.velocity.length();
    const moving = speed > MOVE_ANIM_THRESHOLD;
    const sprinting = moving && this.sprinting;
    const weaponKind = this.equippedWeapon?.kind ?? null;

    if (this.jumping) {
      if (!this.airborneAnimation) {
        // Just left the ground this frame — decide the jump animation
        // once, from input at the moment of takeoff, and keep playing
        // it for the whole time airborne regardless of how input
        // changes mid-air. Like GTA: you can still redirect your actual
        // movement in the air (unaffected by this — see velocity/
        // moveWithCollisions in update()), the jump animation itself
        // just doesn't restart or switch mid-flight.
        this.airborneAnimation =
          Math.abs(localForwardAxis) < DIRECTION_DEADZONE
            ? "jumping"
            : localForwardAxis > 0
              ? "jumpingForward"
              : "jumpingBackward";
      }
      this.character.play(this.airborneAnimation);
      return;
    }
    this.airborneAnimation = null; // landed — clear so the next jump picks fresh

    if (weaponKind === "gun") {
      // Gun-equipped: body faces the camera (see update()), so this stays
      // camera-relative strafing exactly as before. Standing still now
      // distinguishes a dedicated held-up aiming pose from the more
      // relaxed idle-with-pistol stance. Reverted back to plain
      // strafe-left/right for sideways movement (both walk and sprint) —
      // the "arc turn" variants tried previously bake an actual turning
      // motion into the hip/leg bones, which visibly fights a root
      // that's forced to face the camera every frame: removeRootMotion()
      // only strips *position* channels, not rotation, so the arc clip's
      // own baked rotation was fighting setFacing()'s lock, reading as
      // "the character (capsule) moves sideways but the sprite doesn't."
      // A strafe animation is built for exactly this locked-facing,
      // lateral-translation case, which is why reverting to it is the
      // actual fix rather than a workaround.
      if (!moving) {
        // Aiming or just fired: the full aiming pose, not the relaxed idle.
        this.character.play(this.aiming || this.aimPoseHold > 0 ? "pistolAiming" : "pistolIdle");
      } else if (this.gunSprinting) {
        // Body already faces the way it's running (see update()), so this is always a forward run.
        this.character.play("pistolRun");
      } else if (Math.abs(localForwardAxis) >= Math.abs(localRightAxis)) {
        if (localForwardAxis >= 0) {
          this.character.play(sprinting ? "pistolRun" : "pistolStrafeForward");
        } else {
          this.character.play("pistolStrafeBackward");
        }
      } else {
        this.character.play(localRightAxis >= 0 ? "pistolStrafeRight" : "pistolStrafeLeft");
      }
    } else if (weaponKind === "sword" || weaponKind === "pickaxe") {
      // Reuses the exact same idle/walk/run clips the unarmed case uses
      // below — melee-equipped movement is meant to look identical to
      // unarmed movement now, no separate melee-walk pose, per request.
      // (meleeIdle/meleeForward/meleeBackward were dropped from
      // SkeletalCharacter.ts's animation set entirely, not just unused
      // here.)
      if (!moving) this.character.play("idle");
      else this.character.play(sprinting ? "running" : "walkForward");
    } else {
      if (!moving) this.character.play("idle");
      else this.character.play(sprinting ? "running" : "walkForward");
    }
  }

  private updateVerticalMotion(dt: number, canJump = true) {
    const groundY = sampleTerrainHeight(this.mesh.position.x, this.mesh.position.z) + GROUND_OFFSET;

    if (this.jumping) {
      this.velocityY += GRAVITY * dt;
      this.mesh.position.y += this.velocityY * dt;
      if (this.mesh.position.y <= groundY) {
        this.mesh.position.y = groundY;
        this.velocityY = 0;
        this.jumping = false;
        this.character?.playLandSquash(); // the "juice" that makes a landing actually read as an impact
      }
      return;
    }

    if (canJump && this.keys[" "]) {
      this.jumping = true;
      this.velocityY = JUMP_SPEED;
      return;
    }

    // Smoothly follow terrain height rather than snapping — keeps slopes
    // and rolling hills from causing visible pops.
    const t = Math.min(1, TERRAIN_FOLLOW_SPEED * dt);
    this.mesh.position.y = this.mesh.position.y + (groundY - this.mesh.position.y) * t;
  }
}