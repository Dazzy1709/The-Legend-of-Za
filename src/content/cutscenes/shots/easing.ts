// src/content/cutscenes/shots/easing.ts
// Easing curves for cutscene camera moves. Every one maps 0 -> 0 and 1 -> 1.

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Slow start, slow finish. */
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Fast start, gliding to a stop. */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
