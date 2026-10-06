// src/content/cutscenes/shots/handover.ts
// Shared by every shot: the last stretch of a cutscene glides from the
// shot's own camera into the gameplay camera behind the player, so control
// comes back without a jump.

import { Vector3 } from "@babylonjs/core";
import type { OrbitPose } from "../../../babylon/cutscenes/types";
import { easeInOutCubic, lerp } from "./easing";

/** The share of a shot spent gliding into the gameplay camera (when it hands over). */
export const HANDOVER_SHARE = 0.16;

export function blendPose(a: OrbitPose, b: OrbitPose, k: number): OrbitPose {
  const da = Math.atan2(Math.sin(b.alpha - a.alpha), Math.cos(b.alpha - a.alpha));
  return {
    alpha: a.alpha + da * k,
    beta: lerp(a.beta, b.beta, k),
    radius: lerp(a.radius, b.radius, k),
    target: Vector3.Lerp(a.target, b.target, k),
  };
}

/**
 * Wraps a shot's own camera (`shot(main)`, main from 0 to 1) so it plays
 * over the first part of the cutscene and then hands over to `end`.
 * With `handover` false the shot fills the whole time (for a shot in the
 * middle of a sequence).
 */
export function withHandover(shot: (main: number) => OrbitPose, handover: boolean) {
  return (t: number, end: OrbitPose): OrbitPose => {
    if (!handover) return shot(t);
    const cut = 1 - HANDOVER_SHARE;
    if (t < cut) return shot(t / cut);
    return blendPose(shot(1), end, easeInOutCubic((t - cut) / HANDOVER_SHARE));
  };
}

/** Converts "camera here, looking there" into an orbit pose. */
export function poseFromPositions(position: Vector3, lookAt: Vector3): OrbitPose {
  const offset = position.subtract(lookAt);
  const radius = Math.max(0.01, offset.length());
  return {
    alpha: Math.atan2(offset.z, offset.x),
    beta: Math.acos(Math.max(-1, Math.min(1, offset.y / radius))),
    radius,
    target: lookAt.clone(),
  };
}
