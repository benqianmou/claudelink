# ClaudeLink

**远程 Claude Code 终端控制系统**

ClaudeLink 允许你通过 Web 界面或 Android 客户端远程连接和控制本地的 Claude Code 会话，支持实时终端交互、会话监控和任务追踪。

---

## ✨ 核心功能

### 1. 远程终端控制
- ✅ WebSocket 实时双向通信
- ✅ 完整的 xterm.js 终端体验
- ✅ ANSI 颜色和格式支持
- ✅ 多客户端同时连接

### 2. Claude Code 会话监控
- ✅ 自动检测本地运行的 Claude Code 会话
- ✅ 实时显示会话状态（运行中/空闲）
- ✅ 项目信息、PID、工作目录监控
- ✅ 每 2.5 秒自动刷新状态

### 3. 会话详情面板（新功能）
- ✅ **混合视图设计**：
  - 顶部显示会话元数据卡片
  - 中部显示任务执行列表（运行中 + 历史）
  - 底部三个 Tab 切换视图
- ✅ **概览 Tab**：会话摘要、修改的文件、使用的工具
- ✅ **输入历史 Tab**：用户命令历史（带时间戳）
- ✅ **终端输出 Tab**：嵌入式迷你终端，实时同步

### 4. 任务追踪看板
- ✅ 自动识别用户输入并创建任务
- ✅ 实时显示任务执行状态和耗时
- ✅ 2.5 秒输出静默自动标记任务完成
- ✅ 历史任务记录（最多 20 条）

### 5. 内网穿透（Ngrok）
- ✅ 一键启动 ngrok 隧道
- ✅ 自动生成公网访问地址
- ✅ 支持自定义配置（区域、authtoken）

### 6. 跨平台支持
- ✅ **Web 端**：现代浏览器（桌面 + 移动）
- ✅ **Android 端**：原生应用（Kotlin + Jetpack Compose）
- ✅ **响应式设计**：自适应桌面和移动端布局

---

## 🚀 快速开始

### 安装依赖
```bash
npm install
```

### 启动服务器
```bash
node server.js
```

服务器会自动：
1. 启动 WebSocket 服务（端口 3000）
2. 检测本地 Claude Code 会话
3. 初始化 ngrok 内网穿透（如果配置了 authtoken）

### 访问方式

#### 本地访问
- Web: http://localhost:3000
- WebSocket: ws://localhost:3000

#### 公网访问（通过 ngrok）
服务器启动后会显示类似：
```
[Tunnel] HTTP: https://xxxx.ngrok-free.app
[Tunnel] WebSocket: wss://xxxx.ngrok-free.app
```

---

## 📱 移动端支持

### Web 端移动适配
✅ **完全支持移动端浏览器**：
- 响应式布局（`@media (max-width: 900px)`）
- 侧边看板滑出式抽屉（从左侧滑入）
- 会话详情面板自适应宽度（`min(600px, 90vw)`）
- 触控优化的按钮尺寸（最小 38px）
- 背景遮罩层支持点击关闭

### 移动端操作流程
1. 打开 ngrok 公网地址（或本地 http://localhost:3000）
2. 点击左上角"☰"按钮打开侧边看板
3. 查看 Claude Code 会话状态
4. 点击会话卡片打开详情面板
5. 切换 Tab 查看不同内容

### Android 原生客户端
位于 `../android-client/` 目录：
```bash
cd ../android-client
./gradlew assembleDebug
# 或使用便捷脚本
./build-apk.bat
```

---

## 🎨 界面特性

### 深色主题设计
- 5 层表面深度（#05070C → #1E2636）
- 蓝色高亮色调（#38BDF8）
- 圆角卡片设计（12px 半径）
- 流畅的动画过渡

### 会话详情面板结构
```
┌──────────────────────────────────┐
│ Claude Code 会话详情      [×]    │
├──────────────────────────────────┤
│ 🟢 windows-host-18               │
│    运行中 · PID: 10112           │
│    E:\projects\claudelink\...    │
├──────────────────────────────────┤
│ 运行中 (2)                       │
│  [◌] npm install · 15s           │
│  [◌] git commit · 3s             │
│                                  │
│ 历史 (5)                         │
│  [✓] npm test · 8s               │
│  [✓] git status · 1s             │
├──────────────────────────────────┤
│ [概览] [输入历史] [终端输出]     │ ← Tab 切换
└──────────────────────────────────┘
```

---

## 🔧 配置

### 环境变量（`.env`）
```env
PORT=3000
NGROK_AUTHTOKEN=your_authtoken_here
NGROK_REGION=au
```

### Ngrok 配置
首次使用需要设置 authtoken：
```bash
npx ngrok config add-authtoken YOUR_TOKEN
```

获取 authtoken：https://dashboard.ngrok.com/get-started/your-authtoken

---

## 📂 项目结构

```
windows-host/
├── server.js              # 主服务器（WebSocket + HTTP）
├── session-detector.js    # Claude 会话检测器
├── public/
│   ├── index.html        # Web 客户端（含会话详情面板）
│   └── tunnel-test.html  # Ngrok 测试页面
├── package.json
├── .env                  # 环境配置
└── README.md

../android-client/
├── app/                  # Android 应用代码
├── build.gradle.kts
└── build-apk.bat         # APK 构建脚本
```

---

## 🛠️ 技术栈

### 后端
- **Node.js** + **ws**（WebSocket 服务器）
- **node-pty**（伪终端支持）
- **ngrok**（内网穿透）
- **dotenv**（环境变量管理）

### Web 前端
- **xterm.js** 5.5.0（终端模拟器）
- **原生 JavaScript**（无框架依赖）
- **CSS Grid + Flexbox**（响应式布局）

### Android 客户端
- **Kotlin** + **Jetpack Compose**
- **OkHttp WebSocket**
- **Material Design 3**

---

## 📊 会话监控原理

### 数据来源
1. **`~/.claude/sessions/*.json`**  
   - 会话元数据（PID、状态、工作目录、项目名）
   
2. **`~/.claude/history.jsonl`**  
   - 用户输入命令历史（带时间戳和 sessionId）
   
3. **`~/.claude/session-data/*.tmp`**  
   - 会话摘要（任务、修改的文件、使用的工具）
   
4. **`~/.claude/bash-commands.log`**  
   - 执行的 Bash 命令记录

### 检测机制
- `session-detector.js` 每 2.5 秒轮询上述文件
- 通过 `stateHash` 去重，只在状态变化时广播
- WebSocket 消息类型：`claude_status`

---

## 🎯 使用场景

1. **远程开发监控**  
   手机上查看 Claude Code 正在执行什么任务
   
2. **多设备协作**  
   在平板上查看会话状态，在电脑上继续操作
   
3. **外出时的快速查看**  
   通过 ngrok 公网地址随时检查开发进度
   
4. **调试和演示**  
   实时展示 Claude Code 的工作流程

---

## ⚠️ 注意事项

### 安全性
- 默认无身份验证，仅适合个人使用
- 使用 ngrok 时会暴露公网访问入口
- 建议在 `.env` 中添加访问密码验证（待实现）

### 性能
- 多客户端连接共享相同终端实例
- 每 2.5 秒轮询会话状态，CPU 占用可忽略
- 移动端建议使用 Wi-Fi 连接以获得最佳体验

### 兼容性
- 需要 Node.js 16+
- Web 端需要支持 WebSocket 的现代浏览器
- Android 端需要 Android 8.0+

---

## 🚧 待开发功能

- [ ] 用户身份验证
- [ ] 多会话切换支持
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
