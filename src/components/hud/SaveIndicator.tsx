// src/components/hud/SaveIndicator.tsx
// A small "Saving… / Game saved" note in the corner whenever the game saves.

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const text = state === "saving" ? "Saving…" : state === "saved" ? "Game saved" : "Couldn't save — will retry";
  return (
    <div className="pointer-events-none fixed right-4 top-[7.5rem] compact:right-2! compact:top-[12rem]! z-20 flex items-center gap-2 rounded-md bg-stone-950/80 px-3 py-1.5 text-xs text-stone-300 shadow-lg">
      <span className={`h-2 w-2 rounded-full ${state === "saving" ? "animate-pulse bg-amber-400" : state === "saved" ? "bg-emerald-400" : "bg-rose-500"}`} />
      {text}
    </div>
  );
}
