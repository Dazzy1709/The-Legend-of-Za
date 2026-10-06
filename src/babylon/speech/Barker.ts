// src/babylon/speech/Barker.ts
// One speaker's barks: picks a line for a moment from its voice (see
// content/dialogue/barks.ts), never the same line twice in a row, minds
// the per-moment cooldowns, and shows it in a speech bubble.

import type { Vector3 } from "@babylonjs/core";
import { BARK_TIMING, VOICES, type BarkTrigger, type VoiceId } from "../../content/dialogue/barks";
import type { SpeechBubbles } from "./SpeechBubbles";

export class Barker {
  private elapsed = 0;
  /** When each moment may next be barked. */
  private readyAt = new Map<BarkTrigger, number>();
  private lastLine: string | null = null;

  constructor(
    private bubbles: SpeechBubbles,
    private speakerId: string,
    private voice: VoiceId,
    private anchor: () => Vector3,
    /** Height of the bubble above the anchor. */
    private heightAbove = 2.95
  ) {}

  /** Call once per frame (advances the cooldowns). */
  update(dt: number) {
    this.elapsed += dt;
  }

  /**
   * Says something for `trigger` — with probability `chance`, if that
   * moment isn't cooling down. `force` ignores both (and interrupts
   * whatever's being said). Returns whether a line was said.
   */
  bark(trigger: BarkTrigger, chance = 1, force = false): boolean {
    const lines: string[] | undefined = (VOICES[this.voice] as Partial<Record<BarkTrigger, string[]>>)[trigger];
    if (!lines || lines.length === 0) return false;
    if (!force) {
      if ((this.readyAt.get(trigger) ?? 0) > this.elapsed) return false;
      if (Math.random() > chance) return false;
    }
    const timing = BARK_TIMING[trigger];
    this.readyAt.set(trigger, this.elapsed + timing.cooldown);
    const pool = lines.length > 1 ? lines.filter((l) => l !== this.lastLine) : lines;
    const line = pool[Math.floor(Math.random() * pool.length)];
    this.lastLine = line;
    this.bubbles.say(this.speakerId, this.anchor, line, { seconds: timing.seconds, heightAbove: this.heightAbove });
    return true;
  }

  /** Stops talking now. */
  silence() {
    this.bubbles.stop(this.speakerId);
  }
}
