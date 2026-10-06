// src/components/controls/VirtualJoystick.tsx
import { useRef, useState } from "react";

interface VirtualJoystickProps {
  /** Called continuously while dragging with x/z each in [-1, 1] (analog — partial drag gives partial values), and once with (0, 0) on release. */
  onMove: (x: number, z: number) => void;
}

const BASE_RADIUS = 52;
const THUMB_RADIUS = 26;

export function VirtualJoystick({ onMove }: VirtualJoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);
  const [thumbOffset, setThumbOffset] = useState({ x: 0, y: 0 });

  function updateFromClientPoint(clientX: number, clientY: number) {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);
    const maxDist = BASE_RADIUS - THUMB_RADIUS * 0.3;
    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }
    setThumbOffset({ x: dx, y: dy });

    // Screen-up (negative Y) is "forward" (+z); right (positive X) is +x.
    onMove(dx / maxDist, -dy / maxDist);
  }

  function handlePointerDown(e: React.PointerEvent) {
    activePointerId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromClientPoint(e.clientX, e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (activePointerId.current !== e.pointerId) return;
    updateFromClientPoint(e.clientX, e.clientY);
  }

  function release() {
    activePointerId.current = null;
    setThumbOffset({ x: 0, y: 0 });
    onMove(0, 0);
  }

  return (
    <div
      ref={baseRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      className="fixed bottom-8 left-8 compact:bottom-3! compact:left-4! rounded-full bg-stone-900/50 border border-stone-500/40 touch-none select-none z-20"
      style={{ width: BASE_RADIUS * 2, height: BASE_RADIUS * 2 }}
    >
      <div
        className="absolute rounded-full bg-stone-200/80 border border-stone-400/60"
        style={{
          width: THUMB_RADIUS * 2,
          height: THUMB_RADIUS * 2,
          left: BASE_RADIUS - THUMB_RADIUS + thumbOffset.x,
          top: BASE_RADIUS - THUMB_RADIUS + thumbOffset.y,
        }}
      />
    </div>
  );
}
