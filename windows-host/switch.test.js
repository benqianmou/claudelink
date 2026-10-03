'use strict';
// 端到端闸门：起真 server.js（临时家目录 + 临时记忆文件 + cmd.exe 当 CLAUDE_CMD），
// 用 ws 客户端跑一遍「启动即接上 → 切换 → 拒绝未知 → 重启后记忆优先 → 新建会话」。
// 目的是验证活跃会话切换这条链路真的通，而不是靠 mock 出来的绿。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const SERVER = path.join(__dirname, 'server.js');
const TOKEN = 'switch-test-token';
const SHELL = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh';

/** 造一个 transcript：头部垫一段长记录，证明只读头部也能抽到 cwd。 */
function writeTranscript(projectsDir, slug, session, mtimeMs) {
  const dir = path.join(projectsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session.id}.jsonl`);
  const pad = JSON.stringify({ type: 'attachment', blob: 'x'.repeat(20_000) });
  const head = JSON.stringify({ type: 'user', cwd: session.cwd, sessionId: session.id, version: '2.1.283' });
  fs.writeFileSync(file, `${pad}\n${head}\n`, 'utf8');
  const t = new Date(mtimeMs);
  fs.utimesSync(file, t, t);
}

/** 临时家目录：两个 transcript，cwd 不同、mtime 不同（newer 更活跃）。 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudelink-home-'));
  const projects = path.join(home, '.claude', 'projects');
  fs.mkdirSync(projects, { recursive: true });
  const older = { id: '11111111-1111-1111-1111-111111111111', cwd: path.join(home, 'proj-older') };
  const newer = { id: '22222222-2222-2222-2222-222222222222', cwd: path.join(home, 'proj-newer') };
  // cwd 必须是真目录，否则 PTY 起不来（spawn 报 error code 267）
  fs.mkdirSync(older.cwd, { recursive: true });
  fs.mkdirSync(newer.cwd, { recursive: true });
  writeTranscript(projects, 'E--proj-older', older, Date.now() - 60_000);
  writeTranscript(projects, 'E--proj-newer', newer, Date.now());
  return { home, older, newer };
}

async function waitFor(label, probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等不到：${label}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

function startServer(home, targetFile, port) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_TUNNEL: 'false',
      ACCESS_TOKEN: TOKEN,
      USERPROFILE: home,
      HOME: home,
      SESSION_TARGET_FILE: targetFile,
      // 别在测试里真去 --resume 用户的会话
      CLAUDE_CMD: SHELL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function status(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/status?token=${TOKEN}`);
  assert.strictEqual(res.status, 200);
  return res.json();
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    ws.on('error', reject);
    ws.on('open', () => resolve(ws));
  });
}

/** 收集消息直到 predicate 命中。 */
function waitForMessage(ws, predicate, label, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`等不到消息：${label}`));
    }, timeoutMs);
    function onMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

function readTargetFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('活跃会话切换端到端', async () => {
  const { home, older, newer } = makeHome();
  const targetFile = path.join(home, 'target.json');
  const clients = [];
  let child = startServer(home, targetFile, 3102);

  const exited = () => new Promise(resolve => child.on('exit', resolve));

  try {
    // 1) 启动即接上最近活跃的会话，并把选择记进记忆文件
    const boot = await waitFor('启动即接上最近会话', async () => {
      const body = await status(3102);
      return body.currentSession && body.currentSession.sessionId ? body : null;
    });
    assert.strictEqual(boot.currentSession.sessionId, newer.id);
    assert.strictEqual(boot.currentSession.cwd, newer.cwd);
    await waitFor('记住选中的会话', async () => (readTargetFile(targetFile).sessionId === newer.id ? true : null));

    const ws = await connect(3102);
    clients.push(ws);
    const history = await waitForMessage(ws, m => m.type === 'history', 'history');
    assert.strictEqual(history.currentSession.sessionId, newer.id);

    // 2) 切到另一个会话：广播 restart，带上新目标
    const restarted = waitForMessage(ws, m => m.type === 'restart' && m.target, 'restart');
    ws.send(JSON.stringify({ type: 'switch', sessionId: older.id }));
    const switched = await restarted;
    assert.strictEqual(switched.clearScreen, true);
    assert.strictEqual(switched.target.sessionId, older.id);
    assert.strictEqual(switched.target.cwd, older.cwd);
    assert.strictEqual((await status(3102)).currentSession.sessionId, older.id);
    await waitFor('记忆改成新会话', async () => (readTargetFile(targetFile).sessionId === older.id ? true : null));

    // 3) 不存在的会话被拒，且不动当前目标
    const errored = waitForMessage(ws, m => m.type === 'error', 'error');
    ws.send(JSON.stringify({ type: 'switch', sessionId: '00000000-0000-0000-0000-000000000000' }));
    assert.match((await errored).message, /已不存在/);
    assert.strictEqual((await status(3102)).currentSession.sessionId, older.id);

    ws.close();
    child.kill();
    await exited();

    // 4) 重启后记忆优先：newer 更活跃，但仍回到上次选的 older
    child = startServer(home, targetFile, 3103);
    const boot2 = await waitFor('重启后接上记忆里的会话', async () => {
      const body = await status(3103);
      return body.currentSession && body.currentSession.sessionId === older.id ? body : null;
    });
    assert.strictEqual(boot2.currentSession.sessionId, older.id);

    // 5) 新建会话：目标清空，记忆里也记「新建」
    const ws2 = await connect(3103);
    clients.push(ws2);
    await waitForMessage(ws2, m => m.type === 'history', '第二个 history');
    const fresh = waitForMessage(ws2, m => m.type === 'restart' && m.target, '新建 restart');
    ws2.send(JSON.stringify({ type: 'switch', sessionId: null }));
    assert.strictEqual((await fresh).target.sessionId, null);
    await waitFor('记忆里记下「新建」', async () => (readTargetFile(targetFile).sessionId === null ? true : null));
  } finally {
    for (const ws of clients) {
      try {
        ws.close();
      } catch (e) {}
    }
    // 先让 server（连同它的 PTY 子进程）退干净，否则临时目录还挂在别人的 cwd 上删不掉
    try {
      child.kill();
      await Promise.race([exited(), new Promise(r => setTimeout(r, 3000))]);
    } catch (e) {}
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(home, { recursive: true, force: true });
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
});
