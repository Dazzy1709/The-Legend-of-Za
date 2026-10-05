// src/components/hud/HUD.tsx
import type { PlayerState, WeaponKind } from "../../types";
import { STRAINS } from "../../content/items/strains";
import { ItemIcon } from "../shared/ItemIcon";
import { LevelBadge, XpBar } from "./LevelBits";
import { BuffList, StaminaBar } from "./StatusMeters";
import type { GameEngine } from "../../babylon/core/GameEngine";
import type { ProgressionSnapshot } from "../../babylon/progression/Progression";

interface HUDProps {
  player: PlayerState;
  equippedWeapon: WeaponKind | null;
  onOpenInventory: () => void;
  /** Replaces the old onOpenWeaponWheel — selection now lives directly in the side dock below, so there's nothing to "open" anymore. Same handler a weapon-wheel onSelect would have called. */
  onSelectWeapon: (weapon: WeaponKind) => void;
  /** Same handler a weapon-wheel onUnequip would have called. */
  onUnequipWeapon: () => void;
  /** Consumes one of the given strain from inventory and applies its heal — the same slot the old weapon wheel would have listed a consumable item under. */
  onUseHealingLeaf: (strainId: string) => void;
  /** Level, XP and weapon levels (null until the engine has started). */
  progression: ProgressionSnapshot | null;
  /** For the stamina bar and buff timers, which change every frame. */
  engineRef: React.MutableRefObject<GameEngine | null>;
}

interface WeaponSlot {
  kind: WeaponKind;
  label: string;
  icon: string;
  key: string;
}

const WEAPON_SLOTS: WeaponSlot[] = [
  { kind: "sword", label: "Sword", icon: "🗡️", key: "1" },
  { kind: "pickaxe", label: "Pickaxe", icon: "⛏️", key: "2" },
  { kind: "gun", label: "Gun", icon: "🔫", key: "3" },
];

const PLATE = "border border-amber-900/50 bg-stone-950/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_4px_16px_rgba(0,0,0,0.55)]";

export function HUD({ player, equippedWeapon, onOpenInventory, onSelectWeapon, onUnequipWeapon, onUseHealingLeaf, progression, engineRef }: HUDProps) {
  const hpPct = Math.round((player.hp / player.maxHp) * 100);

  return (
    <>
      {/* Floating status plates — sit over the game view rather than pushing
          it down, so the world reads as the full screen and the HUD reads
          as an overlay on top of it. The wrapper is click-through
          (pointer-events-none); only the plates themselves need clicks. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 sm:gap-3 sm:p-4">
        <div className={`pointer-events-auto flex min-w-0 flex-col gap-1.5 rounded-md px-3.5 py-2.5 ${PLATE}`}>
          <span className="truncate font-serif text-sm text-amber-200 sm:text-base">{player.name}</span>
          <div className="flex items-center gap-2.5">
            {/* Level, in a round badge right beside the health bar. */}
            {progression && <LevelBadge level={progression.level} size="md" tone="player" title={`Level ${progression.level}`} />}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="relative h-3 w-28 overflow-hidden rounded-sm border border-black/40 bg-stone-900 sm:w-40">
                  <div
                    className="h-full bg-linear-to-b from-rose-500 via-rose-600 to-rose-800 transition-all duration-300"
                    style={{ width: `${hpPct}%` }}
                  />
                  <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
                </div>
                <span className="text-[10px] text-stone-400 tabular-nums sm:text-xs">
                  {player.hp}/{player.maxHp}
                </span>
              </div>
              {/* XP toward the next level, right under the health bar. */}
              {progression && <XpBar xp={progression.xp} xpToNext={progression.xpToNext} showText className="w-28 sm:w-40" />}
            </div>
          </div>
          {/* Sprint stamina (cardio), under the level, health and XP. */}
          <StaminaBar engineRef={engineRef} />
          <BuffList engineRef={engineRef} />
        </div>

        <div className={`pointer-events-auto flex shrink-0 items-center gap-3 rounded-md px-3.5 py-2.5 ${PLATE}`}>
          <span className="flex items-center gap-1 text-xs tabular-nums text-amber-300 sm:text-sm">
            <span aria-hidden>◆</span>
            {player.gold}
          </span>
          <button
            onClick={onOpenInventory}
            className="rounded-md border border-stone-700/60 bg-stone-800 px-2.5 py-1.5 text-xs text-stone-200 transition-colors hover:bg-stone-700 sm:text-sm"
          >
            Bag
          </button>
        </div>
      </div>

      {/* Weapon dock — always visible along the right edge instead of a
          separate wheel overlay you had to open. Tapping the equipped
          slot again unequips, mirroring the wheel's own center "Unequip"
          button. */}
      <div className="pointer-events-none fixed right-3 top-[42%] z-10 flex -translate-y-1/2 flex-col items-end gap-2 sm:right-4 sm:gap-2.5">
        {WEAPON_SLOTS.map((slot) => {
          const isEquipped = equippedWeapon === slot.kind;
          const weapon = progression?.weapons[slot.kind];
          return (
            // Each weapon: its level in a round badge beside it, its XP bar underneath.
            <div key={slot.kind} className="flex items-center gap-1.5">
              {weapon && <LevelBadge level={weapon.level} title={`${slot.label} — level ${weapon.level}, ${weapon.damage} damage`} />}
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => (isEquipped ? onUnequipWeapon() : onSelectWeapon(slot.kind))}
                  title={`${slot.label} (${slot.key})${weapon ? ` — level ${weapon.level}, ${weapon.damage} damage` : ""}`}
                  className={`group pointer-events-auto relative flex h-12 w-12 flex-col items-center justify-center rounded-md border-2 transition-all sm:h-14 sm:w-14 ${
                    isEquipped
                      ? "border-amber-400 bg-amber-700/90 text-stone-950 shadow-[0_0_14px_rgba(251,191,36,0.45)]"
                      : "border-stone-700/70 bg-stone-950/85 text-stone-200 hover:border-amber-700/70 hover:bg-stone-900"
                  }`}
                >
                  <span className="text-lg leading-none sm:text-xl">{slot.icon}</span>
                  <span className={`pointer-events-none absolute left-1 top-0.5 text-[8px] ${isEquipped ? "text-stone-900/70" : "text-stone-500"}`}>
                    {slot.key}
                  </span>
                </button>
                {weapon && <XpBar xp={weapon.xp} xpToNext={weapon.xpToNext} tone="weapon" className="w-12 sm:w-14" />}
              </div>
            </div>
          );
        })}
        <button
          onClick={onUnequipWeapon}
          title="Unequip"
          className={`pointer-events-auto ml-auto flex h-12 w-12 items-center justify-center rounded-md border-2 text-xs transition-all sm:h-14 sm:w-14 ${
            equippedWeapon === null
              ? "border-amber-400 bg-amber-700/90 text-stone-950 shadow-[0_0_14px_rgba(251,191,36,0.45)]"
              : "border-stone-700/70 bg-stone-950/85 text-stone-400 hover:border-stone-500 hover:text-stone-200"
          }`}
        >
          ✋
        </button>
      </div>

      {/* Healing leaves — left edge, mirroring the weapon dock's own
          style on the right. "Keep the 3 leaves on the side, but make
          these the 3 first items in the inventory" — this reads
          directly off the front of the player's own inventory array
          now, not a fixed list, so reordering items in the Satchel
          (InventoryPanel) changes what shows here too. Each slot shows
          how many of that item the player actually has and disables
          itself at 0, rather than letting a click silently do
          nothing. */}
      <div className="pointer-events-none fixed left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2 sm:left-4 sm:gap-2.5">
        {player.inventory.slice(0, 3).map((entry) => {
          const strain = STRAINS[entry.strainId];
          if (!strain) return null;
          const disabled = entry.quantity <= 0;
          return (
            <button
              key={entry.strainId}
              onClick={() => !disabled && onUseHealingLeaf(entry.strainId)}
              disabled={disabled}
              title={strain.effect.kind === "heal" ? `${strain.name} (heals ${strain.effect.amount})` : strain.name}
              className={`group pointer-events-auto relative flex h-12 w-12 flex-col items-center justify-center rounded-md border-2 transition-all sm:h-14 sm:w-14 ${
                disabled
                  ? "cursor-not-allowed border-stone-800/60 bg-stone-950/60 text-stone-600"
                  : "border-emerald-700/70 bg-stone-950/85 text-stone-200 hover:border-emerald-400 hover:bg-emerald-950/40"
              }`}
            >
              <ItemIcon strainId={entry.strainId} size={30} className={disabled ? "opacity-40" : ""} />
              <span className="pointer-events-none absolute -right-2 -top-1 rounded-full border border-black/40 bg-emerald-800 px-1 text-[9px] text-emerald-100 sm:-right-2.5">
                {entry.quantity}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
