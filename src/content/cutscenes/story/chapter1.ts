// src/content/cutscenes/story/chapter1.ts
// Chapter One: The Debt. The missions that play these are in
// content/story/missions.ts.

import { orbitShot } from "../shots/orbit";
import { pathShot } from "../shots/path";
import { sequence } from "../shots/sequence";
import { SNOOP_SPOT } from "../../cities/kushtar/placements";

/** The story opens: the capital from above, then down the north avenue to Snoop. */
export const PROLOGUE = sequence("prologue", [
  orbitShot({
    id: "prologue-city",
    seconds: 9,
    focus: { x: 0, y: 6, z: 10 },
    radius: 80,
    beta: 1.0,
    fromAngle: -2.6,
    sweep: 1.3,
    handover: false,
    captions: [
      { from: 0.6, to: 4.2, text: "Kushtar. Capital of the green realm." },
      { from: 4.4, to: 8.6, text: "You left owing money to the wrong people, Zaza." },
    ],
  }),
  pathShot({
    id: "prologue-avenue",
    seconds: 8,
    handover: false,
    keys: [
      { position: { x: 4, y: 26, z: 120 }, lookAt: { x: 0, y: 4, z: 60 } },
      { position: { x: 2, y: 12, z: 55 }, lookAt: { x: -6, y: 2, z: 18 } },
      { position: { x: -4, y: 4.5, z: 22 }, lookAt: { x: SNOOP_SPOT.x, y: 1.8, z: SNOOP_SPOT.z } },
    ],
    captions: [{ from: 3.5, to: 7.8, speaker: "Snoop Cordozar", text: "Zaza! Over here, by the market. We need to talk." }],
    events: [{ at: 4, type: "say", npcId: "snoop", text: "Zaza! Over here!", seconds: 3 }],
  }),
]);

/** Snoop points you at the debt collectors camped outside the north gate. */
export const THE_COLLECTORS = orbitShot({
  id: "theCollectors",
  seconds: 11,
  focus: { x: 0, y: 4, z: 235 },
  radius: 45,
  beta: 1.15,
  fromAngle: 2.2,
  sweep: -1.2,
  captions: [
    { from: 0.5, to: 4.2, speaker: "Snoop Cordozar", text: "They're camped outside the north gate." },
    { from: 4.4, to: 8.4, speaker: "Snoop Cordozar", text: "Three of them. Show them the debt's settled." },
  ],
});

/** The end of chapter one. */
export const DEBT_SETTLED = orbitShot({
  id: "debtSettled",
  seconds: 15,
  focus: { x: SNOOP_SPOT.x, y: 2, z: SNOOP_SPOT.z },
  radius: 12,
  beta: 1.3,
  fromAngle: 0.4,
  sweep: 1.4,
  captions: [
    { from: 0.5, to: 4, speaker: "Snoop Cordozar", text: "Not bad, Zaza. Not bad at all." },
    { from: 4.2, to: 8, speaker: "Snoop Cordozar", text: "But those collectors answer to someone bigger..." },
    { from: 8.2, to: 11.4, speaker: "Snoop Cordozar", text: "You'll need more than fists. The Weapons Store in the Handelsviertel will sell to you now." },
    { from: 11.6, to: 14.4, text: "Chapter One complete." },
  ],
  events: [{ at: 11.6, type: "flag", flag: "chapter-1-ending-seen" }],
});
