// src/content/cutscenes/shots/path.ts
// A camera move along a path: the camera glides smoothly through a list
// of positions while looking at a list of points (a fly-through of a
// street, a push in on a door, a sweep over a valley). Positions and
// look-at points are interpolated with Catmull-Rom splines, so the move
// curves through every key without stopping at them.

import { Vector3 } from "@babylonjs/core";
import type { CutsceneCaption, CutsceneDefinition, CutsceneEvent, CutsceneKind } from "../../../babylon/cutscenes/types";
import { easeInOutCubic } from "./easing";
import { poseFromPositions, withHandover } from "./handover";

type Point = { x: number; y: number; z: number };

export interface PathShotOptions {
  id: string;
  kind?: CutsceneKind;
  seconds: number;
  /** Camera keys: where it is, and what it looks at. At least two. */
  keys: { position: Point; lookAt: Point }[];
  captions?: CutsceneCaption[];
  events?: CutsceneEvent[];
  skippable?: boolean;
  handover?: boolean;
}

function catmullRom(points: Vector3[], t: number): Vector3 {
  const segments = points.length - 1;
  const scaled = Math.min(segments - 1e-6, Math.max(0, t * segments));
  const i = Math.floor(scaled);
  const u = scaled - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(points.length - 1, i + 2)];
  return Vector3.CatmullRom(p0, p1, p2, p3, u);
}

export function pathShot(o: PathShotOptions): CutsceneDefinition {
  const positions = o.keys.map((k) => new Vector3(k.position.x, k.position.y, k.position.z));
  const targets = o.keys.map((k) => new Vector3(k.lookAt.x, k.lookAt.y, k.lookAt.z));
  return {
    id: o.id,
    kind: o.kind ?? "story",
    durationSeconds: o.seconds,
    letterbox: true,
    skippable: o.skippable ?? true,
    captions: o.captions,
    events: o.events,
    camera: withHandover((main) => {
      const k = easeInOutCubic(main);
      return poseFromPositions(catmullRom(positions, k), catmullRom(targets, k));
    }, o.handover ?? true),
  };
}
