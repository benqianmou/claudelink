/**
 * 冒烟测试：启动真实 server.js 验证核心链路
 * - HTTP 静态服务与 /api/status 令牌认证
 * - WebSocket 鉴权（无令牌 4401 / 有令牌收到 history）
 * 用法：node smoke-test.js
 * 注意：会临时占用 3199 端口；PTY 用 cmd.exe 代替 claude.exe，不会启动真实 Claude Code。
 */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const PORT = 3199;
const TOKEN = 'smoke-token-123';
const BASE = `http://127.0.0.1:${PORT}`;

function get(pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + pathName, { headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout: ${pathName}`)); });
  });
}

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await get('/');
      if (res.statusCode === 200) return;
    } catch (e) { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

async function wsAuthTest() {
  // 无令牌 → 4401 拒绝
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    const timer = setTimeout(() => reject(new Error('no close event without token')), 8000);
    ws.on('close', (code) => {
      clearTimeout(timer);
      if (code === 4401) resolve();
      else reject(new Error(`expected close 4401, got ${code}`));
    });
    ws.on('error', () => { /* 4401 拒绝会触发 error 事件，忽略 */ });
  });
  console.log('[smoke] WS without token rejected (4401) OK');

  // 有令牌 → 收到 history
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}`);
    const timer = setTimeout(() => reject(new Error('no history message with token')), 10000);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'history') {
        clearTimeout(timer);
        console.log(`[smoke] WS with token OK (history, clients=${msg.clientCount}, server v${msg.server && msg.server.version}, tunnel.enabled=${msg.tunnel && msg.tunnel.enabled})`);
        ws.close();
        resolve();
      }
    });
    ws.on('ping', () => console.log('[smoke] heartbeat ping observed OK'));
  });
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      ENABLE_TUNNEL: 'false',
      ACCESS_TOKEN: TOKEN,
      CLAUDE_CMD: 'cmd.exe'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  server.stdout.on('data', d => process.stdout.write(String(d)));
  server.stderr.on('data', d => process.stderr.write(String(d)));

  try {
    await waitForServer();
    console.log('[smoke] HTTP server up OK');

    const index = await get('/');
    if (index.statusCode !== 200 || !index.body.includes('connect-btn')) {
      throw new Error('index.html not served correctly');
    }
    console.log('[smoke] index.html served OK');

    const noToken = await get('/api/status');
    if (noToken.statusCode !== 401) throw new Error(`/api/status without token: expected 401, got ${noToken.statusCode}`);
    console.log('[smoke] /api/status rejects missing token OK');

    const wrongToken = await get('/api/status?token=wrong');
    if (wrongToken.statusCode !== 401) throw new Error(`/api/status with wrong token: expected 401, got ${wrongToken.statusCode}`);
    console.log('[smoke] /api/status rejects wrong token OK');

    const ok = await get(`/api/status?token=${TOKEN}`);
    const body = JSON.parse(ok.body);
    if (ok.statusCode !== 200 || body.ok !== true || body.tunnel.enabled !== false) {
      throw new Error(`bad /api/status response: ${ok.statusCode} ${ok.body}`);
    }
    console.log(`[smoke] /api/status OK (v${body.version}, pid=${body.pid}, claudeStatus.active=${body.claudeStatus && body.claudeStatus.active})`);

    await wsAuthTest();

    console.log('[smoke] ALL CHECKS PASSED');
    process.exit(0);
  } catch (err) {
    console.error('[smoke] FAILED:', err.message);
    process.exit(1);
  } finally {
    server.kill();
  }
}

main();
