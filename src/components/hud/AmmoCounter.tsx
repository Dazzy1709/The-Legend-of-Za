// src/components/hud/AmmoCounter.tsx
// Rounds left in the equipped gun's magazine, under the weapon dock.
// Polls the engine each frame but only re-renders when the numbers change.

import { useEffect, useState } from "react";
import { GameEngine } from "../../babylon/core/GameEngine";

type Ammo = ReturnType<GameEngine["getAmmo"]>;

export function AmmoCounter({ engineRef }: { engineRef: React.MutableRefObject<GameEngine | null> }) {
  const [ammo, setAmmo] = useState<Ammo>(null);

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const next = engineRef.current?.getAmmo() ?? null;
      setAmmo((prev) =>
        prev?.inMagazine === next?.inMagazine && prev?.magazineSize === next?.magazineSize && prev?.reloading === next?.reloading
          ? prev
          : next
      );
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [engineRef]);

  if (!ammo) return null;
  const empty = ammo.inMagazine === 0;
  return (
    <div className="pointer-events-none fixed bottom-[184px] right-4 z-10 compact:bottom-[9rem]! compact:right-2!">
      <div className="rounded-md border border-amber-900/50 bg-stone-950/85 px-2.5 py-1 text-center font-mono text-sm tabular-nums shadow-lg">
        <span className={empty ? "text-rose-400" : "text-stone-100"}>{ammo.inMagazine}</span>
        <span className="text-stone-500"> / {ammo.magazineSize}</span>
        {ammo.reloading && <div className="text-[10px] tracking-wide text-amber-200">RELOADING</div>}
      </div>
    </div>
  );
}
