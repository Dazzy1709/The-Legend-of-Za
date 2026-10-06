// src/components/hud/CoinToast.tsx
// "Picked up 5 coins" — a small box under the gold counter. Pickups that
// come in close together add up in the same box rather than stacking.

export interface CoinPickup {
  /** Changes with every pickup, so the box pops again. */
  id: number;
  amount: number;
}

export function CoinToast({ pickup }: { pickup: CoinPickup | null }) {
  if (!pickup) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-[4.5rem] z-20 sm:right-4 compact:right-2! compact:top-[9.75rem]!">
      <div
        key={pickup.id}
        className="flex items-center gap-2 rounded-md border border-amber-600/60 bg-stone-950/90 px-3 py-1.5 text-sm text-amber-200 shadow-lg [animation:levelup-in_250ms_ease-out]"
      >
        <span className="text-amber-300" aria-hidden>
          ◆
        </span>
        Picked up <span className="tabular-nums font-semibold text-amber-100">{pickup.amount}</span> {pickup.amount === 1 ? "coin" : "coins"}
      </div>
    </div>
  );
}
