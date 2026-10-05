// src/components/hud/Crosshair.tsx
// A simple always-on crosshair, Minecraft-style — shown any time you're
// actually exploring (not just while a gun is equipped/aiming), since the
// character's facing now always matches the camera direction this marks
// the center of, whether or not you're currently holding a weapon.

export function Crosshair() {
  return (
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center z-10">
      <div className="relative w-5 h-5">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 w-0.5 h-1.5 bg-stone-100/80" />
        <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-0.5 h-1.5 bg-stone-100/80" />
        <div className="absolute top-1/2 left-0 -translate-y-1/2 h-0.5 w-1.5 bg-stone-100/80" />
        <div className="absolute top-1/2 right-0 -translate-y-1/2 h-0.5 w-1.5 bg-stone-100/80" />
      </div>
    </div>
  );
}
