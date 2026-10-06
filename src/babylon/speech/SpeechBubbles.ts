// src/babylon/speech/SpeechBubbles.ts
// Cartoon speech bubbles over characters' heads: a white rounded bubble
// with a thick dark outline and a tail pointing down at the speaker,
// bold comic lettering, popping in with a little bounce and fading out.
// Anyone can talk through this — enemies' barks today, NPCs, the player
// or cutscenes later: say(speakerId, anchor, text). One bubble per
// speaker; a new line replaces the old one.
//
// Kept cheap: a bubble is one small plane with its own little texture,
// drawn once when the line starts; far-away bubbles are hidden.

import { Camera, DynamicTexture, GlowLayer, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

export interface SayOptions {
  /** How long it stays up (seconds). */
  seconds?: number;
  /** Height of the bubble's bottom above the anchor point. */
  heightAbove?: number;
}

interface Bubble {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  anchor: () => Vector3;
  heightAbove: number;
  age: number;
  seconds: number;
  /** Half the bubble's height at scale 1 (its pivot is its bottom edge). */
  halfHeight: number;
}

const TEXTURE_WIDTH = 512;
const MAX_LINE_CHARS = 18;
const FONT_PX = 46;
const LINE_HEIGHT = 54;
const PADDING_X = 34;
const PADDING_Y = 24;
const TAIL_HEIGHT = 34;
const OUTLINE = 9;
const BUBBLE_WORLD_WIDTH = 2.1;
/** Seconds to pop in / fade out. */
const POP_IN = 0.18;
const FADE_OUT = 0.3;
/** Bubbles further than this from the camera aren't shown. */
const MAX_VISIBLE_DISTANCE = 55;
const FONT = `bold ${FONT_PX}px "Comic Sans MS", "Chalkboard SE", "Comic Neue", "Marker Felt", sans-serif`;

export class SpeechBubbles {
  private bubbles = new Map<string, Bubble>();
  private glow: GlowLayer | null;

  constructor(private scene: Scene, private getCamera: () => Camera | null) {
    this.glow = scene.getGlowLayerByName("cityGlow");
  }

  /** `speakerId` says `text`, in a bubble whose tail sits `heightAbove` over `anchor()`. */
  say(speakerId: string, anchor: () => Vector3, text: string, options: SayOptions = {}) {
    this.stop(speakerId);
    const lines = wrap(text, MAX_LINE_CHARS);
    const height = PADDING_Y * 2 + lines.length * LINE_HEIGHT + TAIL_HEIGHT + OUTLINE * 2;
    const texture = new DynamicTexture(`speech-${speakerId}`, { width: TEXTURE_WIDTH, height }, this.scene, true);
    texture.hasAlpha = true;
    drawBubble(texture.getContext() as CanvasRenderingContext2D, lines, TEXTURE_WIDTH, height);
    texture.update();

    const worldWidth = BUBBLE_WORLD_WIDTH;
    const mesh = MeshBuilder.CreatePlane(`speech-${speakerId}`, { width: worldWidth, height: worldWidth * (height / TEXTURE_WIDTH) }, this.scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1; // drawn over the world, so walls don't cut bubbles in half
    // Anchored at its bottom (the tail tip), so it grows upward from the head.
    mesh.setPivotPoint(new Vector3(0, -(worldWidth * (height / TEXTURE_WIDTH)) / 2, 0));
    const material = new StandardMaterial(`speech-mat-${speakerId}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.fogEnabled = false;
    mesh.material = material;
    this.glow?.addExcludedMesh(mesh);

    this.bubbles.set(speakerId, {
      mesh,
      material,
      texture,
      anchor,
      heightAbove: options.heightAbove ?? 2.9,
      age: 0,
      seconds: options.seconds ?? 2.4,
      halfHeight: (worldWidth * (height / TEXTURE_WIDTH)) / 2,
    });
    this.place(this.bubbles.get(speakerId)!);
  }

  /** Takes a speaker's bubble down now (e.g. they died, or despawned). */
  stop(speakerId: string) {
    const bubble = this.bubbles.get(speakerId);
    if (!bubble) return;
    bubble.mesh.dispose();
    bubble.material.dispose();
    bubble.texture.dispose();
    this.bubbles.delete(speakerId);
  }

  isSpeaking(speakerId: string): boolean {
    return this.bubbles.has(speakerId);
  }

  update(dt: number) {
    for (const [id, bubble] of this.bubbles) {
      bubble.age += dt;
      if (bubble.age >= bubble.seconds) {
        this.stop(id);
        continue;
      }
      this.place(bubble);
    }
  }

  private place(bubble: Bubble) {
    const at = bubble.anchor();
    const camera = this.getCamera();
    const distance = camera ? Vector3.Distance(camera.globalPosition, at) : 10;
    bubble.mesh.setEnabled(distance < MAX_VISIBLE_DISTANCE);
    // Readable at any distance: grows with distance (like the health bars), capped.
    const distanceScale = Math.min(3, Math.max(1, distance / 11));
    // A little bounce on the way in, a fade on the way out.
    const t = bubble.age;
    const pop = t < POP_IN ? easeOutBack(t / POP_IN) : 1;
    bubble.mesh.scaling.setAll(distanceScale * Math.max(0.01, pop));
    bubble.material.alpha = Math.min(1, (bubble.seconds - t) / FADE_OUT);
    // The pivot is the bottom edge, so this keeps the tail at heightAbove whatever the scale.
    bubble.mesh.position.set(at.x, at.y + bubble.heightAbove + bubble.halfHeight, at.z);
  }

  dispose() {
    for (const id of [...this.bubbles.keys()]) this.stop(id);
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Splits a line into rows of at most `max` characters, on word boundaries. */
function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** The bubble: rounded white body, tail at the bottom middle, thick outline, centred comic text. */
function drawBubble(ctx: CanvasRenderingContext2D, lines: string[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.font = FONT;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bodyW = Math.min(width - OUTLINE * 2, widest + PADDING_X * 2);
  const bodyH = height - TAIL_HEIGHT - OUTLINE * 2;
  const x = (width - bodyW) / 2;
  const y = OUTLINE;
  const r = Math.min(40, bodyH / 2);
  const tailX = width / 2;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + bodyW - r, y);
  ctx.quadraticCurveTo(x + bodyW, y, x + bodyW, y + r);
  ctx.lineTo(x + bodyW, y + bodyH - r);
  ctx.quadraticCurveTo(x + bodyW, y + bodyH, x + bodyW - r, y + bodyH);
  // The tail: a short wedge down toward the speaker's head.
  ctx.lineTo(tailX + 20, y + bodyH);
  ctx.lineTo(tailX - 4, y + bodyH + TAIL_HEIGHT);
  ctx.lineTo(tailX - 16, y + bodyH);
  ctx.lineTo(x + r, y + bodyH);
  ctx.quadraticCurveTo(x, y + bodyH, x, y + bodyH - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = "#fffdf5";
  ctx.fill();
  ctx.lineWidth = OUTLINE;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1c1917";
  ctx.stroke();

  ctx.fillStyle = "#1c1917";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, y + PADDING_Y + LINE_HEIGHT * (i + 0.5));
  });
}
