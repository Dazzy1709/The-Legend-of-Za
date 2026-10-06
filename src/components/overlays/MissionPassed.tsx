// src/components/overlays/MissionPassed.tsx
// "MISSION PASSED" at the end of a chapter: a soft band fades in across
// the middle of the screen, the title eases in and the chapter's rewards
// follow, then it all fades away. Silent, and nothing flashes or slams. It
// shows for MISSION_PASSED_MS, and the story waits for it before moving
// on (see MissionManager).

import { useEffect, useState } from "react";
import { MISSION_PASSED_MS } from "../../babylon/story/MissionManager";

export interface MissionPassedInfo {
  id: number;
  /** The chapter just finished. */
  chapter: string;
  xp: number;
  gold: number;
}

export function MissionPassed({ info }: { info: MissionPassedInfo }) {
  const xp = useCountUp(info.xp, 900, 1100);
  const gold = useCountUp(info.gold, 900, 1300);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
      style={{ animation: `mission-fade ${MISSION_PASSED_MS}ms ease-in-out forwards` }}
    >
      <div className="absolute inset-x-0 top-1/2 h-40 -translate-y-1/2 bg-gradient-to-r from-transparent via-black/45 to-transparent" />

      <div className="relative flex flex-col items-center text-center">
        {/* The rise animates `filter`, so it goes on a wrapper to keep the title's own drop shadows. */}
        <div className="[animation:mission-rise_1100ms_cubic-bezier(0.22,1,0.36,1)_150ms_both]">
          <p
            className="text-4xl font-black tracking-[0.08em] text-transparent uppercase italic sm:text-6xl"
            style={{
              backgroundImage: "linear-gradient(180deg,#fff7d6 0%,#fcd34d 50%,#e2a33a 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              filter: "drop-shadow(0 2px 0 #1c1203) drop-shadow(0 0 12px rgba(251,191,36,0.3))",
            }}
          >
            Mission Passed
          </p>
        </div>
        <div className="[animation:mission-rise_900ms_cubic-bezier(0.22,1,0.36,1)_600ms_both]">
          <p className="mt-1.5 font-serif text-lg text-stone-100 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] sm:text-xl">{info.chapter}</p>
        </div>
        <div className="[animation:mission-rise_900ms_cubic-bezier(0.22,1,0.36,1)_950ms_both]">
          <div className="mt-2 flex gap-5 text-base font-bold tracking-wider tabular-nums uppercase drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)] sm:text-lg">
            {info.xp > 0 && <span className="text-emerald-300">+{xp} XP</span>}
            {info.gold > 0 && <span className="text-amber-300">+{gold} Gold</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Counts from 0 to `target` over `durationMs`, starting after `delayMs`. */
function useCountUp(target: number, durationMs: number, delayMs: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delayMs;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, delayMs]);
  return value;
}
