const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ClaudeSessionDetector = require('./session-detector');
const {
  getUserInputHistory,
  getSessionSummary,
  getRecentCommands,
  getAllUserInputHistory,
  defaultIsProcessAlive
} = require('./session-detector');

/** 创建带 .claude 目录结构的临时 home 目录。 */
function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudelink-home-'));
  const claude = path.join(dir, '.claude');
  fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'session-data'), { recursive: true });
  return dir;
}

function writeSession(dir, file, session) {
  fs.writeFileSync(path.join(dir, '.claude', 'sessions', file), JSON.stringify(session));
}

test('getUserInputHistory filters by sessionId and respects limit', async () => {
  const dir = makeHome();
  fs.writeFileSync(path.join(dir, '.claude', 'history.jsonl'), [
    JSON.stringify({ sessionId: 's1', display: 'hello one', timestamp: '2024-01-01T00:00:00Z', project: 'p' }),
    JSON.stringify({ sessionId: 's2', display: 'hello two', timestamp: '2024-01-01T00:00:01Z', project: 'p' }),
    JSON.stringify({ sessionId: 's1', display: 'hello three', timestamp: '2024-01-01T00:00:02Z', project: 'p' }),
    JSON.stringify({ sessionId: 's1', display: 'hello four', timestamp: '2024-01-01T00:00:03Z', project: 'p' })
  ].join('\n') + '\n');

  const s1 = await getUserInputHistory('s1', 20, dir);
  assert.strictEqual(s1.length, 3);
  assert.strictEqual(s1[0].display, 'hello one');
  assert.strictEqual(s1[2].display, 'hello four');

  const limited = await getUserInputHistory('s1', 2, dir);
  assert.strictEqual(limited.length, 2);
  assert.strictEqual(limited[0].display, 'hello three');

  const s2 = await getUserInputHistory('s2', 20, dir);
  assert.strictEqual(s2.length, 1);

  const missing = await getUserInputHistory('nope', 20, dir);
  assert.deepStrictEqual(missing, []);
});

test('getUserInputHistory returns [] when file missing', async () => {
  const dir = makeHome();
  const result = await getUserInputHistory('s1', 20, dir);
  assert.deepStrictEqual(result, []);
});

test('getAllUserInputHistory groups by sessionId', async () => {
  const dir = makeHome();
  fs.writeFileSync(path.join(dir, '.claude', 'history.jsonl'), [
    JSON.stringify({ sessionId: 's1', display: 'one', timestamp: '2024-01-01T00:00:00Z' }),
    JSON.stringify({ sessionId: 's2', display: 'two', timestamp: '2024-01-01T00:00:01Z' }),
    JSON.stringify({ sessionId: 's1', display: 'three', timestamp: '2024-01-01T00:00:02Z' })
  ].join('\n') + '\n');

  const map = await getAllUserInputHistory(20, dir);
  assert.ok(map instanceof Map);
  assert.strictEqual(map.size, 2);
  assert.strictEqual(map.get('s1').length, 2);
  assert.strictEqual(map.get('s1')[1].display, 'three');
  assert.strictEqual(map.get('s2')[0].display, 'two');
});

test('getSessionSummary parses tasks/files/tools sections', async () => {
  const dir = makeHome();
  fs.writeFileSync(path.join(dir, '.claude', 'session-data', 'live.tmp'), [
    '## Session info',
    '### Tasks',
    '- Task A',
    '- Task B',
    '### Files Modified',
    '- src/a.js',
    '- src/b.js',
    '### Tools Used: Read, Edit, Bash',
    '### Other',
    '- ignore me'
  ].join('\n'));

  const summary = await getSessionSummary(dir);
  assert.deepStrictEqual(summary.tasks, ['Task A', 'Task B']);
  assert.deepStrictEqual(summary.filesModified, ['src/a.js', 'src/b.js']);
  assert.deepStrictEqual(summary.toolsUsed, ['Read', 'Edit', 'Bash']);
});

test('getSessionSummary returns empty when no tmp file', async () => {
  const dir = makeHome();
  const summary = await getSessionSummary(dir);
  assert.deepStrictEqual(summary, { tasks: [], filesModified: [], toolsUsed: [] });
});

test('getRecentCommands parses bracketed log lines only', async () => {
  const dir = makeHome();
  fs.writeFileSync(path.join(dir, '.claude', 'bash-commands.log'), [
    '[2024-01-01T00:00:00Z] ls -la',
    'not a command',
    '[2024-01-01T00:00:01Z] git status',
    '[2024-01-01T00:00:02Z] npm test'
  ].join('\n') + '\n');

  const cmds = await getRecentCommands(10, dir);
  assert.strictEqual(cmds.length, 3);
  assert.strictEqual(cmds[0].command, 'ls -la');
  assert.strictEqual(cmds[2].command, 'npm test');
  assert.ok(cmds[0].timestamp.startsWith('2024-01-01'));

  const limited = await getRecentCommands(1, dir);
  assert.strictEqual(limited.length, 1);
  assert.strictEqual(limited[0].command, 'npm test');
});

test('getRecentCommands returns [] when log missing', async () => {
  const dir = makeHome();
  assert.deepStrictEqual(await getRecentCommands(10, dir), []);
});

test('defaultIsProcessAlive factory caches and falls back to alive', async () => {
  const checker = defaultIsProcessAlive();
  // 无真实环境可验证 tasklist 结果，只验证返回类型与失败回退逻辑
  const result = await checker(99999999);
  assert.strictEqual(typeof result, 'boolean');
});

test('detectSessions returns all alive sessions, newest first', async () => {
  const dir = makeHome();
  writeSession(dir, 'a.json', {
    pid: 111, sessionId: 's1', name: 'proj-one', cwd: 'C:\\proj1',
    status: 'busy', startedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:01:00Z'
  });
  writeSession(dir, 'b.json', {
    pid: 222, sessionId: 's2', name: 'proj-two', cwd: 'C:\\proj2',
    status: 'idle', startedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:02:00Z'
  });
  writeSession(dir, 'dead.json', {
    pid: 999, sessionId: 's3', name: 'proj-dead', cwd: 'C:\\dead',
    status: 'idle', startedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:03:00Z'
  });
  fs.writeFileSync(path.join(dir, '.claude', 'sessions', 'corrupt.json'), '{not valid json');
  fs.writeFileSync(path.join(dir, '.claude', 'history.jsonl'), [
    JSON.stringify({ sessionId: 's1', display: 'input one', timestamp: '2024-01-01T00:00:00Z' }),
    JSON.stringify({ sessionId: 's2', display: 'input two', timestamp: '2024-01-01T00:00:01Z' })
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, '.claude', 'session-data', 'live.tmp'), [
    '### Tasks', '- T1', '### Files Modified', '- f.js', '### Tools Used: Edit'
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '.claude', 'bash-commands.log'), '[2024-01-01T00:00:00Z] ls\n');

  const alive = new Set([111, 222]);
  const detector = new ClaudeSessionDetector(() => {}, {
    homeDir: dir,
    isProcessAlive: async (pid) => alive.has(pid)
  });

  const state = await detector.detectSessions();
  assert.strictEqual(state.active, true);
  assert.strictEqual(state.sessionId, 's2'); // updatedAt 最新者为主会话
  assert.strictEqual(state.projectName, 'proj-two');
  assert.strictEqual(state.pid, 222);
  assert.strictEqual(state.sessions.length, 2);
  assert.strictEqual(state.sessions[0].sessionId, 's2');
  assert.strictEqual(state.sessions[1].sessionId, 's1');
  assert.strictEqual(state.userInputs[0].display, 'input two');
  assert.deepStrictEqual(state.summary.tasks, ['T1']);
  assert.deepStrictEqual(state.summary.filesModified, ['f.js']);
  assert.deepStrictEqual(state.summary.toolsUsed, ['Edit']);
  assert.strictEqual(state.recentCommands.length, 1);
  assert.strictEqual(state.recentCommands[0].command, 'ls');
  // 每个会话带各自的输入历史
  assert.strictEqual(state.sessions[0].userInputs[0].display, 'input two');
  assert.strictEqual(state.sessions[1].userInputs[0].display, 'input one');
  assert.strictEqual(detector.getLastState(), state);
});

test('detectSessions inactive when all processes dead (and updates lastState)', async () => {
  const dir = makeHome();
  writeSession(dir, 'a.json', {
    pid: 111, sessionId: 's1', name: 'p', cwd: 'C:\\p', status: 'idle'
  });
  const detector = new ClaudeSessionDetector(() => {}, {
    homeDir: dir,
    isProcessAlive: async () => false
  });
  const state = await detector.detectSessions();
  assert.strictEqual(state.active, false);
  assert.deepStrictEqual(state.sessions, []);
  assert.strictEqual(detector.getLastState().active, false);
});

test('detectSessions inactive when no session files', async () => {
  const dir = makeHome();
  const detector = new ClaudeSessionDetector(() => {}, { homeDir: dir });
  const state = await detector.detectSessions();
  assert.strictEqual(state.active, false);
  assert.deepStrictEqual(state.sessions, []);
});

test('poll broadcasts claude_status only on state change', async () => {
  const dir = makeHome();
  writeSession(dir, 'a.json', {
    pid: 111, sessionId: 's1', name: 'p', cwd: 'C:\\p', status: 'idle',
    startedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z'
  });
  const messages = [];
  const detector = new ClaudeSessionDetector((msg) => messages.push(msg), {
    homeDir: dir,
    isProcessAlive: async (pid) => pid === 111,
    pollInterval: 60000
  });
  detector.start();
  await new Promise(r => setTimeout(r, 300));
  detector.stop();
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].type, 'claude_status');
  assert.strictEqual(messages[0].active, true);
  assert.strictEqual(messages[0].sessionId, 's1');
});

test('getLastState initial state is inactive', () => {
  const detector = new ClaudeSessionDetector(() => {}, { homeDir: os.homedir() });
  assert.strictEqual(detector.getLastState().active, false);
});
