// src/components/overlays/ScreenFade.tsx
// A full-screen black layer the engine fades in and out (screenFade
// event): resting at the safe house, respawning, the start of the intro.

interface ScreenFadeProps {
  opacity: number;
  durationMs: number;
}

export function ScreenFade({ opacity, durationMs }: ScreenFadeProps) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 bg-black"
      style={{ opacity, transition: `opacity ${durationMs}ms ease-in-out` }}
    />
  );
}
