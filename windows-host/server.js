require('dotenv').config();
const pty = require('node-pty');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const ngrok = require('ngrok');
const ClaudeSessionDetector = require('./session-detector');
const { createAuth, isAuthorized, tokenFingerprint } = require('./lib/auth');
const { createHttpHandler } = require('./lib/http-handler');
const { buildPtyEnv } = require('./lib/pty-env');
const { pickTarget, resolveSwitch, readTarget, writeTarget } = require('./lib/session-target');

const PORT = process.env.PORT || 3000;
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'C:\\Users\\Lenovo\\.local\\bin\\claude.exe';
const MAX_BUFFER_CHUNKS = 1000;
const VERSION = require('./package.json').version;
const HEARTBEAT_INTERVAL = 30000;   // 心跳间隔（一次未 pong 将在下个周期被终止）

// PTY 数据是流式的，逐块 toString('utf8') 会把跨块的多字节字符切成两个 U+FFFD（中文输出必现），
// 交给流式解码器自己留住半截字节
const utf8Decoder = new TextDecoder('utf-8');

let tunnelUrl = null;
let shuttingDown = false;

// 访问令牌认证：默认免认证，设置 ACCESS_TOKEN 后启用（详见 lib/auth.js）
const auth = createAuth();

// Session 管理器
class SessionManager {
  constructor() {
    this.pty = null;
    this.outputBuffer = [];
    this.clients = new Set();
    this.trustDialogBuffer = '';
    this.trustDialogHandled = false;
    // 当前 PTY 接的是哪个会话：{ cwd, sessionId, fork }，sessionId=null 表示新会话
    this.target = { cwd: null, sessionId: null, fork: false };
  }

  /**
   * 起 PTY。target = { cwd, sessionId, fork }：cwd 决定 claude 认哪个 project（没有 --cwd 参数，
   * 只能在启动目录上做文章）；sessionId 有值就 --resume，null = 新会话；
   * fork=true 时加 --fork-session，免得和还活着的那个进程抢同一份 transcript。
   * 不传就用当前 target（重启场景）。
   * @returns {boolean} 是否真把 PTY 起起来了（目录不存在等会是 false）
   */
  start(target = this.target) {
    if (this.pty) return false;

    utf8Decoder.decode();   // 新 PTY：冲掉上一轮可能残留的半截多字节字符

    const wanted = target || {};
    const workDir = wanted.cwd || process.env.USERPROFILE || process.env.HOME;
    const args = wanted.sessionId
      ? ['--resume', wanted.sessionId].concat(wanted.fork ? ['--fork-session'] : [])
      : [];

    let proc;
    try {
      proc = pty.spawn(CLAUDE_CMD, args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd: workDir,
        env: buildPtyEnv(), // 剥离 NO_COLOR 并声明色彩能力，防止宿主环境导致黑白输出
        useConpty: true,
        conptyInheritCursor: false
      });
    } catch (err) {
      // 目录被删或路径非法时别把连接流程带崩，报一次错就行
      this.pty = null;
      console.error(`[PTY] 启动失败 cwd=${workDir}: ${err.message}`);
      this.broadcast({ type: 'error', message: `无法在 ${workDir} 启动 Claude：${err.message}` });
      return false;
    }

    this.pty = proc;
    this.target = { cwd: workDir, sessionId: wanted.sessionId || null, fork: Boolean(wanted.fork) };

    proc.onData((data) => this.handlePtyData(data));
    proc.onExit(({ exitCode }) => {
      console.log(`[PTY] Claude exited with code ${exitCode}`);
      // 竞态防护：旧 PTY 的退出事件可能在新 PTY 启动后才触发，
      // 只有当它仍是当前实例时才清理，否则会误杀新进程的引用
      if (this.pty === proc) {
        this.pty = null;
        this.broadcast({ type: 'pty_exited', exitCode });
      }
    });

    console.log(`[PTY] Claude process started (${this.target.sessionId ? `resume ${this.target.sessionId}${this.target.fork ? ' --fork-session' : ''}` : 'new session'}) cwd=${this.target.cwd}`);
    return true;
  }

  handlePtyData(data) {
    // Ensure data is properly encoded as UTF-8 string
    const dataStr = typeof data === 'string' ? data : utf8Decoder.decode(data, { stream: true });

    // 自动处理工作区信任对话框
    if (!this.trustDialogHandled) {
      this.trustDialogBuffer += dataStr;
      // 去除 ANSI 转义序列，但保留光标移动作为空格
      const cleanText = this.trustDialogBuffer
        .replace(/\x1B\[(\d+)C/g, (match, n) => ' '.repeat(parseInt(n) || 1))  // [nC 光标右移 -> 空格
        .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')   // 其他 CSI 序列
        .replace(/\x1B\][^\x07]*\x07/g, '')       // OSC 序列
        .replace(/\x1B[>=<][0-9;]*[a-zA-Z]/g, '') // 特殊转义序列
        .replace(/\x1B[()][AB0]/g, '')            // 字符集选择
        .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '') // 控制字符（保留 \t \n）
        .replace(/\s+/g, ' ');                    // 多个空白压缩成单个空格

      if (cleanText.includes('Yes, I trust this folder') || cleanText.includes('trust this folder')) {
        console.log('[PTY] ✓ 检测到信任对话框，自动确认...');
        // 发送向下箭头选择 "Yes" 然后回车
        setTimeout(() => {
          this.pty?.write('\x1B[B'); // 向下箭头
          setTimeout(() => {
            this.pty?.write('\r'); // 回车
            this.trustDialogHandled = true;
            this.trustDialogBuffer = '';
            console.log('[PTY] ✓ 已自动确认信任');
          }, 150);
        }, 150);
      }

      // 限制 buffer 大小防止内存泄漏
      if (this.trustDialogBuffer.length > 5000) {
        this.trustDialogBuffer = this.trustDialogBuffer.slice(-2000);
      }
    }

    this.outputBuffer.push(dataStr);
    if (this.outputBuffer.length > MAX_BUFFER_CHUNKS) {
      this.outputBuffer = this.outputBuffer.slice(-MAX_BUFFER_CHUNKS);
    }

    this.broadcast({ type: 'output', data: dataStr });
  }

  handleInput(command, ws) {
    if (!this.pty) {
      this.sendToClient(ws, { type: 'error', message: 'PTY not started' });
      return;
    }
    this.pty.write(command);
  }

  /**
   * 换掉当前 PTY（重启与切会话共用），新进程按 target 起。
   * @returns {boolean} 同 start()：起不来就 false，调用方别谎报成功
   */
  swapPty(target) {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
    this.outputBuffer = [];
    // 重置信任对话框状态，新进程的对话框需要重新自动确认
    this.trustDialogBuffer = '';
    this.trustDialogHandled = false;

    return this.start(target);
  }

  restart() {
    console.log('[Session] Restarting PTY...');
    if (!this.swapPty(this.target)) return; // 起不来时 start() 已经报过错，别再说「已重启」
    this.broadcast({ type: 'restart', clearScreen: true, target: this.target });
  }

  /** 切到另一个会话：老 PTY 杀掉重开（用户 2026-10-02 拍板，不做多 PTY 池）。 */
  switchSession(target) {
    console.log(`[Session] Switching to ${target.sessionId || 'new session'} @ ${target.cwd || '(default dir)'}${target.fork ? ' (fork)' : ''}`);
    if (!this.swapPty(target)) return;
    // 复用 restart 消息：客户端那边的「清屏 + 重新开始」逻辑本来就一样
    this.broadcast({ type: 'restart', clearScreen: true, target: this.target });
  }

  stop() {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
  }

  addClient(ws) {
    this.clients.add(ws);

    if (!this.pty) {
      this.start();
    }

    const history = this.outputBuffer.join('');
    this.sendToClient(ws, {
      type: 'history',
      data: history,
      clientCount: this.clients.size,
      authEnabled: auth.enabled,
      tunnel: { enabled: process.env.ENABLE_TUNNEL === 'true', url: tunnelUrl },
      currentSession: this.target,
      server: { version: VERSION }
    });

    this.broadcast({ type: 'client_count', count: this.clients.size });
  }

  removeClient(ws) {
    this.clients.delete(ws);
    this.broadcast({ type: 'client_count', count: this.clients.size });
    console.log(`[Session] Client disconnected. ${this.clients.size} clients remaining`);
  }

  broadcast(message) {
    const msg = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

const sessionManager = new SessionManager();

// 启动 Claude session 检测器
const sessionDetector = new ClaudeSessionDetector((data) => {
  sessionManager.broadcast(data);
});
sessionDetector.start();

// 打开网页就该是上次那个会话，而不是家目录里的新会话（用户 2026-10-02 拍板：记忆 > 最近活跃 > 新建）。
// 这里先选一次并立刻把 PTY 起起来，网页一打开就是它。
(async () => {
  try {
    const state = await sessionDetector.detectSessions();
    const target = pickTarget({ remembered: readTarget(), sessions: state.sessions || [] });
    if (target && sessionManager.start(target)) {
      writeTarget(target);
      console.log(`[Session] 启动即接上 ${target.sessionId} @ ${target.cwd}${target.fork ? ' (fork)' : ''}`);
    } else if (target) {
      // transcript 还在但目录已经没了：别记进记忆，等客户端连上来开新会话
      console.log(`[Session] 目录不可用，跳过自动接上：${target.cwd}`);
    } else {
      console.log('[Session] 没有可接的旧会话，等第一个客户端连上来再开新会话');
    }
  } catch (err) {
    console.error('[Session] 选择启动会话失败:', err.message);
  }
})();

// ---- HTTP（静态 + API，路径穿越防护与令牌认证见 lib/http-handler.js）----
const httpHandler = createHttpHandler({
  publicDir: path.join(__dirname, 'public'),
  auth,
  version: VERSION,
  getStatus: () => ({
    pid: process.pid,
    uptime: Math.round(process.uptime()),
    clientCount: sessionManager.clients.size,
    ptyRunning: Boolean(sessionManager.pty),
    currentSession: sessionManager.target,
    claudeStatus: sessionDetector.getLastState() || { active: false },
    tunnel: { enabled: process.env.ENABLE_TUNNEL === 'true', url: tunnelUrl }
  })
});
const server = http.createServer(httpHandler);

// 必须在 WebSocketServer 之前注册：端口占用时优雅退出，避免丑的堆栈崩溃
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`[Server] ✗ 端口 ${PORT} 已被占用 — 说明服务器可能已经在运行了。`);
    console.error(`[Server] 直接打开 http://localhost:${PORT}/ 即可使用，无需再次启动。`);
    if (auth.enabled) {
      console.error(`[Server] 令牌不变（指纹 ${tokenFingerprint(auth.token)}）——浏览器打开后按 🔑 输入`);
    }
    console.error('');
    process.exit(1);
  }
  throw err;
});

// ---- WebSocket（令牌鉴权 + 心跳）----
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  // 令牌校验：Authorization: Bearer（客户端首选，不会进 URL 日志）或 ?token=（浏览器）
  if (!isAuthorized(req, auth)) {
    console.log('[WebSocket] 拒绝未认证连接');
    ws.close(4401, 'unauthorized');
    return;
  }

  console.log('[WebSocket] Client connected');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  sessionManager.addClient(ws);

  ws.on('message', async (msg) => {
    const msgStr = msg.toString();
    try {
      const parsed = JSON.parse(msgStr);

      if (parsed.type === 'restart') {
        sessionManager.restart();
      } else if (parsed.type === 'switch') {
        // sessionId 只认 detector 列表里的会话，客户端传的 cwd 一律不采信
        const state = sessionDetector.getLastState();
        // 刚启动还没轮询到（列表为空）时现扫一次，别把「还没数据」说成「该会话不存在」
        const known = state && (state.sessions || []).length ? state : await sessionDetector.detectSessions();
        const target = resolveSwitch(parsed.sessionId, known);
        if (!target) {
          sessionManager.sendToClient(ws, { type: 'error', message: '该会话已不存在，请刷新列表' });
        } else {
          writeTarget(target);
          sessionManager.switchSession(target);
        }
      } else if (parsed.type === 'input') {
        sessionManager.handleInput(parsed.data, ws);
      } else if (parsed.type === 'resize') {
        if (sessionManager.pty && parsed.cols && parsed.rows) {
          sessionManager.pty.resize(parsed.cols, parsed.rows);
          console.log(`[PTY] Resized to ${parsed.cols}x${parsed.rows}`);
        }
      }
    } catch (e) {
      sessionManager.handleInput(msgStr, ws);
    }
  });

  ws.on('close', () => {
    sessionManager.removeClient(ws);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Error:', err.message);
  });
});

// 心跳：定期 ping，超时未 pong 的连接视为死连接并终止
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      // 发送失败说明连接已断开
    }
  });
}, HEARTBEAT_INTERVAL);
heartbeatTimer.unref?.();

// ---- 隧道（ngrok）----
function broadcastTunnel() {
  sessionManager.broadcast({
    type: 'tunnel',
    enabled: process.env.ENABLE_TUNNEL === 'true',
    url: tunnelUrl
  });
}

/**
 * 清理残留的 ngrok 进程：上一次服务器进程被强杀时，ngrok agent 可能成为孤儿进程，
 * 占用账户的隧道会话导致新连接报 "invalid tunnel configuration"。
 */
async function cleanupOrphanNgrok() {
  try {
    await ngrok.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (e) {
    // 忽略
  }
  try {
    const { execFile } = require('child_process');
    await new Promise((resolve) => {
      execFile('taskkill', ['/F', '/IM', 'ngrok.exe'], { windowsHide: true }, () => resolve());
    });
    // 给 ngrok 云端会话释放留出时间
    await new Promise(resolve => setTimeout(resolve, 1500));
  } catch (e) {
    // 非 Windows 或 taskkill 不可用时忽略
  }
}

/** 尝试在指定区域建立隧道；成功返回 URL，失败抛错。 */
async function tryConnectRegion(region, attempt) {
  console.log(`[Tunnel] 尝试 ${region} 区域 (第 ${attempt} 次)...`);

  const config = {
    authtoken: process.env.NGROK_AUTHTOKEN,
    addr: PORT,
    region: region,
    onStatusChange: status => console.log('[Tunnel] Status:', status),
    onLogEvent: data => {
      if (data.lvl === 'eror' || data.lvl === 'warn') {
        console.log('[Tunnel] Log:', data.msg);
      }
    }
  };

  const url = await ngrok.connect(config);
  console.log(`[Tunnel] ✓ 成功连接到 ${region} 区域`);
  return url;
}

/** 打印隧道成功信息并广播给所有客户端。 */
function announceTunnelSuccess() {
  console.log('');
  console.log('='.repeat(60));
  console.log('[Tunnel] ✓ Ngrok 内网穿透已启动！');
  console.log('[Tunnel] 公网访问地址: ' + tunnelUrl);
  console.log('[Tunnel] WebSocket地址: ' + tunnelUrl.replace('http://', 'ws://').replace('https://', 'wss://'));
  if (auth.enabled) {
    // 不打印带令牌的地址：URL 会进 ngrok 检查器、shell 历史和 server.log（start.bat 重定向）
    console.log(`[Tunnel] 令牌指纹 ${tokenFingerprint(auth.token)} —— 浏览器打开上面的地址后按 🔑 输入令牌`);
  }
  console.log('[Tunnel] 手机端填写（公网必须 https，明文会被客户端拒绝）: ' + tunnelUrl);
  console.log('='.repeat(60));
  console.log('');

  broadcastTunnel();
}

async function openTunnel(retryCount = 0) {
  if (shuttingDown || tunnelUrl) return;

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;
  // ngrok v5 代理启动初期有瞬态故障（前 1-2 次 connect 报 "invalid tunnel configuration"，
  // 与区域无关），因此每个区域先快速重试 2 次，再切换下一个区域。
  const ATTEMPTS_PER_REGION = 2;

  try {
    console.log('[Tunnel] Initializing ngrok...');
    await cleanupOrphanNgrok();

    if (!process.env.NGROK_AUTHTOKEN) {
      throw new Error('NGROK_AUTHTOKEN 未设置');
    }
    console.log('[Tunnel] 使用 authtoken:', process.env.NGROK_AUTHTOKEN.substring(0, 10) + '...');

    // 尝试多个 region，从最近的开始
    const regions = ['us', 'ap', 'eu', 'au', 'sa', 'jp', 'in'];
    const primaryRegion = process.env.NGROK_REGION || 'us';
    const sortedRegions = [primaryRegion, ...regions.filter(r => r !== primaryRegion)];

    let lastError = null;
    for (const region of sortedRegions) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_REGION; attempt++) {
        try {
          tunnelUrl = await tryConnectRegion(region, attempt);
          break;
        } catch (err) {
          lastError = err;
          console.log(`[Tunnel] ${region} 区域失败:`, err.message);

          // 同区域重试前留足时间让云端会话就绪
          try {
            await ngrok.disconnect();
            await new Promise(resolve => setTimeout(resolve, attempt < ATTEMPTS_PER_REGION ? 1500 : 1200));
          } catch (e) {}
        }
      }
      if (tunnelUrl) break;
    }

    if (!tunnelUrl) {
      throw lastError || new Error('所有区域都连接失败');
    }

    announceTunnelSuccess();

  } catch (err) {
    console.error('[Tunnel] Failed to start ngrok:', err.message);

    tunnelUrl = null;
    broadcastTunnel();

    // 自动重试
    if (retryCount < MAX_RETRIES &&
        (err.message.includes('gone away') || err.message.includes('ECONNREFUSED'))) {
      console.log(`[Tunnel] ${RETRY_DELAY/1000}秒后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return openTunnel(retryCount + 1);
    }

    console.log('');
    console.log('[Tunnel] ⚠️  故障排查步骤:');
    console.log('[Tunnel]   1. 检查网络连接');
    console.log('[Tunnel]   2. 验证 authtoken 是否有效: https://dashboard.ngrok.com/get-started/your-authtoken');
    console.log('[Tunnel]   3. 尝试删除 ngrok 配置: del %USERPROFILE%\\.ngrok2\\ngrok.yml');
    console.log('[Tunnel]   4. 尝试手动运行: ngrok http 3000 --authtoken=你的token');
    console.log('[Tunnel]   5. 如果仍然失败，可能是 ngrok 服务暂时不可用');
    console.log('');
  }
}

console.log(`[Server] WebSocket listening on ws://0.0.0.0:${PORT}`);
console.log(`[Server] HTTP server on http://localhost:${PORT}`);
console.log(`[Server] Claude command: ${CLAUDE_CMD}`);
if (auth.enabled) {
  console.log(`[Auth] 访问令牌指纹: ${tokenFingerprint(auth.token)}（在 .env 的 ACCESS_TOKEN 里，日志不打印明文）`);
  console.log(`[Auth] 本地访问: http://localhost:${PORT}/ —— 浏览器会弹 🔑 令牌输入框`);
} else {
  console.warn('[Auth] ⚠ 令牌认证已禁用（未设置 ACCESS_TOKEN）— 任何拿到地址的人都能控制终端');
}

server.listen(PORT, () => {
  console.log(`[Server] Server started on port ${PORT}`);

  if (process.env.ENABLE_TUNNEL === 'true') {
    openTunnel();
  } else {
    console.log('[Tunnel] Tunnel disabled (set ENABLE_TUNNEL=true to enable)');
    broadcastTunnel();
  }
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(heartbeatTimer);

  if (tunnelUrl) {
    try {
      await ngrok.disconnect();
      await ngrok.kill();
      console.log('[Tunnel] Ngrok disconnected');
    } catch (err) {
      console.error('[Tunnel] Error disconnecting:', err.message);
    }
  }

  sessionDetector.stop();
  sessionManager.stop();
  wss.close();
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
