// 测试 PTY 是否能正常启动 Claude
const pty = require('node-pty');

console.log('[Test] Starting PTY test...');
console.log('[Test] Spawning claude process...');

const claudePath = 'C:\\Users\\Lenovo\\.local\\bin\\claude.exe';
const claudePty = pty.spawn(claudePath, [], {
  name: 'xterm-256color',
  cols: 100,
  rows: 30,
  cwd: process.env.USERPROFILE || process.env.HOME,
  env: process.env
});

let outputReceived = false;

claudePty.onData((data) => {
  outputReceived = true;
  console.log('[PTY Output]:', JSON.stringify(data));
});

claudePty.onExit(({ exitCode, signal }) => {
  console.log(`[PTY Exit] code=${exitCode}, signal=${signal}`);
  process.exit(exitCode);
});

// 5秒后检查是否收到输出
setTimeout(() => {
  if (!outputReceived) {
    console.log('[Test] ❌ No output received after 5 seconds');
    console.log('[Test] PTY may not be working correctly');
  } else {
    console.log('[Test] ✅ PTY is working - output received');
  }
  claudePty.kill();
  process.exit(0);
}, 5000);

console.log('[Test] Waiting for output...');
