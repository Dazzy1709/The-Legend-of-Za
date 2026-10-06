// src/babylon/world/WeatherSystem.ts
//
// A real weather cycle — not a fixed state, and not tied to the day/night
// clock. Weather holds steady for a while, then smoothly transitions to a
// new state over several seconds (sky shader parameters, light intensity,
// fog density, and rain all interpolate together, not snap), and which
// weather comes next is picked with a natural-progression bias rather
// than pure chance: clear mostly drifts into cloudy, cloudy is the
// transitional state that tips toward either clear or rain, and rain
// almost always clears back through cloudy rather than switching
// straight to sunshine.
//
// "Cloudy"/"rain" skies are genuine atmospheric-shader parameter shifts
// on the same physically-based sky (SkyBuilder's Preetham/Rayleigh
// model) the clear sky already uses — higher turbidity (haze) and lower
// luminance/rayleigh are what that real model produces for an overcast
// look, not a separate cloud texture layered on top.

import { ParticleSystem, Scene, Vector3 } from "@babylonjs/core";
import type { SkyWeatherParams } from "./SkyBuilder";
import { createRaindropTexture } from "./TextureFactory";

export type WeatherKind = "clear" | "cloudy" | "rain";

interface WeatherPreset {
  sky: SkyWeatherParams;
  /** Multiplies the day/night cycle's own sun+ambient intensity — an overcast or rainy sky is genuinely dimmer at the same time of day. */
  lightMultiplier: number;
  /** Multiplies the scene's base fog density — reduced visibility in poor weather. */
  fogDensityMultiplier: number;
  /** 0-1, drives the rain particle system's emit rate. */
  rainIntensity: number;
}

const WEATHER_PRESETS: Record<WeatherKind, WeatherPreset> = {
  clear: {
    sky: { turbidity: 9, luminance: 0.95, rayleigh: 2.3, mieCoefficient: 0.006, cloudCoverage: 0.15, cloudDarkness: 0 },
    lightMultiplier: 1,
    fogDensityMultiplier: 1,
    rainIntensity: 0,
  },
  cloudy: {
    sky: { turbidity: 18, luminance: 0.55, rayleigh: 1.1, mieCoefficient: 0.02, cloudCoverage: 0.75, cloudDarkness: 0.35 },
    lightMultiplier: 0.62,
    fogDensityMultiplier: 1.8,
    rainIntensity: 0,
  },
  rain: {
    sky: { turbidity: 24, luminance: 0.32, rayleigh: 0.7, mieCoefficient: 0.035, cloudCoverage: 0.92, cloudDarkness: 0.85 },
    lightMultiplier: 0.38,
    fogDensityMultiplier: 3,
    rainIntensity: 0.5,
  },
};

/** From a given current weather, the relative likelihood of transitioning to each other weather — deliberately NOT uniform, so the sequence reads as real weather drifting rather than a random state jumping around. */
const TRANSITION_WEIGHTS: Record<WeatherKind, Partial<Record<WeatherKind, number>>> = {
  clear: { cloudy: 0.85, rain: 0.15 },
  cloudy: { clear: 0.4, rain: 0.6 },
  rain: { cloudy: 0.85, clear: 0.15 },
};

const MIN_HOLD_SECONDS = 90;
const MAX_HOLD_SECONDS = 220;
const TRANSITION_SECONDS = 40; // weather eases in over most of a minute — no sudden darkening

const RAIN_PARTICLE_CAPACITY = 4000;
const RAIN_MAX_EMIT_RATE = 1800;
const RAIN_BOX_HALF_WIDTH = 35;
const RAIN_BOX_HEIGHT_MIN = 18;
const RAIN_BOX_HEIGHT_MAX = 20;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface WeatherFrameResult {
  sky: SkyWeatherParams;
  lightMultiplier: number;
  fogDensityMultiplier: number;
}

export class WeatherSystem {
  private current: WeatherKind = "clear";
  private next: WeatherKind = "clear";
  private transitioning = false;
  private transitionProgress = 0;
  private holdTimer: number;
  private rain: ParticleSystem;

  constructor(scene: Scene) {
    this.holdTimer = this.randomHold();
    this.rain = this.createRainParticles(scene);
  }

  private randomHold(): number {
    return MIN_HOLD_SECONDS + Math.random() * (MAX_HOLD_SECONDS - MIN_HOLD_SECONDS);
  }

  /** Weighted-random pick among this weather's plausible next states — see TRANSITION_WEIGHTS. */
  private pickNext(from: WeatherKind): WeatherKind {
    const weights = TRANSITION_WEIGHTS[from];
    const entries = Object.entries(weights) as [WeatherKind, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [kind, w] of entries) {
      if (r < w) return kind;
      r -= w;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * Follows the player around rather than raining over the whole
   * (200+ unit) city at once — a box emitter just above and around
   * wherever `emitter` currently is, repositioned every frame in
   * update(). Lifetime is tuned against gravity + the emit box's own
   * height so a drop's fall roughly finishes right as its life runs
   * out (0.5 * 55 * 0.8^2 ~= 17.6, matching the ~18-20 unit spawn
   * height) rather than particles visibly vanishing mid-air or
   * persisting underground.
   */
  private createRainParticles(scene: Scene): ParticleSystem {
    const ps = new ParticleSystem("rain", RAIN_PARTICLE_CAPACITY, scene);
    ps.particleTexture = createRaindropTexture(scene);
    ps.emitter = Vector3.Zero(); // repositioned every frame in update()
    ps.createBoxEmitter(
      new Vector3(0, -1, 0),
      new Vector3(0, -1, 0),
      new Vector3(-RAIN_BOX_HALF_WIDTH, RAIN_BOX_HEIGHT_MIN, -RAIN_BOX_HALF_WIDTH),
      new Vector3(RAIN_BOX_HALF_WIDTH, RAIN_BOX_HEIGHT_MAX, RAIN_BOX_HALF_WIDTH)
    );
    ps.direction1 = new Vector3(-0.4, -1, -0.4);
    ps.direction2 = new Vector3(0.4, -1, 0.4);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1.4;
    ps.gravity = new Vector3(0, -55, 0);
    ps.minLifeTime = 0.7;
    ps.maxLifeTime = 0.9;
    ps.minSize = 0.15;
    ps.maxSize = 0.35;
    ps.emitRate = 0; // driven per-frame by the current weather's rain intensity
    ps.updateSpeed = 0.02;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return ps;
  }

  /**
   * Call once per frame. `nearPosition` is where rain should center
   * itself (the player's position is the right choice — close enough to
   * the camera that it always reads as "raining around you" regardless
   * of the camera's current orbit distance). Returns the current
   * (possibly mid-transition, already-interpolated) sky/light/fog values
   * for GameEngine to apply; the rain particle system itself is updated
   * directly here, not returned.
   */
  update(dt: number, nearPosition: Vector3): WeatherFrameResult {
    if (this.transitioning) {
      this.transitionProgress += dt / TRANSITION_SECONDS;
      if (this.transitionProgress >= 1) {
        this.transitionProgress = 1;
        this.current = this.next;
        this.transitioning = false;
        this.holdTimer = this.randomHold();
      }
    } else {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) {
        this.next = this.pickNext(this.current);
        this.transitioning = true;
        this.transitionProgress = 0;
      }
    }

    const fromPreset = WEATHER_PRESETS[this.current];
    const toPreset = WEATHER_PRESETS[this.transitioning ? this.next : this.current];
    // Eased, so a change of weather starts and settles gently instead of at a constant rate.
    const raw = this.transitioning ? this.transitionProgress : 0;
    const t = raw * raw * (3 - 2 * raw);

    const sky: SkyWeatherParams = {
      turbidity: lerp(fromPreset.sky.turbidity, toPreset.sky.turbidity, t),
      luminance: lerp(fromPreset.sky.luminance, toPreset.sky.luminance, t),
      rayleigh: lerp(fromPreset.sky.rayleigh, toPreset.sky.rayleigh, t),
      mieCoefficient: lerp(fromPreset.sky.mieCoefficient, toPreset.sky.mieCoefficient, t),
      cloudCoverage: lerp(fromPreset.sky.cloudCoverage, toPreset.sky.cloudCoverage, t),
      cloudDarkness: lerp(fromPreset.sky.cloudDarkness, toPreset.sky.cloudDarkness, t),
    };
    const lightMultiplier = lerp(fromPreset.lightMultiplier, toPreset.lightMultiplier, t);
    const fogDensityMultiplier = lerp(fromPreset.fogDensityMultiplier, toPreset.fogDensityMultiplier, t);
    const rainIntensity = lerp(fromPreset.rainIntensity, toPreset.rainIntensity, t);

    this.rain.emitter = nearPosition;
    this.rain.emitRate = rainIntensity * RAIN_MAX_EMIT_RATE;

    return { sky, lightMultiplier, fogDensityMultiplier };
  }

  /** Which weather is currently active (mid-transition counts as its starting state) — for anything that wants to show or announce it later, e.g. a HUD weather icon. */
  getCurrentWeather(): WeatherKind {
    return this.current;
  }

  dispose() {
    this.rain.dispose();
  }
}
