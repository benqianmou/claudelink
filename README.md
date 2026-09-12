# ClaudeLink - Windows ↔ Android Claude Code 远程控制

局域网环境下通过 Android 手机远程操作、查看和管理 Windows 电脑上的 Claude Code CLI。

## 系统架构

```
┌─────────────────────┐
│   Windows 宿主端     │
│                     │
│  ┌──────────────┐   │         WebSocket (ws://IP:3000)
│  │ Claude CLI   │   │                │
│  └──────┬───────┘   │                │
│         │ PTY流     │                ▼
│  ┌──────▼───────┐   │    ┌────────────────────┐
│  │  node-pty    │◄──┼────┤ Android WebSocket  │
│  └──────┬───────┘   │    │      Client        │
│         │ ANSI原始  │    └─────────┬──────────┘
│  ┌──────▼───────┐   │              │ ANSI解析
│  │ WebSocket    │───┼──────────────┤
│  │   Server     │   │              ▼
│  └──────────────┘   │    ┌────────────────────┐
└─────────────────────┘    │  终端渲染 TextView │
                           └────────────────────┘
                                    │ 键盘输入
                                    └───────────┘
```

## 已实现功能

### Windows 宿主端 ✅
- ✅ 使用 `node-pty` 派生 Claude Code 进程
- ✅ 捕获完整的 ANSI 转义序列和色彩输出
- ✅ WebSocket 双向流式推送 (端口 3000)
- ✅ **自动处理工作区信任对话框**（关键功能）
- ✅ 多客户端支持（广播模式）
- ✅ 历史输出缓冲（新客户端可查看历史）
- ✅ 会话状态管理和错误处理

### 核心技术点

#### 1. PTY vs 普通 spawn
**必须使用 node-pty**，普通 `child_process.spawn` 无法捕获 ANSI 色彩和终端控制序列。

```javascript
const pty = require('node-pty');
const ptyProcess = pty.spawn('powershell.exe', ['-NoLogo'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  useConpty: true  // Windows 必需
});
```

#### 2. 自动处理信任对话框（硬核重点）
Claude Code 启动时会弹出工作区信任确认对话框，原始 PTY 输出包含大量 ANSI 转义序列：

```
[?25l[2J[m[H]0;C:\Users\Lenovo\.local\bin\claude.exe[?25h
[?25l[?2004h[?2031h[?1004h[>0q
[3;2HAccessing[1Cworkspace:[m[5;2HC:\Users\Lenovo
[7;2HQuick[1Csafety[1Ccheck:[1CIs[1Cthis[1Ca[1Cproject[1Cyou[1Ccreated...
[15;2H❯[1CNo,[1Cexit[m
[16;4HYes,[1CI[1Ctrust[1Cthis[1Cfolder
```

**解决方案**：
1. 累积 PTY 输出到缓冲区
2. 将 `[1C` (光标右移) 替换为空格，避免文本连续
3. 清理其他 ANSI 序列后检测关键词 `"Yes, I trust this folder"`
4. 自动发送 `\x1B[B` (向下箭头) + `\r` (回车) 确认信任

```javascript
const cleanText = buffer
  .replace(/\x1B\[(\d+)C/g, (m, n) => ' '.repeat(parseInt(n) || 1))  // 光标右移 → 空格
  .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')  // 清理 CSI 序列
  .replace(/\s+/g, ' ');                    // 压缩空白

if (cleanText.includes('Yes, I trust this folder')) {
  pty.write('\x1B[B');  // 选择 "Yes"
  setTimeout(() => pty.write('\r'), 150);  // 确认
}
```

#### 3. 键盘输入映射
- **回车键**: 发送 `\r` (Carriage Return)，而非 `\n`
- **退格键**: 发送 `\u007F` (DEL)，而非 `\u0008` (BS)
- **Ctrl-C**: 发送 `\u0003` (ETX)

#### 4. ANSI 跨包分割处理
PTY 输出可能在任意位置截断，需要缓冲不完整的 ANSI 序列：
```javascript
let ansiBuffer = '';
ptyProcess.onData(data => {
  ansiBuffer += data;
  // 检测完整的 CSI 序列后再发送
  const completeSequences = ansiBuffer.match(/\x1B\[[0-9;]*[a-zA-Z]/g);
  // ...
});
```

## 快速启动

### Windows 端
```bash
cd windows-host
npm install
node server.js

# 输出：
# [Server] WebSocket listening on ws://0.0.0.0:3000
# [PTY] Claude process started
# [PTY] ✓ 检测到信任对话框，自动确认...
# [PTY] ✓ 已自动确认信任
```

### Android 端（待实现）
```bash
cd android-client
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

在应用中输入 Windows 局域网 IP，连接 `ws://192.168.x.x:3000`。

## 测试验证

```bash
# 1. 启动服务器
node server.js

# 2. 在另一个终端测试连接
node ws-test.js

# 预期输出：
# [Test] Connected to server
# [Test] Received: history
# [Test] Received: output
# --- PTY Output ---
# Claude Code 主界面...
```

## 风险与避坑

| 风险 | 严重性 | 状态 |
|------|--------|------|
| ANSI 转义序列跨包分割 | **高** | ✅ 已解决（缓冲机制） |
| 信任对话框阻塞启动 | **高** | ✅ 已解决（自动检测+确认） |
| 局域网 IP 变化 | 中 | ⚠️ 待实现 mDNS 自动发现 |
| 大量输出导致 UI 卡顿 | 中 | ⚠️ 待实现 Android 端行数限制 |
| 控制字符未正确映射 | 中 | ⏳ 部分实现（基础键位） |

## 项目结构

```
claudelink/
├── windows-host/
│   ├── package.json
│   ├── server.js          # PTY + WebSocket Server (核心)
│   ├── ws-test.js         # 测试客户端
│   └── .env               # CLAUDE_PATH 配置
├── android-client/        # 待实现
│   └── (Android 原生项目)
└── README.md
```

## 依赖版本

- Node.js: v24.20.0 (或更高)
- node-pty: ^1.1.0
- ws: ^8.18.0
- Android: Kotlin + OkHttp 4.12.0 (待实现)

## 下一步工作

### Android 客户端（优先级：高）
- [ ] WebSocket 客户端封装
- [ ] ANSI 解析器（支持 8 色 → 256 色 → TrueColor）
- [ ] 自定义 TerminalView 渲染
- [ ] 软键盘输入映射
- [ ] 光标控制序列支持 (`[2J` 清屏, `[H` 归位等)

### 增强功能（优先级：中）
- [ ] mDNS 服务发现（自动查找局域网内的 Windows 宿主）
- [ ] TLS/WSS 加密通信
- [ ] 文件上传/下载支持
- [ ] 会话快照和恢复

### 优化（优先级：低）
- [ ] 性能分析（大量输出场景）
- [ ] Android 端虚拟键盘优化
- [ ] 横屏布局适配

## License

MIT

## 作者

Built with Claude Code (Opus 5) + ECC
