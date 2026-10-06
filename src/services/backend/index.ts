// src/services/backend/index.ts
// Picks the backend from the build environment (see .env.example).
// By default progress is saved on the player's account on the game server
// (VITE_API_URL, /api by default). VITE_BACKEND=local keeps accounts and
// saves on this device instead (offline play, or demos without a server).

import { API_PREFIX } from "../../../shared/api";
import type { GameBackend } from "./GameBackend";
import { HttpBackend } from "./HttpBackend";
import { LocalBackend } from "./LocalBackend";

export type { GameBackend, PublicUser } from "./GameBackend";
export { BackendError, ServerUnreachableError } from "./GameBackend";

export function createBackend(): GameBackend {
  if (import.meta.env.VITE_BACKEND === "local") return new LocalBackend();
  return new HttpBackend(import.meta.env.VITE_API_URL ?? API_PREFIX);
}
