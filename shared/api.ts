// shared/api.ts
// The contract between the game and its backend: routes, request and
// response shapes, and the account rules both sides enforce. Any server
// that implements this (the reference one in server/, or one built on
// Supabase, Firebase, Postgres...) works with the game's HttpBackend.

import type { SaveGame } from "./save.ts";

/** Every route sits under this prefix (the dev server proxies it to server/). */
export const API_PREFIX = "/api";

export const API_ROUTES = {
  /** POST AuthRequest -> AuthResponse */
  signUp: "/auth/signup",
  /** POST AuthRequest -> AuthResponse */
  logIn: "/auth/login",
  /** GET (Bearer) -> MeResponse */
  me: "/auth/me",
  /** POST (Bearer) -> OkResponse */
  logOut: "/auth/logout",
  /** GET (Bearer) -> SaveResponse;  PUT (Bearer) SaveRequest -> SaveWriteResponse */
  save: "/save",
  /** POST (Bearer) DeleteAccountRequest -> OkResponse — deletes the account, its sessions and its save. */
  deleteAccount: "/account/delete",
  /** GET (Bearer) -> ExportResponse — everything stored about the account. */
  exportData: "/account/export",
  /** GET -> HealthResponse — is the backend up (used by the dev script and monitoring). */
  health: "/health",
} as const;

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: PublicUser;
  /** Sent back as `Authorization: Bearer <token>`. */
  token: string;
}

export interface MeResponse {
  user: PublicUser;
}

export interface SaveResponse {
  save: SaveGame | null;
}

export interface SaveRequest {
  save: SaveGame;
}

export interface SaveWriteResponse {
  savedAt: string;
}

export interface DeleteAccountRequest {
  /** Asked again, so a borrowed, logged-in device can't delete someone's account. */
  password: string;
}

export interface ExportResponse {
  user: PublicUser;
  save: SaveGame | null;
  exportedAt: string;
}

export interface HealthResponse {
  ok: true;
  service: "legend-of-zaza";
}

export interface OkResponse {
  ok: true;
}

/** Every error response has this body. */
export interface ApiError {
  error: string;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const MIN_PASSWORD_LENGTH = 8;
/** Long enough for any passphrase; short enough that hashing it can't be used to stall the server. */
export const MAX_PASSWORD_LENGTH = 128;

/** The problem with these credentials, or null if they're acceptable. */
export function validateCredentials(username: string, password: string): string | null {
  if (!USERNAME_PATTERN.test(username)) return "Usernames are 3–20 letters, numbers or underscores.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return "That password is too long.";
  if (password.trim().length === 0 || /^(.)\1+$/.test(password)) return "Please choose a stronger password.";
  if (password.toLowerCase().includes(username.toLowerCase())) return "Your password can't contain your username.";
  return null;
}
