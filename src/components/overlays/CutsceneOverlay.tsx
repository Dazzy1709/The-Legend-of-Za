// src/components/overlays/CutsceneOverlay.tsx
// Cinematic letterbox while a cutscene plays: black bars slide in from
// the top and bottom, each with a faint light edge, and a quiet skip hint.

interface CutsceneOverlayProps {
  letterbox: boolean;
  skippable: boolean;
  touch: boolean;
  onSkip: () => void;
}

export function CutsceneOverlay({ letterbox, skippable, touch, onSkip }: CutsceneOverlayProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {letterbox && (
        <>
          <div className="absolute inset-x-0 top-0 h-[11vh] border-b border-white/15 bg-black [animation:letterbox-top-in_700ms_ease-out]" />
          <div className="absolute inset-x-0 bottom-0 h-[11vh] border-t border-white/15 bg-black [animation:letterbox-bottom-in_700ms_ease-out]" />
        </>
      )}
      {skippable && (
        <button
          onClick={onSkip}
          className="pointer-events-auto absolute bottom-[3.5vh] right-6 text-[11px] tracking-[0.2em] text-white/45 uppercase transition-colors hover:text-white/80"
        >
          {touch ? "Tap to skip" : "Space to skip"}
        </button>
      )}
    </div>
  );
}
