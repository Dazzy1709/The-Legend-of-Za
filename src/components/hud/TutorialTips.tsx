// src/components/hud/TutorialTips.tsx
// The current objective's tutorial tips (content/story/missions.ts), one
// at a time, each beside the part of the HUD it explains with an arrow
// pointing at it. A tip moves on by itself after TIP_MS, or straight away
// when clicked. How far through an objective's tips the player got is
// remembered for the session, so opening the Bag or talking to someone
// (which hides the HUD) doesn't start them over.

import { useEffect, useState } from "react";
import type { TutorialTip } from "../../content/story/missions";

const TIP_MS = 8000;
const FIRST_TIP_DELAY_MS = 1200;

/** Objective key → index of the tip it's on (tips.length once all are seen). */
const progress = new Map<string, number>();

type Anchor = TutorialTip["anchor"];

type Arrow = "left" | "right" | "up" | "down";

/**
 * Where the card sits and which way its arrow points, per anchor. The
 * compact HUD (touch screens, short screens) lays things out differently
 * — `compactArrow` is the arrow there.
 */
function placement(anchor: Anchor, touch: boolean): { box: string; arrow: Arrow | null; compactArrow?: Arrow } {
  switch (anchor) {
    case "healing":
      return { box: "left-[4.5rem] top-1/2 -translate-y-1/2 sm:left-24 compact:left-[10.25rem]! compact:top-[7rem]! compact:translate-y-0!", arrow: "left" };
    case "weapons":
      return {
        box: "right-[4.5rem] top-[42%] -translate-y-1/2 sm:right-24 compact:right-2! compact:top-auto! compact:bottom-[9.25rem]! compact:translate-y-0!",
        arrow: "right",
        compactArrow: "down",
      };
    case "bag":
      return { box: "right-3 top-20 sm:right-16 sm:top-24 compact:right-2! compact:top-[3.25rem]!", arrow: "up" };
    case "minimap":
      return touch
        ? { box: "right-3 top-[17rem] compact:right-[10rem]! compact:top-[5.5rem]!", arrow: "up", compactArrow: "right" }
        : { box: "bottom-48 right-4", arrow: "down" };
    case "center":
      return { box: "left-1/2 top-28 -translate-x-1/2 compact:top-[4.75rem]!", arrow: null };
  }
}

const ARROW: Record<Arrow, string> = {
  left: "-left-2 top-1/2 -translate-y-1/2 border-y-8 border-r-8 border-y-transparent border-r-amber-500/80",
  right: "-right-2 top-1/2 -translate-y-1/2 border-y-8 border-l-8 border-y-transparent border-l-amber-500/80",
  up: "-top-2 right-8 border-x-8 border-b-8 border-x-transparent border-b-amber-500/80",
  down: "-bottom-2 right-16 border-x-8 border-t-8 border-x-transparent border-t-amber-500/80",
};

export function TutorialTips({ objectiveKey, tips, touch }: { objectiveKey: string; tips: TutorialTip[]; touch: boolean }) {
  const [index, setIndex] = useState(() => progress.get(objectiveKey) ?? 0);
  // The first tip of an objective waits a moment, so it doesn't land on top of the objective itself.
  const [ready, setReady] = useState(() => progress.has(objectiveKey));

  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setReady(true), FIRST_TIP_DELAY_MS);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    progress.set(objectiveKey, index);
    if (!ready || index >= tips.length) return;
    const t = setTimeout(() => setIndex((i) => i + 1), TIP_MS);
    return () => clearTimeout(t);
  }, [objectiveKey, index, ready, tips.length]);

  const tip = tips[index];
  if (!ready || !tip) return null;
  const { box, arrow, compactArrow } = placement(tip.anchor, touch);

  return (
    <button
      key={index}
      onClick={() => setIndex((i) => i + 1)}
      title="Next tip"
      className={`fixed z-20 w-64 rounded-md border border-amber-500/70 bg-stone-950/90 px-3.5 py-2.5 text-left shadow-[0_6px_24px_rgba(0,0,0,0.6)] [animation:levelup-in_400ms_ease-out] compact:w-56! compact:px-3! compact:py-2! ${box}`}
    >
      {arrow && <span className={`absolute h-0 w-0 ${ARROW[arrow]} ${compactArrow ? "compact:hidden!" : ""}`} />}
      {compactArrow && <span className={`absolute hidden h-0 w-0 compact:block! ${ARROW[compactArrow]}`} />}
      <span className="mb-1 flex items-center justify-between text-[10px] tracking-[0.18em] text-amber-400 uppercase">
        <span>Tip</span>
        {tips.length > 1 && (
          <span className="tabular-nums text-stone-500">
            {index + 1} / {tips.length}
          </span>
        )}
      </span>
      <span className="block text-sm leading-snug text-stone-100 compact:text-xs!">{(touch && tip.touchText) || tip.text}</span>
      <span className="mt-1.5 block text-[10px] text-stone-500">{touch ? "Tap" : "Click"} to {index + 1 < tips.length ? "continue" : "dismiss"}</span>
    </button>
  );
}
