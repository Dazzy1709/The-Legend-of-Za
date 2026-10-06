// server/store.ts
// The database: a single JSON file (server/data/db.json), written
// atomically. Enough for development and small player counts. To move to
// a real database, keep these functions' signatures and reimplement them
// against Postgres/SQLite/Supabase — nothing else in the server changes.

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SaveGame } from "../shared/save.ts";

export interface UserRecord {
  id: string;
  username: string;
  /** Lower-cased, for case-insensitive lookups. */
  usernameKey: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
}

/** Stored under the SHA-256 of its token — the token itself is never written to disk. */
export interface SessionRecord {
  userId: string;
  createdAt: string;
}

interface Database {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  saves: Record<string, SaveGame>;
}

const DATA_DIR = process.env.ZAZA_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "data");
const DB_FILE = join(DATA_DIR, "db.json");

let db: Database = load();

function load(): Database {
  if (!existsSync(DB_FILE)) return { users: {}, sessions: {}, saves: {} };
  return JSON.parse(readFileSync(DB_FILE, "utf8")) as Database;
}

/** Writes to a temp file, then swaps it in — a crash mid-write can't corrupt the database. */
function persist() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${DB_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 }); // readable by the server's user only
  renameSync(tmp, DB_FILE);
}

export function findUserByName(username: string): UserRecord | undefined {
  const key = username.toLowerCase();
  return Object.values(db.users).find((u) => u.usernameKey === key);
}

export function findUserById(id: string): UserRecord | undefined {
  return Object.prototype.hasOwnProperty.call(db.users, id) ? db.users[id] : undefined;
}

export function insertUser(user: UserRecord) {
  db.users[user.id] = user;
  persist();
}

export function insertSession(tokenHash: string, session: SessionRecord) {
  db.sessions[tokenHash] = session;
  persist();
}

export function findSession(tokenHash: string): SessionRecord | undefined {
  return Object.prototype.hasOwnProperty.call(db.sessions, tokenHash) ? db.sessions[tokenHash] : undefined;
}

export function deleteSession(tokenHash: string) {
  delete db.sessions[tokenHash];
  persist();
}

/** Removes sessions older than `maxAgeMs`. */
export function purgeExpiredSessions(maxAgeMs: number) {
  const now = Date.now();
  let changed = false;
  for (const [hash, session] of Object.entries(db.sessions)) {
    if (now - Date.parse(session.createdAt) > maxAgeMs) {
      delete db.sessions[hash];
      changed = true;
    }
  }
  if (changed) persist();
}

/** Deletes an account and everything tied to it: every session and the save. */
export function deleteUserAndData(userId: string) {
  delete db.users[userId];
  delete db.saves[userId];
  for (const [hash, session] of Object.entries(db.sessions)) {
    if (session.userId === userId) delete db.sessions[hash];
  }
  persist();
}

export function readSave(userId: string): SaveGame | null {
  return Object.prototype.hasOwnProperty.call(db.saves, userId) ? db.saves[userId] : null;
}

export function writeSave(userId: string, save: SaveGame) {
  db.saves[userId] = save;
  persist();
}

/** For tests. */
export function resetStore() {
  db = { users: {}, sessions: {}, saves: {} };
}
