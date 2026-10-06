// src/babylon/cutscenes/types.ts
// What a cutscene is. Every cutscene — the load-in swirl, a story beat,
// a boss intro — is one of these: a camera move over time, optional
// subtitles, and an optional timeline of events (fades, sounds, story
// flags, lines over characters' heads...). The shot builders in
// content/cutscenes/shots/ make the camera part; new event types are
// added here and handled in GameEngine.handleCutsceneEvent.

import type { Vector3 } from "@babylonjs/core";

/** An ArcRotateCamera pose: angles and distance around a look-at point. */
export interface OrbitPose {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
}

/** A line shown at the bottom of the screen (seconds from the cutscene's start). */
export interface CutsceneCaption {
  from: number;
  to: number;
  speaker?: string;
  text: string;
}

/** Something that happens at a moment in a cutscene (`at`, seconds from its start). */
export type CutsceneEvent = { at: number } & (
  /** Fade the screen to black (opacity 1) or back (0). */
  | { type: "fade"; opacity: number; durationMs: number }
  /** Play a sound from content/audio/sounds.ts. */
  | { type: "sound"; soundId: string }
  /** Record a story flag (saved with the game). */
  | { type: "flag"; flag: string }
  /** A speech bubble over a named NPC. */
  | { type: "say"; npcId: string; text: string; seconds?: number }
);

/** Broad kinds, for organising and for future players (in-engine, video...). */
export type CutsceneKind = "system" | "story" | "ambient";

export interface CutsceneDefinition {
  id: string;
  kind: CutsceneKind;
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
  /** Spoken lines / narration, shown as subtitles. */
  captions?: CutsceneCaption[];
  /** Timed events. */
  events?: CutsceneEvent[];
}
