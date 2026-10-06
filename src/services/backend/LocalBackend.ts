// src/services/backend/LocalBackend.ts
// Accounts and saves kept in this browser's storage — the game works
// fully with no server. Passwords are stored only as salted PBKDF2 hashes.
// Each account's save is separate. Data stays on this device (clearing
// site data deletes it); for saves that follow the player, use online.

import { MAX_PASSWORD_LENGTH, validateCredentials, type ExportResponse } from "../../../shared/api";
import { migrateSave, type SaveGame } from "../../../shared/save";
import { BackendError, type GameBackend, type PublicUser } from "./GameBackend";

interface StoredAccount extends PublicUser {
  salt: string;
  hash: string;
}

const ACCOUNTS_KEY = "zaza.accounts";
const SESSION_KEY = "zaza.session";
const saveKey = (userId: string) => `zaza.save.${userId}`;
const PBKDF2_ITERATIONS = 150_000;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new BackendError("This browser won't let the game store data (private mode or storage full).");
  }
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

export class LocalBackend implements GameBackend {
  readonly kind = "local" as const;
  private user: PublicUser | null = null;

  private accounts(): Record<string, StoredAccount> {
    return read<Record<string, StoredAccount>>(ACCOUNTS_KEY, {});
  }

  async restoreSession(): Promise<PublicUser | null> {
    const id = read<string | null>(SESSION_KEY, null);
    const account = id ? Object.values(this.accounts()).find((a) => a.id === id) : undefined;
    this.user = account ? { id: account.id, username: account.username, createdAt: account.createdAt } : null;
    return this.user;
  }

  async signUp(username: string, password: string): Promise<PublicUser> {
    const problem = validateCredentials(username, password);
    if (problem) throw new BackendError(problem);
    const accounts = this.accounts();
    const key = username.toLowerCase();
    if (accounts[key]) throw new BackendError("That username is taken on this device.");
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const account: StoredAccount = {
      id: crypto.randomUUID(),
      username,
      createdAt: new Date().toISOString(),
      salt,
      hash: await hashPassword(password, salt),
    };
    accounts[key] = account;
    write(ACCOUNTS_KEY, accounts);
    return this.startSession(account);
  }

  async logIn(username: string, password: string): Promise<PublicUser> {
    if (password.length > MAX_PASSWORD_LENGTH) throw new BackendError("Wrong username or password.");
    const account = this.accounts()[username.toLowerCase()];
    if (!account || (await hashPassword(password, account.salt)) !== account.hash) {
      throw new BackendError("Wrong username or password.");
    }
    return this.startSession(account);
  }

  async logOut(): Promise<void> {
    this.user = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // nothing to clear
    }
  }

  async loadSave(): Promise<SaveGame | null> {
    const user = this.requireUser();
    return migrateSave(read<unknown>(saveKey(user.id), null));
  }

  async writeSave(save: SaveGame): Promise<void> {
    const user = this.requireUser();
    write(saveKey(user.id), save);
  }

  async exportData(): Promise<ExportResponse> {
    const user = this.requireUser();
    return { user, save: await this.loadSave(), exportedAt: new Date().toISOString() };
  }

  async deleteAccount(password: string): Promise<void> {
    const user = this.requireUser();
    const accounts = this.accounts();
    const key = Object.keys(accounts).find((k) => accounts[k].id === user.id);
    if (!key || (await hashPassword(password, accounts[key].salt)) !== accounts[key].hash) {
      throw new BackendError("That password isn't right.");
    }
    delete accounts[key];
    write(ACCOUNTS_KEY, accounts);
    try {
      localStorage.removeItem(saveKey(user.id));
    } catch {
      // nothing more to remove
    }
    await this.logOut();
  }

  private startSession(account: StoredAccount): PublicUser {
    this.user = { id: account.id, username: account.username, createdAt: account.createdAt };
    write(SESSION_KEY, account.id);
    return this.user;
  }

  private requireUser(): PublicUser {
    if (!this.user) throw new BackendError("Please log in.");
    return this.user;
  }
}
