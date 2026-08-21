/**
 * dsh-mcp-manager — host half.
 *
 * Manages MCP servers at runtime:
 *  - persists the server list in $DSH_HOME/mcp-servers.json (global, shared by
 *    every profile and session);
 *  - connects/disconnects each server by dynamically mounting a
 *    `@deepseek-ai/dsh-mcp-client` plugin instance via `ctx.plugin(...)`, so the
 *    server's tools appear as `mcp__<serverName>__<rawName>` to every agent;
 *  - exposes a small JSON API on the web server under `/mcp-manager/api/*` for
 *    the browser settings page (the settings-namespace allowlist cannot serve
 *    third-party namespaces, so the UI talks to these routes directly).
 *
 * @module dsh-mcp-manager
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply as mcpClientApply } from '@deepseek-ai/dsh-mcp-client'
import {
  discoverOAuthServerInfo,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type { Context, Fiber } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: any
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-manager'

/** Required host services. */
export const inject = ['tools', 'webServer']

/** OAuth tokens persisted for a server. */
export interface OAuthTokens {
  accessToken: string
  tokenType?: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
}

/** OAuth configuration attached to an MCP server entry. */
export interface McpServerOAuthConfig {
  clientId?: string
  clientSecret?: string
  scopes?: string[]
  authorizationServerUrl?: string
  tokens?: OAuthTokens
}

/** One configured MCP server (a slim superset of the mcp-client Config). */
export interface McpServerEntry {
  /** Namespace for model-facing tool names (`mcp__<serverName>__<rawName>`). */
  serverName: string
  /** `stdio` spawns a child process; `streamable-http` talks HTTP/SSE. */
  transport: 'stdio' | 'streamable-http'
  /** streamable-http: MCP endpoint URL. */
  url?: string
  /** streamable-http: extra request headers (e.g. auth tokens). */
  headers?: Record<string, string>
  /** stdio: executable to spawn. */
  command?: string
  /** stdio: arguments passed directly, without shell interpolation. */
  args?: string[]
  /** stdio: extra env vars. */
  env?: Record<string, string>
  /** stdio: working directory for the child process. */
  cwd?: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs?: number
  /** Reject plugin activation when the initial connection fails. */
  failOnStartupError?: boolean
  /** Whether this server should be connected. Disabled servers stay disconnected. */
  enabled?: boolean
  /** Authentication mode: 'none' (or static headers) | 'oauth'. */
  authType?: 'none' | 'oauth'
  /** OAuth 2.0 / MCP spec configuration and tokens. */
  oauth?: McpServerOAuthConfig
}

/** The persisted file shape. */
export interface StoredState {
  version: 1
  servers: McpServerEntry[]
  /**
   * Optional access token for the `/mcp-manager/*` API. When set, every
   * request must carry `Authorization: Bearer <token>`. When unset and the
   * web server binds to a non-loopback address, mutating requests are
   * rejected (the audit-mitigating posture).
   */
  token?: string
}

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const MAX_BODY_BYTES = 1_000_000

/**
 * Plugin version surfaced by the health endpoint. Injected at build time from
 * package.json (`__DSH_MCP_MANAGER_VERSION__`), so package.json is the single
 * source of truth — bump it there and rebuild.
 */
declare const __DSH_MCP_MANAGER_VERSION__: string
const VERSION = __DSH_MCP_MANAGER_VERSION__

/** Probe cache TTL: reachability of streamable-http servers, refreshed at most this often. */
const PROBE_TTL_MS = 5_000
/** Per-probe timeout: an endpoint that hangs longer counts as unreachable. */
const PROBE_TIMEOUT_MS = 2_500
/** A server stuck in "connecting" for longer than this is reported as a timeout. */
const CONNECT_TIMEOUT_MS = 30_000
/** Initial retry delay for a failed connect; doubles up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 3_000
/** Ceiling for the automatic reconnect backoff of failed initial connects. */
const RETRY_MAX_MS = 60_000
/** Minimum gap between manual/refresh-triggered retries of a failed server. */
const RETRY_THROTTLE_MS = 3_000
/** Config-file watcher poll interval (fs.watchFile polls; robust across platforms). */
const FILE_WATCH_INTERVAL_MS = 1_000
/** Debounce for externally triggered config reloads. */
const RELOAD_DEBOUNCE_MS = 300

/** Absolute path of the shared server list. */
export function storePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'mcp-servers.json')
}

function loadState(path: string): StoredState {
  try {
    if (!existsSync(path)) return { version: 1, servers: [] }
    // Strip a UTF-8 BOM if present: Windows editors and PowerShell 5.1's
    // `-Encoding UTF8` write one, and JSON.parse rejects it, which would
    // silently degrade the whole list to empty.
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    const raw: unknown = JSON.parse(text)
    if (
      raw !== null && typeof raw === 'object' &&
      Array.isArray((raw as StoredState).servers)
    ) return raw as StoredState
    return { version: 1, servers: [] }
  } catch (err) {
    console.error(`mcp-manager: cannot read ${path}: ${String(err)} — starting with an empty list`)
    return { version: 1, servers: [] }
  }
}

function saveState(path: string, state: StoredState): void {
  const tmp = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

/** Project the manager entry onto the mcp-client Config shape. */
function toMcpConfig(entry: McpServerEntry, resolvedHeaders?: Record<string, string>): unknown {
  const base = {
    serverName: entry.serverName,
    transport: entry.transport,
    toolCallTimeoutMs: entry.toolCallTimeoutMs,
    // Surface an initial connection failure as an "error" status instead of an
    // endless "connecting": with failOnStartupError the first connect failure
    // rejects the fiber, which the manager records and the UI shows. Later
    // drops after a successful start still auto-reconnect (mcp-client keeps
    // its supervisor running; the flag only gates the initial await).
    failOnStartupError: entry.failOnStartupError ?? true,
  }
  return entry.transport === 'stdio'
    ? { ...base, command: entry.command, args: entry.args, env: entry.env, cwd: entry.cwd }
    : { ...base, url: entry.url, headers: resolvedHeaders ?? entry.headers }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * The manager plugin. One instance per process; it owns the server list, the
 * live connection map, and the `/mcp-manager/api/*` routes.
 */
export function apply(ctx: Context): void {
  const path = storePath()
  const state = loadState(path)

  /** Whether the web server is reachable beyond loopback (needs an access token). */
  const exposed = ctx.webServer.host !== '127.0.0.1'
  const hasToken = typeof state.token === 'string' && state.token !== ''

  // ── access control for /mcp-manager/* ───────────────────────────────────────
  function safeEqual(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a).digest()
    const hb = createHash('sha256').update(b).digest()
    return timingSafeEqual(ha, hb)
  }

  function isAuthorized(req: import('node:http').IncomingMessage): boolean {
    if (hasToken) {
      const header = req.headers.authorization
      if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
      return safeEqual(header.slice('Bearer '.length), state.token as string)
    }
    return !exposed
  }

  function authError(): { status: number; message: string } {
    if (exposed && !hasToken) {
      return {
        status: 403,
        message: 'access denied: the web server is network-exposed and no access token is configured — set "token" in $DSH_HOME/mcp-servers.json, then restart',
      }
    }
    return { status: 401, message: 'unauthorized: send "Authorization: Bearer <token>" (set "token" in $DSH_HOME/mcp-servers.json)' }
  }

  /** serverName → live mcp-client fiber. */
  const fibers = new Map<string, Fiber>()
  /** serverName → last start failure message. */
  const errors = new Map<string, string>()
  /** serverName → cached reachability probe result for streamable-http servers. */
  const probeCache = new Map<string, { reachable: boolean; at: number }>()
  /** serverName → when its current connect attempt started (connecting-timeout heuristic). */
  const connectingSince = new Map<string, number>()
  /** serverName → serialized operation chain (prevents connect/disconnect races). */
  const queues = new Map<string, Promise<void>>()
  /** serverName → pending auto-retry timer for a failed initial connect. */
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** serverName → last connect attempt timestamp (throttles refresh-triggered retries). */
  const lastAttempt = new Map<string, number>()

  /** Pending OAuth authorization sessions keyed by state. */
  interface PendingOAuthSession {
    state: string
    serverName: string
    url: string
    codeVerifier: string
    redirectUri: string
    authorizationServerUrl: string
    metadata?: any
    clientInformation: { client_id: string; client_secret?: string }
    createdAt: number
  }
  const pendingOAuthSessions = new Map<string, PendingOAuthSession>()

  /** Resolve dynamic headers for an entry (e.g. injecting or refreshing OAuth access tokens). */
  async function resolveEntryHeaders(entry: McpServerEntry, onSave?: () => void): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...(entry.headers ?? {}) }
    if (entry.authType === 'oauth' && entry.oauth?.tokens?.accessToken) {
      const tokens = entry.oauth.tokens
      // Refresh token automatically if expiring within 60 seconds
      if (tokens.refreshToken && tokens.expiresAt && Date.now() > tokens.expiresAt - 60_000) {
        try {
          const authServerUrl = entry.oauth.authorizationServerUrl || entry.url || ''
          if (authServerUrl) {
            const refreshed = await refreshAuthorization(authServerUrl, {
              clientInformation: {
                client_id: entry.oauth.clientId || 'dsh-mcp-manager',
                client_secret: entry.oauth.clientSecret,
              },
              refreshToken: tokens.refreshToken,
            })
            if (refreshed.access_token) {
              tokens.accessToken = refreshed.access_token
              if (refreshed.refresh_token) tokens.refreshToken = refreshed.refresh_token
              if (refreshed.expires_in) tokens.expiresAt = Date.now() + refreshed.expires_in * 1000
              if (onSave) onSave()
            }
          }
        } catch (err) {
          ctx.logger.warn(`mcp-manager: token refresh failed for "${entry.serverName}": ${String(err)}`)
        }
      }
      headers['Authorization'] = `Bearer ${tokens.accessToken}`
    }
    return headers
  }

  /** Serialize per-server mutations: each op waits for the previous one to finish. */
  function enqueue<T>(serverName: string, fn: () => Promise<T>): Promise<T> {
    const prev = queues.get(serverName) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    queues.set(serverName, next.then(() => {}, () => {}))
    return next
  }

  function clearRetry(serverName: string): void {
    const timer = retryTimers.get(serverName)
    if (timer !== undefined) {
      clearTimeout(timer)
      retryTimers.delete(serverName)
    }
  }

  /** Exponential backoff retry so a server that was down at startup connects once it comes up. */
  function scheduleRetry(entry: McpServerEntry, attempt: number): void {
    if (entry.enabled === false) return
    clearRetry(entry.serverName)
    const delay = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS)
    ctx.logger.info(`mcp-manager: server "${entry.serverName}" will retry in ${Math.round(delay / 1000)}s (attempt ${attempt})`)
    retryTimers.set(entry.serverName, setTimeout(() => {
      retryTimers.delete(entry.serverName)
      void connect(entry, attempt + 1).catch(() => { /* failures are recorded by connectNow */ })
    }, delay))
  }

  async function connectNow(entry: McpServerEntry, attempt = 1): Promise<void> {
    if (entry.enabled === false) return
    if (fibers.has(entry.serverName)) return
    clearRetry(entry.serverName)
    lastAttempt.set(entry.serverName, Date.now())
    errors.delete(entry.serverName)
    connectingSince.set(entry.serverName, Date.now())

    // If OAuth is configured but no access token is available, mark as error/awaiting auth
    if (entry.authType === 'oauth' && !entry.oauth?.tokens?.accessToken) {
      errors.set(entry.serverName, '需要 OAuth 授权登录：请在配置中完成授权')
      connectingSince.delete(entry.serverName)
      return
    }

    const resolvedHeaders = await resolveEntryHeaders(entry, () => saveState(path, state))
    const fiber = ctx.plugin(mcpClientApply, toMcpConfig(entry, resolvedHeaders) as any)
    fibers.set(entry.serverName, fiber)
    try {
      await fiber
    } catch (err) {
      fibers.delete(entry.serverName)
      const cause = (err as { cause?: unknown } | null)?.cause
      const message = err instanceof Error ? err.message : String(err)
      const detail = cause !== undefined && cause !== null ? `${message}（原因: ${String(cause)}）` : message
      errors.set(entry.serverName, detail)
      connectingSince.delete(entry.serverName)
      ctx.logger.error(`mcp-manager: server "${entry.serverName}" failed to start: ${detail}`)
      scheduleRetry(entry, attempt + 1)
    }
  }

  async function disconnectNow(serverName: string): Promise<void> {
    clearRetry(serverName)
    const fiber = fibers.get(serverName)
    if (!fiber) return
    fibers.delete(serverName)
    errors.delete(serverName)
    probeCache.delete(serverName)
    connectingSince.delete(serverName)
    try {
      await fiber.dispose()
    } catch (err) {
      ctx.logger.warn(`mcp-manager: disposing server "${serverName}" reported: ${String(err)}`)
    }
  }

  /** Enqueued connect: serialized with other mutations of the same server. */
  function connect(entry: McpServerEntry, attempt = 1): Promise<void> {
    return enqueue(entry.serverName, () => connectNow(entry, attempt))
  }

  /** Enqueued disconnect: serialized with other mutations of the same server. */
  function disconnect(serverName: string): Promise<void> {
    return enqueue(serverName, () => disconnectNow(serverName))
  }

  /** Live status of one server: connected / connecting / error / disabled / disconnected. */
  function statusOf(entry: McpServerEntry): { status: string; toolCount: number; error?: string } {
    if (entry.enabled === false) return { status: 'disabled', toolCount: 0 }
    const error = errors.get(entry.serverName)
    if (error !== undefined) {
      connectingSince.delete(entry.serverName)
      return { status: 'error', toolCount: 0, error }
    }
    if (!fibers.has(entry.serverName)) return { status: 'disconnected', toolCount: 0 }
    const prefix = `mcp__${entry.serverName}__`
    const toolCount = ctx.tools.schemas().filter(schema => schema.name.startsWith(prefix)).length
    if (toolCount > 0) {
      connectingSince.delete(entry.serverName)
      return { status: 'connected', toolCount }
    }
    const since = connectingSince.get(entry.serverName)
    if (since !== undefined && Date.now() - since > CONNECT_TIMEOUT_MS) {
      return { status: 'error', toolCount: 0, error: `连接超时（超过 ${Math.round(CONNECT_TIMEOUT_MS / 1000)} 秒未建立连接）` }
    }
    return { status: 'connecting', toolCount }
  }

  /**
   * Cheap reachability check for streamable-http servers: a GET that gets any
   * HTTP response (including 4xx/5xx) proves the process is up, without
   * opening an MCP session (which some single-client servers reject). stdio
   * servers are not probed (the child process is owned by mcp-client).
   */
  async function probeReachable(entry: McpServerEntry): Promise<boolean> {
    if (entry.transport !== 'streamable-http' || entry.url === undefined) return true
    const cached = probeCache.get(entry.serverName)
    if (cached !== undefined && Date.now() - cached.at < PROBE_TTL_MS) return cached.reachable
    let reachable = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const probeHeaders: Record<string, string> = { Accept: 'application/json', ...(entry.headers ?? {}) }
      if (entry.authType === 'oauth' && entry.oauth?.tokens?.accessToken) {
        probeHeaders['Authorization'] = `Bearer ${entry.oauth.tokens.accessToken}`
      }
      const res = await fetch(entry.url, {
        method: 'GET',
        headers: probeHeaders,
        signal: controller.signal,
        redirect: 'manual',
      })
      reachable = true
      void res.body?.cancel().catch(() => { /* best-effort body discard */ })
    } catch {
      reachable = false
    } finally {
      clearTimeout(timer)
    }
    probeCache.set(entry.serverName, { reachable, at: Date.now() })
    return reachable
  }

  /** Entry + live status; probes reachability so a closed server is not shown as connected. */
  async function decorateEntry(entry: McpServerEntry): Promise<McpServerEntry & { status: string; toolCount: number; error?: string }> {
    const base = statusOf(entry)
    if (base.status === 'connected') {
      const reachable = await probeReachable(entry)
      if (!reachable) return { ...entry, ...base, status: 'offline' }
    } else if (base.status === 'connecting') {
      const reachable = await probeReachable(entry)
      if (!reachable) {
        return { ...entry, ...base, status: 'error', error: '服务器不可达（可能已关闭）' }
      }
    }
    return { ...entry, ...base }
  }

  function findEntry(serverName: string): McpServerEntry | undefined {
    return state.servers.find(server => server.serverName === serverName)
  }

  /**
   * Re-read the config file from disk and reconcile the live connections:
   * connect newly added / re-enabled / changed servers, disconnect removed /
   * disabled / changed ones. No-op when nothing changed, so the manager's own
   * saveState() writes do not cause churn.
   */
  async function reloadFromDisk(): Promise<void> {
    const disk = loadState(path)
    for (const entry of disk.servers) entry.enabled = entry.enabled ?? true
    const diskSigs = new Map(disk.servers.map(entry => [entry.serverName, JSON.stringify(entry)]))
    const currentSigs = new Map(state.servers.map(entry => [entry.serverName, JSON.stringify(entry)]))

    // Disconnect servers that were removed, disabled, or changed on disk.
    for (const entry of [...state.servers]) {
      const diskSig = diskSigs.get(entry.serverName)
      if (diskSig === undefined || diskSig !== currentSigs.get(entry.serverName)) {
        await disconnect(entry.serverName)
      }
    }

    // Connect servers that are new or changed and enabled on disk.
    for (const diskEntry of disk.servers) {
      const currentSig = currentSigs.get(diskEntry.serverName)
      if (currentSig === undefined || currentSig !== diskSigs.get(diskEntry.serverName)) {
        if (diskEntry.enabled !== false) {
          void connect(diskEntry).catch(err => {
            ctx.logger.error(`mcp-manager: reload connect "${diskEntry.serverName}" failed: ${String(err)}`)
          })
        }
      }
    }

    state.servers = disk.servers
  }

  /** Validate transport-specific fields only (shared by create and update). */
  function validateFields(entry: McpServerEntry): void {
    if (entry.transport !== 'stdio' && entry.transport !== 'streamable-http') {
      throw new Error('transport must be "stdio" or "streamable-http"')
    }
    if (entry.transport === 'streamable-http') {
      if (typeof entry.url !== 'string' || !/^https?:\/\//.test(entry.url)) {
        throw new Error('streamable-http requires a url starting with http:// or https://')
      }
    } else {
      if (typeof entry.command !== 'string' || entry.command.trim() === '') {
        throw new Error('stdio requires a command')
      }
    }
  }

  function validateEntry(body: unknown): McpServerEntry {
    if (body === null || typeof body !== 'object') {
      throw new Error('body must be a JSON object')
    }
    const entry = body as McpServerEntry
    if (typeof entry.serverName !== 'string' || !SERVER_NAME_PATTERN.test(entry.serverName)) {
      throw new Error('serverName must match [A-Za-z0-9_-]{1,32}')
    }
    if (findEntry(entry.serverName)) {
      throw new Error(`server "${entry.serverName}" already exists`)
    }
    validateFields(entry)
    entry.enabled = entry.enabled ?? true
    return entry
  }

  /** Validate an update body: the identity is the URL path (serverName immutable). */
  function validateUpdate(serverName: string, body: unknown): McpServerEntry {
    if (body === null || typeof body !== 'object') {
      throw new Error('body must be a JSON object')
    }
    const entry = body as McpServerEntry
    if (entry.serverName !== undefined && entry.serverName !== serverName) {
      throw new Error(`serverName cannot be changed (stays "${serverName}")`)
    }
    entry.serverName = serverName
    validateFields(entry)
    return entry
  }

  // ── JSON API routes ────────────────────────────────────────────────────────

  const json = (res: import('node:http').ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }

  const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new Error('request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const parts = url.pathname.split('/').filter(Boolean) // mcp-manager / api / ...
      if (parts[0] !== 'mcp-manager' || parts[1] !== 'api') {
        json(res, 404, { ok: false, error: 'not found' })
        return
      }

      const [action, serverName, sub] = parts.slice(2)

      // OAuth callback is loaded directly by user browser redirect, bypass standard token check
      if (req.method === 'GET' && action === 'oauth' && serverName === 'callback') {
        const code = url.searchParams.get('code')
        const stateVal = url.searchParams.get('state')
        const errorParam = url.searchParams.get('error')
        const errorDescription = url.searchParams.get('error_description')

        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')

        if (errorParam || !code || !stateVal) {
          const errMsg = errorDescription || errorParam || 'Missing code or state parameter'
          res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Authorization Failed</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#18181b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#27272a;padding:32px;border-radius:12px;max-width:480px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5)}.err{color:#ef4444;margin-top:12px}</style></head>
<body>
  <div class="card">
    <h2>❌ 授权失败 (Authorization Failed)</h2>
    <div class="err">${escapeHtml(errMsg)}</div>
    <p style="margin-top:24px;color:#a1a1aa;font-size:13px">窗口将在 5 秒后自动关闭…</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'mcp-oauth-error', error: ${JSON.stringify(errMsg)} }, '*');
    }
    setTimeout(() => window.close(), 5000);
  </script>
</body>
</html>`)
          return
        }

        const session = pendingOAuthSessions.get(stateVal)
        if (!session) {
          res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Session Expired</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#18181b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#27272a;padding:32px;border-radius:12px;max-width:480px;text-align:center}</style></head>
<body>
  <div class="card">
    <h2>⚠️ 会话已过期 (Session Expired)</h2>
    <p style="color:#a1a1aa">请返回 MCP 管理面板重新点击授权。</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`)
          return
        }

        pendingOAuthSessions.delete(stateVal)

        try {
          const tokens = await exchangeAuthorization(session.authorizationServerUrl, {
            metadata: session.metadata,
            clientInformation: session.clientInformation,
            authorizationCode: code,
            codeVerifier: session.codeVerifier,
            redirectUri: session.redirectUri,
          })

          let entry = findEntry(session.serverName)
          if (!entry) {
            entry = {
              serverName: session.serverName,
              transport: 'streamable-http',
              url: session.url,
              authType: 'oauth',
              enabled: true,
            }
            state.servers.push(entry)
          }
          entry.authType = 'oauth'
          entry.oauth = {
            ...(entry.oauth ?? {}),
            clientId: session.clientInformation.client_id,
            clientSecret: session.clientInformation.client_secret,
            authorizationServerUrl: session.authorizationServerUrl,
            tokens: {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
              tokenType: tokens.token_type,
              scope: tokens.scope,
            },
          }
          saveState(path, state)

          // Reconnect server immediately with the newly acquired token
          void enqueue(entry.serverName, async () => {
            await disconnectNow(entry.serverName)
            await connectNow(entry)
          })

          res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Authorized</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#18181b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#27272a;padding:32px;border-radius:12px;max-width:480px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5)}.ok{color:#10b981;font-size:20px;font-weight:600}</style></head>
<body>
  <div class="card">
    <div class="ok">🎉 授权成功！(Authorized)</div>
    <p style="color:#a1a1aa;margin-top:12px">服务器 <b>${escapeHtml(session.serverName)}</b> 授权完成，已保存令牌并正在建立连接…</p>
    <p style="margin-top:20px;color:#71717a;font-size:12px">该窗口将在 1.5 秒后自动关闭。</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'mcp-oauth-success', serverName: ${JSON.stringify(session.serverName)} }, '*');
    }
    setTimeout(() => window.close(), 1500);
  </script>
</body>
</html>`)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Exchange Failed</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#18181b;color:#f4f4f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#27272a;padding:32px;border-radius:12px;max-width:480px;text-align:center}</style></head>
<body>
  <div class="card">
    <h2>❌ 交换令牌失败 (Token Exchange Failed)</h2>
    <p style="color:#ef4444">${escapeHtml(errMsg)}</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'mcp-oauth-error', error: ${JSON.stringify(errMsg)} }, '*');
    }
    setTimeout(() => window.close(), 4000);
  </script>
</body>
</html>`)
        }
        return
      }

      if (!isAuthorized(req)) {
        const denied = authError()
        json(res, denied.status, { ok: false, error: denied.message })
        return
      }

      if (req.method === 'GET' && action === 'health') {
        json(res, 200, { ok: true, name, version: VERSION, storePath: path })
        return
      }

      if (req.method === 'POST' && action === 'reload') {
        await reloadFromDisk()
        json(res, 200, { ok: true, servers: state.servers.length })
        return
      }

      // ── OAuth Management Endpoints ──────────────────────────────────────────
      if (req.method === 'POST' && action === 'oauth') {
        if (serverName === 'discover') {
          const body = JSON.parse(await readBody(req)) as { url?: string }
          if (!body.url) {
            json(res, 400, { ok: false, error: 'url is required' })
            return
          }
          try {
            const info = await discoverOAuthServerInfo(body.url)
            json(res, 200, {
              ok: true,
              authorizationServerUrl: info.authorizationServerUrl,
              supportsOAuth: Boolean(info.authorizationServerMetadata || info.resourceMetadata),
              metadata: info.authorizationServerMetadata,
            })
          } catch (err) {
            json(res, 200, { ok: true, supportsOAuth: false, error: String(err) })
          }
          return
        }

        if (serverName === 'start') {
          const body = JSON.parse(await readBody(req)) as {
            serverName: string
            url?: string
            clientId?: string
            clientSecret?: string
            scopes?: string[]
            redirectUri?: string
          }
          const entry = findEntry(body.serverName)
          const targetUrl = body.url || entry?.url
          if (!targetUrl) {
            json(res, 400, { ok: false, error: 'url or valid serverName is required' })
            return
          }

          const serverInfo = await discoverOAuthServerInfo(targetUrl).catch(() => ({
            authorizationServerUrl: targetUrl,
            authorizationServerMetadata: undefined,
            resourceMetadata: undefined,
          }))

          const authServerUrl = serverInfo.authorizationServerUrl || targetUrl
          const clientId = body.clientId || entry?.oauth?.clientId || 'dsh-mcp-manager'
          const clientInformation = {
            client_id: clientId,
            client_secret: body.clientSecret || entry?.oauth?.clientSecret,
          }

          const hostHeader = (req.headers.host || `127.0.0.1:${ctx.webServer.port}`).split(':')[0]
          const port = ctx.webServer.port
          const redirectUri = body.redirectUri || `http://${hostHeader}:${port}/mcp-manager/api/oauth/callback`
          const stateVal = randomBytes(16).toString('hex')

          const { authorizationUrl, codeVerifier } = await startAuthorization(authServerUrl, {
            metadata: serverInfo.authorizationServerMetadata,
            clientInformation,
            redirectUrl: redirectUri,
            scope: body.scopes?.join(' ') || entry?.oauth?.scopes?.join(' '),
            state: stateVal,
          })

          pendingOAuthSessions.set(stateVal, {
            state: stateVal,
            serverName: body.serverName,
            url: targetUrl,
            codeVerifier,
            redirectUri,
            authorizationServerUrl: authServerUrl,
            metadata: serverInfo.authorizationServerMetadata,
            clientInformation,
            createdAt: Date.now(),
          })

          json(res, 200, {
            ok: true,
            authorizationUrl: authorizationUrl.toString(),
            state: stateVal,
            redirectUri,
          })
          return
        }

        if (serverName === 'revoke') {
          const body = JSON.parse(await readBody(req)) as { serverName: string }
          const entry = findEntry(body.serverName)
          if (!entry) {
            json(res, 404, { ok: false, error: `server "${body.serverName}" not found` })
            return
          }
          if (entry.oauth) {
            delete entry.oauth.tokens
            saveState(path, state)
          }
          await enqueue(entry.serverName, async () => {
            await disconnectNow(entry.serverName)
          })
          json(res, 200, { ok: true, server: await decorateEntry(entry) })
          return
        }
      }

      if (req.method === 'GET' && action === 'servers' && serverName === undefined) {
        const servers = await Promise.all(state.servers.map(entry => decorateEntry(entry)))
        // Refresh-triggered retry: a manual refresh (or page open) immediately
        // retries servers whose initial connect failed, throttled so rapid
        // polling does not hammer the endpoint.
        for (const entry of state.servers) {
          const s = statusOf(entry)
          if (s.status === 'error' && !fibers.has(entry.serverName)) {
            const last = lastAttempt.get(entry.serverName) ?? 0
            if (Date.now() - last > RETRY_THROTTLE_MS) {
              void connect(entry).catch(() => { /* failures are recorded by connectNow */ })
            }
          }
        }
        json(res, 200, { ok: true, servers })
        return
      }

      if (req.method === 'POST' && action === 'servers' && serverName === undefined) {
        const body = JSON.parse(await readBody(req)) as unknown
        const entry = validateEntry(body)
        state.servers.push(entry)
        saveState(path, state)
        void connect(entry).catch(err => {
          ctx.logger.error(`mcp-manager: connect "${entry.serverName}" failed: ${String(err)}`)
        })
        json(res, 201, { ok: true, server: { ...entry, ...statusOf(entry) } })
        return
      }

      if (serverName !== undefined) {
        if (req.method === 'DELETE') {
          await disconnect(serverName)
          const before = state.servers.length
          state.servers = state.servers.filter(entry => entry.serverName !== serverName)
          if (state.servers.length !== before) saveState(path, state)
          json(res, 200, { ok: true })
          return
        }

        if (req.method === 'POST' && sub === 'update') {
          const entry = findEntry(serverName)
          if (!entry) {
            json(res, 404, { ok: false, error: `server "${serverName}" not found` })
            return
          }
          const body = JSON.parse(await readBody(req)) as unknown
          const updated = validateUpdate(serverName, body)
          // Assign only the fields the client actually sent, so flags like
          // `enabled` set through the toggle endpoint are preserved.
          for (const [key, value] of Object.entries(updated)) {
            if (value !== undefined) (entry as unknown as Record<string, unknown>)[key] = value
          }
          saveState(path, state)
          // Reconfigure the live connection in place: fiber.update() validates
          // and hot-restarts the mcp-client instance without a full teardown,
          // so the serverName reservation never goes through a race window.
          await enqueue(serverName, async () => {
            if (entry.enabled === false) {
              await disconnectNow(serverName)
              return
            }
            const fiber = fibers.get(serverName)
            if (fiber === undefined) {
              await connectNow(entry)
              return
            }
            errors.delete(serverName)
            connectingSince.set(serverName, Date.now())
            try {
              const resolvedHeaders = await resolveEntryHeaders(entry, () => saveState(path, state))
              await fiber.update(toMcpConfig(entry, resolvedHeaders))
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              errors.set(serverName, message)
              connectingSince.delete(serverName)
              ctx.logger.error(`mcp-manager: update "${serverName}" failed: ${message}`)
            }
          })
          json(res, 200, { ok: true, server: { ...entry, ...statusOf(entry) } })
          return
        }

        if (req.method === 'POST' && sub === 'toggle') {
          const entry = findEntry(serverName)
          if (!entry) {
            json(res, 404, { ok: false, error: `server "${serverName}" not found` })
            return
          }
          const body = JSON.parse(await readBody(req)) as { enabled?: unknown }
          const enabled = body?.enabled === true
          entry.enabled = enabled
          saveState(path, state)
          if (enabled) {
            void connect(entry).catch(err => {
              ctx.logger.error(`mcp-manager: enable "${serverName}" connect failed: ${String(err)}`)
            })
          } else {
            await disconnect(serverName)
          }
          json(res, 200, { ok: true, server: { ...entry, ...statusOf(entry) } })
          return
        }

        if (req.method === 'POST' && sub === 'reconnect') {
          const entry = findEntry(serverName)
          if (!entry) {
            json(res, 404, { ok: false, error: `server "${serverName}" not found` })
            return
          }
          await disconnect(serverName)
          void connect(entry).catch(err => {
            ctx.logger.error(`mcp-manager: reconnect "${serverName}" failed: ${String(err)}`)
          })
          json(res, 200, { ok: true, server: { ...entry, ...statusOf(entry) } })
          return
        }

        if (req.method === 'GET') {
          const entry = findEntry(serverName)
          if (!entry) {
            json(res, 404, { ok: false, error: `server "${serverName}" not found` })
            return
          }
          json(res, 200, { ok: true, server: await decorateEntry(entry) })
          return
        }
      }

      json(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      json(res, 400, { ok: false, error: message })
    }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  // Routes are registered through an effect so unload removes them; the
  // register() disposer doubles as the effect disposer.
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/mcp-manager', handler }), 'mcp-manager.routes')

  // Connections are owned by this fiber: unloading the manager disposes every
  // mounted mcp-client fiber, which disconnects and unregisters all its tools.
  // The config-file watcher is torn down with the same effect.
  ctx.effect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | undefined
    const onConfigChange = (): void => {
      if (reloadTimer !== undefined) return
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined
        void reloadFromDisk()
      }, RELOAD_DEBOUNCE_MS)
    }
    // Poll-based watch (works across platforms, including when the file does
    // not exist yet). External edits to mcp-servers.json are picked up
    // automatically; the manager's own saveState() writes reconcile as no-ops.
    watchFile(path, { interval: FILE_WATCH_INTERVAL_MS }, onConfigChange)
    return () => {
      if (reloadTimer !== undefined) clearTimeout(reloadTimer)
      unwatchFile(path, onConfigChange)
      for (const timer of retryTimers.values()) clearTimeout(timer)
      retryTimers.clear()
      for (const fiber of fibers.values()) {
        void fiber.dispose().catch(() => { /* best-effort teardown */ })
      }
      fibers.clear()
      errors.clear()
      queues.clear()
      connectingSince.clear()
      probeCache.clear()
      lastAttempt.clear()
    }
  }, 'mcp-manager.connections')

  // Connect every configured server at startup (best-effort; failures log and
  // show as status "error" in the UI, the list stays intact for a retry).
  for (const entry of state.servers) {
    void connect(entry).catch(err => {
      ctx.logger.error(`mcp-manager: startup connect "${entry.serverName}" failed: ${String(err)}`)
    })
  }
  ctx.logger.info(`mcp-manager: loaded ${state.servers.length} server(s) from ${path}`)
  if (hasToken) {
    ctx.logger.info('mcp-manager: access token configured — /mcp-manager/* requests require "Authorization: Bearer <token>"')
  } else if (exposed) {
    ctx.logger.error(
      'mcp-manager: SECURITY — the web server is network-exposed (host 0.0.0.0) and no access token is set; '
      + 'all /mcp-manager/* requests are rejected until you set "token" in mcp-servers.json (stdio servers execute arbitrary commands)',
    )
  } else {
    ctx.logger.warn(
      'mcp-manager: no access token configured — /mcp-manager/* is open on loopback only; '
      + 'set "token" in mcp-servers.json before binding dsh to a non-loopback address',
    )
  }
}
