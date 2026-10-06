// src/content/dialogue/barks.ts
// Barks: the short lines characters shout in speech bubbles during play
// (not conversations — those are dialogueTrees.ts). Every line lives
// here, grouped by voice (a kind of speaker) and by the moment that
// triggers it. To give a character new lines, add to its voice; for a new
// kind of character, add a voice and point its config at it (enemy
// archetypes: `voice` in CombatConfig.ts). The engine picks a random line
// for the moment, never the same one twice in a row, and the timing
// rules below keep anyone from talking over themselves.

/** The moments a character can say something. */
export type BarkTrigger =
  /** Just noticed the player — said during the taunt. */
  | "spotted"
  /** Every so often while running the player down. */
  | "chasing"
  /** Now and then as a swing starts. */
  | "attacking"
  /** Took a hit. */
  | "hurt"
  /** The player hit them before they'd noticed. */
  | "provoked"
  /** The player got away. */
  | "gaveUp"
  /** Last words. */
  | "defeated";

export type VoiceLines = Partial<Record<BarkTrigger, string[]>>;

export const VOICES = {
  /** Thugs collecting debts — the default enemy voice. */
  debtCollector: {
    spotted: [
      "You owe me money!",
      "Time's up, pal!",
      "Bring me my weed!",
      "There you are!",
      "Pay up. Now.",
      "Thought you could hide from me?",
    ],
    chasing: [
      "Where's my money?!",
      "Let's settle this now!",
      "You can't run forever!",
      "Get back here!",
      "Pay what you owe!",
      "I want my stash back!",
    ],
    attacking: ["Pay up!", "Interest is due!", "This is for my weed!", "Take that!"],
    hurt: ["Ugh!", "That all you got?", "Big mistake!", "Oh, you'll pay for that."],
    provoked: ["Oh, you're dead now!", "Wrong move!", "Now you owe me double!"],
    gaveUp: ["This ain't over!", "I'll find you!", "Next time, you pay!"],
    defeated: ["Keep... the change...", "Ugh... not my stash..."],
  },
  /** A brutish heavy — fewer words, more threats. */
  brute: {
    spotted: ["You. Me. Now.", "Boss wants his money!", "Smash time!"],
    chasing: ["Stand still!", "Gonna flatten you!", "Where's the cash?!"],
    attacking: ["Hrraah!", "Crush!", "Smash!"],
    hurt: ["Grr!", "Tickles.", "Hah!"],
    provoked: ["Now I'm mad!", "You'll regret that!"],
    gaveUp: ["Bah! Too fast...", "Next time..."],
    defeated: ["Ooof...", "Boss... gonna be mad..."],
  },
} satisfies Record<string, VoiceLines>;

export type VoiceId = keyof typeof VOICES;

/**
 * Timing per moment: `cooldown` is how long the same speaker must wait
 * before saying something for that moment again, `seconds` how long the
 * bubble stays up.
 */
export const BARK_TIMING: Record<BarkTrigger, { cooldown: number; seconds: number }> = {
  spotted: { cooldown: 12, seconds: 2.6 },
  chasing: { cooldown: 5, seconds: 2.2 },
  attacking: { cooldown: 6, seconds: 1.6 },
  hurt: { cooldown: 5, seconds: 1.5 },
  provoked: { cooldown: 12, seconds: 2.2 },
  gaveUp: { cooldown: 15, seconds: 2.4 },
  defeated: { cooldown: 0, seconds: 2.2 },
};
