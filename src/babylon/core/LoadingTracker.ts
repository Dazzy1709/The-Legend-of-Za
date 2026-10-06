// src/babylon/core/LoadingTracker.ts
// How far the game's initial load has got, for the loading screen. Every
// model file (characters, animations, weapons, vehicles) is loaded through
// trackedLoad, which follows its download; the scene's own pending items
// (textures, shaders) count too. GameEngine asks whenDone() before the
// opening shot, and reports progress() to the loading screen.

import type { ISceneLoaderProgressEvent, Scene } from "@babylonjs/core";

/** Share of the bar for model files; the rest is the scene getting ready (textures, shaders). */
const FILES_WEIGHT = 0.85;
/** The load counts as done only after nothing new has started for this long (loads start over the first frames). */
const SETTLE_MS = 400;
/** The time-left estimate goes by the progress made over the last ESTIMATE_WINDOW_MS, once there's ESTIMATE_MIN_MS of it. */
const ESTIMATE_WINDOW_MS = 5000;
const ESTIMATE_MIN_MS = 3000;

interface FileProgress {
  fraction: number;
  done: boolean;
}

export interface LoadingProgress {
  /** 0..1, never goes backwards. */
  fraction: number;
  /** Rough seconds left, from the recent rate — null until there's enough to go on. */
  secondsLeft: number | null;
}

export class LoadingTracker {
  private static trackers = new WeakMap<Scene, LoadingTracker>();

  static for(scene: Scene): LoadingTracker {
    let tracker = this.trackers.get(scene);
    if (!tracker) {
      tracker = new LoadingTracker(scene);
      this.trackers.set(scene, tracker);
    }
    return tracker;
  }

  private files: FileProgress[] = [];
  private lastStartedAt = performance.now();
  private best = 0;
  /** Recent (time, fraction) samples, for the time-left estimate. */
  private samples: { t: number; f: number }[] = [];
  /** Set once the load is done — later loads (enemies spawning mid-game) aren't tracked. */
  private finished = false;

  private constructor(private scene: Scene) {}

  /** Follows one file's download (`load` gets the progress callback to pass to SceneLoader). */
  track<T>(load: (onProgress: (event: ISceneLoaderProgressEvent) => void) => Promise<T>): Promise<T> {
    if (this.finished) return load(() => {});
    const file: FileProgress = { fraction: 0, done: false };
    this.files.push(file);
    this.lastStartedAt = performance.now();
    const promise = load((event) => {
      if (event.lengthComputable && event.total > 0) file.fraction = Math.min(0.99, event.loaded / event.total);
    });
    promise.then(
      () => (file.done = true),
      () => (file.done = true) // a failed file isn't waited on (its loader handles the failure)
    );
    return promise;
  }

  progress(): LoadingProgress {
    const files = this.files.length === 0 ? 0 : this.files.reduce((sum, f) => sum + (f.done ? 1 : f.fraction), 0) / this.files.length;
    const sceneReady = this.isSceneReady() ? 1 : 0;
    this.best = Math.max(this.best, FILES_WEIGHT * files + (1 - FILES_WEIGHT) * sceneReady * (files >= 1 ? 1 : 0.5));

    const now = performance.now();
    this.samples.push({ t: now, f: this.best });
    while (this.samples.length > 2 && now - this.samples[0].t > ESTIMATE_WINDOW_MS) this.samples.shift();
    const first = this.samples[0];
    const rate = (this.best - first.f) / ((now - first.t) / 1000);
    // Only once there's a few seconds' worth to go on — the first files arrive in a burst that says little.
    const secondsLeft = now - first.t >= ESTIMATE_MIN_MS && rate > 0.002 ? Math.max(1, Math.ceil((1 - this.best) / rate)) : null;
    return { fraction: this.best, secondsLeft };
  }

  /** Calls `done` once every tracked file has arrived and the scene is ready — or after `maxWaitMs` regardless. */
  whenDone(done: () => void, maxWaitMs: number) {
    const startedAt = performance.now();
    const check = () => {
      if (this.scene.isDisposed) return;
      const now = performance.now();
      const allFiles = this.files.every((f) => f.done);
      if ((allFiles && now - this.lastStartedAt > SETTLE_MS && this.isSceneReady()) || now - startedAt > maxWaitMs) {
        this.finished = true;
        this.best = 1;
        done();
      } else setTimeout(check, 100);
    };
    check();
  }

  private isSceneReady(): boolean {
    return this.scene.getWaitingItemsCount() === 0 && this.scene.isReady();
  }
}
