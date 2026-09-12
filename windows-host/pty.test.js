const test = require('node:test');
const assert = require('node:assert');
const pty = require('node-pty');

test('PTY spawns shell process', (t) => {
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30
  });

  assert.ok(ptyProcess.pid > 0, 'PTY should have valid PID');

  ptyProcess.kill();
});

test('PTY captures ANSI output', (t, done) => {
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30
  });

  let completed = false;

  const cleanup = (err) => {
    if (completed) return;
    completed = true;
    ptyProcess.kill();
    done(err);
  };

  ptyProcess.onData((data) => {
    assert.ok(data.length > 0, 'Should receive data from PTY');
    cleanup();
  });

  ptyProcess.write('echo test\r');

  setTimeout(() => cleanup(new Error('No data received from PTY')), 2000);
});

test('PTY handles input correctly', (t, done) => {
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30
  });

  let output = '';
  let completed = false;

  const cleanup = (err) => {
    if (completed) return;
    completed = true;
    ptyProcess.kill();
    done(err);
  };

  ptyProcess.onData((data) => {
    output += data;
    if (output.includes('test')) {
      assert.ok(true, 'PTY echoed input');
      cleanup();
    }
  });

  setTimeout(() => {
    ptyProcess.write('echo test\r');
  }, 500);

  setTimeout(() => {
    if (!output.includes('test')) {
      cleanup(new Error('PTY did not echo input'));
    }
  }, 3000);
});
