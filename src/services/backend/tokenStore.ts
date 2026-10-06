// src/services/backend/tokenStore.ts
// Where the online session token is kept between visits. In the browser
// that's localStorage (protected by the page's strict Content Security
// Policy — see vite.config.ts). A native iOS/Android build should swap in
// a store backed by the Keychain / Keystore (e.g. a Capacitor secure
// storage plugin) by passing it to HttpBackend — nothing else changes.

export interface TokenStore {
  get(): string | null;
  set(token: string | null): void;
}

const KEY = "zaza.token";

export const browserTokenStore: TokenStore = {
  get() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      // storage blocked: the token lives in memory for this visit only
    }
  },
};
