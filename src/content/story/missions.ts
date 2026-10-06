// src/content/story/missions.ts
// The story, mission by mission, in the order it's played. Each mission
// is a list of objectives done one after another, with rewards and
// optional cutscenes at its start and end. Missions are grouped into
// chapters (same `chapter` string, one after another): only the last one
// of a chapter gets the big "Mission Passed", the others finish with a
// small toast. Objectives can carry tutorial tips, shown beside the bit
// of the HUD they explain. To extend the story, append missions here;
// new objective kinds go in Objective below plus a handler in
// babylon/story/MissionManager.ts.

import type { CutsceneId } from "../cutscenes";

/** A tutorial tip, shown beside the part of the screen it's about. */
export interface TutorialTip {
  text: string;
  /** Replaces `text` on touch screens (no keyboard). */
  touchText?: string;
  /** What it points at: the healing items (left edge), the weapon slots (right edge), the minimap, the Bag button, or nothing in particular. */
  anchor: "healing" | "weapons" | "minimap" | "bag" | "center";
}

export type Objective = ObjectiveKind & { tips?: TutorialTip[] };

type ObjectiveKind =
  /** Talk to a named NPC (their id in the city's placements). */
  | { kind: "talk"; npcId: string; text: string }
  /** Rest at a safe house. */
  | { kind: "rest"; text: string }
  /** Get on the Budmobile. */
  | { kind: "ride"; text: string }
  /** Defeat a number of enemies. */
  | { kind: "defeat"; count: number; text: string; marker?: { x: number; z: number } }
  /** Reach a place. */
  | { kind: "goTo"; x: number; z: number; radius: number; text: string };

export interface MissionDef {
  id: string;
  chapter: string;
  title: string;
  objectives: Objective[];
  rewards: { xp: number; gold: number };
  /** Played when the mission begins / once it's done. */
  startCutscene?: CutsceneId;
  endCutscene?: CutsceneId;
  /** Story flags set when it's completed. */
  setsFlags?: string[];
}

export const STORY: MissionDef[] = [
  {
    id: "homecoming",
    chapter: "Chapter One: The Debt",
    title: "Homecoming",
    startCutscene: "prologue",
    objectives: [
      {
        kind: "talk",
        npcId: "snoop",
        text: "Find Snoop Cordozar at the market",
        tips: [
          {
            text: "Move with WASD and look around with the mouse. Hold Shift to sprint.",
            touchText: "Move with the stick on the left and drag across the screen to look around.",
            anchor: "center",
          },
          {
            text: "The diamond on your minimap shows where to go next. Press E next to Snoop to talk.",
            touchText: "The diamond on your minimap shows where to go next. Tap the prompt that pops up next to Snoop to talk.",
            anchor: "minimap",
          },
        ],
      },
    ],
    rewards: { xp: 40, gold: 10 },
    setsFlags: ["met-snoop"],
  },
  {
    id: "home-sweet-home",
    chapter: "Chapter One: The Debt",
    title: "Home Sweet Home",
    objectives: [
      {
        kind: "rest",
        text: "Rest at your Safe House (it saves your game)",
        tips: [{ text: "Resting at your Safe House fills your health back up and saves your game.", anchor: "minimap" }],
      },
    ],
    rewards: { xp: 30, gold: 0 },
  },
  {
    id: "wheels",
    chapter: "Chapter One: The Debt",
    title: "Wheels",
    objectives: [
      {
        kind: "ride",
        text: "Hop on the Budmobile beside the Safe House",
        tips: [
          {
            text: "Press E next to the Budmobile to hop on. Space climbs, C sinks, Shift boosts.",
            touchText: "Tap the prompt next to the Budmobile to hop on. ⤒ climbs, ⚔ sinks.",
            anchor: "center",
          },
        ],
      },
      { kind: "goTo", x: 0, z: 222, radius: 18, text: "Fly out through the north gate" },
    ],
    rewards: { xp: 50, gold: 15 },
  },
  {
    id: "the-collectors",
    chapter: "Chapter One: The Debt",
    title: "The Collectors",
    startCutscene: "theCollectors",
    objectives: [
      {
        kind: "defeat",
        count: 3,
        text: "Defeat the debt collectors outside the walls",
        marker: { x: 0, z: 240 },
        tips: [
          {
            text: "Pick your weapon here: click a slot or press 1, 2 or 3. Q opens the weapon wheel. F attacks.",
            touchText: "Pick your weapon here: tap a slot. The ⚔ button swings it.",
            anchor: "weapons",
          },
          {
            text: "Your healing herbs and boosts are on the left. Click one to use it when your health runs low.",
            touchText: "Your healing herbs and boosts are on the left. Tap one to use it when your health runs low.",
            anchor: "healing",
          },
          {
            text: "Everything you carry is in your Bag. Buy more herbs at the Healing Shop in town.",
            anchor: "bag",
          },
          {
            text: "Enemies are a level or two above you. Keep moving, and heal before it's too late.",
            anchor: "center",
          },
        ],
      },
    ],
    rewards: { xp: 150, gold: 40 },
  },
  {
    id: "settled",
    chapter: "Chapter One: The Debt",
    title: "Debt Settled",
    objectives: [{ kind: "talk", npcId: "snoop", text: "Report back to Snoop at the market" }],
    rewards: { xp: 80, gold: 25 },
    endCutscene: "debtSettled",
    setsFlags: ["chapter-1-complete"],
  },
  {
    id: "arm-yourself",
    chapter: "Free Roam",
    title: "Arm Yourself",
    // The Weapons Store's door (content/cities/kushtar/placements.ts) — it sells the pistol now.
    objectives: [{ kind: "goTo", x: 88, z: 31.4, radius: 5, text: "Visit the Weapons Store in the Handelsviertel" }],
    rewards: { xp: 20, gold: 0 },
  },
];
