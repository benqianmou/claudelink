const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const execAsync = promisify(exec);

// 读取用户输入历史
async function getUserInputHistory(sessionId, limit = 20) {
  try {
    const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');
    const content = await fs.readFile(historyPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line);

    const history = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId === sessionId) {
          history.push({
            display: entry.display,
            timestamp: entry.timestamp,
            project: entry.project
          });
        }
      } catch (e) {}
    }

    return history.slice(-limit);
  } catch (err) {
    return [];
  }
}

// 读取会话摘要
async function getSessionSummary() {
  try {
    const sessionDataDir = path.join(os.homedir(), '.claude', 'session-data');
    const files = await fs.readdir(sessionDataDir);

    for (const file of files) {
      if (file.endsWith('.tmp')) {
        const filePath = path.join(sessionDataDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        const tasks = [];
        const filesModified = [];
        let toolsLine = '';

        const lines = content.split('\n');
        let inTasks = false;
        let inFiles = false;

        for (const line of lines) {
          if (line.includes('### Tasks')) inTasks = true;
          else if (line.includes('### Files Modified')) { inTasks = false; inFiles = true; }
          else if (line.includes('### Tools Used')) { inFiles = false; toolsLine = line; }
          else if (line.startsWith('##')) { inTasks = false; inFiles = false; }
          else if (inTasks && line.startsWith('- ')) tasks.push(line.substring(2).trim());
          else if (inFiles && line.startsWith('- ')) filesModified.push(line.substring(2).trim());
        }

        const toolsUsed = toolsLine.replace(/### Tools Used\s*/i, '').split(',').map(t => t.trim()).filter(t => t);

        return { tasks, filesModified, toolsUsed };
      }
    }

    return { tasks: [], filesModified: [], toolsUsed: [] };
  } catch (err) {
    return { tasks: [], filesModified: [], toolsUsed: [] };
  }
}

// 读取最近的命令
async function getRecentCommands(limit = 10) {
  try {
    const logPath = path.join(os.homedir(), '.claude', 'bash-commands.log');
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line);

    const commands = lines
      .map(line => {
        const match = line.match(/^\[(.*?)\] (.+)$/);
        if (match) {
          return { timestamp: match[1], command: match[2] };
        }
        return null;
      })
      .filter(cmd => cmd !== null);

    return commands.slice(-limit);
  } catch (err) {
    return [];
  }
}

class ClaudeSessionDetector {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    this.lastStateHash = null;
    this.pollTimer = null;
    this.pidCache = new Map();
  }

  start() {
    console.log('[SessionDetector] Starting...');
    this.poll().then(() => {
      console.log('[SessionDetector] Initial poll completed');
    });
    this.pollTimer = setInterval(() => this.poll(), 2500);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[SessionDetector] Stopped');
    }
  }

  async poll() {
    try {
      const state = await this.detectSessions();
      const stateHash = JSON.stringify(state);

      if (stateHash !== this.lastStateHash) {
        this.lastStateHash = stateHash;
        console.log('[SessionDetector] State changed:', state);
        this.broadcast({ type: 'claude_status', ...state });
      }
    } catch (err) {
      console.error('[SessionDetector] Poll error:', err.message);
    }
  }

  async detectSessions() {
    console.log('[SessionDetector] detectSessions called, sessionsDir:', this.sessionsDir);
    let files;
    try {
      files = await fs.readdir(this.sessionsDir);
      console.log('[SessionDetector] Found files:', files.length);
    } catch (err) {
      console.log('[SessionDetector] Failed to read sessions dir:', err.message);
      return { active: false };
    }

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    if (!jsonFiles.length) return { active: false };

    const sessions = [];
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(this.sessionsDir, file), 'utf8');
        const session = JSON.parse(content);
        if (session.pid) sessions.push(session);
      } catch {
        continue;
      }
    }

    if (!sessions.length) return { active: false };

    const alivePids = await this.getAlivePids();
    const validSessions = sessions.filter(s => alivePids.has(s.pid));

    if (!validSessions.length) return { active: false };

    const s = validSessions[0];
    const projectName = s.name || path.basename(s.cwd);

    const userInputs = await getUserInputHistory(s.sessionId);
    const summary = await getSessionSummary();
    const recentCommands = await getRecentCommands();

    return {
      active: true,
      status: s.status || 'unknown',
      cwd: s.cwd,
      pid: s.pid,
      projectName: projectName,
      sessionId: s.sessionId,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
      userInputs: userInputs,
      summary: summary,
      recentCommands: recentCommands
    };
  }

  async getAlivePids() {
    const now = Date.now();
    const alivePids = new Set();

    try {
      const { stdout } = await execAsync('tasklist /NH /FO CSV');
      const lines = stdout.split('\n');

      for (const line of lines) {
        const match = line.match(/^"[^"]*","(\d+)"/);
        if (match) {
          const pid = parseInt(match[1]);
          alivePids.add(pid);
          this.pidCache.set(pid, { valid: true, checkedAt: now });
        }
      }
    } catch (err) {
      console.error('[SessionDetector] tasklist failed:', err.message);
    }

    for (const [pid, cache] of this.pidCache.entries()) {
      if (now - cache.checkedAt > 30000) {
        this.pidCache.delete(pid);
      }
    }

    return alivePids;
  }
}

module.exports = ClaudeSessionDetector;
