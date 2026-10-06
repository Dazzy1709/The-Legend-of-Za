// src/services/device.ts
// Phones and tablets play the game sideways (see RotateDevice).

/** On a touch device, goes full screen and locks the screen sideways — where the browser allows it (Android Chrome; iPhones don't). Call from a tap. */
export function enterLandscapeFullscreen() {
  if (!window.matchMedia?.("(pointer: coarse)").matches) return;
  const root = document.documentElement;
  if (document.fullscreenElement || typeof root.requestFullscreen !== "function") return;
  root
    .requestFullscreen({ navigationUI: "hide" })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
    .catch(() => {
      // Not allowed here (or not from a tap): the rotate card covers it.
    });
}
