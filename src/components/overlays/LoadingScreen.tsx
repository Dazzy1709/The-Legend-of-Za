// src/components/overlays/LoadingScreen.tsx
// The cover art while the game loads (the world, every model in it, and
// the opening cutscene), with a progress bar, the percentage and a rough
// time left (from LoadingTracker via the loadingProgress event). The art
// is shown whole over a blurred copy of itself, so it fits any screen
// shape without cropping the title. When loading is done it fades out
// and calls onHidden.

import { useEffect, useState } from "react";

const LOADING_ART_URL = "/assets/ui/loading.webp";
const FADE_OUT_MS = 700;

export interface LoadingState {
  fraction: number;
  secondsLeft: number | null;
  done: boolean;
}

export function LoadingScreen({ state, onHidden }: { state: LoadingState; onHidden: () => void }) {
  // The bar eases toward the real value rather than jumping.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setShown((cur) => {
        const next = cur + (state.fraction - cur) * 0.12;
        return Math.abs(state.fraction - next) < 0.001 ? state.fraction : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.fraction]);

  useEffect(() => {
    if (!state.done) return;
    const t = setTimeout(onHidden, FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [state.done, onHidden]);

  const percent = Math.round(shown * 100);
  const label = state.done
    ? "Ready"
    : state.fraction < 0.02
      ? "Building the world…"
      : state.secondsLeft !== null && state.secondsLeft > 0
        ? `About ${formatSeconds(state.secondsLeft)} left`
        : "Loading characters…";

  return (
    <div
      className="fixed inset-0 z-[60] overflow-hidden bg-stone-950"
      style={{ opacity: state.done ? 0 : 1, transition: `opacity ${FADE_OUT_MS}ms ease-in-out` }}
      role="progressbar"
      aria-label="Loading the game"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <LoadingArt />

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-[max(1rem,env(safe-area-inset-left))] pt-10 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-end justify-between gap-4 text-xs text-stone-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-sm">
          <span>{label}</span>
          <span className="font-semibold tabular-nums text-amber-300">{percent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.6)]"
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** The cover art, whole and centred, over a blurred, darkened copy of itself that fills the rest of the screen. */
function LoadingArt() {
  return (
    <>
      <img src={LOADING_ART_URL} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />
      <img src={LOADING_ART_URL} alt="The Legend of Za" className="absolute inset-0 h-full w-full object-contain" />
    </>
  );
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60} s`;
}
