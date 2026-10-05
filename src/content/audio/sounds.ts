// src/content/audio/sounds.ts
// Every sound in the game, by id. To add one: put the file in
// public/assets/sounds/<category>/ and add an entry, e.g.
//   punch: { file: "sfx/punch.mp3", category: "sfx", volume: 0.8 },
// then play it from the engine with gameEngine.playSound("punch").

export type SoundCategory = "music" | "sfx" | "ambience";

export interface SoundDef {
  /** Path under public/assets/sounds/. */
  file: string;
  category: SoundCategory;
  /** 0-1, before the category volume. Default 1. */
  volume?: number;
  loop?: boolean;
}

export const SOUNDS: Record<string, SoundDef> = {};
