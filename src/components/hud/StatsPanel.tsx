// src/components/hud/StatsPanel.tsx
// The player's four stats in a small box, bottom-left. A stat raised by
// an active buff shows the bonus in green beside it. It folds away to a
// small "Stats" tab — click it, or press T — and remembers which way it
// was left.

import { useEffect, useState } from "react";
import type { ProgressionSnapshot } from "../../babylon/progression/Progression";
import type { StatName } from "../../types";

const STATS: { stat: StatName; label: string; hint: string }[] = [
  { stat: "strength", label: "Strength", hint: "Damage of every hit" },
  { stat: "endurance", label: "Endurance", hint: "Max health" },
  { stat: "cardio", label: "Cardio", hint: "How long you can sprint" },
  { stat: "defense", label: "Defense", hint: "Damage you shrug off" },
];

const STORAGE_KEY = "zaza.statsPanelOpen";
const TOGGLE_KEY = "t";

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

interface StatsPanelProps {
  progression: ProgressionSnapshot;
  className?: string;
  /** Show the keyboard hint (desktop). */
  showKeyHint?: boolean;
}

export function StatsPanel({ progression, className = "", showKeyHint = true }: StatsPanelProps) {
  const [open, setOpen] = useState(readOpen);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(open));
    } catch {
      // Storage blocked — it just won't be remembered.
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.key.toLowerCase() !== TOGGLE_KEY) return;
      // Not while typing in a text field.
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const base = `pointer-events-auto fixed z-10 rounded-md border border-amber-900/50 bg-stone-950/85 shadow-[0_4px_16px_rgba(0,0,0,0.55)] ${className}`;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`${base} px-3 py-1.5 font-serif text-sm text-amber-200 hover:bg-stone-900`}>
        Stats {showKeyHint && <span className="ml-1 font-sans text-[10px] text-stone-500">T</span>}
      </button>
    );
  }

  return (
    <div className={`${base} w-44 px-3 py-2`}>
      <button onClick={() => setOpen(false)} className="mb-1 flex w-full items-baseline justify-between" title="Hide stats (T)">
        <span className="font-serif text-sm text-amber-200">Stats</span>
        <span className="text-[10px] text-stone-400">
          Level {progression.level}
          <span className="ml-1.5 text-stone-500">▾</span>
        </span>
      </button>
      {STATS.map(({ stat, label, hint }) => {
        const bonus = progression.stats[stat] - progression.baseStats[stat];
        return (
          <div key={stat} title={hint} className="flex items-center justify-between text-xs leading-5">
            <span className="text-stone-300">{label}</span>
            <span className="tabular-nums text-stone-100">
              {progression.stats[stat]}
              {bonus > 0 && <span className="ml-1 text-emerald-400">+{bonus}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
