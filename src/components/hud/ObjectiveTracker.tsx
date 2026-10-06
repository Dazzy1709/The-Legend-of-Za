// src/components/hud/ObjectiveTracker.tsx
// The current story mission and what to do next, top centre. A new
// objective shows in full for SHOW_FULL_MS, then the box shrinks to a
// small pill out of the way; J (or clicking it) opens and closes it.

import { useEffect, useState } from "react";
import type { MissionStatus } from "../../babylon/story/MissionManager";

const SHOW_FULL_MS = 10_000;
const TOGGLE_KEY = "j";

/** The objective already shown in full — so closing a menu (which remounts this) doesn't pop it open again. */
let lastAnnounced: string | null = null;

export function ObjectiveTracker({ status }: { status: MissionStatus | null }) {
  const objectiveKey = status ? `${status.missionId}-${status.step}` : null;
  const [expandedFor, setExpandedFor] = useState<string | null>(() => (objectiveKey && objectiveKey !== lastAnnounced ? objectiveKey : null));
  // A different objective arrived while mounted: open it (the effect below closes it later).
  const [seenKey, setSeenKey] = useState(objectiveKey);
  if (seenKey !== objectiveKey) {
    setSeenKey(objectiveKey);
    if (objectiveKey && objectiveKey !== lastAnnounced) setExpandedFor(objectiveKey);
  }

  // A new objective: show it in full, then shrink.
  useEffect(() => {
    if (!objectiveKey || objectiveKey === lastAnnounced) return;
    lastAnnounced = objectiveKey;
    const t = setTimeout(() => setExpandedFor((cur) => (cur === objectiveKey ? null : cur)), SHOW_FULL_MS);
    return () => clearTimeout(t);
  }, [objectiveKey]);

  // J opens / closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== TOGGLE_KEY || e.repeat || e.target instanceof HTMLInputElement) return;
      setExpandedFor((cur) => (cur === objectiveKey ? null : objectiveKey));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [objectiveKey]);

  if (!status) return null;
  const expanded = expandedFor === objectiveKey;
  const toggle = () => setExpandedFor(expanded ? null : objectiveKey);

  if (!expanded) {
    return (
      <button
        onClick={toggle}
        title="Show the mission (J)"
        className="fixed left-1/2 top-3 compact:top-2! z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-900/50 bg-stone-950/75 px-3 py-1 text-xs text-amber-100 shadow-lg [animation:hud-in_300ms_ease-out] hover:border-amber-600/70 sm:top-4"
      >
        <span className="text-amber-400">◆</span>
        <span className="max-w-40 truncate">{status.title}</span>
        {status.progress && <span className="tabular-nums text-amber-300">{status.progress}</span>}
        <span className="rounded-sm border border-stone-600 px-1 text-[9px] text-stone-400">J</span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title="Hide (J)"
      className="fixed left-1/2 top-3 z-10 w-72 -translate-x-1/2 rounded-md border border-amber-900/50 bg-stone-950/80 px-3.5 py-2 text-center compact:top-2! compact:w-60! compact:py-1.5! shadow-lg [animation:levelup-in_300ms_ease-out] sm:top-4"
    >
      <p className="text-[10px] tracking-[0.18em] text-amber-500/80 uppercase">{status.chapter}</p>
      <p className="font-serif text-base text-amber-100">{status.title}</p>
      <p key={objectiveKey} className="mt-0.5 text-xs text-stone-200 [animation:levelup-in_350ms_ease-out]">
        <span className="mr-1 text-amber-400">◆</span>
        {status.objective}
        {status.progress && <span className="ml-1.5 tabular-nums text-amber-300">{status.progress}</span>}
      </p>
    </button>
  );
}
