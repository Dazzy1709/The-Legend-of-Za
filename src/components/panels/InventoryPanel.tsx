// src/components/panels/InventoryPanel.tsx
import { useRef, useState } from "react";
import type { PlayerState } from "../../types.ts";
import { STRAINS } from "../../content/items/strains";
import { ItemIcon } from "../shared/ItemIcon";

interface InventoryPanelProps {
  player: PlayerState;
  onUseStrain: (strainId: string) => void;
  /** Drop the item in slot `from` onto slot `to` — see the reducer's MOVE_INVENTORY_ITEM for swap/move rules. */
  onMoveItem: (from: number, to: number) => void;
  onClose: () => void;
}

// Minecraft-style grid: fixed slot count, empty slots render as bare
// sockets. The first 3 slots are exactly what HUD's own side dock
// shows — dragging items around here changes both at once, since the
// dock reads directly off the front of this same inventory array.
const SLOT_COUNT = 24;
/** Pointer travel (px) before a press on an item counts as a drag rather than a click. */
const DRAG_THRESHOLD = 6;

interface DragState {
  from: number;
  strainId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** True once the pointer has moved past DRAG_THRESHOLD. */
  active: boolean;
  /** Slot currently under the pointer, if any. */
  over: number | null;
}

const GRID_COLUMNS = 6;

/** Keeps a slot's tooltip inside the panel: edge columns anchor to their inner side instead of centering. */
function tooltipPosition(index: number): string {
  const column = index % GRID_COLUMNS;
  if (column === 0) return "left-0";
  if (column === GRID_COLUMNS - 1) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

/** The slot index under a screen point — slots carry a data-slot attribute. */
function slotAt(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-slot]");
  const value = el?.getAttribute("data-slot");
  return value == null ? null : Number(value);
}

export function InventoryPanel({ player, onUseStrain, onMoveItem, onClose }: InventoryPanelProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // A drag ends with a click event on the same button; this swallows it so
  // dropping an item doesn't also use it.
  const suppressClickRef = useRef(false);

  // Pointer events rather than HTML5 drag-and-drop, so dragging works the
  // same with a mouse and on touch screens.
  const handlePointerDown = (e: React.PointerEvent, index: number, strainId: string) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: index, strainId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false, over: null });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const active = drag.active || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, active, over: active ? slotAt(e.clientX, e.clientY) : null });
    if (active) setHoveredIndex(null);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.active) {
      suppressClickRef.current = true;
      const to = slotAt(e.clientX, e.clientY);
      if (to !== null && to !== drag.from) onMoveItem(drag.from, to);
    }
    setDrag(null);
  };

  const handleClick = (strainId: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onUseStrain(strainId);
  };

  return (
    <div className="fixed inset-0 z-20 bg-black/60 flex items-end sm:items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-lg bg-stone-800 border-4 border-stone-950 rounded-md shadow-2xl overflow-hidden" style={{ fontFamily: "monospace" }}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-stone-900 border-b-4 border-stone-950">
          <span className="text-stone-200 text-sm tracking-wide">Satchel</span>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-100 text-sm">
            ✕
          </button>
        </div>

        <p className="px-4 pt-3 text-[11px] text-stone-400">
          Drag items to rearrange — the first 3 slots also show on the side dock. Click an item to use it.
        </p>

        <div className="p-4 grid grid-cols-6 gap-1.5">
          {Array.from({ length: SLOT_COUNT }).map((_, index) => {
            const entry = player.inventory[index];
            const strain = entry ? STRAINS[entry.strainId] : undefined;
            const isDockSlot = index < 3;
            const isDragSource = drag?.active && drag.from === index;
            const isDropTarget = drag?.active && drag.over === index && drag.from !== index;
            return (
              <div
                key={index}
                data-slot={index}
                className="relative aspect-square"
                onMouseEnter={() => strain && !drag && setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <button
                  onClick={() => strain && handleClick(strain.id)}
                  onPointerDown={(e) => strain && handlePointerDown(e, index, strain.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => setDrag(null)}
                  disabled={!strain}
                  title={strain?.name}
                  className={`h-full w-full touch-none select-none rounded-sm border-2 flex items-center justify-center transition-colors ${
                    strain
                      ? "border-stone-950 bg-stone-700 hover:bg-stone-600 cursor-grab active:cursor-grabbing"
                      : "border-stone-700/60 bg-stone-900/60 cursor-default"
                  } ${isDockSlot ? "ring-2 ring-emerald-600/70" : ""} ${isDropTarget ? "border-amber-400! bg-stone-600!" : ""}`}
                >
                  {strain && <ItemIcon strainId={strain.id} className={`h-4/5 w-4/5 ${isDragSource ? "opacity-30" : ""}`} />}
                </button>
                {entry && entry.quantity > 1 && !isDragSource && (
                  <span className="pointer-events-none absolute bottom-0.5 right-1 text-[10px] text-white" style={{ textShadow: "1px 1px 0 #000" }}>
                    {entry.quantity}
                  </span>
                )}
                {hoveredIndex === index && strain && (
                  <div className={`pointer-events-none absolute top-full z-10 mt-1.5 w-44 ${tooltipPosition(index)} rounded-sm border border-stone-950 bg-stone-950/95 px-2 py-1.5 text-left shadow-xl`}>
                    <p className="text-stone-100 text-[11px]">{strain.name}</p>
                    <p className="text-stone-400 text-[10px] mt-0.5 leading-snug">{strain.description}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* The item following the pointer while dragging. */}
      {drag?.active && (
        <div className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-1/2 drop-shadow-lg" style={{ left: drag.x, top: drag.y }}>
          <ItemIcon strainId={drag.strainId} size={40} />
        </div>
      )}
    </div>
  );
}
