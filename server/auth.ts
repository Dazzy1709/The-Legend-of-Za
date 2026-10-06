// server/auth.ts
// Passwords and sessions.
//  - Passwords are stored only as salted scrypt hashes and compared in
//    constant time. A login for an unknown user still runs a hash, so
//    response time doesn't reveal which usernames exist.
//  - A session is a random 256-bit token sent as `Authorization: Bearer`.
//    Only its SHA-256 is stored, so a leaked database holds no usable
//    tokens. Sessions expire after SESSION_DAYS and are deleted on log-out
//    and when the account is deleted.

import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { PublicUser } from "../shared/api.ts";
import { findSession, findUserById, purgeExpiredSessions, type UserRecord } from "./store.ts";

const KEY_LENGTH = 64;
/** scrypt cost (N=2^15, r=8): ~50 ms per hash — slow for an attacker, fine for a login. */
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86_400_000;

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS).toString("hex");
  return { salt, hash };
}

export function passwordMatches(password: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const stored = Buffer.from(hash, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

const DUMMY = hashPassword(randomBytes(12).toString("hex"));
/** Spends the same time as a real password check, for logins to accounts that don't exist. */
export function burnPasswordCheck(password: string) {
  passwordMatches(password, DUMMY.salt, DUMMY.hash);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What's stored for a token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newUserId(): string {
  return randomUUID();
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

/** The user a request's `Authorization: Bearer <token>` belongs to, if the session is valid. */
export function userForToken(authorization: string | undefined): { user: UserRecord; tokenHash: string } | null {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token || token.length > 128) return null;
  const tokenHash = hashToken(token);
  const session = findSession(tokenHash);
  if (!session) return null;
  if (Date.now() - Date.parse(session.createdAt) > SESSION_MS) return null;
  const user = findUserById(session.userId);
  return user ? { user, tokenHash } : null;
}

/** Clears out expired sessions now and then. */
export function startSessionCleanup() {
  purgeExpiredSessions(SESSION_MS);
  setInterval(() => purgeExpiredSessions(SESSION_MS), 6 * 3600_000).unref();
}
