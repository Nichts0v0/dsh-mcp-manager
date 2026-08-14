/**
 * Build script for dsh-mcp-manager.
 *
 * Two artifacts, mirroring the harness's own client-bundle conventions:
 *  - lib/index.js  — host half: ESM, fully bundled (mcp-client + SDK inlined),
 *                    no runtime dependencies to resolve from the profile.
 *  - lib/client.js — browser half: a CJS closure-factory bundle that calls
 *                    window.__ModuleLoader__.load({ id, factory }), with the
 *                    platform seed modules left external so the browser module
 *                    table answers them at runtime.
 *
 * Usage: node scripts/build.mjs [--watch]
 */

import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'

/** package.json is the single source of truth for the plugin version. */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
const PLUGIN_VERSION = pkg.version

/** The browser module table's seed specifiers (mirror of the harness list). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

const NODE_ENV = process.env.NODE_ENV ?? 'production'

/** Minify production builds (the plugin ships its own bundles; size matters for installs). */
const MINIFY = NODE_ENV === 'production'

async function buildOnce() {
  // ── host half ───────────────────────────────────────────────────────────────
  await build({
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    minify: MINIFY,
    logLevel: 'info',
    define: { __DSH_MCP_MANAGER_VERSION__: JSON.stringify(PLUGIN_VERSION) },
    // Bundled CJS dependencies (e.g. cross-spawn inside the MCP SDK) call
    // require('child_process') etc. at runtime. In ESM scope `require` does
    // not exist, so esbuild's __require fallback would throw "Dynamic require
    // ... is not supported" under the harness loader. Provide a real require
    // through createRequire before the bundle body runs.
    banner: { js: "import { createRequire as __dshCreateRequire } from 'node:module';\nconst require = __dshCreateRequire(import.meta.url);" },
  })

  // ── browser half ────────────────────────────────────────────────────────────
  await build({
    entryPoints: ['src/client/index.tsx'],
    outfile: 'lib/client.js',
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    minify: MINIFY,
    logLevel: 'info',
    jsx: 'automatic',
    external: PLATFORM_MODULES,
    define: {
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
      'import.meta.env.MODE': JSON.stringify(NODE_ENV),
      'import.meta.env': JSON.stringify({ MODE: NODE_ENV }),
    },
    // esbuild has no `intro` option (that is rolldown's); the closure-factory
    // wrapper is expressed as banner + footer, with `module`/`exports` defined
    // first exactly like the harness's tsdown client preset does.
    banner: { js: 'var module = { exports: {} }; var exports = module.exports;\nwindow.__ModuleLoader__.load({ id: "dsh-mcp-manager", factory: (require) => {' },
    footer: { js: 'return module.exports; } });' },
  })

  console.log('[dsh-mcp-manager] build complete: lib/index.js + lib/client.js')
}

const watch = process.argv.includes('--watch')

if (watch) {
  const client = await context({
    entryPoints: ['src/client/index.tsx'],
    outfile: 'lib/client.js',
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    logLevel: 'info',
    jsx: 'automatic',
    external: PLATFORM_MODULES,
    define: {
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
      'import.meta.env.MODE': JSON.stringify(NODE_ENV),
      'import.meta.env': JSON.stringify({ MODE: NODE_ENV }),
    },
    banner: { js: 'var module = { exports: {} }; var exports = module.exports;\nwindow.__ModuleLoader__.load({ id: "dsh-mcp-manager", factory: (require) => {' },
    footer: { js: 'return module.exports; } });' },
  })
  await client.watch()
  console.log('[dsh-mcp-manager] watching client bundle...')
} else {
  await buildOnce()
}
