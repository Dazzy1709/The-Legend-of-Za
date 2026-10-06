// src/babylon/core/Quality.ts
// How much the game puts on screen, by device. Phones and tablets get a
// lighter world: a browser tab there has far less memory (iOS Safari
// reloads the page, then gives up, once it runs out) and a slower GPU.
// Every animated character costs memory and time, so the crowd thins out
// most; the extra full-screen effect passes go too.
//
// If a game start never got going (the tab ran out of memory and the
// browser reloaded it), the next start uses the even lighter "minimal"
// profile instead of crashing again — see markLoadStarted/markLoadSettled.
//
// `?quality=low`, `minimal` or `high` in the address forces one (for testing).

export interface QualityProfile {
  name: "minimal" | "low" | "high";
  /** Share of the ambient crowd that's actually spawned. */
  crowdScale: number;
  /** Share of doorstep greeters spawned. */
  greeterScale: number;
  /** Share of each enemy archetype's population cap. */
  enemyScale: number;
  shadowMapSize: number;
  /** Bloom, sharpening and an HDR buffer (the colour grading stays either way). */
  fancyPostProcessing: boolean;
  /** The glow pass that makes lit windows shine at night. */
  glowLayer: boolean;
  /** Largest image texture side; bigger ones are scaled down as they load (0 = no limit). */
  maxTextureSize: number;
  /** Characters keep their normal and metal/roughness maps (on phones only the colour map — those are 2048px each). */
  characterDetailMaps: boolean;
}

const HIGH: QualityProfile = {
  name: "high",
  crowdScale: 1,
  greeterScale: 1,
  enemyScale: 1,
  shadowMapSize: 1024,
  fancyPostProcessing: true,
  glowLayer: true,
  maxTextureSize: 0,
  characterDetailMaps: true,
};
const LOW: QualityProfile = {
  name: "low",
  crowdScale: 0.25,
  greeterScale: 0.25,
  enemyScale: 0.5,
  shadowMapSize: 512,
  fancyPostProcessing: false,
  glowLayer: false,
  maxTextureSize: 512,
  characterDetailMaps: false,
};

/** Last resort, after a start that didn't survive: a near-empty crowd and the smallest textures. */
const MINIMAL: QualityProfile = { ...LOW, name: "minimal", crowdScale: 0.15, greeterScale: 0, enemyScale: 0.34, maxTextureSize: 256 };

/** Set while a game is starting up (and its first moments), cleared once it's running fine. Still set on the next load = that start crashed. */
const UNSETTLED_KEY = "zaza.unsettledStart";
/** How long into play a crash still counts against the start. */
const SETTLE_MS = 20_000;

function crashedLastTime(): boolean {
  try {
    return localStorage.getItem(UNSETTLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** A game is about to start building its world. */
export function markLoadStarted() {
  try {
    localStorage.setItem(UNSETTLED_KEY, "1");
  } catch {
    // Storage blocked: no crash memory, no harm.
  }
}

/** The world has loaded: once it's been running a little while (`delayMs`), the start counts as having survived. */
export function markLoadSettled(delayMs = SETTLE_MS) {
  const clear = () => {
    try {
      localStorage.removeItem(UNSETTLED_KEY);
    } catch {
      // As above.
    }
  };
  if (delayMs > 0) setTimeout(clear, delayMs);
  else clear(); // straight away — this may be the page unloading
}

// Leaving the page normally (closing the tab, a refresh) isn't a crash — a crash never gets this far.
if (typeof window !== "undefined") window.addEventListener("pagehide", () => markLoadSettled(0));

function pickQuality(): QualityProfile {
  if (typeof window === "undefined") return HIGH;
  const forced = new URLSearchParams(window.location.search).get("quality");
  if (forced === "minimal") return MINIMAL;
  if (forced === "low") return LOW;
  if (forced === "high") return HIGH;
  if (crashedLastTime()) return MINIMAL;
  const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const mobileUa = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports itself as a Mac
  const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  return touch || mobileUa || lowMemory ? LOW : HIGH;
}

export const QUALITY: QualityProfile = pickQuality();

/** `count` scaled by `share`, rounded — a group of one or two can thin out to nobody. */
export function scaledCount(count: number, share: number): number {
  return share >= 1 ? count : Math.round(count * share);
}
