/**
 * dsh-mcp-manager — browser half.
 *
 * Registers the "MCP Manager" section into the Web settings page
 * (`settings.section` slot) and renders the server management card. The card
 * talks to the host half through plain HTTP routes under `/mcp-manager/api/*`
 * (the settings-namespace allowlist cannot expose third-party namespaces, so
 * the UI deliberately does not use `settingsScope`).
 *
 * Two views: a list of server cards, and a form page (add / edit). Opening the
 * form hides the list; editing shows a delete danger zone whose confirmation
 * hint only appears after the first click, on the same row as the button.
 *
 * Theming: every color references the harness's `--dsw-alias-*` token family,
 * so the page follows DSH's light/dark mode automatically.
 * i18n: all strings come from the `mcpManager` locale namespace (zh/en).
 *
 * @module dsh-mcp-manager/client
 */

import { useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { en, fmt, zh, type LocaleKey } from './locales.ts'

export interface McpServerView {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
  enabled?: boolean
  status?: string
  toolCount?: number
  error?: string
}

export interface McpManagerSectionInjected {
  list: () => Promise<McpServerView[]>
  add: (entry: McpServerView) => Promise<void>
  update: (serverName: string, entry: McpServerView) => Promise<void>
  setEnabled: (serverName: string, enabled: boolean) => Promise<void>
  remove: (serverName: string) => Promise<void>
  reconnect: (serverName: string) => Promise<void>
}

export interface McpManagerSectionProps extends McpManagerSectionInjected {
  /** Bound to the `mcpManager` locale namespace by the settings shell. */
  t: (key: LocaleKey) => string
  // The settings shell may bind additional runtime props; we only need the face above.
  [key: string]: unknown
}

/** Locale namespace owned by this plugin. */
export const NS = 'mcpManager'

const API = '/mcp-manager/api'

/** Poll cadence while waiting for a connection to settle. */
const POLL_INTERVAL_MS = 800
/** Default connection wait before giving up (seconds). */
const DEFAULT_WAIT_SECONDS = 15
/** How long the delete button stays in its "确认删除？" state. */
const DELETE_CONFIRM_MS = 3_000
/** localStorage key for the optional access token entered by the user. */
const TOKEN_STORAGE_KEY = 'mcpManager.accessToken'

/** Current access token sent on every request ("" = none configured). */
let accessToken = ''

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (accessToken !== '') headers.set('Authorization', `Bearer ${accessToken}`)
  const response = await fetch(url, { ...init, headers })
  let body: { ok: boolean; error?: string } & T
  try {
    body = await response.json() as typeof body
  } catch {
    throw new Error(`MCP manager: invalid response (${response.status})`)
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error ?? `request failed (${response.status})`)
  }
  return body
}

/** Poll the server list until every entry settles (terminal states) or the timeout elapses. */
async function pollServers(timeoutMs: number): Promise<{ servers: McpServerView[]; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs
  let servers: McpServerView[] = []
  for (;;) {
    const body = await request<{ servers: McpServerView[] }>(`${API}/servers`)
    servers = body.servers
    const settled = servers.every(s =>
      s.status === 'connected' || s.status === 'error' || s.status === 'disabled'
      || s.status === 'disconnected' || s.status === 'offline')
    if (settled) return { servers, timedOut: false }
    if (Date.now() >= deadline) return { servers, timedOut: true }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

// ── theme tokens ──────────────────────────────────────────────────────────────
// All colors come from DSH's --dsw-alias-* token family so the page follows the
// active light/dark theme automatically. `tint()` derives a translucent surface
// from a state token for badge/notice backgrounds.

const tint = (token: string, percent: number): string =>
  `color-mix(in srgb, var(${token}) ${percent}%, transparent)`

const TOKENS = {
  bgCard: 'var(--dsw-alias-bg-layer-3)',
  bgForm: 'var(--dsw-alias-bg-layer-2)',
  bgMuted: 'var(--dsw-alias-bg-module-platform)',
  border: 'var(--dsw-alias-border-l2)',
  borderSubtle: 'var(--dsw-alias-border-l1)',
  label: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  brand: 'var(--dsw-alias-brand-primary)',
  business: 'var(--dsw-alias-state-business-primary)',
  success: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
} as const

// ── styles ───────────────────────────────────────────────────────────────────

const badgeStyle = (status: string): React.CSSProperties => {
  const palette: Record<string, [string, string]> = {
    connected: [tint(TOKENS.success, 24), TOKENS.success],
    connecting: [tint(TOKENS.business, 24), TOKENS.business],
    error: [tint(TOKENS.error, 24), TOKENS.error],
    offline: [tint(TOKENS.warn, 26), TOKENS.warn],
    disabled: [TOKENS.bgMuted, TOKENS.labelTertiary],
    disconnected: [TOKENS.bgMuted, TOKENS.labelSecondary],
  }
  const [bg, fg] = palette[status] ?? palette.disconnected
  return {
    padding: '2px 10px', borderRadius: '10px', fontSize: '12px', whiteSpace: 'nowrap',
    background: bg, color: fg, border: `1px solid ${fg}`,
  }
}
const btnStyle: React.CSSProperties = {
  padding: '5px 12px', borderRadius: '4px', border: `1px solid ${TOKENS.border}`,
  background: TOKENS.bgCard, color: TOKENS.label, cursor: 'pointer', fontSize: '13px',
}
const btnDisabled = { ...btnStyle, opacity: 0.55, cursor: 'not-allowed' }
const sectionStyle: React.CSSProperties = { padding: '8px 4px', maxWidth: '880px' }
const serverCardStyle: React.CSSProperties = {
  border: `1px solid ${TOKENS.border}`, borderRadius: '8px', padding: '12px 16px',
  marginBottom: '10px', background: TOKENS.bgCard,
}
const transportBadgeStyle: React.CSSProperties = {
  padding: '2px 8px', borderRadius: '4px', fontSize: '12px',
  background: tint(TOKENS.business, 12), color: TOKENS.business,
}
const formCardStyle: React.CSSProperties = {
  border: `1px solid ${TOKENS.border}`, borderRadius: '8px', padding: '16px 20px 18px',
  background: TOKENS.bgForm, maxWidth: '680px',
}
const fieldRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px',
}
const fieldLabelStyle: React.CSSProperties = {
  width: '150px', flexShrink: 0, fontSize: '13px', color: TOKENS.labelSecondary, textAlign: 'right',
}
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: `1px solid ${TOKENS.border}`, borderRadius: '4px',
  fontFamily: 'inherit', fontSize: '13px', flex: 1, minWidth: 0,
  background: TOKENS.bgCard, color: TOKENS.label,
}
const metaLineStyle: React.CSSProperties = {
  marginTop: '8px', color: TOKENS.labelSecondary, fontSize: '13px', display: 'flex',
  alignItems: 'center', gap: '8px', flexWrap: 'wrap',
}
const metaTextStyle: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
}
const actionRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px',
  marginTop: '12px', paddingTop: '10px', borderTop: `1px solid ${TOKENS.borderSubtle}`,
}

const transportLabel = (transport: string): string =>
  transport === 'stdio' ? 'stdio' : 'streamable-http'

/** A small iOS-style switch. */
function Switch({ checked, disabled, onChange, title }: { checked: boolean; disabled?: boolean; onChange: () => void; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onChange}
      style={{
        position: 'relative', width: 40, height: 22, borderRadius: 11, padding: 0, border: 'none',
        background: checked ? TOKENS.business : TOKENS.border, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1, transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: 9,
        background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
      }} />
    </button>
  )
}

export function McpManagerSection({ list, add, update, setEnabled, remove, reconnect, t }: McpManagerSectionProps) {
  const [servers, setServers] = useState<McpServerView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  /** 'list' shows the server cards; 'form' shows the add/edit page (cards hidden). */
  const [view, setView] = useState<'list' | 'form'>('list')
  /** Server currently being edited (null = the form is in add mode). */
  const [editing, setEditing] = useState<McpServerView | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteTimer = useRef<number>()

  // form fields
  const [serverName, setServerName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('streamable-http')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [headers, setHeaders] = useState('')
  const [waitSeconds, setWaitSeconds] = useState(DEFAULT_WAIT_SECONDS)

  /** Optional access token, persisted locally so the settings page keeps working. */
  const [token, setToken] = useState<string>(() => window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '')

  useEffect(() => {
    accessToken = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  }, [])

  const handleTokenChange = (value: string): void => {
    const trimmed = value.trim()
    setToken(trimmed)
    accessToken = trimmed
    if (trimmed === '') window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    else window.localStorage.setItem(TOKEN_STORAGE_KEY, trimmed)
  }

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const body = await request<{ servers: McpServerView[] }>(`${API}/servers`)
      setServers(body.servers)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  // Clear the delete-confirm timer when the component unmounts.
  useEffect(() => () => { if (deleteTimer.current !== undefined) window.clearTimeout(deleteTimer.current) }, [])

  /** Run an action, then poll until the connection settles or the wait times out, and refresh. */
  const runWithPoll = async (busyKey: string, action: () => Promise<void>): Promise<void> => {
    setBusy(busyKey)
    setError(undefined)
    try {
      await action()
      const timeoutMs = Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds * 1000 : DEFAULT_WAIT_SECONDS * 1000
      const { servers: settled, timedOut } = await pollServers(timeoutMs)
      setServers(settled)
      if (timedOut) {
        setError(fmt(t('timeoutMsg'), { n: Math.round(timeoutMs / 1000) }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      await refresh()
    } finally {
      setBusy(undefined)
    }
  }

  const resetForm = (): void => {
    setServerName(''); setUrl(''); setCommand(''); setArgs(''); setHeaders(''); setTransport('streamable-http')
  }

  const openAddForm = (): void => {
    setEditing(null)
    resetForm()
    setConfirmingDelete(false)
    setView('form')
  }

  const startEdit = (server: McpServerView): void => {
    setEditing(server)
    setTransport(server.transport)
    setUrl(server.url ?? '')
    setCommand(server.command ?? '')
    setArgs((server.args ?? []).join(' '))
    setHeaders(server.headers !== undefined ? JSON.stringify(server.headers, null, 2) : '')
    setConfirmingDelete(false)
    setView('form')
  }

  const closeForm = (): void => {
    setEditing(null)
    setConfirmingDelete(false)
    setView('list')
    resetForm()
  }

  const submit = async (): Promise<void> => {
    const entry: McpServerView = {
      serverName: (editing?.serverName ?? serverName).trim(),
      transport,
    }
    if (transport === 'streamable-http') {
      entry.url = url.trim()
      if (headers.trim() !== '') {
        try {
          entry.headers = JSON.parse(headers) as Record<string, string>
        } catch {
          setError(t('invalidHeaders'))
          return
        }
      }
    } else {
      entry.command = command.trim()
      entry.args = args.split(/\s+/).filter(Boolean)
    }
    if (editing !== null) {
      await runWithPoll(editing.serverName, async () => {
        await update(editing.serverName, entry)
        closeForm()
      })
    } else {
      await runWithPoll('add', async () => {
        await add(entry)
        closeForm()
      })
    }
  }

  /** Two-step delete from the edit page's danger zone: first click arms, second confirms. */
  const handleDelete = async (): Promise<void> => {
    if (editing === null) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      deleteTimer.current = window.setTimeout(() => setConfirmingDelete(false), DELETE_CONFIRM_MS)
      return
    }
    if (deleteTimer.current !== undefined) window.clearTimeout(deleteTimer.current)
    setBusy(editing.serverName)
    setError(undefined)
    try {
      await remove(editing.serverName)
      closeForm()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const removeServer = async (serverName: string): Promise<void> => {
    setBusy(serverName)
    setError(undefined)
    try {
      await remove(serverName)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const reconnectServer = async (serverName: string): Promise<void> => {
    await runWithPoll(serverName, async () => { await reconnect(serverName) })
  }

  /** Enable or disable a server: enabling connects (with poll), disabling disconnects immediately. */
  const toggleEnabled = (server: McpServerView): void => {
    const enabling = server.enabled === false
    void runWithPoll(server.serverName, async () => { await setEnabled(server.serverName, enabling) })
  }

  const formBusy = busy !== undefined
  const deleting = editing !== null && busy === editing.serverName

  const statusText = (server: McpServerView): string => {
    switch (server.status) {
      case 'connected': return fmt(t('connected'), { n: server.toolCount ?? 0 })
      case 'connecting': return t('connecting')
      case 'error': return t('error')
      case 'offline': return t('offline')
      case 'disabled': return t('disabled')
      case 'disconnected': return t('disconnected')
      default: return server.status ?? t('unknown')
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginBottom: 4, color: TOKENS.label }}>{t('title')}</h2>
      <p style={{ color: TOKENS.labelSecondary, fontSize: '13px', marginTop: 0 }}>{t('intro')}</p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
        margin: '10px 0 14px', padding: '10px 12px', borderRadius: '8px',
        border: `1px solid ${TOKENS.borderSubtle}`, background: TOKENS.bgForm, maxWidth: '720px',
      }}>
        <label style={{ fontSize: '13px', color: TOKENS.labelSecondary, whiteSpace: 'nowrap' }}>{t('tokenLabel')}</label>
        <input
          type="password"
          style={{ ...inputStyle, maxWidth: '280px', flex: 1 }}
          placeholder="Bearer <token>"
          value={token}
          onChange={e => handleTokenChange(e.target.value)}
        />
        <span style={{ fontSize: '12px', color: TOKENS.labelTertiary, flexBasis: '100%' }}>{t('tokenHint')}</span>
      </div>

      {error !== undefined && (
        <p style={{
          color: TOKENS.error, background: tint(TOKENS.error, 8),
          padding: '8px 12px', borderRadius: '4px',
        }}>{error}</p>
      )}

      {view === 'form' ? (
        <div style={{ maxWidth: '720px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, color: TOKENS.label }}>
              {editing !== null ? fmt(t('editTitle'), { name: editing.serverName }) : t('addTitle')}
            </h3>
            <button style={btnStyle} onClick={closeForm}>{t('backToList')}</button>
          </div>

          {editing !== null && (
            <div style={{
              border: `1px solid ${tint(TOKENS.error, 40)}`, borderRadius: '8px', background: tint(TOKENS.error, 8),
              padding: '12px 16px', marginBottom: '14px', maxWidth: '680px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px', flexWrap: 'wrap' }}>
                {confirmingDelete && (
                  <span style={{ fontSize: '12px', color: TOKENS.error, flex: 1, minWidth: 220 }}>{t('deleteHint')}</span>
                )}
                <button
                  style={{
                    ...btnStyle, color: TOKENS.bgForm, borderColor: TOKENS.error,
                    background: TOKENS.error,
                    padding: '6px 18px', fontWeight: 500,
                  }}
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? t('deleting') : confirmingDelete ? t('confirmDelete') : t('deleteServer')}
                </button>
              </div>
            </div>
          )}

          <div style={formCardStyle}>
            <div style={fieldRowStyle}>
              <label style={fieldLabelStyle}>{t('fieldServerName')}</label>
              {editing !== null ? (
                <input
                  style={{ ...inputStyle, background: TOKENS.bgMuted, color: TOKENS.labelTertiary }}
                  value={editing.serverName}
                  disabled
                  title={t('serverNameLocked')}
                />
              ) : (
                <input
                  style={inputStyle}
                  placeholder="my-server"
                  value={serverName}
                  onChange={e => setServerName(e.target.value)}
                />
              )}
            </div>

            <div style={fieldRowStyle}>
              <label style={fieldLabelStyle}>{t('fieldTransport')}</label>
              <select style={{ ...inputStyle, maxWidth: '260px' }} value={transport} onChange={e => setTransport(e.target.value as 'stdio' | 'streamable-http')}>
                <option value="streamable-http">streamable-http (HTTP/SSE)</option>
                <option value="stdio">stdio</option>
              </select>
            </div>

            {transport === 'streamable-http' ? (
              <div style={fieldRowStyle}>
                <label style={fieldLabelStyle}>{t('fieldUrl')}</label>
                <input
                  style={inputStyle}
                  placeholder="http://127.0.0.1:8080/mcp"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div style={fieldRowStyle}>
                  <label style={fieldLabelStyle}>{t('fieldCommand')}</label>
                  <input
                    style={inputStyle}
                    placeholder="npx"
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                  />
                </div>
                <div style={fieldRowStyle}>
                  <label style={fieldLabelStyle}>{t('fieldArgs')}</label>
                  <input
                    style={inputStyle}
                    placeholder="--flag value"
                    value={args}
                    onChange={e => setArgs(e.target.value)}
                  />
                </div>
              </>
            )}

            <div style={fieldRowStyle}>
              <label style={fieldLabelStyle}>{t('fieldHeaders')}</label>
              <textarea
                style={{ ...inputStyle, minHeight: '48px', resize: 'vertical', fontFamily: 'monospace' }}
                placeholder='{"Authorization": "Bearer <token>"}'
                value={headers}
                onChange={e => setHeaders(e.target.value)}
              />
            </div>

            <div style={fieldRowStyle}>
              <label style={fieldLabelStyle}>{t('fieldTimeout')}</label>
              <input
                style={{ ...inputStyle, maxWidth: '120px' }}
                type="number"
                min={1}
                max={120}
                value={String(waitSeconds)}
                onChange={e => { const n = Number(e.target.value); setWaitSeconds(Number.isFinite(n) ? n : DEFAULT_WAIT_SECONDS) }}
              />
              <span style={{ fontSize: '12px', color: TOKENS.labelTertiary }}>{t('timeoutHint')}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
              <button style={btnStyle} disabled={formBusy} onClick={closeForm}>{t('cancel')}</button>
              <button
                style={{ ...btnStyle, background: TOKENS.label, color: TOKENS.bgForm, borderColor: TOKENS.label, padding: '7px 20px', fontWeight: 500 }}
                disabled={formBusy}
                onClick={() => void submit()}
              >
                {formBusy
                  ? (editing !== null ? t('savingBusy') : t('addingBusy'))
                  : (editing !== null ? t('save') : t('addAndConnect'))}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <h3 style={{ marginBottom: 10, color: TOKENS.label }}>{t('configured')}</h3>
          {loading ? <p style={{ color: TOKENS.labelSecondary }}>{t('loading')}</p> : servers.length === 0 ? (
            <p style={{ color: TOKENS.labelTertiary, marginBottom: 12 }}>{t('empty')}</p>
          ) : (
            <div>
              {servers.map(server => {
                const disabled = server.enabled === false
                return (
                  <div key={server.serverName} style={{ ...serverCardStyle, opacity: disabled ? 0.62 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '15px', color: TOKENS.label }}>{server.serverName}</strong>
                      <span style={transportBadgeStyle}>{transportLabel(server.transport)}</span>
                      <span style={{ marginLeft: 'auto' }}>
                        <span style={badgeStyle(server.status ?? 'unknown')}>{statusText(server)}</span>
                      </span>
                    </div>
                    <div style={metaLineStyle}>
                      {server.transport === 'streamable-http'
                        ? <span style={metaTextStyle} title={server.url}>{server.url}</span>
                        : (
                          <span style={metaTextStyle} title={[server.command, ...(server.args ?? [])].join(' ')}>
                            {server.command} {(server.args ?? []).join(' ')}
                          </span>
                        )}
                      {server.status === 'error' && server.error !== undefined && (
                        <span style={{ color: TOKENS.error, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={server.error}>
                          {server.error}
                        </span>
                      )}
                      {server.status === 'offline' && (
                        <span style={{ color: TOKENS.warn }}>{t('offlineHint')}</span>
                      )}
                    </div>
                    <div style={actionRowStyle}>
                      {!disabled && (
                        <button
                          style={busy === server.serverName ? btnDisabled : btnStyle}
                          disabled={busy === server.serverName}
                          onClick={() => void reconnectServer(server.serverName)}
                        >
                          {busy === server.serverName ? t('reconnecting') : t('reconnect')}
                        </button>
                      )}
                      <button
                        style={busy === server.serverName ? btnDisabled : btnStyle}
                        disabled={busy === server.serverName}
                        onClick={() => startEdit(server)}
                      >
                        {t('edit')}
                      </button>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '7px', marginLeft: '6px' }}>
                        <Switch
                          checked={!disabled}
                          disabled={busy === server.serverName}
                          title={disabled ? t('enabledLabel') : t('disabledLabel')}
                          onChange={() => toggleEnabled(server)}
                        />
                        <span style={{ fontSize: '12px', color: TOKENS.labelTertiary, minWidth: '3em' }}>
                          {disabled ? t('disabledLabel') : t('enabledLabel')}
                        </span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ marginTop: 6 }}>
            <button style={{ ...btnStyle, borderStyle: 'dashed', padding: '6px 16px' }} onClick={openAddForm}>
              {t('addServer')}
            </button>
          </div>

          <div style={{ marginTop: '16px' }}>
            <button style={btnStyle} onClick={() => void refresh()}>{t('refresh')}</button>
          </div>
        </>
      )}
    </section>
  )
}

/** Services required by this client plugin. */
export const inject = ['slots', 'locale']

/** Register the section into Web settings. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcp-manager: dictionaries')

  const injected = (): McpManagerSectionInjected => ({
    list: async () => {
      const body = await request<{ servers: McpServerView[] }>(`${API}/servers`)
      return body.servers
    },
    add: async (entry: McpServerView) => {
      const body = await request<{ ok: boolean }>(`${API}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      if (!body.ok) throw new Error(t('addFailed'))
    },
    update: async (serverName: string, entry: McpServerView) => {
      const body = await request<{ ok: boolean }>(`${API}/servers/${encodeURIComponent(serverName)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      if (!body.ok) throw new Error(t('updateFailed'))
    },
    setEnabled: async (serverName: string, enabled: boolean) => {
      const body = await request<{ ok: boolean }>(`${API}/servers/${encodeURIComponent(serverName)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!body.ok) throw new Error(t('toggleFailed'))
    },
    remove: async (serverName: string) => {
      await request<{ ok: boolean }>(`${API}/servers/${encodeURIComponent(serverName)}`, { method: 'DELETE' })
    },
    reconnect: async (serverName: string) => {
      await request<{ ok: boolean }>(`${API}/servers/${encodeURIComponent(serverName)}/reconnect`, { method: 'POST' })
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-manager',
    order: 16,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, McpManagerSection))
}
