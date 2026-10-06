// src/services/backend/HttpBackend.ts
// Accounts and cloud saves through a server implementing shared/api.ts —
// the reference one is server/ (npm run server). The session token is kept
// in this browser so players stay logged in between visits.

import {
  API_ROUTES,
  type ApiError,
  type AuthResponse,
  type ExportResponse,
  type OkResponse,
  type MeResponse,
  type SaveResponse,
  type SaveWriteResponse,
} from "../../../shared/api";
import { migrateSave, type SaveGame } from "../../../shared/save";
import { BackendError, ServerUnreachableError, type GameBackend, type PublicUser } from "./GameBackend";
import { browserTokenStore, type TokenStore } from "./tokenStore";

/**
 * Only HTTPS servers (as the App Store's App Transport Security requires),
 * except the same-origin path (/api, proxied in development) and a server
 * on this machine.
 */
function assertSecureUrl(baseUrl: string) {
  if (baseUrl.startsWith("/")) return;
  const url = new URL(baseUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !local) throw new Error(`The game server must use HTTPS (got ${baseUrl}).`);
}

export class HttpBackend implements GameBackend {
  readonly kind = "online" as const;
  private token: string | null;

  constructor(private baseUrl: string, private tokens: TokenStore = browserTokenStore) {
    assertSecureUrl(baseUrl);
    this.token = tokens.get();
  }

  /**
   * The user of the stored session. A rejected session (401) is forgotten;
   * an unreachable server throws ServerUnreachableError and keeps the
   * session, so a server hiccup never logs the player out.
   */
  async restoreSession(): Promise<PublicUser | null> {
    if (!this.token) return null;
    try {
      return (await this.request<MeResponse>("GET", API_ROUTES.me)).user;
    } catch (err) {
      if (err instanceof ServerUnreachableError) throw err;
      return null; // request() already cleared a rejected token
    }
  }

  async signUp(username: string, password: string): Promise<PublicUser> {
    const res = await this.request<AuthResponse>("POST", API_ROUTES.signUp, { username, password });
    this.setToken(res.token);
    return res.user;
  }

  async logIn(username: string, password: string): Promise<PublicUser> {
    const res = await this.request<AuthResponse>("POST", API_ROUTES.logIn, { username, password });
    this.setToken(res.token);
    return res.user;
  }

  async logOut(): Promise<void> {
    try {
      await this.request("POST", API_ROUTES.logOut);
    } finally {
      this.setToken(null);
    }
  }

  async loadSave(): Promise<SaveGame | null> {
    const res = await this.request<SaveResponse>("GET", API_ROUTES.save);
    return res.save ? migrateSave(res.save) : null;
  }

  async writeSave(save: SaveGame, options: { keepalive?: boolean } = {}): Promise<void> {
    await this.request<SaveWriteResponse>("PUT", API_ROUTES.save, { save }, options.keepalive);
  }

  async exportData(): Promise<ExportResponse> {
    return this.request<ExportResponse>("GET", API_ROUTES.exportData);
  }

  async deleteAccount(password: string): Promise<void> {
    await this.request<OkResponse>("POST", API_ROUTES.deleteAccount, { password });
    this.setToken(null);
  }

  private setToken(token: string | null) {
    this.token = token;
    this.tokens.set(token);
  }

  private async request<T>(method: string, route: string, body?: unknown, keepalive = false): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${route}`, {
        method,
        credentials: "omit", // the Bearer token is the only credential — no cookies
        cache: "no-store",
        keepalive,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ServerUnreachableError();
    }
    // A proxy/gateway answering for a server that's down or restarting.
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new ServerUnreachableError();
    const data = (await res.json().catch(() => ({}))) as T | ApiError;
    if (res.status === 401) this.setToken(null);
    if (!res.ok) throw new BackendError((data as ApiError).error ?? `Server error (${res.status}).`);
    return data as T;
  }
}
