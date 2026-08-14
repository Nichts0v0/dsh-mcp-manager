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
}

/** Render a template string, replacing `{name}` / `{n}` placeholders. */
export function fmt(template: string, params: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(params)) {
    out = out.replaceAll(`{${key}}`, String(value))
  }
  return out
}
