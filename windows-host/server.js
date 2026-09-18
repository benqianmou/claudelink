require('dotenv').config();
const pty = require('node-pty');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ngrok = require('ngrok');
const ClaudeSessionDetector = require('./session-detector');

const PORT = process.env.PORT || 3000;
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'C:\\Users\\Lenovo\\.local\\bin\\claude.exe';
const MAX_BUFFER_CHUNKS = 1000;

// Session 管理器
class SessionManager {
  constructor() {
    this.pty = null;
    this.outputBuffer = [];
    this.clients = new Set();
    this.trustDialogBuffer = '';
    this.trustDialogHandled = false;
  }

  start() {
    if (this.pty) return;

    const workDir = process.env.USERPROFILE || process.env.HOME;

    const proc = pty.spawn(CLAUDE_CMD, [], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: workDir,
      env: process.env,
      useConpty: true,
      conptyInheritCursor: false
    });
    this.pty = proc;

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

    console.log('[PTY] Claude process started');
  }

  handlePtyData(data) {
    // Ensure data is properly encoded as UTF-8 string
    const dataStr = typeof data === 'string' ? data : data.toString('utf8');

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

      // 调试：每次接收数据都检查一次
      if (cleanText.length > 50) {
        console.log('[PTY] 清理后片段:', cleanText.substring(0, 200));
      }

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

  restart() {
    console.log('[Session] Restarting PTY...');
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
    this.outputBuffer = [];
    // 重置信任对话框状态，新进程的对话框需要重新自动确认
    this.trustDialogBuffer = '';
    this.trustDialogHandled = false;

    this.start();
    this.broadcast({ type: 'restart', clearScreen: true });
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
      clientCount: this.clients.size
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

const server = http.createServer((req, res) => {
  // 允许跨域访问和隧道访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const filePath = req.url === '/' ? 'public/index.html' : `public${req.url}`;
  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const contentType = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const sessionManager = new SessionManager();
const wss = new WebSocket.Server({ server });

// 启动 Claude session 检测器
const sessionDetector = new ClaudeSessionDetector((data) => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
});
sessionDetector.start();

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');
  sessionManager.addClient(ws);

  ws.on('message', (msg) => {
    const msgStr = msg.toString();
    try {
      const parsed = JSON.parse(msgStr);

      if (parsed.type === 'restart') {
        sessionManager.restart();
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

console.log(`[Server] WebSocket listening on ws://0.0.0.0:${PORT}`);
console.log(`[Server] HTTP server on http://localhost:${PORT}`);
console.log(`[Server] Claude command: ${CLAUDE_CMD}`);

let tunnelUrl = null;
let shuttingDown = false;

async function openTunnel(retryCount = 0) {
  if (shuttingDown || tunnelUrl) return;

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  try {
    console.log('[Tunnel] Initializing ngrok...');

    // 先断开所有现有连接
    try {
      await ngrok.kill();
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      // 忽略
    }

    // 验证 authtoken
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
      try {
        console.log(`[Tunnel] 尝试 ${region} 区域...`);

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

        tunnelUrl = await ngrok.connect(config);

        // 成功了就跳出
        console.log(`[Tunnel] ✓ 成功连接到 ${region} 区域`);
        break;

      } catch (err) {
        lastError = err;
        console.log(`[Tunnel] ${region} 区域失败:`, err.message);

        // 清理后再试下一个
        try {
          await ngrok.disconnect();
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (e) {}

        // 继续尝试下一个区域
        continue;
      }
    }

    // 所有区域都失败了
    if (!tunnelUrl) {
      throw lastError || new Error('所有区域都连接失败');
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('[Tunnel] ✓ Ngrok 内网穿透已启动！');
    console.log('[Tunnel] 公网访问地址: ' + tunnelUrl);
    console.log('[Tunnel] WebSocket地址: ' + tunnelUrl.replace('http://', 'ws://').replace('https://', 'wss://'));
    console.log('='.repeat(60));
    console.log('');

  } catch (err) {
    console.error('[Tunnel] Failed to start ngrok:', err.message);
    console.error('[Tunnel] 完整错误:', err);

    tunnelUrl = null;

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

server.listen(PORT, () => {
  console.log(`[Server] Server started on port ${PORT}`);

  if (process.env.ENABLE_TUNNEL === 'true') {
    openTunnel();
  } else {
    console.log('[Tunnel] Tunnel disabled (set ENABLE_TUNNEL=true to enable)');
  }
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

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
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
