// src/components/overlays/DeathScreen.tsx
// Dark Souls-style "YOU DIED": fades in when the player dies and stays up
// while they lie there, until the engine respawns them (behind a fade to
// black, so it never just pops away).

export function DeathScreen() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/70 [animation:death-screen-in_800ms_ease-out]">
      <div className="font-serif text-5xl tracking-[0.3em] text-red-700 drop-shadow-[0_0_20px_rgba(153,27,27,0.8)] sm:text-7xl">YOU DIED</div>
    </div>
  );
}
