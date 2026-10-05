// src/components/hud/StatusMeters.tsx
// Fast-changing bits of the player's status that the engine owns and the
// HUD polls every frame (only re-rendering when what's shown changes):
// the sprint stamina bar (cardio) and the active stat buffs' countdowns.

import { useEffect, useState } from "react";
import { GameEngine } from "../../babylon/core/GameEngine";
import type { StatName } from "../../types";

type EngineRef = React.MutableRefObject<GameEngine | null>;

/** Polls `read` every animation frame; `same` decides whether the value changed enough to re-render. */
function usePolled<T>(engineRef: EngineRef, read: (engine: GameEngine) => T, same: (a: T, b: T) => boolean, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const engine = engineRef.current;
      if (engine) {
        const next = read(engine);
        setValue((prev) => (same(prev, next) ? prev : next));
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [engineRef, read, same]);
  return value;
}

const readStamina = (engine: GameEngine) => engine.getStamina();
const sameStamina = (a: { fraction: number; exhausted: boolean }, b: { fraction: number; exhausted: boolean }) =>
  Math.round(a.fraction * 100) === Math.round(b.fraction * 100) && a.exhausted === b.exhausted;

/** The sprint-stamina meter (cardio) — a slim labelled bar under the level and health. Turns red while exhausted. */
export function StaminaBar({ engineRef }: { engineRef: EngineRef }) {
  const stamina = usePolled(engineRef, readStamina, sameStamina, { fraction: 1, exhausted: false });
  return (
    <div className="flex items-center gap-2" title="Stamina (Cardio)">
      <span className={`w-10 shrink-0 text-[9px] tracking-wide uppercase sm:text-[10px] ${stamina.exhausted ? "text-rose-400" : "text-sky-300"}`}>
        {stamina.exhausted ? "Winded" : "Stamina"}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm border border-black/40 bg-stone-900">
        <div
          className={`h-full ${stamina.exhausted ? "bg-linear-to-b from-rose-400 to-rose-600" : "bg-linear-to-b from-sky-300 to-sky-500"}`}
          style={{ width: `${Math.round(stamina.fraction * 100)}%` }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
      </div>
    </div>
  );
}

const STAT_SHORT: Record<StatName, string> = { strength: "STR", endurance: "END", cardio: "CAR", defense: "DEF" };

type BuffTimer = ReturnType<GameEngine["getBuffTimers"]>[number];
const readBuffs = (engine: GameEngine) => engine.getBuffTimers();
const sameBuffs = (a: BuffTimer[], b: BuffTimer[]) =>
  a.length === b.length && a.every((x, i) => x.source === b[i].source && Math.ceil(x.remaining) === Math.ceil(b[i].remaining));

/** Active stat buffs as small chips: "+10 STR 1:24". */
export function BuffList({ engineRef }: { engineRef: EngineRef }) {
  const buffs = usePolled(engineRef, readBuffs, sameBuffs, [] as BuffTimer[]);
  if (buffs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {buffs.map((b) => {
        const secs = Math.max(0, Math.ceil(b.remaining));
        return (
          <span
            key={b.source}
            title={b.source}
            className="rounded-sm border border-emerald-700/60 bg-emerald-950/70 px-1.5 py-0.5 text-[10px] tabular-nums text-emerald-200"
          >
            +{b.amount} {STAT_SHORT[b.stat]} {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </span>
        );
      })}
    </div>
  );
}
