// src/components/hud/TimerRings.tsx
// Small radial countdown rings just under the crosshair:
// - ComboTimer: while a melee combo's follow-up window is open — how
//   long is left to land the next hit before the chain resets.
// - ReloadTimer: while a gun reloads — a little smaller and brighter, in
//   the same spot (the two never show at once: one is melee, one is guns).
// Both poll the engine via requestAnimationFrame (the same pattern
// Minimap.tsx uses) and write the ring's dash offset straight to the SVG,
// so they count down smoothly every frame without re-rendering React.

import { useEffect, useRef, useState } from "react";
import { GameEngine } from "../../babylon/core/GameEngine";

interface RingStyle {
  size: number;
  stroke: number;
  color: string;
  opacity: number;
}

interface RingTimerProps {
  engineRef: React.MutableRefObject<GameEngine | null>;
  /** 0-1 remaining fraction (1 = full ring, 0 = hidden). */
  readFraction: (engine: GameEngine) => number;
  style: RingStyle;
}

function RingTimer({ engineRef, readFraction, style }: RingTimerProps) {
  const ringRef = useRef<SVGCircleElement>(null);
  const [visible, setVisible] = useState(false);
  const radius = (style.size - style.stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const engine = engineRef.current;
      const fraction = engine ? readFraction(engine) : 0;
      const isVisible = fraction > 0;
      // Only re-renders on the rare frame this flips — the countdown
      // itself is the direct SVG write below.
      setVisible((prev) => (prev !== isVisible ? isVisible : prev));
      if (ringRef.current) ringRef.current.style.strokeDashoffset = String(circumference * (1 - fraction));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engineRef, readFraction, circumference]);

  if (!visible) return null;
  const c = style.size / 2;
  return (
    <div className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-10" style={{ top: `calc(50% + ${26 + (30 - style.size) / 2}px)` }}>
      <svg width={style.size} height={style.size} viewBox={`0 0 ${style.size} ${style.size}`}>
        <circle cx={c} cy={c} r={radius} fill="none" stroke="rgba(28, 25, 20, 0.6)" strokeWidth={style.stroke} />
        <circle
          ref={ringRef}
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          stroke={style.color}
          strokeWidth={style.stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={0}
          transform={`rotate(-90 ${c} ${c})`}
          opacity={style.opacity}
        />
      </svg>
    </div>
  );
}

const COMBO_STYLE: RingStyle = { size: 30, stroke: 4, color: "#f6c453", opacity: 0.4 };
const RELOAD_STYLE: RingStyle = { size: 22, stroke: 3, color: "#fff4c7", opacity: 0.85 };

const readCombo = (engine: GameEngine) => engine.getMeleeComboWindowFraction();
const readReload = (engine: GameEngine) => engine.getReloadFraction();

export function ComboTimer({ engineRef }: { engineRef: React.MutableRefObject<GameEngine | null> }) {
  return <RingTimer engineRef={engineRef} readFraction={readCombo} style={COMBO_STYLE} />;
}

export function ReloadTimer({ engineRef }: { engineRef: React.MutableRefObject<GameEngine | null> }) {
  return <RingTimer engineRef={engineRef} readFraction={readReload} style={RELOAD_STYLE} />;
}
