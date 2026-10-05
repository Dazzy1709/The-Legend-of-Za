// src/babylon/world/TextureFactory.ts
// Textures drawn procedurally with a 2D canvas and wrapped in a Babylon
// DynamicTexture — signs, labels, markers, particles, sky and a few
// surfaces. Photographed surface textures live under public/textures and
// load through PbrTextureSet.ts instead.

import { DynamicTexture, Scene, Texture } from "@babylonjs/core";

function ctx2d(texture: DynamicTexture): CanvasRenderingContext2D {
  return texture.getContext() as unknown as CanvasRenderingContext2D;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  base: string,
  variants: string[],
  count: number
) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = variants[Math.floor(Math.random() * variants.length)];
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.6 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function makeTexture(
  scene: Scene,
  name: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  uScale = 8,
  vScale = 8
): Texture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  draw(ctx2d(tex));
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = uScale;
  tex.vScale = vScale;
  return tex;
}

export function createFoliageTexture(scene: Scene): Texture {
  return makeTexture(scene, "foliageTex", 96, (ctx) => {
    speckle(ctx, 96, "#2f4a26", ["#3a5a2e", "#264020", "#446634", "#1f351a"], 500);
  });
}

/**
 * A deterministic hash so a building's window layout is stable across
 * re-renders — needed so the diffuse and emissive textures agree on which
 * windows are "lit" (see createFacadePair).
 */
function seededRandom(seed: number, i: number): number {
  const s = Math.sin(seed * 999.7 + i * 37.219) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A building facade, as a matched pair: `diffuse` is the normal daytime
 * texture, `emissive` is black everywhere except the same lit windows,
 * drawn bright — feed `emissive` to `material.emissiveTexture` and it'll
 * glow convincingly under a GlowLayer at night without the geometry
 * needing separate window meshes.
 */
export type FacadeStyle = "timber" | "stone" | "plaster";

export function createFacadePair(
  scene: Scene,
  baseHex: string,
  cols: number,
  rows: number,
  seed: number,
  litChance = 0.45,
  style: FacadeStyle = "timber"
): { diffuse: Texture; emissive: Texture } {
  const lit: boolean[] = [];
  for (let i = 0; i < cols * rows; i++) lit.push(seededRandom(seed, i) > 1 - litChance);

  // Style changes window proportions too, not just the wall behind them —
  // "stone" (royal/church) reads grander with fewer, narrower windows;
  // "plaster" (shop) reads commercial with wider, shorter ones (storefront
  // glass, not a cottage window).
  const winW = style === "stone" ? 0.38 : style === "plaster" ? 0.62 : 0.5;
  const winH = style === "plaster" ? 0.42 : 0.6;

  const drawWindows = (ctx: CanvasRenderingContext2D, litColor: string, unlitColor: string | null) => {
    const marginX = 256 / cols;
    const marginY = 256 / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const w = marginX * winW;
        const h = marginY * winH;
        const x = c * marginX + (marginX - w) / 2;
        const y = r * marginY + (marginY - h) / 2;
        if (lit[i]) {
          ctx.fillStyle = litColor;
          ctx.fillRect(x, y, w, h);
        } else if (unlitColor) {
          ctx.fillStyle = unlitColor;
          ctx.fillRect(x, y, w, h);
        }
        if (unlitColor) {
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, w, h);
        }
      }
    }
  };

  const drawWallBase = (ctx: CanvasRenderingContext2D) => {
    if (style === "stone") {
      // Muted, grey-shifted, with a visible mortar-joint grid — reads as
      // cut masonry, not painted plaster. Royal/church use this.
      ctx.fillStyle = "#8a8578";
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      const block = 32;
      for (let y = 0; y <= 256; y += block) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(256, y + 0.5);
        ctx.stroke();
      }
      for (let y = 0; y < 256; y += block) {
        const offset = (y / block) % 2 === 0 ? 0 : block / 2;
        for (let x = -block; x <= 256 + block; x += block) {
          ctx.beginPath();
          ctx.moveTo(x + offset + 0.5, y);
          ctx.lineTo(x + offset + 0.5, y + block);
          ctx.stroke();
        }
      }
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(0,0,0,${seededRandom(seed, i + 1000) * 0.05})`;
        ctx.fillRect(seededRandom(seed, i + 2000) * 256, seededRandom(seed, i + 3000) * 256, 2, 2);
      }
    } else if (style === "plaster") {
      // Smooth, bright, minimal speckle — a clean commercial storefront
      // face rather than a weathered cottage wall.
      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, 256, 256);
      const overlay = ctx.createLinearGradient(0, 0, 0, 256);
      overlay.addColorStop(0, "rgba(255,255,255,0.12)");
      overlay.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 150; i++) {
        ctx.fillStyle = `rgba(0,0,0,${seededRandom(seed, i + 1000) * 0.03})`;
        ctx.fillRect(seededRandom(seed, i + 2000) * 256, seededRandom(seed, i + 3000) * 256, 2, 2);
      }
    } else {
      // "timber" — the original cottage look, unchanged.
      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(0,0,0,${seededRandom(seed, i + 1000) * 0.06})`;
        ctx.fillRect(seededRandom(seed, i + 2000) * 256, seededRandom(seed, i + 3000) * 256, 2, 2);
      }
    }
  };

  const diffuse = makeTexture(
    scene,
    `facadeTex-${baseHex}-${cols}x${rows}-${seed}-${style}`,
    256,
    (ctx) => {
      drawWallBase(ctx);
      drawWindows(ctx, "#f6d999", "#2a2f3a");
    },
    1,
    1
  );

  const emissive = makeTexture(
    scene,
    `facadeEmissive-${baseHex}-${cols}x${rows}-${seed}-${style}`,
    256,
    (ctx) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 256, 256);
      drawWindows(ctx, "#ffdd88", null);
    },
    1,
    1
  );

  return { diffuse, emissive };
}

export function createWaterTexture(scene: Scene): Texture {
  return makeTexture(
    scene,
    "waterTex",
    128,
    (ctx) => {
      ctx.fillStyle = "#1c4c63";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        const y = (i / 14) * 128 + Math.sin(i) * 4;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(32, y + 6, 96, y - 6, 128, y);
        ctx.stroke();
      }
    },
    6,
    6
  );
}

/**
 * A small floating marker (a diamond over a dot, classic "someone here has
 * something to say" RPG iconography) — used above NPCs the player can
 * actually talk to, so it's visible at a glance before walking up, not just
 * once already in interaction range.
 */
export function createTalkableMarkerTexture(scene: Scene): Texture {
  const size = 32;
  const tex = new DynamicTexture("talkableMarkerTex", { width: size, height: size }, scene, true);
  const ctx = ctx2d(tex);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  // soft glow behind the marker
  const gradient = ctx.createRadialGradient(cx, 12, 1, cx, 12, 10);
  gradient.addColorStop(0, "rgba(255, 221, 120, 0.85)");
  gradient.addColorStop(1, "rgba(255, 221, 120, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // diamond marker
  ctx.fillStyle = "#ffdd78";
  ctx.strokeStyle = "#7a5a10";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, 4);
  ctx.lineTo(cx + 7, 12);
  ctx.lineTo(cx, 20);
  ctx.lineTo(cx - 7, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/**
 * A single soft-edged raindrop streak — a thin vertical gradient blob,
 * transparent at both ends so it fades in/out rather than showing a hard
 * rectangular edge. Sized as a small square texture (32x32, well under
 * the other textures here since a particle system samples it once per
 * particle at a tiny on-screen size, not tiled across a surface) with
 * uScale/vScale left at 1 — a particle texture should never repeat.
 */
export function createRaindropTexture(scene: Scene): Texture {
  const tex = makeTexture(
    scene,
    "raindropTex",
    32,
    (ctx) => {
      ctx.clearRect(0, 0, 32, 32);
      const gradient = ctx.createLinearGradient(0, 0, 0, 32);
      gradient.addColorStop(0, "rgba(210, 225, 235, 0)");
      gradient.addColorStop(0.5, "rgba(210, 225, 235, 0.65)");
      gradient.addColorStop(1, "rgba(210, 225, 235, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(13, 0, 6, 32);
    },
    1,
    1
  );
  // makeTexture() doesn't set this itself (most of its other callers are
  // opaque surface textures that don't need it) — without it explicitly
  // set here, the gradient's alpha channel is ignored and the
  // transparent parts render as solid black instead of fading out,
  // which is the same class of bug createHumanoidSpriteSheet and
  // createTalkableMarkerTexture already had to handle for their own
  // transparent textures.
  tex.hasAlpha = true;
  return tex;
}

/**
 * A tiling cloud pattern — soft, irregular white blobs (clustered radial
 * gradients, several per "clump" so they read as puffy cloud shapes
 * rather than plain circles) on a transparent background. Every blob is
 * drawn nine times, once at its actual position plus each of its eight
 * wrapped positions one tile-width/height away — the standard cheap trick
 * for a seamlessly-tiling procedural texture: any blob near an edge gets
 * a copy appearing from the opposite edge, so tiling this (uScale/vScale
 * > 1, as SkyBuilder does) shows no visible seam. This is a one-time
 * setup cost (texture generation, not a per-frame one), so the 9x
 * redundant draws per blob — most of which land off-canvas and are
 * simply clipped — aren't worth optimizing away with edge-detection
 * logic.
 */
export function createCloudTexture(scene: Scene): Texture {
  const size = 256;
  const tex = makeTexture(
    scene,
    "cloudTex",
    size,
    (ctx) => {
      ctx.clearRect(0, 0, size, size);

      const drawBlob = (x: number, y: number, r: number, alpha: number) => {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
        gradient.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };

      const clumpCount = 5;
      for (let c = 0; c < clumpCount; c++) {
        const cx = Math.random() * size;
        const cy = Math.random() * size;
        const blobCount = 4 + Math.floor(Math.random() * 4);
        for (let b = 0; b < blobCount; b++) {
          const ox = (Math.random() - 0.5) * 70;
          const oy = (Math.random() - 0.5) * 34;
          const r = 22 + Math.random() * 32;
          const alpha = 0.45 + Math.random() * 0.4;
          for (const wx of [-size, 0, size]) {
            for (const wy of [-size, 0, size]) {
              drawBlob(cx + ox + wx, cy + oy + wy, r, alpha);
            }
          }
        }
      }
    },
    3,
    3
  );
  tex.hasAlpha = true;
  return tex;
}

/**
 * One shared texture atlas holding every name in `names`, each rendered
 * as its own cell in a grid — built once and reused across every crowd
 * member's name-label sprite (via SpriteManager + Sprite.cellIndex, see
 * CrowdManager), rather than a separate texture per NPC. That's what
 * keeps hundreds of ambient NPCs each showing a different name down to
 * one shared texture instead of hundreds of individual ones.
 * `cellWidth`/`cellHeight` must match what the SpriteManager built from
 * this atlas is configured with.
 */
export function createNameLabelAtlas(
  scene: Scene,
  names: string[],
  cellWidth: number,
  cellHeight: number
): Texture {
  // A single row (was a roughly-square multi-row grid) — the actual,
  // confirmed cause of "npc naming conventions are all messed up": the
  // reported mismatch pattern (seller's label showing wizard's model,
  // warriorFemale showing men, women showing warriorMale, wizard
  // showing seller) maps exactly to "every label shows the entry from
  // index+3, mod 6" — precisely one full row-swap in what was a 3-col
  // x 2-row grid for 6 names. invertV (required on the sprite itself to
  // stop the text rendering upside down) evidently doesn't just flip
  // text within its own cell — it also flips which row of cells gets
  // sampled in a multi-row atlas. Rather than try to precisely counter
  // that interaction and risk getting it wrong again, a single row has
  // no second row for anything to flip into: cellIndex now maps
  // one-to-one with column position, with nothing left for invertV to
  // confuse.
  const cols = names.length;
  const width = cols * cellWidth;
  const height = cellHeight;

  const tex = new DynamicTexture("nameLabelAtlas", { width, height }, scene, true);
  const ctx = ctx2d(tex);
  ctx.clearRect(0, 0, width, height);
  ctx.font = `bold ${Math.floor(cellHeight * 0.42)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  names.forEach((name, i) => {
    const cx = i * cellWidth + cellWidth / 2;
    const cy = cellHeight / 2;
    // A dark outline behind the text so it stays readable over any
    // background (bright sky, a light-colored wall, another character)
    // without needing a solid backing panel.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(name, cx, cy);
    ctx.fillStyle = "#fdf6e3";
    ctx.fillText(name, cx, cy);
  });

  tex.update();
  tex.hasAlpha = true;
  return tex;
}
/**
 * A wooden signboard face — a title line plus an optional smaller
 * subtitle line, painted onto a weathered plank-colored panel. Used for
 * both the district entry signs (Ortsschilder) and the city gate sign
 * (Stadtschild) — the same texture generator with different text/size,
 * rather than two near-duplicate functions.
 */
export function createSignTexture(
  scene: Scene,
  title: string,
  subtitle: string | null,
  widthPx = 512,
  heightPx = 256
): Texture {
  const tex = new DynamicTexture("signTexture", { width: widthPx, height: heightPx }, scene, true);
  const ctx = ctx2d(tex);

  // Weathered plank background — a few vertical board seams and a subtle
  // grain speckle, not a flat color panel. Two rounds of "still too
  // dark" feedback now — the first lightening (#6b4a2f -> #a3764a) was
  // too small a change. This is a real jump to a genuinely light
  // pine/birch wood tone, not another small nudge, with the text
  // switched from light-on-medium to dark-on-light to match (light
  // cream text was losing contrast as the background got lighter).
  ctx.fillStyle = "#dab27a";
  ctx.fillRect(0, 0, widthPx, heightPx);
  speckle(ctx, widthPx, "#dab27a", ["#c99f68", "#e6c18e", "#cfa671"], 900);
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 2;
  const plankCount = 5;
  for (let i = 1; i < plankCount; i++) {
    const x = (widthPx / plankCount) * i;
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, heightPx - 6);
    ctx.stroke();
  }

  // A carved-in border frame.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, widthPx - 20, heightPx - 20);
  ctx.strokeStyle = "rgba(255,250,235,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, widthPx - 32, heightPx - 32);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const titleY = subtitle ? heightPx * 0.4 : heightPx * 0.5;
  ctx.font = `bold ${Math.floor(heightPx * 0.22)}px serif`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeText(title, widthPx / 2, titleY);
  ctx.fillStyle = "#2c1c10";
  ctx.fillText(title, widthPx / 2, titleY);

  if (subtitle) {
    const subtitleY = heightPx * 0.72;
    ctx.font = `${Math.floor(heightPx * 0.11)}px serif`;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.strokeText(subtitle, widthPx / 2, subtitleY);
    ctx.fillStyle = "#3d2818";
    ctx.fillText(subtitle, widthPx / 2, subtitleY);
  }

  tex.update();
  return tex;
}
/**
 * A shop signboard's own texture — dark storefront-sign background with
 * white text, rather than reusing createSignTexture's light wood panel
 * (which was reported as making shop sign text hard to see; light text
 * on a light-ish tan background is a real, separate problem from that
 * function's own district/city-sign use, where dark text already has
 * good contrast against the same background).
 */
export function createShopSignTexture(scene: Scene, title: string, widthPx = 512, heightPx = 224): Texture {
  const tex = new DynamicTexture("shopSignTexture", { width: widthPx, height: heightPx }, scene, true);
  const ctx = ctx2d(tex);

  ctx.fillStyle = "#241c14";
  ctx.fillRect(0, 0, widthPx, heightPx);
  speckle(ctx, widthPx, "#241c14", ["#1c1610", "#2c2118", "#1f1812"], 700);

  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, widthPx - 16, heightPx - 16);
  ctx.strokeStyle = "rgba(230,200,140,0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, widthPx - 28, heightPx - 28);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.floor(heightPx * 0.26)}px serif`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(title, widthPx / 2, heightPx / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(title, widthPx / 2, heightPx / 2);

  tex.update();
  return tex;
}

/** A soft radial-gradient disc (opaque center fading smoothly to fully transparent at the edge) — used as the visible sun's own opacity map, so it reads as a glowing disc rather than a hard-edged flat circle. */
export function createSunDiscTexture(scene: Scene, size = 256): Texture {
  const tex = new DynamicTexture("sunDiscTexture", { width: size, height: size }, scene, true);
  const ctx = ctx2d(tex);
  const cx = size / 2;
  const cy = size / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  return tex;
}

/** A damage number rendered onto a transparent square — used as a floating damage-number plane's own opacity map (paired with an emissive-colored material so the text itself reads as the material's own emissive color, not this texture's). */
export function createDamageNumberTexture(scene: Scene, text: string, size = 128): Texture {
  const tex = new DynamicTexture("damageNumberTexture", { width: size, height: size }, scene, true);
  const ctx = ctx2d(tex);
  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.floor(size * 0.42)}px sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, size / 2, size / 2);
  tex.update();
  return tex;
}