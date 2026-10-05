// src/content/vehicles/vehicles.ts
// Every vehicle in the game: its model and how it handles. The flying
// itself lives in babylon/vehicles/.

export interface HoverVehicleDef {
  id: string;
  /** Floating name above it while parked. */
  name: string;
  /** Folder under public/assets/vehicles/ and the model file in it. */
  folder: string;
  modelFile: string;
  /** The model is laid on its side and scaled to this length (m), nose forward. */
  length: number;
  /** Squash of the body's height relative to its width (1 = as modelled). */
  heightScale: number;
  /** Gap between its underside and the ground at its lowest. */
  hoverHeight: number;
  /** Top speeds (m/s). */
  cruiseSpeed: number;
  boostSpeed: number;
  climbSpeed: number;
  /** Height limit above the ground. */
  maxAltitude: number;
}

export const BUDMOBILE: HoverVehicleDef = {
  id: "budmobile",
  name: "BUDMOBILE",
  folder: "budmobile",
  modelFile: "budmobile.glb",
  length: 3.1,
  heightScale: 0.62,
  hoverHeight: 0.35,
  cruiseSpeed: 16,
  boostSpeed: 32,
  climbSpeed: 9,
  maxAltitude: 90,
};
