// src/components/overlays/RotateDevice.tsx
// The game is played sideways on phones and tablets. Held upright, a
// touch screen gets this "turn your device" card over everything
// (pure CSS, so it follows the device the moment it turns). Where the
// browser allows it (Android), starting a game also goes full screen and
// locks the screen sideways — see services/device.ts.

export function RotateDevice() {
  return (
    <div className="fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-5 bg-stone-950 px-8 text-center [@media(orientation:portrait)_and_(pointer:coarse)]:flex">
      <div className="[animation:rotate-hint_2.4s_ease-in-out_infinite]">
        <svg viewBox="0 0 48 48" className="h-16 w-16 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="14" y="4" width="20" height="40" rx="4" />
          <line x1="21" y1="38" x2="27" y2="38" />
        </svg>
      </div>
      <p className="text-xs font-bold tracking-[0.4em] text-amber-500/90 uppercase">The Legend of Za</p>
      <p className="max-w-xs font-serif text-2xl text-stone-100">Turn your device sideways to play</p>
      <p className="max-w-xs text-sm text-stone-400">Tip: add the game to your home screen for full screen play.</p>
    </div>
  );
}
