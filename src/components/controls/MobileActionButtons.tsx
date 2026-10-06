// src/components/controls/MobileActionButtons.tsx
interface MobileActionButtonsProps {
  onJumpChange: (pressed: boolean) => void;
  onAttackChange: (pressed: boolean) => void;
  onAimTap: () => void;
  aiming: boolean;
}

/** A round touch button that reports press/release (not just tap) — needed for jump/attack, which read as held keys. */
function HoldButton({
  label,
  className,
  onPressChange,
}: {
  label: string;
  className: string;
  onPressChange: (pressed: boolean) => void;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onPressChange(true);
      }}
      onPointerUp={() => onPressChange(false)}
      onPointerLeave={() => onPressChange(false)}
      onPointerCancel={() => onPressChange(false)}
      className={`touch-none select-none rounded-full border flex items-center justify-center font-medium active:scale-95 transition-transform ${className}`}
    >
      {label}
    </button>
  );
}

export function MobileActionButtons({ onJumpChange, onAttackChange, onAimTap, aiming }: MobileActionButtonsProps) {
  return (
    <div className="fixed bottom-8 right-8 z-20 flex items-end gap-3 compact:bottom-3! compact:right-3! compact:gap-2!">
      <button
        onClick={onAimTap}
        className={`touch-none select-none w-14 h-14 compact:w-12! compact:h-12! rounded-full border flex items-center justify-center text-xl active:scale-95 transition-transform ${
          aiming
            ? "bg-amber-700 border-amber-300 text-stone-950"
            : "bg-stone-900/70 border-stone-500/40 text-stone-200"
        }`}
        title="Toggle aim"
      >
        🎯
      </button>
      <HoldButton
        label="⤒"
        className="w-14 h-14 compact:w-12! compact:h-12! bg-stone-900/70 border-stone-500/40 text-stone-200 text-2xl"
        onPressChange={onJumpChange}
      />
      <HoldButton
        label="⚔"
        className="w-20 h-20 compact:w-16! compact:h-16! bg-stone-900/70 border-amber-500/50 text-amber-200 text-3xl"
        onPressChange={onAttackChange}
      />
    </div>
  );
}
