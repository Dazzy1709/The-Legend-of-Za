# Security & privacy

This file covers how The Legend of Zaza protects accounts and saves, and what's left to do before publishing to the App Store (or Google Play).

## App Store requirements

| Requirement | Guideline | Status |
|---|---|---|
| **In-app account deletion.** Apps that let you create an account must let you delete it from inside the app. | 5.1.1(v) | Done. Main menu → Account → Delete account asks for the password again, then deletes the account, every session and the save, on the server and the device. |
| **Privacy policy in the app and on the store listing** | 5.1.1(i) | Done in the game: main menu → Privacy, plus a link at sign-up. You still need to fill in the `[bracketed]` details in `src/content/legal/privacyPolicy.ts` and `PRIVACY.md`, and host `PRIVACY.md` at a public URL for App Store Connect. |
| **Data minimisation.** Only collect what the app needs. | 5.1.1(iii) | Done. Only a username and password, plus game progress. No email, real name, location, device or advertising IDs. No ads, analytics or tracking SDKs. |
| **Access to your data** | 5.1.1 / GDPR | Done. Main menu → Account → Download my data exports everything stored as JSON. |
| **Encrypted network traffic (App Transport Security)** | ATS | Done in code. The client refuses non-HTTPS servers except `localhost`. In production the server rejects plain HTTP and sends HSTS. You still need to deploy the API behind HTTPS (see the checklist). |
| **Sign in with Apple** | 4.8 | Not needed. It's only required when an app offers third-party or social login (Google, Facebook…). This app only has its own accounts. If you add a social login later, add Sign in with Apple too. |
| **App Privacy "nutrition label"** | App Store Connect | To fill in. Declare **User ID** and **Gameplay Content**, linked to the user, used for **App Functionality** only, and **not** used for tracking. |
| **No hidden or undocumented features, no private APIs** | 2.3 / 2.5 | Met. |

## How accounts are protected

**Passwords**
- Rules: 8–128 characters. A password can't be all one character or contain the username.
- Storage: only a salted **scrypt** hash on the server (N=2¹⁵, 16-byte random salt) or a salted **PBKDF2-SHA-256** hash (150k iterations) in on-device mode. Passwords are never logged.
- Login checks: compared in constant time. A login for an unknown username still runs a full hash, so response times don't reveal which accounts exist.

**Brute force and abuse** (`server/rateLimit.ts`), with `429` and `Retry-After` on every limit:

| What | Limit |
|---|---|
| Logins | 20 per 15 min per IP |
| Wrong passwords on one account | 5 lock that account's logins for 15 min |
| Sign-ups | 5 per hour per IP |
| Saves | 30 per minute per account |
| All requests | 300 per minute per IP |

**Sessions**
- Tokens: random 256-bit, sent as `Authorization: Bearer`. The server stores only their SHA-256, so a leaked database contains no usable tokens.
- Ending sessions: they expire after 30 days and are deleted on log-out and on account deletion. A `401` clears the client's copy.
- No cookies (`credentials: "omit"`), so cross-site request forgery doesn't apply.

**Requests**
- Input: every body must be JSON with the right content type and is size-limited (auth 4 KB, saves 512 KB).
- Saves: validated against the shared schema (`shared/save.ts`) before they're stored.
- Lookups: guarded against prototype keys.
- Timeouts: slow clients are cut off (`headersTimeout`, `requestTimeout`).

**API response headers:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `default-src 'none'` CSP, and HSTS in production. CORS only allows the origins listed in `ZAZA_ALLOWED_ORIGINS`.

**The game page**
- Release builds carry a strict **Content Security Policy**: only the game's own scripts and Babylon's official decoders, and network access only to its own origin, the API and Babylon's CDNs. This keeps injected scripts away from the session token and saves. Inline scripts are blocked; `'unsafe-eval'` is allowed because the KTX2 texture decoder (Basis transcoder) needs it, or no character model can load.
- No source maps are shipped, and the page sets `no-referrer`.
- `vite preview` serves the build with the same headers a production host should send.

**Data on disk**
- The server's database file is written atomically and readable only by the server's user (`0600`).
- In on-device mode, accounts and saves stay in that device's app storage.

## Native app (iOS / Android) notes

- Token storage: the session token goes through `TokenStore` (`src/services/backend/tokenStore.ts`). In a native wrapper such as Capacitor, swap in a store backed by the iOS Keychain or Android Keystore (a secure-storage plugin) and pass it to `HttpBackend`.
- ATS: keep it on, without `NSAllowsArbitraryLoads`. The API must be HTTPS.

## Production checklist

1. **Hosting:** run the API behind HTTPS (a TLS-terminating proxy or load balancer) with `NODE_ENV=production` and `ZAZA_TRUST_PROXY=1`, and set `ZAZA_ALLOWED_ORIGINS` to the game's real origin(s).
2. **Client build:** build with `VITE_API_URL=https://<your-api>/api`.
3. **Static host headers:** serve the static build with the headers in `vite.config.ts` → `preview.headers`.
4. **Storage:**
   - Back up `server/data/` (or move `server/store.ts` to a managed database).
   - Never commit `server/data/`; it's already git-ignored.
5. **Legal:** fill in and host the privacy policy, then complete the App Privacy section in App Store Connect.
6. **Scaling out:** with more than one server instance, move the rate-limit counters to a shared store such as Redis.
7. **Self-host Babylon's decoders (recommended for the App Store):**
   - Why: some models need Babylon's KTX2 texture and meshopt mesh decoders, which Babylon loads from `cdn.babylonjs.com` by default. Shipping them inside the app avoids running remotely loaded code, so it also works offline.
   - Get the files: they come from the `@babylonjs/ktx2decoder` and `meshoptimizer` packages.
   - Wire them up: copy them into `public/assets/decoders/`, then point `KhronosTextureContainer2.URLConfig` and `MeshoptCompression.Configuration` at them.
   - Lock it down: remove `https://cdn.babylonjs.com` from the CSP in `vite.config.ts`.
