// src/content/cutscenes/shots/sequence.ts
// Several shots cut together into one cutscene — e.g. a wide orbit of
// the city, a cut to a path along a street, then a close orbit on a
// character. Build every shot in it with `handover: false`; the sequence
// itself glides into the gameplay camera at the very end. Each shot's captions
// and events keep their own timing, offset to where the shot starts.

import type { CutsceneDefinition, CutsceneKind } from "../../../babylon/cutscenes/types";
import { withHandover } from "./handover";

export function sequence(id: string, shots: CutsceneDefinition[], options: { kind?: CutsceneKind; skippable?: boolean } = {}): CutsceneDefinition {
  const total = shots.reduce((sum, s) => sum + s.durationSeconds, 0);
  const starts: number[] = [];
  let at = 0;
  for (const s of shots) {
    starts.push(at);
    at += s.durationSeconds;
  }
  return {
    id,
    kind: options.kind ?? "story",
    durationSeconds: total,
    letterbox: true,
    skippable: options.skippable ?? true,
    captions: shots.flatMap((s, i) => (s.captions ?? []).map((c) => ({ ...c, from: c.from + starts[i], to: c.to + starts[i] }))),
    events: shots.flatMap((s, i) => (s.events ?? []).map((e) => ({ ...e, at: e.at + starts[i] }))),
    camera: (t, end) => {
      const seconds = t * total;
      let i = shots.length - 1;
      while (i > 0 && seconds < starts[i]) i--;
      const shot = shots[i];
      const local = Math.min(1, (seconds - starts[i]) / shot.durationSeconds);
      // The last shot hands over; earlier ones play out in full.
      if (i === shots.length - 1) return withHandover((m) => shot.camera(m, end), true)(local, end);
      return shot.camera(local, end);
    },
  };
}
