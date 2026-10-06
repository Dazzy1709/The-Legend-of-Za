// src/components/panels/WeaponStorePanel.tsx
// The Weapons Store in the Handelsviertel: buy weapons with gold. Some
// stay locked until the story gets far enough (see content/items/weapons.ts).

import { useState } from "react";
import type { WeaponKind } from "../../types";
import { WEAPON_STORE } from "../../content/items/weapons";

const ICONS: Record<WeaponKind, string> = { sword: "🗡️", pickaxe: "⛏️", gun: "🔫" };

interface WeaponStorePanelProps {
  gold: number;
  owned: WeaponKind[];
  /** Whether a story flag is set (locks items until the story gets there). */
  hasFlag: (flag: string) => boolean;
  onBuy: (weapon: WeaponKind) => void;
  onClose: () => void;
}

export function WeaponStorePanel({ gold, owned, hasFlag, onBuy, onClose }: WeaponStorePanelProps) {
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 p-3 sm:items-center sm:p-6">
      <div className="w-full max-w-md overflow-hidden rounded-t-xl border border-red-900/50 bg-stone-900 shadow-2xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-red-900/40 bg-stone-950 px-4 py-3">
          <div>
            <span className="font-serif text-sm tracking-wider text-red-300 uppercase">Weapons Store</span>
            <span className="ml-2 text-xs text-stone-500">{gold} gold</span>
          </div>
          <button onClick={onClose} className="text-sm text-stone-400 hover:text-stone-200">
            Close
          </button>
        </div>

        {problem && <div className="border-b border-red-900/50 bg-red-950/60 px-4 py-2 text-xs text-red-200">{problem}</div>}

        <div className="max-h-[60dvh] divide-y divide-stone-800 overflow-y-auto">
          {WEAPON_STORE.map((item) => {
            const locked = item.requiresFlag ? !hasFlag(item.requiresFlag) : false;
            const isOwned = owned.includes(item.kind);
            return (
              <div key={item.kind} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-stone-700/60 bg-stone-800 text-2xl ${locked ? "opacity-40 grayscale" : ""}`}>
                    {ICONS[item.kind]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-stone-100">
                      {item.name} {locked && <span className="text-stone-500">🔒</span>}
                    </p>
                    <p className="text-xs text-stone-500">{locked ? item.lockedHint : item.description}</p>
                  </div>
                </div>
                {isOwned ? (
                  <span className="shrink-0 text-xs font-bold tracking-wider text-emerald-400 uppercase">Owned</span>
                ) : (
                  <button
                    disabled={locked}
                    onClick={() => {
                      if (gold < item.price) {
                        setProblem(`Not enough gold for the ${item.name}: you need ${item.price - gold} more.`);
                        return;
                      }
                      setProblem(null);
                      onBuy(item.kind);
                    }}
                    className="shrink-0 rounded-md bg-red-800 px-3 py-1.5 text-xs text-red-50 hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
                  >
                    {locked ? "Locked" : `${item.price}g`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
