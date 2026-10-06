// src/components/panels/ShopPanel.tsx
import { useState } from "react";
import type { PlayerState } from "../../types.ts";
import { STRAINS, STRAIN_PRICES } from "../../content/items/strains";
import { ItemIcon } from "../shared/ItemIcon";

interface ShopPanelProps {
  player: PlayerState;
  onBuyStrain: (strainId: string) => void;
  onClose: () => void;
}

// Everything the Apothecary sells, in display order — the healing leaves
// and other products, then the temporary stat boosts.
const SHOP_STRAIN_IDS = [
  "indica", "sativa", "ogKush", "blueDream", "northernLights", "vapePen", "hash", "wax",
  // Temporary stat boosts
  "gorillaGlue", "whiteWidow", "durbanPoison", "granddaddyPurple", "kush", "haze",
];

export function ShopPanel({ player, onBuyStrain, onClose }: ShopPanelProps) {
  // "The shop menu stays open, but a little popup appears" — rather
  // than disabling the buy button outright, every button stays
  // clickable; clicking one the player can't afford shows this instead
  // of calling onBuyStrain at all.
  const [insufficientFunds, setInsufficientFunds] = useState<{ name: string; missing: number } | null>(null);

  const handleBuy = (strainId: string) => {
    const strain = STRAINS[strainId];
    const price = STRAIN_PRICES[strainId];
    if (!strain || price === undefined) return;
    if (player.gold < price) {
      setInsufficientFunds({ name: strain.name, missing: price - player.gold });
      return;
    }
    setInsufficientFunds(null);
    onBuyStrain(strainId);
  };

  return (
    <div className="fixed inset-0 z-20 bg-black/60 flex items-end sm:items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-md bg-stone-900 border border-emerald-900/50 rounded-t-xl sm:rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-stone-950 border-b border-emerald-900/40">
          <div>
            <span className="font-serif text-emerald-300 text-sm">Kushtar Apothecary</span>
            <span className="ml-2 text-stone-500 text-xs">{player.gold} gold</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200 text-sm">
            Close
          </button>
        </div>

        {insufficientFunds && (
          <div className="px-4 py-2 bg-red-950/60 border-b border-red-900/50 text-red-200 text-xs">
            Not enough gold for {insufficientFunds.name} — you need {insufficientFunds.missing} more.
          </div>
        )}

        <div className="max-h-[60dvh] overflow-y-auto divide-y divide-stone-800">
          {SHOP_STRAIN_IDS.map((strainId) => {
            const strain = STRAINS[strainId];
            const price = STRAIN_PRICES[strainId];
            if (!strain || price === undefined) return null;
            const owned = player.inventory.find((i) => i.strainId === strainId)?.quantity ?? 0;
            return (
              <div key={strainId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-700/60 bg-stone-800">
                    <ItemIcon strainId={strainId} size={32} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-stone-100 text-sm truncate">
                      {strain.name} <span className="text-stone-500">x{owned} owned</span>
                    </p>
                    <p className="text-stone-500 text-xs truncate">{strain.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleBuy(strainId)}
                  className="shrink-0 rounded-md text-xs px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-50"
                >
                  {price}g
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
