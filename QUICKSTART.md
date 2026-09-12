# ClaudeLink 快速开始指南

5 分钟内在局域网实现手机远程操作 Windows 上的 Claude Code。

## 前置条件

- ✅ Windows 10/11（已安装 Claude Code CLI）
- ✅ Node.js v18+
- ✅ Android 手机与电脑在同一局域网

## 步骤 1: 启动 Windows 服务器

```bash
cd windows-host
npm install
node server.js
```

**预期输出**：
```
[Server] WebSocket listening on ws://0.0.0.0:3000
[Server] HTTP server on http://localhost:3000
[PTY] Claude process started
[PTY] ✓ 检测到信任对话框，自动确认...
[PTY] ✓ 已自动确认信任
```

**记录你的 IP 地址**：
```bash
ipconfig
# 找到 "无线局域网适配器 WLAN" 或 "以太网适配器"
# IPv4 地址示例: 192.168.2.189
```

## 步骤 2: 浏览器测试（可选）

在电脑或手机浏览器打开：
```
http://192.168.2.189:3000
```

你会看到一个测试页面，可以直接在浏览器中与 Claude Code 交互。

## 步骤 3: Android 客户端（开发中）

参考 `android-client/README.md` 实现 Kotlin 应用。

### 核心代码片段

```kotlin
val wsClient = WebSocketClient("ws://192.168.2.189:3000", object : Listener {
    override fun onDataReceived(data: String) {
        terminalView.appendData(data)
    }
})
wsClient.connect()
```

## 快速验证

### 测试 1: 检查服务器是否运行
```bash
curl http://localhost:3000
# 应返回 HTML 页面
```

### 测试 2: WebSocket 连接
```bash
node ws-test.js
# 应看到:
# [Test] Connected to server
# [Test] Received: history
# [Test] Received: output
```

### 测试 3: 发送命令
在浏览器测试页面输入：
```
help
```

应该看到 Claude Code 的帮助信息返回。

## 常见问题

### Q: 连接失败 "ECONNREFUSED"
**A**: 检查防火墙是否阻止了 3000 端口。临时禁用防火墙测试，或添加入站规则：
```bash
netsh advfirewall firewall add rule name="ClaudeLink" dir=in action=allow protocol=TCP localport=3000
```

### Q: 手机无法连接
**A**: 
1. 确认手机和电脑在同一 WiFi
2. 使用电脑的实际 IP（不要用 localhost）
3. 检查路由器是否启用了 AP 隔离

### Q: 看不到彩色输出
**A**: Android 端需要实现 AnsiParser 来解析色彩序列（参考 `android-client/README.md`）

### Q: 输入回车后没反应
**A**: 确保发送的是 `\r` 而不是 `\n`：
```kotlin
wsClient.sendInput("help\r")  // ✅ 正确
wsClient.sendInput("help\n")  // ❌ 错误
```

## 下一步

- 📖 阅读 [README.md](README.md) 了解完整功能
- 🏗️ 查看 [ARCHITECTURE.md](ARCHITECTURE.md) 理解系统设计
- 🔧 参考 [windows-host/TECHNICAL_NOTES.md](windows-host/TECHNICAL_NOTES.md) 深入技术细节
- 📱 按照 [android-client/README.md](android-client/README.md) 实现 Android 应用

## 停止服务器

在运行 `node server.js` 的终端按 `Ctrl+C`，或：
```bash
taskkill /F /IM node.exe
```

## 自动启动（可选）

### 使用 start.vbs（无窗口后台运行）
双击 `windows-host/start.vbs`

### 使用 PM2（推荐生产环境）
```bash
npm install -g pm2
cd windows-host
pm2 start server.js --name claudelink
pm2 save
pm2 startup  # Windows 开机自启
```

---

**提示**: 这是一个本地开发工具，**不要**暴露到公网！如需远程访问，请使用 VPN 或配置反向代理 + WSS 加密。
