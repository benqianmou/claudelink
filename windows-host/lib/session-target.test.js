const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pickTarget, resolveSwitch, readTarget, writeTarget } = require('./session-target');

const S1 = { sessionId: 's1', cwd: 'C:\\p1', updatedAt: '2024-01-01T00:01:00Z', live: false };
const S2 = { sessionId: 's2', cwd: 'C:\\p2', updatedAt: '2024-01-01T00:02:00Z', live: true };

test('pickTarget 优先兑现记忆里的会话', () => {
  const t = pickTarget({ remembered: { sessionId: 's1' }, sessions: [S2, S1] });
  assert.deepStrictEqual(t, { cwd: 'C:\\p1', sessionId: 's1', fork: false });
});

test('记忆里的会话不在了就退回最近活跃，活的加 fork', () => {
  const t = pickTarget({ remembered: { sessionId: 'gone' }, sessions: [S1, S2] });
  assert.deepStrictEqual(t, { cwd: 'C:\\p2', sessionId: 's2', fork: true });
});

test('记忆是「新建」时不开旧会话', () => {
  assert.strictEqual(pickTarget({ remembered: { sessionId: null, cwd: null }, sessions: [S2] }), null);
});

test('没有任何会话时返回 null（= 今天的行为）', () => {
  assert.strictEqual(pickTarget({ sessions: [] }), null);
  assert.strictEqual(pickTarget({}), null);
  assert.strictEqual(pickTarget(), null);
});

test('pickTarget 忽略缺 cwd 的条目', () => {
  const broken = { sessionId: 'x', cwd: null, updatedAt: '2024-01-01T09:00:00Z' };
  assert.strictEqual(pickTarget({ sessions: [broken, S1] }).sessionId, 's1');
});

test('resolveSwitch 只认列表里的会话，客户端传的路径一律不采信', () => {
  const state = { sessions: [S1, S2] };
  assert.deepStrictEqual(resolveSwitch('s1', state), { cwd: 'C:\\p1', sessionId: 's1', fork: false });
  assert.deepStrictEqual(resolveSwitch('s2', state), { cwd: 'C:\\p2', sessionId: 's2', fork: true });
  assert.strictEqual(resolveSwitch('C:\\evil', state), null);
  assert.strictEqual(resolveSwitch('nope', state), null);
  assert.strictEqual(resolveSwitch('s1', {}), null);
});

test('resolveSwitch(null) = 开新会话', () => {
  assert.deepStrictEqual(resolveSwitch(null, { sessions: [S1] }), { cwd: null, sessionId: null, fork: false });
});

test('记忆文件能存能读，损坏或不存在都当没有记忆', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claudelink-target-')), 'target.json');
  assert.strictEqual(readTarget(file), null);

  assert.strictEqual(writeTarget({ cwd: 'C:\\p1', sessionId: 's1' }, file), true);
  assert.deepStrictEqual(readTarget(file), { cwd: 'C:\\p1', sessionId: 's1' });

  assert.strictEqual(writeTarget(null, file), true);
  assert.deepStrictEqual(readTarget(file), { cwd: null, sessionId: null });

  fs.writeFileSync(file, '{broken');
  assert.strictEqual(readTarget(file), null);
});
