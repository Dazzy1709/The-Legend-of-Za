// src/components/hud/Minimap.tsx
// A rotating, player-centered local-area minimap — shows a fixed WORLD
// radius around the player (not the whole city at once), rotated so the
// player's current facing is always "up." Built from the same pure,
// Babylon-free generator functions CityBuilder itself uses to lay the
// real city out (generateCityLayout, buildAvenueFrontage,
// generateOutskirtsHomesteads, all exported from CityBuilder.ts
// specifically for this), plus the hand-placed landmarks and district
// geometry — not a live second camera render, and not a hand-drawn
// approximation either: this is the actual building layout.
//
// Rendering is split in two for cost reasons. The full world (every
// building, the full street grid, district regions, the wall, the lake,
// landmark and interactable-NPC markers) is rendered ONCE, at load, onto
// an offscreen canvas sized to cover the whole world at this component's
// fixed world-to-pixel scale. Every frame, the visible canvas just
// re-draws that one offscreen image with a translate+rotate transform
// (to re-center it on the player's current position and rotate it to
// the player's current facing) — one drawImage call, not re-drawing
// hundreds of buildings and dozens of streets 60 times a second.

import { useEffect, useRef, useState } from "react";
import { GameEngine } from "../../babylon/core/GameEngine";
import {
  buildAvenueFrontage,
  CELL_SIZE,
  CITY_SPAN,
  generateCityLayout,
  generateOutskirtsHomesteads,
  RING_ROAD_RADIUS,
  RING_ROAD_WIDTH,
  streetHalfLength,
  WALL_RADIUS,
} from "../../babylon/world/CityBuilder";
import { ADEL_RING_OUTER_RADIUS, DISTRICTS } from "../../babylon/world/Districts";
import { BUILDINGS, LAKE_CENTER, LAKE_RADIUS, NPC_PLACEMENTS, SAFE_HOUSES } from "../../content/cities/kushtar/placements";
import type { BuildingPlacement } from "../../types";

const MAP_WIDTH = 232; // px — the visible rectangular widget, bottom-right
const MAP_HEIGHT = 156;
const MAP_PADDING = 6; // px between the widget's edge and its usable drawing area
const MAP_CORNER = 10; // px rounding of the widget's corners
const MAP_RADIUS = MAP_HEIGHT / 2; // the shorter half-extent — sets the scale, so LOCAL_VIEW_RADIUS fits top to bottom
/** World-space radius actually shown around the player at any moment — this is what makes it a local view rather than the whole city shrunk down; buildings and streets need to be at a scale large enough to actually read. */
const LOCAL_VIEW_RADIUS = 55;
const WORLD_TO_MAP_SCALE = (MAP_RADIUS - MAP_PADDING) / LOCAL_VIEW_RADIUS;

/** The offscreen cache needs to cover the whole world (the player can be anywhere), at the same scale as the local view above. */
const OFFSCREEN_WORLD_RADIUS = WALL_RADIUS + 12;
const OFFSCREEN_SIZE = Math.ceil(OFFSCREEN_WORLD_RADIUS * WORLD_TO_MAP_SCALE * 2);
const OFFSCREEN_CENTER = OFFSCREEN_SIZE / 2;
const GRID_HALF = Math.ceil(CITY_SPAN / CELL_SIZE);

interface MinimapProps {
  engineRef: React.MutableRefObject<GameEngine | null>;
  /** Position classes — bottom-right by default. */
  className?: string;
}

/** World (x, z) -> offscreen-canvas (x, y). North (+z) is up, east (+x) is right — same convention bearingDeg()/facingYaw already use. */
function worldToOffscreen(x: number, z: number): [number, number] {
  return [OFFSCREEN_CENTER + x * WORLD_TO_MAP_SCALE, OFFSCREEN_CENTER - z * WORLD_TO_MAP_SCALE];
}

function drawDistrictWedge(ctx: CanvasRenderingContext2D, bearingCenterDeg: number, color: string) {
  const steps = 20;
  const startDeg = bearingCenterDeg - 60;
  const endDeg = bearingCenterDeg + 60;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const deg = startDeg + ((endDeg - startDeg) * i) / steps;
    const rad = (deg * Math.PI) / 180;
    const [cx, cy] = worldToOffscreen(OFFSCREEN_WORLD_RADIUS * Math.sin(rad), OFFSCREEN_WORLD_RADIUS * Math.cos(rad));
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  for (let i = steps; i >= 0; i--) {
    const deg = startDeg + ((endDeg - startDeg) * i) / steps;
    const rad = (deg * Math.PI) / 180;
    const [cx, cy] = worldToOffscreen(ADEL_RING_OUTER_RADIUS * Math.sin(rad), ADEL_RING_OUTER_RADIUS * Math.cos(rad));
    ctx.lineTo(cx, cy);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: BuildingPlacement, color: string) {
  const [cx, cy] = worldToOffscreen(b.position.x, b.position.z);
  const w = Math.max(1.5, b.width * WORLD_TO_MAP_SCALE);
  const d = Math.max(1.5, b.depth * WORLD_TO_MAP_SCALE);
  ctx.fillStyle = color;
  ctx.fillRect(cx - w / 2, cy - d / 2, w, d);
}

/** Renders the whole world once onto an offscreen canvas — everything from generateCityLayout/buildAvenueFrontage/generateOutskirtsHomesteads (the same pure functions CityBuilder itself calls to build the real city), the full street grid, district regions, the wall, the lake, and markers for landmarks and interactable NPCs. Deliberately excludes ambient crowd NPCs — CrowdManager instances aren't individually tracked anywhere accessible outside Babylon, and per the request only NPCs the player can actually talk to should show up here. */
function renderWorldToOffscreen(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = OFFSCREEN_SIZE;
  canvas.height = OFFSCREEN_SIZE;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#2b3a24"; // outskirts/countryside base
  ctx.fillRect(0, 0, OFFSCREEN_SIZE, OFFSCREEN_SIZE);

  for (const d of DISTRICTS) {
    if (d.id === "noble") continue;
    drawDistrictWedge(ctx, d.bearingDeg, d.palette[0]);
  }
  const noble = DISTRICTS.find((d) => d.id === "noble");
  const [ringCx, ringCy] = worldToOffscreen(0, 0);
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ADEL_RING_OUTER_RADIUS * WORLD_TO_MAP_SCALE, 0, Math.PI * 2);
  ctx.fillStyle = noble?.palette[0] ?? "#8a8578";
  ctx.fill();

  // Full street grid — every ordinary grid line, not just the two main
  // avenues, so there's an actual street layout to navigate by. Main
  // avenues (pos===0) are drawn thicker/brighter, matching how they
  // visually stand out as the boulevards in the real city.
  for (let k = -GRID_HALF; k <= GRID_HALF; k++) {
    const pos = k * CELL_SIZE;
    if (Math.abs(pos) >= RING_ROAD_RADIUS) continue;
    const isMainAvenue = pos === 0;
    ctx.strokeStyle = isMainAvenue ? "rgba(235, 226, 205, 0.75)" : "rgba(200, 190, 165, 0.35)";
    ctx.lineWidth = isMainAvenue ? 4 : 2;
    // Same lengths CityBuilder builds: ordinary streets end on the ring
    // road, only the main avenues run on to the wall gates.
    const half = isMainAvenue ? WALL_RADIUS : streetHalfLength(pos);

    const nsA = worldToOffscreen(pos, half);
    const nsB = worldToOffscreen(pos, -half);
    ctx.beginPath();
    ctx.moveTo(nsA[0], nsA[1]);
    ctx.lineTo(nsB[0], nsB[1]);
    ctx.stroke();

    const ewA = worldToOffscreen(half, pos);
    const ewB = worldToOffscreen(-half, pos);
    ctx.beginPath();
    ctx.moveTo(ewA[0], ewA[1]);
    ctx.lineTo(ewB[0], ewB[1]);
    ctx.stroke();
  }

  // The ring road just inside the wall.
  const [ringCx2, ringCy2] = worldToOffscreen(0, 0);
  ctx.beginPath();
  ctx.arc(ringCx2, ringCy2, RING_ROAD_RADIUS * WORLD_TO_MAP_SCALE, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(235, 226, 205, 0.6)";
  ctx.lineWidth = Math.max(2, RING_ROAD_WIDTH * WORLD_TO_MAP_SCALE);
  ctx.stroke();

  // The lake.
  const [lakeCx, lakeCy] = worldToOffscreen(LAKE_CENTER.x, LAKE_CENTER.z);
  ctx.beginPath();
  ctx.arc(lakeCx, lakeCy, LAKE_RADIUS * WORLD_TO_MAP_SCALE, 0, Math.PI * 2);
  ctx.fillStyle = "#1c4c63";
  ctx.fill();

  // Every generated building — the actual procedural city layout, not
  // just the hand-placed landmarks.
  const layout = generateCityLayout();
  for (const b of layout.buildings) drawBuilding(ctx, b, "#9c8f74");
  for (const b of buildAvenueFrontage()) drawBuilding(ctx, b, "#8a7e66");
  for (const b of generateOutskirtsHomesteads()) drawBuilding(ctx, b, "#6b7a4e");

  // Hand-placed landmarks on top — the palace stands out; everything
  // else in BUILDINGS gets a plainer marker.
  for (const b of BUILDINGS) {
    const [cx, cy] = worldToOffscreen(b.position.x, b.position.z);
    const isPalace = b.id === "palace-gate";
    ctx.beginPath();
    ctx.arc(cx, cy, isPalace ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isPalace ? "#ffd76a" : "#e8dcc0";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  // The city wall.
  const [wallCx, wallCy] = worldToOffscreen(0, 0);
  ctx.beginPath();
  ctx.arc(wallCx, wallCy, WALL_RADIUS * WORLD_TO_MAP_SCALE, 0, Math.PI * 2);
  ctx.strokeStyle = "#c9b98a";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Named, interactable NPCs only — never the ambient wandering crowd.
  for (const npc of NPC_PLACEMENTS) {
    const [cx, cy] = worldToOffscreen(npc.position.x, npc.position.z);
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffdd88";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.75;
    ctx.fill();
    ctx.stroke();
  }

  // The player's safe house — a small green house glyph.
  for (const house of SAFE_HOUSES) {
    const [cx, cy] = worldToOffscreen(house.building.position.x, house.building.position.z);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 5.5, cy - 1);
    ctx.lineTo(cx + 4, cy - 1);
    ctx.lineTo(cx + 4, cy + 4.5);
    ctx.lineTo(cx - 4, cy + 4.5);
    ctx.lineTo(cx - 4, cy - 1);
    ctx.lineTo(cx - 5.5, cy - 1);
    ctx.closePath();
    ctx.fillStyle = "#34d399";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  return canvas;
}

export function Minimap({ engineRef, className = "bottom-4 right-4" }: MinimapProps) {
  const visibleCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | undefined>(undefined);

  // The whole world only ever needs rendering once — nothing about the
  // city layout changes at runtime. A lazy useState initializer runs it
  // exactly once, before the first frame draws it.
  const [offscreen] = useState(renderWorldToOffscreen);

  useEffect(() => {
    const ctx = visibleCanvasRef.current?.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

      const engine = engineRef.current;
      if (engine && offscreen) {
        const pos = engine.getPlayerPosition();
        // Uses the camera's own look direction, not the character
        // body's facing — the body now always turns to face wherever
        // it's actually moving (PlayerController's update()), which is
        // frequently a different direction from wherever the player is
        // actually looking (strafing, standing still while looking
        // around). The minimap should rotate with what the player is
        // looking at, not with which way the character model happens to
        // be walking.
        const facing = engine.getCameraForwardYaw();
        const [playerOffX, playerOffY] = worldToOffscreen(pos.x, pos.z);

        // Clip to the rounded-rectangle widget before drawing the (much
        // larger) offscreen image into it.
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(MAP_PADDING / 2, MAP_PADDING / 2, MAP_WIDTH - MAP_PADDING, MAP_HEIGHT - MAP_PADDING, MAP_CORNER - 2);
        ctx.clip();

        // Re-centers the offscreen world image on the player's current
        // position and rotates it by -facing, so whichever way the
        // player is currently facing always ends up pointing "up" —
        // verified this exact sign/order numerically (all four cardinal
        // directions) before relying on it: rotating the WORLD by
        // -facing while keeping the player arrow itself fixed pointing
        // up achieves the same "forward is always up" result as rotating
        // the arrow by +facing against a fixed north-up world did in the
        // previous version, just inverted, since here the world moves
        // and the player doesn't.
        ctx.translate(MAP_WIDTH / 2, MAP_HEIGHT / 2);
        ctx.rotate(-facing);
        ctx.translate(-playerOffX, -playerOffY);
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();
      }

      // The Budmobile where it's parked — a green dot that moves with it.
      if (engine && offscreen) {
        const vehicle = engine.getVehicleMarker();
        if (!vehicle.ridden) {
          const pos = engine.getPlayerPosition();
          const facing = engine.getCameraForwardYaw();
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(MAP_PADDING / 2, MAP_PADDING / 2, MAP_WIDTH - MAP_PADDING, MAP_HEIGHT - MAP_PADDING, MAP_CORNER - 2);
          ctx.clip();
          ctx.translate(MAP_WIDTH / 2, MAP_HEIGHT / 2);
          ctx.rotate(-facing);
          ctx.beginPath();
          ctx.arc((vehicle.x - pos.x) * WORLD_TO_MAP_SCALE, -(vehicle.z - pos.z) * WORLD_TO_MAP_SCALE, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = "#86efac";
          ctx.strokeStyle = "#14532d";
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      // The player marker — fixed at the exact center, always pointing
      // straight up, since the world rotates around it instead of the
      // other way around.
      ctx.save();
      ctx.translate(MAP_WIDTH / 2, MAP_HEIGHT / 2);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fillStyle = "#ff5555";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [engineRef, offscreen]);

  return (
    <div
      className={`absolute z-20 overflow-hidden rounded-[10px] border-2 border-amber-900/60 bg-stone-950/80 shadow-lg ${className}`}
      style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
    >
      <canvas ref={visibleCanvasRef} width={MAP_WIDTH} height={MAP_HEIGHT} className="absolute inset-0" />
    </div>
  );
}
