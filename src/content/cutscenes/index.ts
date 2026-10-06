// src/content/cutscenes/index.ts
// Every cutscene, by id. Missions and the engine refer to cutscenes only
// by these ids. To add one: build it in a file under system/ (game flow:
// load-in, respawn...) or story/ (one file per chapter), from the shots
// in shots/ (orbit, path, sequence), then list it here.

import type { CutsceneDefinition } from "../../babylon/cutscenes/types";
import { LOAD_IN } from "./system/loadIn";
import { DEBT_SETTLED, PROLOGUE, THE_COLLECTORS } from "./story/chapter1";

export const CUTSCENES = {
  // System
  loadIn: LOAD_IN,
  // Chapter One: The Debt
  prologue: PROLOGUE,
  theCollectors: THE_COLLECTORS,
  debtSettled: DEBT_SETTLED,
} satisfies Record<string, CutsceneDefinition>;

export type CutsceneId = keyof typeof CUTSCENES;
