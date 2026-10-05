// src/content/cutscenes/intro.ts
// The opening shot when the game starts: the camera begins high above
// the plaza looking straight down, then sweeps down in a wide circle
// around the player and settles exactly into the normal gameplay
// camera behind them.

import type { CutsceneDefinition } from "../../babylon/cutscenes/CutsceneDirector";
import { easeInOutCubic, easeOutCubic, lerp } from "./easing";

/** How far round the camera circles on the way down (in full turns). */
const TURNS = 1.15;
const START_RADIUS = 62;
/** Near straight down. */
const START_BETA = 0.14;

export const INTRO_CUTSCENE: CutsceneDefinition = {
  id: "intro",
  durationSeconds: 8,
  letterbox: true,
  skippable: true,
  camera: (t, end) => {
    const descend = easeInOutCubic(t);
    // Circling slows to a stop exactly as the camera reaches its spot behind the player.
    const circle = easeOutCubic(t);
    return {
      alpha: end.alpha - TURNS * Math.PI * 2 * (1 - circle),
      beta: lerp(START_BETA, end.beta, descend),
      radius: lerp(START_RADIUS, end.radius, descend),
      target: end.target,
    };
  },
};
