// src/components/overlays/LevelUpBanner.tsx
// Short messages under the HUD — the player or a weapon levelling up
// (what went up, and to how much), or resting at the safe house. Each
// one shows for a few seconds (App removes it); several in a row stack.

export interface LevelUpNotice {
  id: number;
  title: string;
  lines: string[];
  /** Character level-ups are green, weapon level-ups gold, resting at the safe house blue. */
  tone: "level" | "weapon" | "rest" | "mission";
}

const TONE_BOX: Record<LevelUpNotice["tone"], string> = {
  level: "border-emerald-500/60 bg-emerald-950/85",
  weapon: "border-amber-500/60 bg-amber-950/85",
  rest: "border-sky-400/60 bg-sky-950/85",
  mission: "border-amber-400/70 bg-stone-950/90",
};
const TONE_TITLE: Record<LevelUpNotice["tone"], string> = {
  level: "text-emerald-200",
  weapon: "text-amber-200",
  rest: "text-sky-200",
  mission: "text-amber-200",
};

export function LevelUpBanner({ notices }: { notices: LevelUpNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
      {notices.map((n) => (
        <div
          key={n.id}
          className={`min-w-56 rounded-md border px-4 py-2.5 text-center shadow-xl backdrop-blur-sm [animation:levelup-in_350ms_ease-out] ${
            TONE_BOX[n.tone]
          }`}
        >
          <p className={`font-serif text-lg tracking-wide ${TONE_TITLE[n.tone]}`}>{n.title}</p>
          {n.lines.map((line) => (
            <p key={line} className="text-xs text-stone-200 tabular-nums">
              {line}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
