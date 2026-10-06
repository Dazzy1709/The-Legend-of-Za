// src/babylon/audio/SoundManager.ts
// Plays the sounds listed in content/audio/sounds.ts, with a volume per
// category (music, sfx, ambience). Each sound's file loads the first
// time it's played and is reused after that.

import { SOUNDS, type SoundCategory } from "../../content/audio/sounds";
import { soundUrl } from "../../content/assetPaths";

export class SoundManager {
  private loaded = new Map<string, HTMLAudioElement>();
  private categoryVolume: Record<SoundCategory, number> = { music: 0.6, sfx: 1, ambience: 0.7 };
  /** The settings' master volume, over every category. */
  private master = 1;

  setMasterVolume(volume: number) {
    this.master = Math.max(0, Math.min(1, volume));
    for (const [id, audio] of this.loaded) {
      const def = SOUNDS[id];
      if (def) audio.volume = (def.volume ?? 1) * this.categoryVolume[def.category] * this.master;
    }
  }

  play(id: string) {
    const def = SOUNDS[id];
    if (!def) {
      console.warn(`SoundManager: no sound "${id}" in content/audio/sounds.ts`);
      return;
    }
    let audio = this.loaded.get(id);
    if (!audio) {
      audio = new Audio(soundUrl(def.file));
      audio.loop = !!def.loop;
      this.loaded.set(id, audio);
    }
    audio.volume = (def.volume ?? 1) * this.categoryVolume[def.category] * this.master;
    // Sound effects restart if played again while still going; looping tracks just keep playing.
    if (!def.loop) audio.currentTime = 0;
    audio.play().catch(() => {}); // browsers refuse audio until the player has clicked or pressed a key
  }

  stop(id: string) {
    const audio = this.loaded.get(id);
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  setCategoryVolume(category: SoundCategory, volume: number) {
    this.categoryVolume[category] = Math.max(0, Math.min(1, volume));
    for (const [id, audio] of this.loaded) {
      const def = SOUNDS[id];
      if (def?.category === category) audio.volume = (def.volume ?? 1) * this.categoryVolume[category] * this.master;
    }
  }

  dispose() {
    for (const audio of this.loaded.values()) audio.pause();
    this.loaded.clear();
  }
}
