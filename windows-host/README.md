# ClaudeLink

**远程 Claude Code 终端控制系统**

ClaudeLink 允许你通过 Web 界面或 Android 客户端远程连接和控制本地的 Claude Code 会话，支持实时终端交互、会话监控和任务追踪。

---

## ✨ 核心功能

### 1. 远程终端控制
- ✅ WebSocket 实时双向通信（带心跳保活，30s 无响应自动断开）
- ✅ 完整的 xterm.js 终端体验（ANSI 颜色、滚动、自适应尺寸）
- ✅ 多客户端同时连接、共享终端实例
- ✅ **断线自动重连**（指数退避，最多 15s 间隔）

### 2. 安全访问（🔐 可选令牌认证）
- ✅ 默认免认证，开箱即用
- ✅ 设置环境变量 `ACCESS_TOKEN` 后，WebSocket 与 HTTP API 均要求令牌
- ✅ 启用后可用 `http://localhost:3000/?token=<令牌>` 免输入登录（自动保存到 localStorage）
- ✅ 令牌校验使用恒定时间比较（防时序攻击）

### 3. Claude Code 会话监控
- ✅ 自动检测本地运行中的**全部** Claude Code 会话
- ✅ 实时显示每个会话的状态（运行中/空闲）、项目、PID、工作目录
- ✅ 会话列表按最近活动排序，主会话带摘要 + 最近命令
- ✅ 每 2.5 秒自动刷新，状态变化才广播

### 4. 会话详情面板
- ✅ **多会话列表**：侧栏可看到所有存活会话，点击任意一个查看详情
- ✅ **概览 Tab**：会话摘要（任务、修改的文件、使用的工具）+ 最近 Bash 命令
- ✅ **输入历史 Tab**：该会话的用户命令历史（带时间戳）
- ✅ **终端输出 Tab**：嵌入式迷你终端，**实时同步**主终端输出

### 5. 任务追踪看板
- ✅ 自动识别用户输入并创建任务
- ✅ 实时显示任务执行状态和耗时
- ✅ 2.5 秒输出静默自动标记任务完成
- ✅ 历史任务记录（最多 20 条）

### 6. 内网穿透（Ngrok）
- ✅ 一键启动 ngrok 隧道（配置 `ENABLE_TUNNEL=true`）
- ✅ 状态栏实时显示公网地址，点击直接以公网地址打开
- ✅ **公网二维码**：扫码即可在手机上连接
- ✅ 支持自定义配置（区域、authtoken）

### 7. 移动端优化
- ✅ 响应式布局（`@media (max-width: 900px)`）
- ✅ 侧边看板滑出式抽屉
- ✅ **底部命令栏**：专门为移动端设计的输入条（IME 安全，不触发任务看板）
- ✅ 触控优化的按钮尺寸（最小 38px）

---

## 🚀 快速开始

### 安装依赖
```bash
npm install
```

### 配置
```bash
copy .env.example .env
```
按需填写 `.env`（端口、Claude 路径、ngrok 令牌等；默认无需访问令牌）。

### 启动服务器
```bash
node server.js
```

服务器会自动：
1. 启动 HTTP + WebSocket 服务（默认端口 3000）
2. 检测本地 Claude Code 会话
3. 初始化 ngrok 公网隧道（如果 `ENABLE_TUNNEL=true`）

### 访问方式

#### 本机浏览器
- 直接打开 http://localhost:3000 即可使用（默认免认证）
- 若设置了 `ACCESS_TOKEN`，点击状态栏 🔑 按钮粘贴令牌（启动日志只打印令牌指纹，不打印明文）

#### 手机（公网/局域网）
- 服务器启动后点状态栏公网地址，或扫描侧栏的**二维码**
- 默认免认证；若设置了 `ACCESS_TOKEN` 则打开后输入访问令牌

---

## 🔌 HTTP API

默认免认证。若设置了 `ACCESS_TOKEN`，则 API 需令牌：请求头 `Authorization: Bearer <token>` 或查询参数 `?token=<token>`。

| 端点 | 说明 |
| --- | --- |
| `GET /api/status` | 服务器状态：运行时间、客户端数、PTY 状态、Claude 会话状态、隧道信息 |

WebSocket 连接：`ws://host:port/`（免认证时）或 `ws://host:port/?token=<token>`（启用认证时，未提供或错误的令牌会以 `4401` 关闭码拒绝）。

---

## 🔧 配置（`.env`）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket 端口 |
| `CLAUDE_CMD` | 用户目录下 claude.exe | Claude Code 可执行文件路径 |
| `ACCESS_TOKEN` | 空（免认证） | 可选访问令牌（设置后启用认证） |
| `ENABLE_TUNNEL` | `false` | 是否启用 ngrok 公网隧道 |
| `NGROK_REGION` | `us` | ngrok 区域（us/ap/eu/au/sa/jp/in） |
| `NGROK_AUTHTOKEN` | — | ngrok 认证令牌 |

---

## 📂 项目结构

```
windows-host/
├── server.js              # 主服务器（WebSocket + HTTP + ngrok）
├── session-detector.js    # Claude 会话检测器
├── lib/
│   ├── auth.js            # 可选令牌认证（默认免认证）
│   └── http-handler.js    # HTTP 静态服务 + API（含路径穿越防护）
├── public/
│   ├── index.html         # Web 客户端
│   └── tunnel-test.html   # 隧道连通性测试页
├── server.test.js         # WebSocket 服务器测试
├── pty.test.js            # PTY 测试
├── ui.test.js             # HTTP 服务集成测试（认证/路径穿越/API）
├── session-detector.test.js
├── lib/*.test.js          # 模块单元测试
├── package.json
├── .env.example           # 环境配置示例
└── README.md
```

---

## 🛠️ 技术栈

### 后端
- **Node.js** + **ws**（WebSocket 服务器）
- **node-pty**（伪终端支持）
- **ngrok**（内网穿透）
- **dotenv**（环境变量管理）

### Web 前端
- **xterm.js 5.5.0**（终端模拟器，CDN 引入）
- **qrcode-generator**（公网地址二维码，CDN 引入）
- **原生 JavaScript**（无框架依赖）
- **CSS Grid + Flexbox**（响应式布局）

---

## 📊 会话监控原理

### 数据来源
1. **`~/.claude/sessions/*.json`** — 会话元数据（PID、状态、工作目录、项目名）
2. **`~/.claude/history.jsonl`** — 用户输入历史（带时间戳和 sessionId）
3. **`~/.claude/session-data/*.tmp`** — 会话摘要（任务、修改的文件、使用的工具）
4. **`~/.claude/bash-commands.log`** — 执行的 Bash 命令记录
5. **`~/.claude/projects/<slug>/<sessionId>.jsonl`** — 会话 transcript。本机 `~/.claude/sessions/` 常为空（会话结束就被清掉），历史会话靠它兜底列出：只读文件头部 64 KB 取 `cwd` 字段，按修改时间倒序取最近 10 个、30 秒缓存。`projects/` 子目录名是把 cwd 里所有非 `[A-Za-z0-9]` 字符换成 `-` 得到的**有损**编码（`E:\git\qq-chat-exporter\docker` → `E--git-qq-chat-exporter-docker`），反解不出来，所以 cwd 一律从 transcript 内容里读

### 检测机制
- `session-detector.js` 每 2.5 秒轮询上述文件
- 通过 `stateHash` 去重，只在状态变化时广播
- WebSocket 消息类型：`claude_status`（含全部存活会话）、`restart`（重启/切会话后带 `target`）、`error`
- 会话条目带 `live`（进程还在不在）与 `source`（`registry` = 注册表活进程 / `transcript` = 历史文件）

### 接上哪个会话（活跃会话切换）
打开网页不该看到家目录里的新会话，而应该是你上次在用的那个。服务端启动时按三层优先级选一次：

1. **记忆** — `~/.claudelink/session-target.json`（可用 `SESSION_TARGET_FILE` 覆盖，测试用）里记着上次选中的 `{cwd, sessionId}`；里面 `sessionId: null` 表示「上次明确选了新会话」，同样兑现
2. **最近活跃** — 注册表里还活着的进程优先，其次是最新写入的 transcript
3. **新建** — 一个都没有时，等第一个客户端连上来在家目录开新会话

- 目标进程还在跑（`live`）时切换会加 `--fork-session`：新进程从这个会话接着聊，但写新的 session id，原进程不受影响
- 目标目录已经不存在（transcript 还在）时不会假装接上：日志打 `[Session] 目录不可用，跳过自动接上`，也**不写进记忆**，等客户端连上来开新会话
- 客户端发 `{type:'switch', sessionId}`（`null` = 新会话），服务端成功后广播 `{type:'restart', clearScreen:true, target}`；目标已不在列表里则回 `{type:'error'}`，且不改动当前目标。`history` 消息与 `/api/status` 都带 `currentSession`
- 网页端：会话卡片高亮「当前」，卡片上是「切到这个会话」按钮（当前那个显示「已接上」），面板里有「新建会话」。目标进程还活着时第一次切换会 `confirm` 提醒一次
- 切换 = 杀掉当前 PTY 重开（不做多 PTY 池）：**当前会话里正在跑的东西会中断**

---

## ⚠️ 注意事项

### 安全性
- ⚠️ 默认免认证：未设置 `ACCESS_TOKEN` 时，任何拿到地址（尤其公网 ngrok 地址）的人都能完全控制终端
- 多人或公网使用请务必设置 `ACCESS_TOKEN` 启用认证；令牌只保存在环境变量，不落盘，日志只打印 SHA-256 指纹
- 手机端（Android）走 `Authorization: Bearer` 头，令牌不进 URL；**浏览器无法给 WebSocket 握手加自定义头**，所以网页端仍用 `?token=`，这条已知风险是：令牌会出现在 ngrok 请求检查器、浏览器历史与地址栏截图里 —— 网页端只在 https 下用，且本机访问时优先点 🔑 输入
- ngrok 公网地址会出现在服务器日志与状态栏中，注意屏幕共享时避免泄露
- HTTP 静态服务已做路径穿越防护，仅能访问 `public/` 目录

### 性能
- 多客户端连接共享相同终端实例
- 每 2.5 秒轮询会话状态，CPU 占用可忽略

### 兼容性
- 需要 Node.js 16+
- Web 端需要支持 WebSocket 的现代浏览器

---

## 🚧 待开发功能

- [ ] 会话历史记录持久化
- [ ] 更丰富的任务统计图表
- [ ] iOS 客户端支持

---

## 📝 相关文档

- [Ngrok 配置指南](TUNNEL_GUIDE.md)
- [会话面板演示](SESSION_PANEL_DEMO.md)
- [技术实现笔记](TECHNICAL_NOTES.md)

---

## 📄 许可证

MIT

---

**开发者**：benqianmou  
**项目仓库**：https://github.com/benqianmou/claudelink
