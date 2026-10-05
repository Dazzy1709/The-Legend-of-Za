// src/babylon/vehicles/Budmobile.ts
// The Budmobile: a giant weed bud the player rides through the air, the
// way Goku rides the Flying Nimbus in Dragon Ball. Parked, it floats just
// above the ground, bobbing gently like a GTA pickup, with its name over
// it. Ridden, the player stands on it in a hovering pose and the controls
// fly it: move where the camera looks, Space to climb, C/Ctrl to sink,
// Shift to boost — with eased speed, banking into turns and a trail. It
// can't fly through buildings (it can fly over them), and it stays
// wherever it's left.
//
// Hopping on and off: the clips' own root motion is locked (see
// SkeletalCharacter.removeRootMotion), so the jump arc is drawn here —
// the body is moved along a curve while the clip plays the pose.

import {
  AbstractMesh,
  AssetContainer,
  Color3,
  Color4,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  Ray,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { HoverVehicleDef } from "../../content/vehicles/vehicles";
import { VEHICLES_FOLDER } from "../../content/assetPaths";
import type { WorldPosition } from "../../types";
import type { EventBridge } from "../core/EventBridge";
import type { PlayerController } from "../player/PlayerController";
import { MAP_RADIUS, sampleTerrainHeight } from "../world/TerrainBuilder";

export type RideState = "parked" | "mounting" | "riding" | "dismounting";

/** How fast velocity eases toward what the controls ask for (per second) — low is floaty, high is twitchy. */
const STEER_RESPONSE = 2.6;
/** Easing when letting go of the controls: it glides to a stop. */
const GLIDE_RESPONSE = 1.5;
const CLIMB_RESPONSE = 3.5;
/** How fast the nose swings round to the direction of travel. */
const TURN_RATE = 3.2;
/** Lean into turns and into speed changes (radians at most). */
const MAX_BANK = 0.5;
const MAX_PITCH = 0.3;
const LEAN_RESPONSE = 4;
/** Parked: the slow GTA-pickup bob. Riding: a much subtler one. */
const PARKED_BOB = 0.12;
const RIDING_BOB = 0.05;
/** Parked, it floats this much higher than its lowest hover. */
const PARKED_LIFT = 0.15;
/** Can only hop off this close to its lowest hover, and this slow. */
const DISMOUNT_MAX_ALTITUDE = 0.3;
const DISMOUNT_MAX_SPEED = 2.5;
/** How close the player must be (to its middle) to hop on. */
export const BUDMOBILE_INTERACT_RADIUS = 3.4;
/** Space the rider takes up above the body, for collisions (so the rider can't pass through overhangs either). */
const RIDER_HEIGHT = 1.8;
/** Camera distance while riding — further out, to see where you're flying. */
const RIDE_CAMERA_RADIUS = 11;
/** Clip speeds and shapes of the hop on/off. */
const MOUNT_SPEED = 1;
const DISMOUNT_SPEED = 1.35;
/** How high the hop on/off arcs above a straight line between start and end. */
const MOUNT_ARC = 0.7;
const DISMOUNT_ARC = 0.5;
/**
 * Each clip holds the feet at its own height over the character's anchor
 * (root motion is stripped, so the hips stay where the clip's first frame
 * has them). Rather than guessing those heights, the rider's toes are
 * read from the posed skeleton and kept on whatever they stand on — the
 * bud's top while riding, and during a hop clip whenever the feet are
 * planted (before take-off, after landing). In the air the clip's own
 * leg motion (the tuck of a jump) is left alone.
 */
const TOE_BONES = ["mixamorig:LeftToeBase", "mixamorig:RightToeBase"];
/** The top surface is a touch higher where the feet stand (either side of the centre line the seat is measured on). */
const FEET_ON_TOP_LIFT = 0.11;
/** The toe bone sits a little above the sole. */
const FEET_ON_GROUND_LIFT = 0.04;
/** Parts of each hop clip (share of its length) where the feet are planted: before take-off, after landing. */
const MOUNT_PLANTED = { takeOff: 0.1, landed: 0.85 };
const DISMOUNT_PLANTED = { takeOff: 0.18, landed: 0.62 };
/** Sanity limit on the feet height read from a pose (m). */
const MAX_FEET_CORRECTION = 2;
/** How quickly the rider settles from one clip's foot height to the next. */
const RIDER_SETTLE_RATE = 10;
/** Where the rider stands along the bud, as a share of its length from the nose — on the fat front part. */
const SEAT_FROM_NOSE = 0.38;
/** How far in front of the nose the rider lands when hopping off. */
const DISMOUNT_CLEARANCE = 1.1;

/**
 * One loaded copy of each vehicle model per scene. Every vehicle of that
 * kind is a copy that shares its geometry, textures and material — so a
 * second (or tenth) Budmobile costs a draw call, not another download and
 * another set of GPU buffers.
 */
const modelCache = new WeakMap<Scene, Map<string, Promise<AssetContainer>>>();

function loadVehicleModel(scene: Scene, def: HoverVehicleDef): Promise<AssetContainer> {
  let perScene = modelCache.get(scene);
  if (!perScene) {
    perScene = new Map();
    modelCache.set(scene, perScene);
  }
  let promise = perScene.get(def.id);
  if (!promise) {
    promise = SceneLoader.LoadAssetContainerAsync(`${VEHICLES_FOLDER}${def.folder}/`, def.modelFile, scene);
    perScene.set(def.id, promise);
  }
  return promise;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** Shortest signed angle from a to b. */
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class Budmobile {
  readonly def: HoverVehicleDef;
  /** Its parking spot (beside the safe house) — where it goes back to when the player dies. */
  private readonly home: WorldPosition & { yaw: number };
  private readonly root: TransformNode;
  private readonly bob: TransformNode;
  private readonly collider: Mesh;
  private readonly label: Mesh;
  private readonly blobShadow: Mesh;
  private readonly trail: ParticleSystem;
  private modelMeshes: AbstractMesh[] = [];

  /** The middle of its underside. */
  private readonly position: Vector3;
  private readonly velocity = Vector3.Zero();
  private yaw: number;
  private pitch = 0;
  private roll = 0;
  private bobPhase = 0;
  private state: RideState = "parked";
  private canDismountNow = false;

  /** Body size once scaled (until the model loads, the planned size). */
  private bodyWidth: number;
  private bodyHeight: number;
  /** Where the rider's feet go, in the vehicle's own space. */
  private readonly seatLocal: Vector3;

  /** Hop on/off progress. */
  private transition: { elapsed: number; duration: number; from: Vector3; to: Vector3; fromYaw: number; toYaw: number } | null = null;
  private cameraRadiusBeforeRide = 8;
  /** Rider anchor height relative to their feet — eased between the clips' foot heights. */
  private riderOffset = 0;
  private cameraTween: { from: number; to: number; elapsed: number; duration: number } | null = null;

  constructor(
    private scene: Scene,
    def: HoverVehicleDef,
    parking: WorldPosition & { yaw: number },
    private player: PlayerController,
    private bridge: EventBridge,
    /** Called with true while hopping on/off (player input is held off) and false after. */
    private onSequence: (running: boolean) => void
  ) {
    this.def = def;
    this.yaw = parking.yaw;
    this.home = { ...parking };
    this.bodyWidth = def.length * 0.62;
    this.bodyHeight = this.bodyWidth * def.heightScale;
    this.seatLocal = new Vector3(0, this.bodyHeight * 0.9, def.length * (0.5 - SEAT_FROM_NOSE));
    const groundY = sampleTerrainHeight(parking.x, parking.z);
    this.position = new Vector3(parking.x, groundY + def.hoverHeight + PARKED_LIFT, parking.z);

    this.root = new TransformNode(`${def.id}-root`, scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.bob = new TransformNode(`${def.id}-bob`, scene);
    this.bob.parent = this.root;

    // Collisions: the box blocks people walking into it; its ellipsoid
    // (body plus rider, kept upright) is what flies into walls.
    this.collider = MeshBuilder.CreateBox(`${def.id}-collider`, { width: this.bodyWidth * 0.8, height: this.bodyHeight, depth: def.length * 0.85 }, scene);
    this.collider.bakeTransformIntoVertices(Matrix.Translation(0, this.bodyHeight / 2, 0));
    this.collider.isVisible = false;
    this.collider.isPickable = false;
    this.collider.checkCollisions = true;
    const halfHeight = (this.bodyHeight + RIDER_HEIGHT) / 2;
    this.collider.ellipsoid = new Vector3(Math.min(1.3, this.bodyWidth * 0.6), halfHeight, Math.min(1.3, this.bodyWidth * 0.6));
    this.collider.ellipsoidOffset = new Vector3(0, halfHeight, 0);

    this.label = this.createLabel();
    this.blobShadow = this.createBlobShadow();
    this.trail = this.createTrail();
    void this.loadModel();
    this.applyTransform();
  }

  // ---------- Queries ----------

  getState(): RideState {
    return this.state;
  }

  /** Someone is on it (or hopping on/off). */
  hasRider(): boolean {
    return this.state !== "parked";
  }

  isParked(): boolean {
    return this.state === "parked";
  }

  /** Its middle at ground level — for the interact prompt and the minimap. */
  getPosition(): Vector3 {
    return this.position;
  }

  // ---------- Hopping on and off ----------

  /** The player hops on: the mount clip plays while they jump onto the seat. */
  mount() {
    if (this.state !== "parked" || this.player.isDead()) return;
    const character = this.player.getCharacter();
    this.setState("mounting");
    this.onSequence(true);
    this.player.setExternalControl(true);
    const from = this.player.getPosition().add(new Vector3(0, -0.89, 0));
    const toward = this.seatWorld().subtract(from);
    const duration = this.clipSeconds("budMount") / MOUNT_SPEED;
    this.transition = {
      elapsed: 0,
      duration,
      from,
      to: this.seatWorld(),
      fromYaw: Math.atan2(toward.x, toward.z),
      toYaw: this.yaw,
    };
    character?.play("budMount", false, undefined, MOUNT_SPEED);
    this.cameraRadiusBeforeRide = this.player.camera.radius;
    this.cameraTween = { from: this.player.camera.radius, to: Math.max(RIDE_CAMERA_RADIUS, this.player.camera.radius), elapsed: 0, duration: duration + 0.6 };
  }

  /** E while riding: hops off to the front — only once it's down at its lowest hover and (nearly) still. */
  tryDismount(): boolean {
    if (this.state !== "riding" || !this.canDismountNow) return false;
    this.velocity.setAll(0);
    this.setState("dismounting");
    this.onSequence(true);
    const duration = this.clipSeconds("budDismount") / DISMOUNT_SPEED;
    const from = this.seatWorld();
    const to = this.landingSpot();
    const hopYaw = Math.atan2(to.x - from.x, to.z - from.z); // the nose, unless a wall sent them out a side
    this.transition = { elapsed: 0, duration, from, to, fromYaw: this.yaw, toYaw: hopYaw };
    this.player.getCharacter()?.play("budDismount", false, undefined, DISMOUNT_SPEED);
    this.cameraTween = { from: this.player.camera.radius, to: this.cameraRadiusBeforeRide, elapsed: 0, duration };
    return true;
  }

  /** Off at once, no animation — e.g. the rider was killed. They end up on the ground in front. */
  forceDismount() {
    if (this.state === "parked") return;
    const landing = this.landingSpot();
    this.transition = null;
    this.player.getPosition().copyFrom(landing.add(new Vector3(0, 0.89, 0)));
    this.player.setFacingYaw(Math.atan2(landing.x - this.position.x, landing.z - this.position.z));
    this.player.setExternalControl(false);
    this.endRide();
  }

  /** Back to its parking spot, parked — after the player dies and respawns. */
  returnHome() {
    if (this.state !== "parked") this.forceDismount();
    const groundY = sampleTerrainHeight(this.home.x, this.home.z);
    this.position.set(this.home.x, groundY + this.def.hoverHeight + PARKED_LIFT, this.home.z);
    this.velocity.setAll(0);
    this.yaw = this.home.yaw;
    this.pitch = 0;
    this.roll = 0;
    this.applyTransform();
  }

  private endRide() {
    this.velocity.setAll(0);
    this.setState("parked");
    this.onSequence(false);
  }

  // ---------- Per frame ----------

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    this.bobPhase += dt;
    switch (this.state) {
      case "parked":
        this.updateParked(dt);
        break;
      case "riding":
        this.updateFlight(dt);
        break;
      case "mounting":
      case "dismounting":
        this.settle(dt, PARKED_LIFT * 0.5);
        break;
    }
    this.applyTransform();
    this.updateRider(dt);
    this.updateEffects();
    this.updateCameraTween(dt);
  }

  private updateParked(dt: number) {
    this.settle(dt, PARKED_LIFT);
    // Ease out of any lean left from flying.
    this.pitch += (0 - this.pitch) * Math.min(1, dt * LEAN_RESPONSE);
    this.roll += (0 - this.roll) * Math.min(1, dt * LEAN_RESPONSE);
  }

  /**
   * Drifts down (or up) to float `lift` above its lowest hover. Straight
   * up and down over open ground, so no collision checks are needed here
   * — only flying pays for those.
   */
  private settle(dt: number, lift: number) {
    const targetY = sampleTerrainHeight(this.position.x, this.position.z) + this.def.hoverHeight + lift;
    this.position.y += (targetY - this.position.y) * Math.min(1, dt * 2.5);
  }

  private updateFlight(dt: number) {
    const input = this.player.getFlightInput();
    const speed = input.boost ? this.def.boostSpeed : this.def.cruiseSpeed;
    const wishX = input.x * speed;
    const wishZ = input.z * speed;
    const wishY = (input.up ? 1 : 0) * this.def.climbSpeed - (input.down ? 1 : 0) * this.def.climbSpeed;
    const steering = Math.hypot(input.x, input.z) > 0.05;

    const prevForwardSpeed = this.forwardSpeed();
    const horizontalEase = 1 - Math.exp(-(steering ? STEER_RESPONSE : GLIDE_RESPONSE) * dt);
    this.velocity.x += (wishX - this.velocity.x) * horizontalEase;
    this.velocity.z += (wishZ - this.velocity.z) * horizontalEase;
    this.velocity.y += (wishY - this.velocity.y) * (1 - Math.exp(-CLIMB_RESPONSE * dt));

    const before = this.position.clone();
    this.moveBy(this.velocity.scale(dt));
    // Hitting a wall or a roof takes the speed out of that direction, so it slides along instead of grinding.
    const moved = this.position.subtract(before);
    if (dt > 0) {
      const actual = moved.scale(1 / dt);
      if (Math.abs(actual.x) < Math.abs(this.velocity.x) * 0.5) this.velocity.x = actual.x;
      if (Math.abs(actual.z) < Math.abs(this.velocity.z) * 0.5) this.velocity.z = actual.z;
      if (Math.abs(actual.y) < Math.abs(this.velocity.y) * 0.5) this.velocity.y = actual.y;
    }

    // Altitude band: never below its hover, never above the ceiling, never off the map.
    const groundY = sampleTerrainHeight(this.position.x, this.position.z);
    const minY = groundY + this.def.hoverHeight;
    if (this.position.y < minY) {
      this.position.y = minY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
    if (this.position.y > groundY + this.def.maxAltitude) {
      this.position.y = groundY + this.def.maxAltitude;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
    const fromCenter = Math.hypot(this.position.x, this.position.z);
    const edge = MAP_RADIUS - 15;
    if (fromCenter > edge) {
      this.position.x *= edge / fromCenter;
      this.position.z *= edge / fromCenter;
    }
    this.collider.position.copyFrom(this.position);

    // Nose swings round to where it's going; it banks into the turn and
    // dips its nose when speeding up or diving.
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let yawRate = 0;
    if (horizontalSpeed > 1) {
      const turn = angleDelta(this.yaw, Math.atan2(this.velocity.x, this.velocity.z)) * Math.min(1, dt * TURN_RATE);
      this.yaw += turn;
      yawRate = dt > 0 ? turn / dt : 0;
    }
    const accel = dt > 0 ? (this.forwardSpeed() - prevForwardSpeed) / dt : 0;
    const bankTarget = Math.max(-MAX_BANK, Math.min(MAX_BANK, -yawRate * 0.22 * Math.min(1, horizontalSpeed / 8)));
    const pitchTarget = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, accel * 0.025 - this.velocity.y * 0.03));
    const lean = Math.min(1, dt * LEAN_RESPONSE);
    this.roll += (bankTarget - this.roll) * lean;
    this.pitch += (pitchTarget - this.pitch) * lean;

    const altitude = this.position.y - minY;
    const canDismount = altitude <= DISMOUNT_MAX_ALTITUDE && horizontalSpeed < DISMOUNT_MAX_SPEED && Math.abs(this.velocity.y) < 1;
    if (canDismount !== this.canDismountNow) {
      this.canDismountNow = canDismount;
      this.emitRide();
    }
  }

  /** Moves with collisions against buildings, walls and props. */
  private moveBy(delta: Vector3) {
    this.collider.position.copyFrom(this.position);
    this.collider.computeWorldMatrix(true);
    this.collider.moveWithCollisions(delta);
    this.position.copyFrom(this.collider.position);
  }

  private forwardSpeed(): number {
    return this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
  }

  private applyTransform() {
    this.root.position.copyFrom(this.position);
    Quaternion.FromEulerAnglesToRef(this.pitch, this.yaw, this.roll, this.root.rotationQuaternion!);
    const bobSize = this.state === "parked" ? PARKED_BOB : RIDING_BOB;
    this.bob.position.y = Math.sin(this.bobPhase * 1.8) * bobSize;
    // A slow sway while parked, like a floating pickup.
    this.bob.rotation.z = this.state === "parked" ? Math.sin(this.bobPhase * 1.1) * 0.035 : 0;
    this.collider.position.copyFrom(this.position);
    this.collider.rotation.y = this.yaw;
    this.root.computeWorldMatrix(true);
    this.bob.computeWorldMatrix(true);
  }

  /** The rider's feet, in the world. */
  private seatWorld(): Vector3 {
    this.bob.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(this.seatLocal, this.bob.getWorldMatrix());
  }

  /**
   * On the ground just past the nose. If a wall is in the way there, the
   * rider hops off to a side instead (or, failing that, the back) — never
   * into a building.
   */
  private landingSpot(): Vector3 {
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(forward.z, 0, -forward.x);
    const options: { dir: Vector3; distance: number }[] = [
      { dir: forward, distance: this.def.length / 2 + DISMOUNT_CLEARANCE },
      { dir: right, distance: this.bodyWidth / 2 + DISMOUNT_CLEARANCE },
      { dir: right.scale(-1), distance: this.bodyWidth / 2 + DISMOUNT_CLEARANCE },
      { dir: forward.scale(-1), distance: this.def.length / 2 + DISMOUNT_CLEARANCE },
    ];
    const origin = this.position.add(new Vector3(0, this.bodyHeight + 0.6, 0));
    const blocked = (dir: Vector3, distance: number) => {
      const hit = this.scene.pickWithRay(new Ray(origin, dir, distance + 0.5), (m) => m.checkCollisions && m !== this.collider);
      return !!hit?.hit;
    };
    const choice = options.find((o) => !blocked(o.dir, o.distance)) ?? options[0];
    const x = this.position.x + choice.dir.x * choice.distance;
    const z = this.position.z + choice.dir.z * choice.distance;
    return new Vector3(x, sampleTerrainHeight(x, z), z);
  }

  /** Places and poses the rider: hopping on, riding, or hopping off. */
  private updateRider(dt: number) {
    const character = this.player.getCharacter();
    const capsule = this.player.getPosition();
    if (this.state === "riding") {
      const feet = this.seatWorld();
      capsule.copyFrom(feet.add(new Vector3(0, 0.89, 0)));
      const feetHeight = this.feetAboveAnchor();
      if (feetHeight !== null) this.riderOffset += (FEET_ON_TOP_LIFT - feetHeight - this.riderOffset) * Math.min(1, dt * RIDER_SETTLE_RATE);
      character?.position.copyFrom(feet.add(new Vector3(0, this.riderOffset, 0)));
      character?.setOrientation(this.yaw, this.pitch, this.roll);
      return;
    }
    if (!this.transition || (this.state !== "mounting" && this.state !== "dismounting")) return;

    const tr = this.transition;
    tr.elapsed += dt;
    const t = clamp01(tr.elapsed / tr.duration);
    const planted = this.state === "mounting" ? MOUNT_PLANTED : DISMOUNT_PLANTED;
    if (t < planted.takeOff || t > planted.landed) {
      // Feet on something: on the bud at the start of hopping off and the
      // end of hopping on, on the ground otherwise.
      const onBud = (this.state === "mounting") === t > planted.landed;
      const feetHeight = this.feetAboveAnchor();
      const lift = onBud ? FEET_ON_TOP_LIFT : FEET_ON_GROUND_LIFT;
      if (feetHeight !== null) this.riderOffset += (lift - feetHeight - this.riderOffset) * Math.min(1, dt * RIDER_SETTLE_RATE * 1.5);
    }
    let feet: Vector3;
    let path: Vector3; // the straight line, without the arc and clip offsets — where the capsule (and camera) follow
    if (this.state === "mounting") {
      // The seat moves with the bob — keep aiming at it.
      tr.to = this.seatWorld();
      const k = smooth(t);
      path = Vector3.Lerp(tr.from, tr.to, k);
      feet = path.add(new Vector3(0, Math.sin(Math.PI * t) * MOUNT_ARC, 0));
    } else {
      // The hop-off clip pushes off about a fifth of the way in and lands a bit past halfway.
      const k = smooth(clamp01((t - 0.18) / 0.4));
      path = Vector3.Lerp(tr.from, tr.to, k);
      feet = path.add(new Vector3(0, Math.sin(Math.PI * k) * DISMOUNT_ARC, 0));
    }
    const yaw = tr.fromYaw + angleDelta(tr.fromYaw, tr.toYaw) * smooth(clamp01(t * 1.4));
    character?.position.copyFrom(feet.add(new Vector3(0, this.riderOffset, 0)));
    character?.setOrientation(yaw, 0, 0);
    capsule.copyFrom(path.add(new Vector3(0, 0.89, 0)));

    if (t >= 1) {
      this.transition = null;
      if (this.state === "mounting") {
        this.setState("riding");
        this.canDismountNow = false;
        character?.play("budHover", true);
        this.onSequence(false);
      } else {
        capsule.copyFrom(tr.to.add(new Vector3(0, 0.89, 0)));
        this.player.setFacingYaw(tr.toYaw);
        this.player.setExternalControl(false);
        this.endRide();
      }
    }
  }

  /** How high the rider's lowest toe is above their anchor, in the pose last shown. */
  private feetAboveAnchor(): number | null {
    const character = this.player.getCharacter();
    if (!character) return null;
    let lowest = Infinity;
    for (const name of TOE_BONES) {
      const bone = character.getBoneNode(name);
      if (bone) lowest = Math.min(lowest, bone.getAbsolutePosition().y);
    }
    if (!Number.isFinite(lowest)) return null;
    // Against the anchor as of that same drawn pose (not the position just
    // set this frame) — otherwise a frame that isn't drawn would feed the
    // correction back into itself.
    const height = lowest - character.root.getAbsolutePosition().y;
    return Math.max(-MAX_FEET_CORRECTION, Math.min(MAX_FEET_CORRECTION, height));
  }

  private updateCameraTween(dt: number) {
    if (!this.cameraTween) return;
    const tw = this.cameraTween;
    tw.elapsed += dt;
    const t = smooth(clamp01(tw.elapsed / tw.duration));
    this.player.camera.radius = tw.from + (tw.to - tw.from) * t;
    if (tw.elapsed >= tw.duration) this.cameraTween = null;
  }

  private updateEffects() {
    const groundY = sampleTerrainHeight(this.position.x, this.position.z);
    const altitude = Math.max(0, this.position.y - groundY);
    // The blob shadow shrinks and fades the higher it flies.
    this.blobShadow.position.set(this.position.x, groundY + 0.04, this.position.z);
    this.blobShadow.rotation.y = this.yaw;
    const fade = Math.max(0, 1 - altitude / 25);
    this.blobShadow.visibility = 0.55 * fade;
    const s = 1 - Math.min(0.5, altitude / 40);
    this.blobShadow.scaling.set(s, s, s);

    this.label.position.set(this.position.x, this.position.y + this.bob.position.y + this.bodyHeight + 0.9, this.position.z);
    this.label.isVisible = this.state === "parked";

    // Trail from the tail, stronger the faster it goes.
    const speed = this.velocity.length();
    const tail = Vector3.TransformCoordinates(new Vector3(0, this.bodyHeight * 0.45, -this.def.length * 0.5), this.bob.getWorldMatrix());
    (this.trail.emitter as Vector3).copyFrom(tail);
    this.trail.emitRate = this.state === "riding" ? Math.min(260, speed * 11) : 0;
    const back = this.velocity.length() > 0.1 ? this.velocity.normalizeToNew().scale(-1) : new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.trail.direction1 = back.add(new Vector3(-0.25, -0.1, -0.25));
    this.trail.direction2 = back.add(new Vector3(0.25, 0.25, 0.25));
  }

  private setState(state: RideState) {
    this.state = state;
    this.emitRide();
  }

  private emitRide() {
    this.bridge.emit("rideChanged", { state: this.state, canDismount: this.state === "riding" && this.canDismountNow });
  }

  private clipSeconds(name: "budMount" | "budDismount"): number {
    return this.player.getCharacter()?.getAnimationDuration(name) ?? (name === "budMount" ? 1.17 : 3.27);
  }

  // ---------- Building it ----------

  /**
   * Loads the model and fits it: laid on its side, fat end as the nose
   * (+Z), scaled to the vehicle's length, its underside at the
   * root. Then finds where on top the rider's feet go.
   */
  private async loadModel() {
    let container: AssetContainer;
    try {
      container = await loadVehicleModel(this.scene, this.def);
    } catch (err) {
      console.warn(`${this.def.id}: model failed to load`, err);
      return;
    }
    if (this.scene.isDisposed) return;
    // A copy sharing the loaded geometry and material (not an instance —
    // the source meshes stay in the container, out of the scene).
    const copy = container.instantiateModelsToScene((name) => `${this.def.id}-${name}`, false, { doNotInstantiate: true });
    const modelRoot = copy.rootNodes[0];
    const meshes = modelRoot.getChildMeshes(false);
    const size = new TransformNode(`${this.def.id}-size`, this.scene);
    const lay = new TransformNode(`${this.def.id}-lay`, this.scene);
    // The modelled bud stands upright; this lays it down with its fat end
    // forward and the long tapering tip trailing behind, like a comet (the
    // trail streams off the tip).
    lay.rotation.x = -Math.PI / 2;
    lay.parent = size;
    modelRoot.parent = lay;
    // Measure it unrotated at the origin.
    const savedPos = this.root.position.clone();
    const savedRot = this.root.rotationQuaternion!.clone();
    this.root.position.setAll(0);
    this.root.rotationQuaternion!.copyFrom(Quaternion.Identity());
    this.bob.position.setAll(0);
    this.bob.rotation.setAll(0);
    size.computeWorldMatrix(true);
    const { min, max } = size.getHierarchyBoundingVectors(true);
    const length = max.z - min.z;
    const width = max.x - min.x;
    const scale = this.def.length / length;
    const heightScale = scale * this.def.heightScale;
    size.scaling.set(scale, heightScale, scale);
    size.position.set(-((min.x + max.x) / 2) * scale, -min.y * heightScale, -((min.z + max.z) / 2) * scale);
    size.parent = this.bob;
    this.bodyWidth = width * scale;
    this.bodyHeight = (max.y - min.y) * heightScale;

    this.modelMeshes = meshes.filter((m) => m.getTotalVertices() > 0);
    // Not drawn a second time into the glow layer (it doesn't glow).
    const glow = this.scene.getGlowLayerByName("cityGlow");
    for (const m of this.modelMeshes) {
      m.isPickable = true;
      m.receiveShadows = true;
      glow?.addExcludedMesh(m as Mesh);
    }
    // Where the top surface is at the seat: cast down onto the model.
    size.computeWorldMatrix(true);
    for (const m of meshes) m.computeWorldMatrix(true);
    const seatZ = this.def.length * (0.5 - SEAT_FROM_NOSE);
    const hit = this.scene.pickWithRay(new Ray(new Vector3(0, this.bodyHeight + 5, seatZ), new Vector3(0, -1, 0), this.bodyHeight + 10), (m) =>
      this.modelMeshes.includes(m)
    );
    this.seatLocal.set(0, hit?.hit && hit.pickedPoint ? hit.pickedPoint.y - 0.06 : this.bodyHeight * 0.9, seatZ);
    for (const m of this.modelMeshes) m.isPickable = false;

    this.root.position.copyFrom(savedPos);
    this.root.rotationQuaternion!.copyFrom(savedRot);
    this.applyTransform();
  }

  /** "BUDMOBILE" floating over it, always facing the camera. */
  private createLabel(): Mesh {
    const w = 512;
    const h = 112;
    const texture = new DynamicTexture(`${this.def.id}-label-tex`, { width: w, height: h }, this.scene, true);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "bold 72px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(10, 40, 15, 0.9)";
    ctx.strokeText(this.def.name, w / 2, h / 2 + 4);
    ctx.fillStyle = "#9dff8a";
    ctx.fillText(this.def.name, w / 2, h / 2 + 4);
    texture.update();

    const label = MeshBuilder.CreatePlane(`${this.def.id}-label`, { width: 2.4, height: 2.4 * (h / w) }, this.scene);
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
    const mat = new StandardMaterial(`${this.def.id}-label-mat`, this.scene);
    mat.diffuseTexture = texture;
    mat.emissiveTexture = texture;
    mat.opacityTexture = texture;
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    label.material = mat;
    return label;
  }

  /** A soft dark patch on the ground under it — shows how high it's floating. */
  private createBlobShadow(): Mesh {
    const size = 128;
    const texture = new DynamicTexture(`${this.def.id}-shadow-tex`, size, this.scene, false);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.85)");
    g.addColorStop(0.6, "rgba(0,0,0,0.4)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    texture.update();
    const disc = MeshBuilder.CreatePlane(`${this.def.id}-shadow`, { width: this.def.length * 0.75, height: this.def.length * 1.05 }, this.scene);
    disc.rotationQuaternion = null;
    disc.rotation.x = Math.PI / 2;
    disc.isPickable = false;
    const mat = new StandardMaterial(`${this.def.id}-shadow-mat`, this.scene);
    mat.diffuseTexture = texture;
    mat.opacityTexture = texture;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    disc.material = mat;
    return disc;
  }

  /** Green-gold puffs streaming from the tail while flying. */
  private createTrail(): ParticleSystem {
    const size = 64;
    const texture = new DynamicTexture(`${this.def.id}-trail-tex`, size, this.scene, false);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    texture.update();

    const ps = new ParticleSystem(`${this.def.id}-trail`, 600, this.scene);
    ps.particleTexture = texture;
    ps.emitter = this.position.clone();
    ps.minEmitBox = new Vector3(-0.35, -0.25, -0.2);
    ps.maxEmitBox = new Vector3(0.35, 0.25, 0.2);
    ps.color1 = new Color4(0.55, 1, 0.45, 0.85);
    ps.color2 = new Color4(0.95, 1, 0.55, 0.7);
    ps.colorDead = new Color4(0.4, 0.9, 0.4, 0);
    ps.minSize = 0.2;
    ps.maxSize = 0.55;
    ps.minScaleY = 1;
    ps.maxScaleY = 1;
    ps.minLifeTime = 0.45;
    ps.maxLifeTime = 1.0;
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 2.2;
    ps.minAngularSpeed = -2;
    ps.maxAngularSpeed = 2;
    ps.updateSpeed = 0.016;
    ps.gravity = new Vector3(0, 0.3, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitRate = 0;
    ps.start();
    return ps;
  }

  dispose() {
    this.trail.dispose();
    this.root.dispose();
    this.collider.dispose();
    this.label.dispose();
    this.blobShadow.dispose();
  }
}
