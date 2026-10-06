// src/content/cutscenes/shots/orbit.ts
// A slow circling shot around a point of interest (a landmark, a
// character, a camp), ending with the glide into the gameplay camera.

import { Vector3 } from "@babylonjs/core";
import type { CutsceneCaption, CutsceneDefinition, CutsceneEvent, CutsceneKind } from "../../../babylon/cutscenes/types";
import { withHandover } from "./handover";

export interface OrbitShotOptions {
  id: string;
  kind?: CutsceneKind;
  seconds: number;
  /** The point the camera circles and looks at. */
  focus: { x: number; y: number; z: number };
  radius: number;
  /** Camera tilt (0 = straight down, PI/2 = level). */
  beta: number;
  /** Where around the focus it starts (radians) and how far it travels. */
  fromAngle: number;
  sweep: number;
  captions?: CutsceneCaption[];
  events?: CutsceneEvent[];
  /** Default true. */
  skippable?: boolean;
  /** Glide into the gameplay camera at the end (default true; false inside a sequence). */
  handover?: boolean;
}

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export function orbitShot(o: OrbitShotOptions): CutsceneDefinition {
  const focus = new Vector3(o.focus.x, o.focus.y, o.focus.z);
  return {
    id: o.id,
    kind: o.kind ?? "story",
    durationSeconds: o.seconds,
    letterbox: true,
    skippable: o.skippable ?? true,
    captions: o.captions,
    events: o.events,
    camera: withHandover(
      (main) => ({ alpha: o.fromAngle + o.sweep * easeInOutSine(main), beta: o.beta, radius: o.radius, target: focus }),
      o.handover ?? true
    ),
  };
}
