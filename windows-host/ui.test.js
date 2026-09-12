const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');

let serverProcess;

test.before(() => {
  return new Promise((resolve) => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: 'ignore'
    });
    setTimeout(resolve, 1000); // 等待服务器启动
  });
});

test.after(() => {
  if (serverProcess) serverProcess.kill();
});

test('HTTP server serves index.html', (t, done) => {
  let completed = false;
  const cleanup = (err) => {
    if (completed) return;
    completed = true;
    done(err);
  };

  http.get('http://localhost:3000/', (res) => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'text/html');

    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      assert.ok(data.includes('Claude Remote'), 'Should contain page title');
      assert.ok(data.includes('terminal'), 'Should contain terminal element');
      cleanup();
    });
  }).on('error', cleanup);
});

test('HTTP server returns 404 for missing files', (t, done) => {
  let completed = false;
  const cleanup = (err) => {
    if (completed) return;
    completed = true;
    done(err);
  };

  http.get('http://localhost:3000/nonexistent.html', (res) => {
    assert.strictEqual(res.statusCode, 404);
    cleanup();
  }).on('error', cleanup);
});
