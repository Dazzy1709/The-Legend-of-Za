// server/index.ts
// The reference game backend: accounts and cloud saves over a small JSON
// API (the contract is shared/api.ts). No dependencies — just Node.
//
//   npm run server            (listens on http://localhost:8787)
//
// In development the game's dev server proxies /api to it (see
// vite.config.ts); set VITE_BACKEND=online in .env.local to use it.
// Production settings and the security model: SECURITY.md.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  API_PREFIX,
  API_ROUTES,
  MAX_PASSWORD_LENGTH,
  validateCredentials,
  type ApiError,
  type AuthRequest,
  type AuthResponse,
  type DeleteAccountRequest,
  type ExportResponse,
  type HealthResponse,
  type MeResponse,
  type OkResponse,
  type SaveRequest,
  type SaveResponse,
  type SaveWriteResponse,
} from "../shared/api.ts";
import { MAX_SAVE_BYTES, migrateSave } from "../shared/save.ts";
import {
  burnPasswordCheck,
  hashPassword,
  hashToken,
  newSessionToken,
  newUserId,
  passwordMatches,
  startSessionCleanup,
  toPublicUser,
  userForToken,
} from "./auth.ts";
import { RateLimiter } from "./rateLimit.ts";
import { deleteSession, deleteUserAndData, findUserByName, insertSession, insertUser, readSave, writeSave } from "./store.ts";

const PORT = Number(process.env.PORT ?? 8787);
const PRODUCTION = process.env.NODE_ENV === "production";
/** Behind a reverse proxy / load balancer that terminates TLS: trust its X-Forwarded-* headers. */
const TRUST_PROXY = process.env.ZAZA_TRUST_PROXY === "1";
/** Origins allowed to call the API from a browser (the game's dev and preview servers by default). */
const ALLOWED_ORIGINS = (process.env.ZAZA_ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4173").split(",");

// Brute-force and abuse limits.
const loginsPerIp = new RateLimiter(20, 15 * 60_000); // 20 attempts / 15 min / IP
const failedLoginsPerUser = new RateLimiter(5, 15 * 60_000); // 5 wrong passwords locks that account's logins for 15 min
const signUpsPerIp = new RateLimiter(5, 60 * 60_000); // 5 new accounts / hour / IP
const savesPerUser = new RateLimiter(30, 60_000); // 30 saves / min / account
const requestsPerIp = new RateLimiter(300, 60_000); // overall ceiling

class HttpError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function clientIp(req: IncomingMessage): string {
  const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

function isHttps(req: IncomingMessage): boolean {
  if (TRUST_PROXY) return req.headers["x-forwarded-proto"] === "https";
  return Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

function limit(limiter: RateLimiter, key: string) {
  const wait = limiter.hit(key);
  if (wait > 0) throw new HttpError(429, "Too many attempts. Please wait a little and try again.", wait);
}

/** Headers every API response carries. */
function securityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Cache-Control", "no-store"); // account data and tokens must never be cached
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (PRODUCTION) res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage, maxBytes: number): Promise<T> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, "Request too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON.");
  }
}

function requireUser(req: IncomingMessage) {
  const auth = userForToken(req.headers.authorization);
  if (!auth) throw new HttpError(401, "Please log in again.");
  return auth;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function startSession(userId: string): string {
  const token = newSessionToken();
  insertSession(hashToken(token), { userId, createdAt: new Date().toISOString() });
  return token;
}

const AUTH_BODY_LIMIT = 4096;

async function handle(req: IncomingMessage, res: ServerResponse) {
  const ip = clientIp(req);
  limit(requestsPerIp, ip);
  if (PRODUCTION && !isHttps(req)) throw new HttpError(403, "HTTPS is required.");

  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(API_PREFIX)) throw new HttpError(404, "Not found.");
  const route = url.pathname.slice(API_PREFIX.length);
  const method = req.method ?? "GET";

  if (route === API_ROUTES.health && method === "GET") {
    return send(res, 200, { ok: true, service: "legend-of-zaza" } satisfies HealthResponse);
  }

  if (route === API_ROUTES.signUp && method === "POST") {
    limit(signUpsPerIp, ip);
    const body = await readJson<Partial<AuthRequest>>(req, AUTH_BODY_LIMIT);
    const username = asString(body.username).trim();
    const password = asString(body.password);
    const problem = validateCredentials(username, password);
    if (problem) throw new HttpError(400, problem);
    if (findUserByName(username)) throw new HttpError(409, "That username is taken.");
    const { salt, hash } = hashPassword(password);
    const user = { id: newUserId(), username, usernameKey: username.toLowerCase(), passwordSalt: salt, passwordHash: hash, createdAt: new Date().toISOString() };
    insertUser(user);
    return send(res, 201, { user: toPublicUser(user), token: startSession(user.id) } satisfies AuthResponse);
  }

  if (route === API_ROUTES.logIn && method === "POST") {
    limit(loginsPerIp, ip);
    const body = await readJson<Partial<AuthRequest>>(req, AUTH_BODY_LIMIT);
    const username = asString(body.username).trim();
    const password = asString(body.password);
    const userKey = `user:${username.toLowerCase()}`;
    const locked = failedLoginsPerUser.blockedFor(userKey);
    if (locked > 0) throw new HttpError(429, "Too many wrong passwords for this account. Please wait a little and try again.", locked);
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) throw new HttpError(401, "Wrong username or password.");
    const user = findUserByName(username);
    let ok = false;
    if (user) ok = passwordMatches(password, user.passwordSalt, user.passwordHash);
    else burnPasswordCheck(password); // same time as a real check — no hint about which usernames exist
    if (!user || !ok) {
      failedLoginsPerUser.hit(userKey);
      throw new HttpError(401, "Wrong username or password.");
    }
    failedLoginsPerUser.reset(userKey);
    return send(res, 200, { user: toPublicUser(user), token: startSession(user.id) } satisfies AuthResponse);
  }

  if (route === API_ROUTES.me && method === "GET") {
    const { user } = requireUser(req);
    return send(res, 200, { user: toPublicUser(user) } satisfies MeResponse);
  }

  if (route === API_ROUTES.logOut && method === "POST") {
    const { tokenHash } = requireUser(req);
    deleteSession(tokenHash);
    return send(res, 200, { ok: true } satisfies OkResponse);
  }

  if (route === API_ROUTES.save && method === "GET") {
    const { user } = requireUser(req);
    return send(res, 200, { save: readSave(user.id) } satisfies SaveResponse);
  }

  if (route === API_ROUTES.save && method === "PUT") {
    const { user } = requireUser(req);
    limit(savesPerUser, user.id);
    const body = await readJson<Partial<SaveRequest>>(req, MAX_SAVE_BYTES + 1024);
    const save = migrateSave(body.save);
    if (!save) throw new HttpError(400, "That isn't a valid save.");
    writeSave(user.id, save);
    return send(res, 200, { savedAt: save.savedAt } satisfies SaveWriteResponse);
  }

  if (route === API_ROUTES.exportData && method === "GET") {
    const { user } = requireUser(req);
    return send(res, 200, { user: toPublicUser(user), save: readSave(user.id), exportedAt: new Date().toISOString() } satisfies ExportResponse);
  }

  if (route === API_ROUTES.deleteAccount && method === "POST") {
    const { user } = requireUser(req);
    limit(loginsPerIp, ip);
    const body = await readJson<Partial<DeleteAccountRequest>>(req, AUTH_BODY_LIMIT);
    const password = asString(body.password);
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH || !passwordMatches(password, user.passwordSalt, user.passwordHash)) {
      throw new HttpError(401, "That password isn't right.");
    }
    deleteUserAndData(user.id);
    return send(res, 200, { ok: true } satisfies OkResponse);
  }

  throw new HttpError(404, "Not found.");
}

const server = createServer((req, res) => {
  securityHeaders(res);
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  handle(req, res).catch((err: unknown) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err); // never logs request bodies (passwords)
    if (err instanceof HttpError && err.retryAfter) res.setHeader("Retry-After", String(err.retryAfter));
    send(res, status, { error: err instanceof HttpError ? err.message : "Something went wrong." } satisfies ApiError);
  });
});

// Slow-client protection.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — is the game backend already running? (Set PORT to use another port.)`);
    process.exit(1);
  }
  throw err;
});

startSessionCleanup();
server.listen(PORT, () => console.log(`Legend of Zaza backend on http://localhost:${PORT}${API_PREFIX}${PRODUCTION ? " (production)" : ""}`));
