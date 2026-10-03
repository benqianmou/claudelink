const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// 使用独立端口避免与用户运行的实例冲突；关闭隧道避免测试期间启动 ngrok
const PORT = 3101;
const TOKEN = 'uitest-token-abc123';
const BASE = `http://127.0.0.1:${PORT}`;

let serverProcess;

function get(pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + pathName, { headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
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
    } catch (e) {
      // 尚未就绪，继续轮询
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start in time');
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      ENABLE_TUNNEL: 'false',
      ACCESS_TOKEN: TOKEN,
      // 测试服务器别去写用户真身的会话记忆文件
      SESSION_TARGET_FILE: path.join(os.tmpdir(), 'claudelink-uitest-target.json'),
      // 启动即接上次会话是 server.js 的正常行为；测试里换掉命令，别真去 --resume 用户的会话
      CLAUDE_CMD: process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh'
    },
    stdio: 'ignore',
    windowsHide: true
  });
  await waitForServer();
});

test.after(() => {
  if (serverProcess) serverProcess.kill();
});

test('HTTP server serves index.html', async () => {
  const res = await get('/');
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.headers['content-type'].startsWith('text/html'));
  assert.ok(res.body.includes('ClaudeLink Terminal'), 'Should contain page title');
  assert.ok(res.body.includes('terminal-container'), 'Should contain terminal element');
  assert.ok(res.body.includes('connect-btn'), 'Should contain connect button');
});

test('index.html 内联脚本语法没坏', async () => {
  const res = await get('/');
  const blocks = [...res.body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length > 0, '一个内联脚本都没找到，选择器写错了？');
  // 内联脚本是 type="module"（有 import），存成 .mjs 交给 node --check；语法错会退出码非 0
  const file = path.join(os.tmpdir(), `claudelink-inline-${process.pid}.mjs`);
  try {
    for (const code of blocks) {
      fs.writeFileSync(file, code, 'utf8');
      const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      assert.strictEqual(check.status, 0, `内联脚本语法错：\n${check.stderr || check.stdout}`);
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('index.html ships Esc, Tab, arrow and Ctrl key buttons', async () => {
  const res = await get('/');
  // 期望的转义序列：Esc / Tab / 四方向键 / 回车 / Ctrl+C / Ctrl+D（与 xterm 默认按键输出一致）
  const keys = {
    esc: '\\x1b', tab: '\\t',
    left: '\\x1b[D', up: '\\x1b[A', down: '\\x1b[B', right: '\\x1b[C',
    enter: '\\r',
    ctrlc: '\\x03', ctrld: '\\x04'
  };
  for (const [key, seq] of Object.entries(keys)) {
    assert.ok(res.body.includes(`data-key="${key}"`), `缺少 ${key} 按键按钮`);
    assert.ok(res.body.includes(`${key}: '${seq}'`), `${key} 的转义序列不是 ${seq}`);
  }
});

test('HTTP server serves static pages with content type', async () => {
  const res = await get('/tunnel-test.html');
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.headers['content-type'].startsWith('text/html'));
});

test('HTTP server returns 404 for missing files', async () => {
  const res = await get('/nonexistent.html');
  assert.strictEqual(res.statusCode, 404);
});

test('path traversal is blocked', async () => {
  const attempts = ['/../server.js', '/..%2Fserver.js', '/%2e%2e/%2e%2e/package.json'];
  for (const p of attempts) {
    const res = await get(p);
    assert.ok([400, 403, 404].includes(res.statusCode), `${p} -> unexpected ${res.statusCode}`);
    assert.ok(!res.body.includes('require'), `${p} leaked file content`);
  }
});

test('/api/status requires token', async () => {
  const res = await get('/api/status');
  assert.strictEqual(res.statusCode, 401);
});

test('/api/status rejects wrong token', async () => {
  const res = await get('/api/status?token=wrong-token');
  assert.strictEqual(res.statusCode, 401);
});

test('/api/status works with query token', async () => {
  const res = await get(`/api/status?token=${TOKEN}`);
  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.ok, true);
  assert.ok(body.pid > 0);
  assert.strictEqual(body.tunnel.enabled, false);
  assert.ok(typeof body.version === 'string' && body.version.length > 0);
});

test('/api/status works with Authorization header', async () => {
  const res = await get('/api/status', { Authorization: `Bearer ${TOKEN}` });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(JSON.parse(res.body).ok, true);
});

test('unknown /api route with token returns 404 json', async () => {
  const res = await get(`/api/nonexistent?token=${TOKEN}`);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(JSON.parse(res.body).error, 'not_found');
});
