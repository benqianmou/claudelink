const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHttpHandler } = require('./http-handler');

function makeAuth(tokens) {
  return { verify: (candidate) => typeof candidate === 'string' && tokens.includes(candidate) };
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(port, pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${pathName}`, { headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout: ${pathName}`)); });
  });
}

let publicDir;

test.before(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudelink-public-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(publicDir, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(publicDir, 'app.mjs'), 'export const x = 1;');
});

test.after(() => {
  if (publicDir) fs.rmSync(publicDir, { recursive: true, force: true });
});

test('serves index.html with html content type', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    const res = await request(server.address().port, '/');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers['content-type'].startsWith('text/html'));
    assert.ok(res.body.includes('<h1>hi</h1>'));
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  } finally {
    server.close();
  }
});

test('serves css/js assets with correct content types', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    const css = await request(server.address().port, '/style.css');
    assert.strictEqual(css.statusCode, 200);
    assert.ok(css.headers['content-type'].startsWith('text/css'));

    const js = await request(server.address().port, '/app.mjs');
    assert.strictEqual(js.statusCode, 200);
    assert.ok(js.headers['content-type'].startsWith('text/javascript'));
  } finally {
    server.close();
  }
});

test('returns 404 for missing static files', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    const res = await request(server.address().port, '/nope.html');
    assert.strictEqual(res.statusCode, 404);
  } finally {
    server.close();
  }
});

test('blocks path traversal variants', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    for (const p of ['/../package.json', '/..%2Fpackage.json', '/%2e%2e/%2e%2e/package.json', '/a/../../package.json']) {
      const res = await request(server.address().port, p);
      assert.ok([400, 403, 404].includes(res.statusCode), `${p} -> unexpected ${res.statusCode}`);
    }
  } finally {
    server.close();
  }
});

test('/api/status requires authentication', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    const res = await request(server.address().port, '/api/status');
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(JSON.parse(res.body).error, 'unauthorized');

    const bad = await request(server.address().port, '/api/status?token=bad');
    assert.strictEqual(bad.statusCode, 401);
  } finally {
    server.close();
  }
});

test('/api/status accepts query token and Bearer header', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123, uptime: 5 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    const query = await request(server.address().port, '/api/status?token=good-token');
    assert.strictEqual(query.statusCode, 200);
    const body = JSON.parse(query.body);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.pid, 123);
    assert.strictEqual(body.version, '9.9.9');

    const header = await request(server.address().port, '/api/status', { Authorization: 'Bearer good-token' });
    assert.strictEqual(header.statusCode, 200);
    assert.strictEqual(JSON.parse(header.body).pid, 123);
  } finally {
    server.close();
  }
});

test('unknown /api routes need auth, then 404', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    const noAuth = await request(server.address().port, '/api/whatever');
    assert.strictEqual(noAuth.statusCode, 401);

    const authed = await request(server.address().port, '/api/whatever?token=good-token');
    assert.strictEqual(authed.statusCode, 404);
    assert.strictEqual(JSON.parse(authed.body).error, 'not_found');
  } finally {
    server.close();
  }
});

test('OPTIONS returns 204 with CORS headers', async () => {
  const handler = createHttpHandler({
    publicDir: publicDir,
    auth: makeAuth(['good-token']),
    getStatus: () => ({ pid: 123 }),
    version: '9.9.9'
  });
  const server = await startServer(handler);
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        path: '/api/status',
        method: 'OPTIONS',
        timeout: 5000
      }, resolve);
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
  } finally {
    server.close();
  }
});
