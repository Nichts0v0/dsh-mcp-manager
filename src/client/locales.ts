/**
 * dsh-mcp-manager — locale dictionaries (zh / en).
 *
 * Registered under the `mcpManager` namespace through ctx.locale, following
 * the same pattern as DSH's own settings UI plugins.
 *
 * @module dsh-mcp-manager/client/locales
 */

export type LocaleKey =
  | 'nav'
  | 'title'
  | 'intro'
  | 'configured'
  | 'loading'
  | 'empty'
  | 'connected'
  | 'connecting'
  | 'error'
  | 'offline'
  | 'disabled'
  | 'disconnected'
  | 'unknown'
  | 'offlineHint'
  | 'reconnect'
  | 'reconnecting'
  | 'edit'
  | 'enabledLabel'
  | 'disabledLabel'
  | 'addServer'
  | 'refresh'
  | 'addTitle'
  | 'editTitle'
  | 'backToList'
  | 'deleteServer'
  | 'confirmDelete'
  | 'deleting'
  | 'deleteHint'
  | 'fieldServerName'
  | 'fieldTransport'
  | 'fieldUrl'
  | 'fieldCommand'
  | 'fieldArgs'
  | 'fieldHeaders'
  | 'fieldTimeout'
  | 'timeoutHint'
  | 'cancel'
  | 'save'
  | 'addAndConnect'
  | 'savingBusy'
  | 'addingBusy'
  | 'processing'
  | 'invalidHeaders'
  | 'timeoutMsg'
  | 'addFailed'
  | 'updateFailed'
  | 'toggleFailed'
  | 'serverNameLocked'
  | 'tokenLabel'
  | 'tokenHint'
  | 'authType'
  | 'authTypeNone'
  | 'authTypeOAuth'
  | 'oauthStatus'
  | 'oauthAuthorized'
  | 'oauthNotAuthorized'
  | 'oauthExpired'
  | 'oauthAuthorizeBtn'
  | 'oauthAuthorizing'
  | 'oauthRevokeBtn'
  | 'oauthClientId'
  | 'oauthClientIdHint'
  | 'oauthScopes'
  | 'oauthScopesHint'
  | 'oauthExpiresAt'
  | 'oauthSuccessMsg'
  | 'oauthFailedMsg'

/** Placeholders in template strings: `{n}`, `{name}` are replaced at render time. */
export const zh: Record<LocaleKey, string> = {
  nav: 'MCP 服务器',
  title: 'MCP 服务器管理',
  intro: '在此管理 MCP 服务器：启用/停用、编辑、删除。配置保存在 $DSH_HOME/mcp-servers.json，对所有会话生效；连接成功后工具以 mcp__<serverName>__<tool> 提供给 agent。',
  configured: '已配置的服务器',
  loading: '加载中…',
  empty: '（还没有配置任何服务器）',
  connected: '已连接 ({n} 工具)',
  connecting: '连接中…',
  error: '连接错误',
  offline: '服务器离线',
  disabled: '已停用',
  disconnected: '未连接',
  unknown: '未知',
  offlineHint: '服务器进程无响应，服务恢复后自动重连',
  reconnect: '重连',
  reconnecting: '重连中…',
  edit: '编辑',
  enabledLabel: '已启用',
  disabledLabel: '已停用',
  addServer: '＋ 添加 MCP 服务器',
  refresh: '刷新状态',
  addTitle: '添加 MCP 服务器',
  editTitle: '编辑服务器 {name}',
  backToList: '← 返回列表',
  deleteServer: '删除服务器',
  confirmDelete: '确认删除？',
  deleting: '删除中…',
  deleteHint: '删除后将永久移除该服务器并立即卸载其工具，此操作不可恢复。3 秒内未点「确认删除？」将自动取消。',
  fieldServerName: 'serverName',
  fieldTransport: '传输方式',
  fieldUrl: 'URL',
  fieldCommand: 'Command',
  fieldArgs: 'Args（空格分隔）',
  fieldHeaders: 'Headers（可选）',
  fieldTimeout: '连接等待超时（秒）',
  timeoutHint: '添加/重连后自动等待连接结果，超时自动刷新状态',
  cancel: '取消',
  save: '保存修改',
  addAndConnect: '添加并连接',
  savingBusy: '保存并重连中…',
  addingBusy: '添加并连接中…',
  processing: '处理中…',
  invalidHeaders: 'headers 必须是合法的 JSON 对象',
  timeoutMsg: '等待连接状态超时（{n} 秒），可点击「刷新状态」查看最新状态。',
  addFailed: '添加服务器失败',
  updateFailed: '更新服务器失败',
  toggleFailed: '切换启用状态失败',
  serverNameLocked: 'serverName 是服务器唯一标识，创建后不可修改',
  tokenLabel: '访问令牌（可选）',
  tokenHint: '若已在 mcp-servers.json 配置 "token"，请在此输入，所有请求会携带 Authorization: Bearer <token>；留空表示未配置令牌。',
  authType: '认证方式',
  authTypeNone: '无 / 静态 Headers',
  authTypeOAuth: 'OAuth 2.0 (MCP 官方规范 / PKCE)',
  oauthStatus: 'OAuth 授权状态',
  oauthAuthorized: '已授权',
  oauthNotAuthorized: '未授权',
  oauthExpired: '令牌已过期',
  oauthAuthorizeBtn: '授权登录 (OAuth)',
  oauthAuthorizing: '正在等待授权…',
  oauthRevokeBtn: '撤销 / 清除授权',
  oauthClientId: 'Client ID（可选）',
  oauthClientIdHint: '若服务端要求固定客户端 ID 请在此填写；留空将尝试 RFC 7591 动态客户端注册',
  oauthScopes: '请求权限 (Scopes，空格分隔)',
  oauthScopesHint: '可选，例如：read write repo',
  oauthExpiresAt: '有效期至: {time}',
  oauthSuccessMsg: 'OAuth 授权成功并已自动连接！',
  oauthFailedMsg: 'OAuth 授权失败: {error}',
}

export const en: Record<LocaleKey, string> = {
  nav: 'MCP Manager',
  title: 'MCP Server Manager',
  intro: 'Manage MCP servers: enable/disable, edit, delete. Config lives in $DSH_HOME/mcp-servers.json and is shared by all sessions; on connect, tools are exposed to agents as mcp__<serverName>__<tool>.',
  configured: 'Configured Servers',
  loading: 'Loading…',
  empty: '(No servers configured yet)',
  connected: 'Connected ({n} tools)',
  connecting: 'Connecting…',
  error: 'Connection error',
  offline: 'Server offline',
  disabled: 'Disabled',
  disconnected: 'Not connected',
  unknown: 'Unknown',
  offlineHint: 'Server process unreachable; reconnects automatically when it recovers',
  reconnect: 'Reconnect',
  reconnecting: 'Reconnecting…',
  edit: 'Edit',
  enabledLabel: 'Enabled',
  disabledLabel: 'Disabled',
  addServer: '＋ Add MCP Server',
  refresh: 'Refresh',
  addTitle: 'Add MCP Server',
  editTitle: 'Edit Server {name}',
  backToList: '← Back to list',
  deleteServer: 'Delete Server',
  confirmDelete: 'Confirm delete?',
  deleting: 'Deleting…',
  deleteHint: 'This permanently removes the server and immediately unloads its tools. Confirm within 3 seconds or the action is cancelled.',
  fieldServerName: 'serverName',
  fieldTransport: 'Transport',
  fieldUrl: 'URL',
  fieldCommand: 'Command',
  fieldArgs: 'Args (space-separated)',
  fieldHeaders: 'Headers (optional)',
  fieldTimeout: 'Connection wait (s)',
  timeoutHint: 'Waits for the connection result after add/reconnect; refreshes automatically on timeout',
  cancel: 'Cancel',
  save: 'Save Changes',
  addAndConnect: 'Add & Connect',
  savingBusy: 'Saving & reconnecting…',
  addingBusy: 'Adding & connecting…',
  processing: 'Working…',
  invalidHeaders: 'headers must be a valid JSON object',
  timeoutMsg: 'Timed out waiting for connection state ({n}s). Click "Refresh" for the latest status.',
  addFailed: 'Failed to add server',
  updateFailed: 'Failed to update server',
  toggleFailed: 'Failed to toggle enabled state',
  serverNameLocked: 'serverName is the server identity and cannot be changed after creation',
  tokenLabel: 'Access token (optional)',
  tokenHint: 'If "token" is set in mcp-servers.json, enter it here — every request then carries Authorization: Bearer <token>. Leave empty when no token is configured.',
  authType: 'Authentication',
  authTypeNone: 'None / Static Headers',
  authTypeOAuth: 'OAuth 2.0 (MCP Spec / PKCE)',
  oauthStatus: 'OAuth Status',
  oauthAuthorized: 'Authorized',
  oauthNotAuthorized: 'Not Authorized',
  oauthExpired: 'Token Expired',
  oauthAuthorizeBtn: 'Authorize (OAuth)',
  oauthAuthorizing: 'Waiting for authorization…',
  oauthRevokeBtn: 'Revoke / Clear Auth',
  oauthClientId: 'Client ID (optional)',
  oauthClientIdHint: 'Fill in if the server requires a fixed Client ID; leave empty for RFC 7591 dynamic registration',
  oauthScopes: 'Scopes (space-separated)',
  oauthScopesHint: 'Optional, e.g. read write repo',
  oauthExpiresAt: 'Expires: {time}',
  oauthSuccessMsg: 'OAuth authorization successful! Server connected.',
  oauthFailedMsg: 'OAuth authorization failed: {error}',
}

/** Render a template string, replacing `{name}` / `{n}` placeholders. */
export function fmt(template: string, params: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(params)) {
    out = out.replaceAll(`{${key}}`, String(value))
  }
  return out
}
