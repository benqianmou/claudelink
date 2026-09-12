const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

test('WebSocket server accepts connections', async (t) => {
  const wss = new WebSocket.Server({ port: 0 });
  const port = wss.address().port;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    ws.on('open', () => {
      ws.close();
      wss.close();
      resolve();
    });

    ws.on('error', reject);

    setTimeout(() => reject(new Error('Connection timeout')), 2000);
  });
});

test('WebSocket server echoes messages', async (t) => {
  const wss = new WebSocket.Server({ port: 0 });
  const port = wss.address().port;

  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      ws.send(msg.toString());
    });
  });

  const received = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    ws.on('open', () => {
      ws.send('test message');
    });

    ws.on('message', (data) => {
      ws.close();
      wss.close();
      resolve(data.toString());
    });

    ws.on('error', reject);
    setTimeout(() => reject(new Error('Timeout')), 2000);
  });

  assert.strictEqual(received, 'test message');
});

test('server handles client disconnect gracefully', async (t) => {
  const wss = new WebSocket.Server({ port: 0 });
  const port = wss.address().port;

  let disconnectFired = false;

  wss.on('connection', (ws) => {
    ws.on('close', () => {
      disconnectFired = true;
    });
  });

  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('open', () => {
      ws.close();
      setTimeout(() => {
        wss.close();
        resolve();
      }, 100);
    });
  });

  assert.strictEqual(disconnectFired, true);
});
