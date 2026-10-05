// src/babylon/cutscenes/CutsceneDirector.ts
// Plays camera cutscenes. A cutscene (content/cutscenes/) is a duration
// plus a function giving the camera's orbit pose at each moment, ending
// on the gameplay camera's own pose — so when it finishes, control is
// handed back with the camera exactly where gameplay expects it, with no
// jump. While one plays, GameEngine keeps player input off and React
// hides the HUD (the cutsceneChanged event).

import { ArcRotateCamera, Vector3 } from "@babylonjs/core";
import type { EventBridge } from "../core/EventBridge";

/** An ArcRotateCamera pose: angles and distance around a look-at point. */
export interface OrbitPose {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
}

export interface CutsceneDefinition {
  id: string;
  durationSeconds: number;
  /** Black bars top and bottom. */
  letterbox: boolean;
  /** Space / Enter / Escape jumps to the end. */
  skippable: boolean;
  /**
   * The camera at `t` (0 at the start, 1 at the end). `end` is the
   * gameplay camera the cutscene hands over to; returning exactly `end`
   * at t = 1 (with motion easing to a stop) makes the handover seamless.
   */
  camera: (t: number, end: OrbitPose) => OrbitPose;
}

/** Longest step a single frame may advance a cutscene, so a loading hitch doesn't skip half of it. */
const MAX_STEP_SECONDS = 1 / 30;

export class CutsceneDirector {
  private current: CutsceneDefinition | null = null;
  private end: OrbitPose | null = null;
  private elapsed = 0;
  private running = false;
  private onFinished: (() => void) | null = null;
  /** The camera's zoom/tilt limits, lifted while a cutscene plays (a shot can go far beyond gameplay's range) and put back after. */
  private savedLimits: { lowerRadius: number | null; upperRadius: number | null; lowerBeta: number | null; upperBeta: number | null } | null = null;

  constructor(private camera: ArcRotateCamera, private bridge: EventBridge) {}

  isActive(): boolean {
    return this.current !== null;
  }

  /**
   * Starts `def`, ending on `end`. The camera jumps to the first frame
   * now; the cutscene itself only starts moving once begin() is called
   * (so it can wait for the world to finish loading).
   */
  prepare(def: CutsceneDefinition, end: OrbitPose, onFinished?: () => void) {
    this.current = def;
    this.end = { ...end, target: end.target.clone() };
    this.elapsed = 0;
    this.running = false;
    this.onFinished = onFinished ?? null;
    if (!this.savedLimits) {
      const c = this.camera;
      this.savedLimits = { lowerRadius: c.lowerRadiusLimit, upperRadius: c.upperRadiusLimit, lowerBeta: c.lowerBetaLimit, upperBeta: c.upperBetaLimit };
      c.lowerRadiusLimit = null;
      c.upperRadiusLimit = null;
      c.lowerBetaLimit = 0.01;
      c.upperBetaLimit = Math.PI - 0.01;
    }
    this.apply(def.camera(0, this.end));
    this.bridge.emit("cutsceneChanged", { id: def.id, active: true, letterbox: def.letterbox, skippable: def.skippable });
  }

  begin() {
    if (this.current) this.running = true;
  }

  skip() {
    if (this.current?.skippable) this.finish();
  }

  update(dt: number) {
    if (!this.current || !this.end || !this.running) return;
    this.elapsed += Math.min(dt, MAX_STEP_SECONDS);
    const t = Math.min(1, this.elapsed / this.current.durationSeconds);
    if (t >= 1) {
      this.finish();
      return;
    }
    this.apply(this.current.camera(t, this.end));
  }

  private finish() {
    if (!this.current || !this.end) return;
    this.apply(this.end);
    if (this.savedLimits) {
      const c = this.camera;
      c.lowerRadiusLimit = this.savedLimits.lowerRadius;
      c.upperRadiusLimit = this.savedLimits.upperRadius;
      c.lowerBetaLimit = this.savedLimits.lowerBeta;
      c.upperBetaLimit = this.savedLimits.upperBeta;
      this.savedLimits = null;
    }
    this.current = null;
    this.end = null;
    this.running = false;
    this.bridge.emit("cutsceneChanged", { id: null, active: false, letterbox: false, skippable: false });
    const done = this.onFinished;
    this.onFinished = null;
    done?.();
  }

  private apply(pose: OrbitPose) {
    this.camera.alpha = pose.alpha;
    this.camera.beta = pose.beta;
    this.camera.radius = pose.radius;
    // Keep the given angles — a plain target assignment would recompute them.
    this.camera.setTarget(pose.target, false, false, true);
  }
}
