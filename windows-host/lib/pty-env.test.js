const test = require('node:test');
const assert = require('node:assert');
const { buildPtyEnv } = require('./pty-env');

test('剥离 NO_COLOR（宿主沙箱环境会导致 Claude 输出黑白）', () => {
  const env = buildPtyEnv({ NO_COLOR: '1', PATH: 'x' });
  assert.strictEqual(env.NO_COLOR, undefined);
  assert.strictEqual(env.PATH, 'x');
});

test('补全缺失的色彩能力声明', () => {
  const env = buildPtyEnv({ PATH: 'x' });
  assert.strictEqual(env.TERM, 'xterm-256color');
  assert.strictEqual(env.COLORTERM, 'truecolor');
});

test('TERM=dumb 视为无效，替换为可用终端', () => {
  const env = buildPtyEnv({ TERM: 'dumb' });
  assert.strictEqual(env.TERM, 'xterm-256color');
});

test('不覆盖已有配置', () => {
  const env = buildPtyEnv({ TERM: 'screen-256color', COLORTERM: '24bit' });
  assert.strictEqual(env.TERM, 'screen-256color');
  assert.strictEqual(env.COLORTERM, '24bit');
});

test('不污染调用方传入的环境对象', () => {
  const base = { NO_COLOR: '1', TERM: 'xterm' };
  buildPtyEnv(base);
  assert.strictEqual(base.NO_COLOR, '1'); // 原对象保持不变
  assert.strictEqual(base.TERM, 'xterm');
});
