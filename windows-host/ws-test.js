const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('[Test] Connected to server');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('[Test] Received:', msg.type);
  if (msg.type === 'output') {
    console.log('--- PTY Output ---');
    console.log(msg.data);
    console.log('--- End Output ---');
  }
});

ws.on('error', (error) => {
  console.error('[Test] Error:', error.message);
});

ws.on('close', () => {
  console.log('[Test] Connection closed');
});

// Keep alive for 15 seconds
setTimeout(() => {
  console.log('[Test] Closing connection');
  ws.close();
  process.exit(0);
}, 15000);
