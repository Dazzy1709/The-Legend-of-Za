import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * The Content Security Policy for production builds: the page may only
 * run its own scripts plus Babylon's official decoders (cdn.babylonjs.com:
 * the KTX2 texture and meshopt mesh decoders some models need, which run
 * as WebAssembly), and talk only to its own origin, the game API and
 * Babylon's CDNs. This is what stops injected scripts from reading the
 * session token or saves. (To drop the CDN, self-host the decoders — see
 * SECURITY.md.)
 * 'unsafe-eval' is needed by the KTX2 decoder: its Basis transcoder (the
 * characters' textures) builds functions at runtime, and without it every
 * character model fails to load. Inline scripts stay blocked.
 * (Development skips it — the dev server's hot reload needs inline scripts.)
 */
function contentSecurityPolicy(apiUrl: string): string {
  const apiOrigin = apiUrl.startsWith('http') ? new URL(apiUrl).origin : ''
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.babylonjs.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://assets.babylonjs.com",
    "font-src 'self' data:",
    `connect-src 'self' data: blob: https://assets.babylonjs.com https://cdn.babylonjs.com ${apiOrigin}`.trim(),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

function cspPlugin(csp: string): Plugin {
  return {
    name: 'zaza-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="no-referrer" />`),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const csp = contentSecurityPolicy(env.VITE_API_URL ?? '/api')
  // The backend `npm run dev` started (scripts/dev.mjs picks the port).
  const apiTarget = `http://localhost:${process.env.ZAZA_API_PORT ?? 8787}`
  return {
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      cspPlugin(csp),
    ],
    build: {
      sourcemap: false, // don't ship source maps in release builds
    },
    server: {
      // The backend (npm run server) — the game calls /api on its own origin.
      proxy: {
        '/api': apiTarget,
      },
    },
    preview: {
      // `vite preview` serves the production build with the same headers a real host should send (see SECURITY.md).
      headers: {
        'Content-Security-Policy': `${csp}; frame-ancestors 'none'`,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      },
      proxy: {
        '/api': apiTarget,
      },
    },
  }
})
