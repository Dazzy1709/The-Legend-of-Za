// src/components/shared/ItemIcon.tsx
// One small drawn image per item (strain), used everywhere an item is
// shown: the Satchel, the side dock, the Apothecary and the combat picker.
// Plain inline SVG, so there are no image files to load and each icon
// scales cleanly to whatever slot size it's drawn at.

import type { ReactElement } from "react";

interface ItemIconProps {
  strainId: string;
  /** Rendered size in pixels (the icon is square). */
  size?: number;
  className?: string;
}

interface LeafStyle {
  fill: string;
  vein: string;
  /** Leaflet width relative to its length — indica is broad, sativa slender. */
  breadth: number;
  /** Number of leaflets (odd). */
  leaflets: 5 | 7 | 9;
  accent?: "star" | "frost" | "crown" | "wisps" | "strength" | "shield" | "bolt" | "heart";
}

const LEAF_STYLES: Record<string, LeafStyle> = {
  indica: { fill: "#16a34a", vein: "#bbf7d0", breadth: 0.36, leaflets: 7 },
  sativa: { fill: "#84cc16", vein: "#ecfccb", breadth: 0.2, leaflets: 9 },
  ogKush: { fill: "#15803d", vein: "#fde68a", breadth: 0.32, leaflets: 7, accent: "crown" },
  blueDream: { fill: "#0ea5e9", vein: "#e0f2fe", breadth: 0.3, leaflets: 7 },
  northernLights: { fill: "#0891b2", vein: "#cffafe", breadth: 0.28, leaflets: 7, accent: "star" },
  kush: { fill: "#b45309", vein: "#fef3c7", breadth: 0.34, leaflets: 5, accent: "frost" },
  haze: { fill: "#65a30d", vein: "#f7fee7", breadth: 0.22, leaflets: 7, accent: "wisps" },
  gorillaGlue: { fill: "#4d7c0f", vein: "#d9f99d", breadth: 0.4, leaflets: 7, accent: "strength" },
  whiteWidow: { fill: "#6b8f71", vein: "#ffffff", breadth: 0.3, leaflets: 7, accent: "shield" },
  durbanPoison: { fill: "#a3e635", vein: "#ecfccb", breadth: 0.2, leaflets: 9, accent: "bolt" },
  granddaddyPurple: { fill: "#7e22ce", vein: "#f3e8ff", breadth: 0.36, leaflets: 7, accent: "heart" },
};

/** A fan of leaflets radiating from a stem, longest in the middle. */
function Leaf({ style }: { style: LeafStyle }) {
  const baseX = 16;
  const baseY = 25;
  const count = style.leaflets;
  const spread = count === 9 ? 160 : count === 7 ? 150 : 130;
  const leaflets = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1) - 0.5; // -0.5..0.5
    const angle = t * spread;
    const length = 15 * (1 - Math.abs(t) * 0.95);
    return { angle, length };
  });
  return (
    <g>
      <line x1={baseX} y1={baseY} x2={baseX} y2={30} stroke={style.fill} strokeWidth={1.6} strokeLinecap="round" />
      {leaflets.map(({ angle, length }, i) => (
        <g key={i} transform={`rotate(${angle} ${baseX} ${baseY})`}>
          <path
            d={`M ${baseX} ${baseY}
                Q ${baseX + length * style.breadth} ${baseY - length * 0.5} ${baseX} ${baseY - length}
                Q ${baseX - length * style.breadth} ${baseY - length * 0.5} ${baseX} ${baseY} Z`}
            fill={style.fill}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={0.5}
          />
          <line x1={baseX} y1={baseY} x2={baseX} y2={baseY - length * 0.85} stroke={style.vein} strokeWidth={0.45} opacity={0.8} />
        </g>
      ))}
      {style.accent === "star" && (
        <path d="M26 3 L27 6 L30 6.5 L27.5 8.3 L28.3 11.3 L26 9.6 L23.7 11.3 L24.5 8.3 L22 6.5 L25 6 Z" fill="#e0f2fe" />
      )}
      {style.accent === "crown" && (
        <path d="M21 8 L22 3.5 L24.5 6 L26 3 L27.5 6 L30 3.5 L31 8 Z" fill="#facc15" stroke="#854d0e" strokeWidth={0.5} />
      )}
      {style.accent === "frost" &&
        [
          [10, 9],
          [21, 7],
          [13, 15],
          [19, 13],
          [16, 6],
        ].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.9} fill="#fffbeb" opacity={0.9} />)}
      {/* Stat-buff strains get a small badge for the stat they boost. */}
      {style.accent === "strength" && <path d="M22 4 h7 v3 h-2 v3 h-3 v-3 h-2 Z" fill="#fca5a5" stroke="#7f1d1d" strokeWidth={0.5} />}
      {style.accent === "shield" && <path d="M26 3 L30.5 4.5 V8 Q30.5 11 26 12.5 Q21.5 11 21.5 8 V4.5 Z" fill="#cbd5e1" stroke="#334155" strokeWidth={0.6} />}
      {style.accent === "bolt" && <path d="M27 2 L23 8 H26 L24.5 13 L29.5 6.5 H26.5 Z" fill="#fde047" stroke="#854d0e" strokeWidth={0.5} />}
      {style.accent === "heart" && <path d="M26 12 C 20 8, 21.5 3, 26 5.8 C 30.5 3, 32 8, 26 12 Z" fill="#fb7185" stroke="#881337" strokeWidth={0.5} />}
      {style.accent === "wisps" && (
        <path
          d="M24 12 C 27 10, 23 7, 26 5 M27.5 13 C 30.5 11, 26.5 8, 29.5 6"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={0.9}
          strokeLinecap="round"
          opacity={0.85}
        />
      )}
    </g>
  );
}

function VapePen() {
  return (
    <g transform="rotate(-35 16 16)">
      <rect x="13" y="3" width="6" height="5" rx="2" fill="#1f2937" />
      <rect x="12.5" y="7.5" width="7" height="20" rx="2.5" fill="#94a3b8" stroke="#334155" strokeWidth={0.8} />
      <rect x="12.5" y="10" width="7" height="5" fill="#64748b" />
      <circle cx="16" cy="23.5" r="1.3" fill="#34d399" />
    </g>
  );
}

function Hash() {
  return (
    <g>
      <path d="M5 13 L16 8 L27 13 L16 18 Z" fill="#b45309" />
      <path d="M5 13 L16 18 L16 26 L5 21 Z" fill="#78350f" />
      <path d="M27 13 L16 18 L16 26 L27 21 Z" fill="#92400e" />
      <path d="M12 12.6 L16 11 L20 12.6 L16 14.4 Z" fill="none" stroke="#fde68a" strokeWidth={0.8} opacity={0.75} />
    </g>
  );
}

function Wax() {
  return (
    <g>
      <rect x="7" y="9" width="18" height="4" rx="1.5" fill="#e5e7eb" stroke="#6b7280" strokeWidth={0.6} />
      <path d="M8 13 H24 V24 Q24 27 21 27 H11 Q8 27 8 24 Z" fill="rgba(226,232,240,0.35)" stroke="#94a3b8" strokeWidth={0.8} />
      <path d="M10 22 Q12 16 16 18 Q20 15 22 21 Q22 25 16 25 Q10 25 10 22 Z" fill="#facc15" stroke="#ca8a04" strokeWidth={0.6} />
      <path d="M13 20 Q15 18.5 17 19.5" fill="none" stroke="#fef9c3" strokeWidth={0.8} strokeLinecap="round" />
    </g>
  );
}

const SPECIAL_ICONS: Record<string, () => ReactElement> = {
  vapePen: VapePen,
  hash: Hash,
  wax: Wax,
};

export function ItemIcon({ strainId, size = 24, className }: ItemIconProps) {
  const Special = SPECIAL_ICONS[strainId];
  const leafStyle = LEAF_STYLES[strainId] ?? LEAF_STYLES.indica;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      {Special ? <Special /> : <Leaf style={leafStyle} />}
    </svg>
  );
}
