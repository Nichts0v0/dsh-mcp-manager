# dsh-mcp-manager

[English](README.md) | [中文](README.zh.md)

在 DeepSeek Harness 的 **Web 设置页**里直接管理 **MCP 服务器**——运行时添加、编辑、启用/停用、重连、删除，带实时状态、自动重连和配置文件热同步。

## 功能简介

- **Web 设置页 UI** — 独立的"MCP 服务器管理"页面：服务器卡片（实时状态）、添加/编辑表单、两步确认的删除保护。
- **运行时连接** — 服务器即时连接/断开；工具以 `mcp__<serverName>__<tool>` 全局注册，所有会话的 agent 都能调用。
- **实时状态** — 可达性探测让关闭的服务器显示 **离线** 而不是陈旧的"已连接"；卡住的连接 30 秒后判为超时。
- **自动重连** — 初始连接失败按指数退避重试（3s → 60s）；点"刷新"立即重试一次。
- **启用/停用** — 一键停用立即断开并卸载工具；重新启用即自动重连。
- **配置热同步** — `$DSH_HOME/mcp-servers.json` 被实时监听，外部修改约 1 秒内生效，无需重启。
- **主题与多语言** — 自动跟随 DSH 浅色/深色主题（含外观插件对 `--dsw-alias-*` token 的覆盖）；UI 内置**简体中文 / English**。

## 截图

![MCP 服务器管理设置页](docs/s_zh.webp)

## 安装

### 如果你是人类

1. 获取代码并构建：`git clone <仓库> && cd dsh-mcp-manager && npm install`（`prepare` 脚本会自动构建 `lib/`；使用带预构建 `lib/` 的发布包可跳过）。
2. 让 loader 能从 profile 解析该包（二选一）：
   - 把整个 `dsh-mcp-manager/` 目录复制或软链接到 `$DSH_HOME/profiles/web/node_modules/`；或
   - `dsh plugin --profile web add <仓库路径>`。
3. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: mcp-manager
         name: dsh-mcp-manager
   ```

4. **重启 `dsh web`**，并强制刷新浏览器页面（`Ctrl+Shift+R`）以加载新的 `__DSH_BOOT__`。
5. 打开 **设置 → MCP 服务器**，添加你的第一个服务器。

> 注：Web 面的 `cordis.patch.yml` 热重载未启用（DSH 共享 HMR 行是关的），改配置后需重启。

### 如果你是一个 AI agent

请按顺序执行，不要跳步：

1. **通读本 README**（尤其是"功能简介"、"已知限制"和本节）。
2. **按需构建**：在 `dsh-mcp-manager/` 下运行 `npm install --ignore-scripts && npm run build`（产出自包含的 `lib/index.js` + `lib/client.js`；插件运行时零依赖）。
3. **链接到 profile**：在 `$DSH_HOME/profiles/<profile>/node_modules/dsh-mcp-manager` 创建指向本仓库的目录 junction（Windows）或符号链接（POSIX），让 loader 能解析该包名。（也可用 `dsh plugin --profile <profile> add <路径>`。）
4. **挂载插件行**：在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: mcp-manager
         name: dsh-mcp-manager
   ```

5. **重启 `dsh web`**（Web 面配置热重载未启用），并提示用户**强制刷新浏览器**以看到设置页新入口。
6. **验证**：`GET http://127.0.0.1:3080/mcp-manager/api/health` 应返回 `{"ok":true,"name":"mcp-manager","version":"<x.y.z>",...}`。

## 使用简介

打开 **设置 → MCP 服务器**：

- **服务器卡片**：显示名称、传输方式、状态徽章和端点；停用的卡片变灰。
- **启用/停用开关**：停用立即断开并卸载该服务器的工具。
- **重连**：自动等待连接结果并刷新（等待时间可配置，默认 15 秒）。
- **编辑**：可改传输方式 / URL / 命令 / Headers（`serverName` 不可修改）；保存后原地热更新连接。
- **删除**：位于编辑页顶部，两步确认（3 秒窗口）。
- **添加**：`streamable-http`（URL + 可选 Headers）或 `stdio`（命令 + 参数），可设连接等待超时。

### 状态说明

| 状态 | 含义 |
|---|---|
| 已连接 (n 工具) | 工具已注册 |
| 连接中 | 正在握手 / 重连 |
| 服务器离线 | 曾连接成功，但服务器进程当前不可达（探测结果） |
| 连接错误 | 初始连接失败（显示原因）或 30 秒连接超时 |
| 已停用 | 已关闭——不连接、无工具 |

### 配置文件

`$DSH_HOME/mcp-servers.json` —— 所有 profile/会话共享：

```json
{
  "version": 1,
  "servers": [
    { "serverName": "my-server", "transport": "streamable-http", "url": "http://127.0.0.1:8080/mcp", "enabled": true }
  ]
}
```

文件被**实时监听**：手工修改（增/删/改/启停）约 1 秒内生效；`POST /mcp-manager/api/reload` 可随时手动触发。

### HTTP API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/mcp-manager/api/health` | 存活 + 版本 + 存储路径 |
| GET | `/mcp-manager/api/servers` | 服务器列表（含探测后的实时状态） |
| GET | `/mcp-manager/api/servers/<name>` | 单个服务器 |
| POST | `/mcp-manager/api/servers` | 添加并连接 |
| POST | `/mcp-manager/api/servers/<name>/update` | 更新配置并热重连（`serverName` 不可改） |
| POST | `/mcp-manager/api/servers/<name>/toggle` | 启用/停用（`{"enabled": true|false}`） |
| POST | `/mcp-manager/api/servers/<name>/reconnect` | 断开后重连 |
| DELETE | `/mcp-manager/api/servers/<name>` | 断开并删除 |
| POST | `/mcp-manager/api/reload` | 从磁盘重新读取配置文件 |

## 开发

```sh
npm install      # 仅构建期依赖；prepare 自动构建
npm run build    # esbuild：lib/index.js（host，全内联）+ lib/client.js（浏览器）
npm run watch    # 监听 client bundle（配合 dsh-client-hmr）
```

运行时零依赖：host 半内联了 `@deepseek-ai/dsh-mcp-client`、MCP SDK 和 `cross-spawn`；浏览器半是 DSH 客户端模块系统托管的闭包工厂 bundle。

## 已知限制

- **初始失败是退避重试而非即时** — `failOnStartupError` 开启，首次连接失败显示 `error` 并最多每 60 秒重试一次；连接成功后由 mcp-client 自带重连处理断线。
- **可达性探测是 HTTP 层** — 对 `streamable-http` 服务器发 GET（2.5 秒超时，任何 HTTP 响应都算可达）；`stdio` 服务器不探测。
- **仅桥接 tools** — MCP Resources/Prompts 未桥接（与官方 mcp-client 一致）。
- **`/mcp-manager/*` 无认证** — 默认仅 loopback；谨慎对外暴露 `--host 0.0.0.0`（stdio 服务器可执行任意命令）。
- **部分 MCP 服务器只允许一个活动客户端**（如 Godot MCP）——第一连接未释放时，第二连接会被拒绝并报错。

## 许可证

MIT
