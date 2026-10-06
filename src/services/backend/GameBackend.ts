// src/services/backend/GameBackend.ts
// Everything the game needs from "a backend": accounts and saves. The UI
// and the game only ever talk to this interface, so where the data lives
// — this device, the reference server, or a hosted service — is decided
// in one place (createBackend) and can change without touching gameplay.

import type { ExportResponse, PublicUser } from "../../../shared/api";
import type { SaveGame } from "../../../shared/save";

export type { ExportResponse, PublicUser };

export interface GameBackend {
  /** "local" keeps everything on this device; "online" talks to a server. */
  readonly kind: "local" | "online";
  /** The user from a previous visit, if their session is still valid. */
  restoreSession(): Promise<PublicUser | null>;
  signUp(username: string, password: string): Promise<PublicUser>;
  logIn(username: string, password: string): Promise<PublicUser>;
  logOut(): Promise<void>;
  /** The logged-in user's save, or null if they haven't got one yet. */
  loadSave(): Promise<SaveGame | null>;
  /** `keepalive`: the page is closing (refresh, tab closed) — the request must outlive it. */
  writeSave(save: SaveGame, options?: { keepalive?: boolean }): Promise<void>;
  /** Everything stored about the logged-in account (privacy: the player's right to their data). */
  exportData(): Promise<ExportResponse>;
  /** Permanently deletes the logged-in account and all its data; needs the password again. Logs out. */
  deleteAccount(password: string): Promise<void>;
}

/** A failure worth showing to the player ("That username is taken."). */
export class BackendError extends Error {}

/** The server couldn't be reached (offline, restarting) — nothing is wrong with the account. */
export class ServerUnreachableError extends BackendError {
  constructor() {
    super("Can't reach the game server right now. Please check your connection — retrying…");
  }
}
