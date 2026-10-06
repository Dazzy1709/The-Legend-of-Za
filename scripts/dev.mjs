// scripts/dev.mjs
// `npm run dev`: the game's dev server and the game backend together, so
// accounts and saves work out of the box. Ctrl+C stops both.
//
// If the backend is already running (another terminal), it's reused
// rather than started twice; if its port is taken by something else, the
// backend moves to the next free port and the game's /api proxy follows
// it (ZAZA_API_PORT, read by vite.config.ts).
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const PREFERRED_API_PORT = Number(process.env.ZAZA_API_PORT ?? 8787);

const run = (cmd, args, env) => spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env });

async function isOurBackend(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    const body = await res.json();
    return body?.service === "legend-of-zaza";
  } catch {
    return false;
  }
}

function isFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port);
  });
}

let apiPort = PREFERRED_API_PORT;
let server = null;
if (await isOurBackend(apiPort)) {
  console.log(`Using the game backend already running on port ${apiPort}.`);
} else {
  while (!(await isFree(apiPort))) apiPort++;
  if (apiPort !== PREFERRED_API_PORT) console.log(`Port ${PREFERRED_API_PORT} is busy — starting the game backend on ${apiPort}.`);
  server = run("node", ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", "--watch", "server/index.ts"], {
    ...process.env,
    PORT: String(apiPort), // its own port, never a PORT meant for the dev server
  });
}

const vite = run("npx", ["vite", ...process.argv.slice(2)], { ...process.env, ZAZA_API_PORT: String(apiPort) });

const stop = () => {
  server?.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", (code) => {
  server?.kill();
  process.exit(code ?? 0);
});
