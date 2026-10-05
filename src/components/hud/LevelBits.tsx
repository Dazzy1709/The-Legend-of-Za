// src/components/hud/LevelBits.tsx
// Small shared pieces of the leveling UI: the round level badge (player
// and weapons) and the thin XP bar under it.

interface LevelBadgeProps {
  level: number;
  /** "md" beside the player's health bar, "sm" beside weapons. */
  size?: "md" | "sm";
  tone?: "player" | "weapon";
  title?: string;
}

export function LevelBadge({ level, size = "sm", tone = "weapon", title }: LevelBadgeProps) {
  const dims = size === "md" ? "h-10 w-10 text-sm" : "h-6 w-6 text-[10px]";
  const colors =
    tone === "player"
      ? "border-emerald-500/80 bg-emerald-950/90 text-emerald-100"
      : "border-amber-500/80 bg-stone-950/90 text-amber-100";
  return (
    <div
      title={title ?? `Level ${level}`}
      className={`flex shrink-0 items-center justify-center rounded-full border-2 font-semibold tabular-nums shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${dims} ${colors}`}
    >
      {level}
    </div>
  );
}

interface XpBarProps {
  xp: number;
  /** XP needed for the next level; 0 means max level. */
  xpToNext: number;
  /** Show "120 / 400 XP" under the bar. */
  showText?: boolean;
  tone?: "player" | "weapon";
  className?: string;
}

export function XpBar({ xp, xpToNext, showText = false, tone = "player", className = "" }: XpBarProps) {
  const maxed = xpToNext <= 0;
  const pct = maxed ? 100 : Math.min(100, Math.round((xp / xpToNext) * 100));
  return (
    <div className={className}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-sm border border-black/40 bg-stone-900">
        <div className={`h-full ${tone === "player" ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
      </div>
      {showText && (
        <div className="mt-0.5 text-[9px] leading-none text-stone-400 tabular-nums sm:text-[10px]">
          {maxed ? "MAX LEVEL" : `${xp.toLocaleString()} / ${xpToNext.toLocaleString()} XP`}
        </div>
      )}
    </div>
  );
}
