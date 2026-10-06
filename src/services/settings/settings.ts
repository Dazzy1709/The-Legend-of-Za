// src/services/settings/settings.ts
// Player preferences (controls, sound). These belong to the device, not
// the save, so they're kept in this browser's storage. Add a setting by
// adding it to GameSettings and DEFAULT_SETTINGS, then apply it in
// GameEngine.applySettings.

export interface GameSettings {
  /** Mouse / drag look speed, 0.25–2 (1 = default). */
  lookSensitivity: number;
  /** Moving the mouse up looks down. */
  invertLookY: boolean;
  /** 0–1. */
  masterVolume: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  lookSensitivity: 1,
  invertLookY: false,
  masterVolume: 0.8,
};

const KEY = "zaza.settings";

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function storeSettings(settings: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // not remembered, still applied
  }
}
