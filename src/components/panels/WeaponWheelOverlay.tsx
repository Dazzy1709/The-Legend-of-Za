// src/components/panels/WeaponWheelOverlay.tsx
import { useEffect } from "react";
import type { WeaponKind } from "../../types";
import type { WeaponProgress } from "../../babylon/progression/Progression";
import { LevelBadge, XpBar } from "../hud/LevelBits";

interface WeaponWheelOverlayProps {
  equipped: WeaponKind | null;
  /** Weapons the player has; the others show locked. */
  owned: WeaponKind[];
  onSelect: (weapon: WeaponKind) => void;
  onUnequip: () => void;
  onClose: () => void;
  /** Each weapon's level/XP — shown as a badge beside it and a bar under its icon. */
  weapons?: Record<WeaponKind, WeaponProgress>;
}

interface WheelSlot {
  kind: WeaponKind;
  label: string;
  icon: string;
  key: string;
}

const SLOTS: WheelSlot[] = [
  { kind: "sword", label: "Sword", icon: "🗡️", key: "1" },
  { kind: "pickaxe", label: "Pickaxe", icon: "⛏️", key: "2" },
  { kind: "gun", label: "Gun", icon: "🔫", key: "3" },
];

const RADIUS_PX = 110;

export function WeaponWheelOverlay({ equipped, owned, onSelect, onUnequip, onClose, weapons }: WeaponWheelOverlayProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const slot = SLOTS.find((s) => s.key === e.key);
      if (slot) onSelect(slot.kind);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onSelect, onClose]);

  return (
    <div
      className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="relative" style={{ width: RADIUS_PX * 2 + 100, height: RADIUS_PX * 2 + 100 }}>
        {/* faint guide ring */}
        <div
          className="absolute border border-amber-800/40 rounded-full"
          style={{
            width: RADIUS_PX * 2,
            height: RADIUS_PX * 2,
            left: 50,
            top: 50,
          }}
        />

        {SLOTS.map((slot, i) => {
          const angle = (i / SLOTS.length) * Math.PI * 2 - Math.PI / 2;
          const x = RADIUS_PX + Math.cos(angle) * RADIUS_PX + 50;
          const y = RADIUS_PX + Math.sin(angle) * RADIUS_PX + 50;
          const isEquipped = equipped === slot.kind;
          const isOwned = owned.includes(slot.kind);
          const progress = isOwned ? weapons?.[slot.kind] : undefined;
          return (
            <button
              key={slot.kind}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(slot.kind);
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isEquipped
                  ? "bg-amber-700 border-amber-300 text-stone-950"
                  : "bg-stone-900 border-amber-800/60 text-stone-100 hover:bg-stone-800"
              }`}
              style={{ left: x, top: y }}
            >
              <span className={`text-2xl leading-none ${isOwned ? "" : "opacity-30 grayscale"}`}>{slot.icon}</span>
              <span className="text-[10px] font-medium">{isOwned ? slot.label : `🔒 ${slot.label}`}</span>
              <span className="text-[9px] text-stone-400">{slot.key}</span>
              {progress && <XpBar xp={progress.xp} xpToNext={progress.xpToNext} tone="weapon" className="w-12" />}
              {progress && (
                <span className="absolute -right-3 -top-1">
                  <LevelBadge level={progress.level} title={`${slot.label} — level ${progress.level}, ${progress.damage} damage`} />
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnequip();
          }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-stone-950 border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-500 flex items-center justify-center text-xs"
        >
          Unequip
        </button>
      </div>
    </div>
  );
}
