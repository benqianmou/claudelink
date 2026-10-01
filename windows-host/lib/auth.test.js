const test = require('node:test');
const assert = require('node:assert');
const { createAuth, timingSafeEqualStr, tokenFingerprint, extractToken, isAuthorized } = require('./auth');

const SAVED_ENV = process.env.ACCESS_TOKEN;

test.before(() => {
  process.env.ACCESS_TOKEN = 'env-token-123';
});
test.after(() => {
  if (SAVED_ENV === undefined) delete process.env.ACCESS_TOKEN;
  else process.env.ACCESS_TOKEN = SAVED_ENV;
});

test('createAuth enables auth with ACCESS_TOKEN set', () => {
  const auth = createAuth();
  assert.strictEqual(auth.enabled, true);
  assert.strictEqual(auth.token, 'env-token-123');
});

test('verify accepts correct token, rejects others', () => {
  const auth = createAuth();
  assert.strictEqual(auth.verify('env-token-123'), true);
  assert.strictEqual(auth.verify('wrong'), false);
  assert.strictEqual(auth.verify(''), false);
  assert.strictEqual(auth.verify(null), false);
  assert.strictEqual(auth.verify(undefined), false);
});

test('without ACCESS_TOKEN, auth disabled and verify always true', () => {
  delete process.env.ACCESS_TOKEN;
  try {
    const auth = createAuth();
    assert.strictEqual(auth.enabled, false);
    assert.strictEqual(auth.token, null);
    assert.strictEqual(auth.verify('anything'), true);
    assert.strictEqual(auth.verify(''), true);
    assert.strictEqual(auth.verify(null), true);
  } finally {
    process.env.ACCESS_TOKEN = 'env-token-123';
  }
});

test('timingSafeEqualStr is strict', () => {
  assert.strictEqual(timingSafeEqualStr('abc', 'abc'), true);
  assert.strictEqual(timingSafeEqualStr('abc', 'abd'), false);
  assert.strictEqual(timingSafeEqualStr('abc', ''), false);
  assert.strictEqual(timingSafeEqualStr(null, 'abc'), false);
  assert.strictEqual(timingSafeEqualStr(123, '123'), false);
});

test('extractToken prefers Authorization header over query', () => {
  assert.strictEqual(
    extractToken({ headers: { authorization: 'Bearer from-header' }, url: '/ws?token=from-url' }),
    'from-header'
  );
  assert.strictEqual(extractToken({ headers: { authorization: 'bearer lower-case' }, url: '/ws' }), 'lower-case');
  assert.strictEqual(extractToken({ headers: { authorization: 'Bearer   padded  ' }, url: '/ws' }), 'padded');
});

test('extractToken falls back to the query string (browsers cannot set handshake headers)', () => {
  assert.strictEqual(extractToken({ headers: {}, url: '/ws?token=from-url' }), 'from-url');
  assert.strictEqual(extractToken({ headers: {}, url: '/ws?x=1&token=a%20b' }), 'a b');
});

test('extractToken returns null when nothing usable is present', () => {
  assert.strictEqual(extractToken({ headers: {}, url: '/ws' }), null);
  assert.strictEqual(extractToken({ headers: { authorization: 'Basic abc' }, url: '/ws' }), null);
  assert.strictEqual(extractToken({ headers: {}, url: 'http://[bad' }), null);
  assert.strictEqual(extractToken({}), null);
  assert.strictEqual(extractToken(null), null);
});

test('isAuthorized 是 HTTP 与 WebSocket 握手共用的那条判据', () => {
  const auth = createAuth();   // ACCESS_TOKEN = env-token-123（见 before 钩子）
  assert.strictEqual(isAuthorized({ headers: { authorization: 'Bearer env-token-123' }, url: '/ws' }, auth), true);
  assert.strictEqual(isAuthorized({ headers: {}, url: '/ws?token=env-token-123' }, auth), true);
  assert.strictEqual(isAuthorized({ headers: {}, url: '/ws' }, auth), false);
  assert.strictEqual(isAuthorized({ headers: { authorization: 'Bearer wrong' }, url: '/ws?token=env-token-123' }, auth), false);

  delete process.env.ACCESS_TOKEN;
  try {
    const open = createAuth();
    assert.strictEqual(isAuthorized({ headers: {}, url: '/ws' }, open), true);
  } finally {
    process.env.ACCESS_TOKEN = 'env-token-123';
  }
});

test('tokenFingerprint 只暴露指纹，日志里没有明文令牌', () => {
  const print = tokenFingerprint('env-token-123');
  assert.match(print, /^[0-9a-f]{8}$/);
  assert.ok(!print.includes('env-token-123'));
  assert.strictEqual(print, tokenFingerprint('env-token-123'));   // 同一令牌指纹稳定
  assert.notStrictEqual(print, tokenFingerprint('another-token'));
  assert.strictEqual(tokenFingerprint(null), '未设置');
});
