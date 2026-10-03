const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const execAsync = promisify(exec);

// 会话注册表（~/.claude/sessions/*.json）在某些版本里是空的（本机 2026-10-02 实测为空），
// 那时改用 transcript（~/.claude/projects/<slug>/<sessionId>.jsonl）反推「还有哪些会话、目录在哪」。
const TRANSCRIPT_LIMIT = 10;              // 只列最近 10 个，够用，也不必每次 stat 全部 164 个文件
const TRANSCRIPT_HEAD_BYTES = 64 * 1024;  // cwd 字段实测出现在 ~16KB 处，64KB 留足余量
const TRANSCRIPT_CACHE_MS = 30000;        // detector 每 2.5s 轮询一次，扫描结果缓存 30s

// 读取用户输入历史（可按 homeDir 注入，便于测试）
async function getUserInputHistory(sessionId, limit = 20, homeDir = os.homedir()) {
  try {
    const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
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

// 一次性读取全部历史并按 sessionId 分组（避免每会话重复读文件）
async function getAllUserInputHistory(limit = 20, homeDir = os.homedir()) {
  const map = new Map();
  try {
    const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
    const content = await fs.readFile(historyPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.sessionId) continue;
        if (!map.has(entry.sessionId)) map.set(entry.sessionId, []);
        map.get(entry.sessionId).push({
          display: entry.display,
          timestamp: entry.timestamp,
          project: entry.project
        });
      } catch (e) {}
    }
    for (const [sid, list] of map.entries()) {
      map.set(sid, list.slice(-limit));
    }
  } catch (err) {}
  return map;
}

// 读取会话摘要
async function getSessionSummary(homeDir = os.homedir()) {
  try {
    const sessionDataDir = path.join(homeDir, '.claude', 'session-data');
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

        const toolsUsed = toolsLine.replace(/### Tools Used\s*:?\s*/i, '').split(',').map(t => t.trim()).filter(t => t);

        return { tasks, filesModified, toolsUsed };
      }
    }

    return { tasks: [], filesModified: [], toolsUsed: [] };
  } catch (err) {
    return { tasks: [], filesModified: [], toolsUsed: [] };
  }
}

// 读取最近的命令
async function getRecentCommands(limit = 10, homeDir = os.homedir()) {
  try {
    const logPath = path.join(homeDir, '.claude', 'bash-commands.log');
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

/** 从 transcript 头部文本里抽 cwd（同一行还带 sessionId / version / gitBranch）。 */
function parseTranscriptCwd(head) {
  const match = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (e) {
    return null;
  }
}

/** 默认进程存活检测：tasklist，带 30s 缓存。 */
function defaultIsProcessAlive() {
  const pidCache = new Map();
  return async function isProcessAlive(pid) {
    const now = Date.now();
    const cached = pidCache.get(pid);
    if (cached && now - cached.checkedAt < 30000) return cached.valid;

    try {
      const { stdout } = await execAsync('tasklist /NH /FO CSV');
      const lines = stdout.split('\n');
      const alivePids = new Set();
      for (const line of lines) {
        const match = line.match(/^"[^"]*","(\d+)"/);
        if (match) alivePids.add(parseInt(match[1]));
      }
      // 刷新缓存
      for (const p of alivePids) pidCache.set(p, { valid: true, checkedAt: now });
      for (const [p, cache] of pidCache.entries()) {
        if (now - cache.checkedAt > 30000) pidCache.delete(p);
      }
      return alivePids.has(pid);
    } catch (err) {
      console.error('[SessionDetector] tasklist failed:', err.message);
      return true; // 无法检测时默认视为存活，避免误报离线
    }
  };
}

class ClaudeSessionDetector {
  /**
   * @param {function} broadcastFn 状态变化时回调（接收 claude_status 消息）
   * @param {object} [options]
   * @param {string} [options.homeDir] Claude 数据目录的宿主目录（默认 os.homedir()）
   * @param {(pid:number)=>Promise<boolean>} [options.isProcessAlive] 进程存活检测（可注入）
   * @param {number} [options.pollInterval] 轮询间隔 ms（默认 2500）
   */
  constructor(broadcastFn, options = {}) {
    this.broadcast = broadcastFn;
    this.homeDir = options.homeDir || os.homedir();
    this.isProcessAlive = options.isProcessAlive || defaultIsProcessAlive();
    this.pollInterval = options.pollInterval || 2500;
    this.sessionsDir = path.join(this.homeDir, '.claude', 'sessions');
    this.lastStateHash = null;
    this.lastState = { active: false, sessions: [] };
    this.transcriptCache = null;
    this.pollTimer = null;
  }

  start() {
    console.log('[SessionDetector] Starting...');
    this.poll().then(() => {
      console.log('[SessionDetector] Initial poll completed');
    });
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[SessionDetector] Stopped');
    }
  }

  /** 最近一次检测状态（供 /api/status 等使用）。 */
  getLastState() {
    return this.lastState;
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

  /** 读取 sessions 目录下的会话文件（含 pid）。 */
  async readSessionFiles() {
    let files;
    try {
      files = await fs.readdir(this.sessionsDir);
    } catch (err) {
      return [];
    }
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const sessions = [];
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(this.sessionsDir, file), 'utf8');
        const session = JSON.parse(content);
        if (session && session.pid) sessions.push(session);
      } catch (e) {
        // 损坏文件跳过
      }
    }
    return sessions;
  }

  /** 扫描 ~/.claude/projects/<slug>/*.jsonl，按最后修改时间倒序取最近若干个。 */
  async readTranscripts() {
    const projectsDir = path.join(this.homeDir, '.claude', 'projects');
    let slugs;
    try {
      slugs = await fs.readdir(projectsDir, { withFileTypes: true });
    } catch (err) {
      return [];
    }

    const files = [];
    for (const slug of slugs) {
      if (!slug.isDirectory()) continue;
      const dir = path.join(projectsDir, slug.name);
      let names;
      try {
        names = await fs.readdir(dir);
      } catch (err) {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        try {
          const stat = await fs.stat(file);
          files.push({ file, sessionId: name.slice(0, -'.jsonl'.length), mtime: stat.mtime });
        } catch (err) {
          // 文件刚被清理，跳过
        }
      }
    }

    files.sort((a, b) => b.mtime - a.mtime);

    const sessions = [];
    for (const item of files.slice(0, TRANSCRIPT_LIMIT)) {
      const cwd = await this.readTranscriptCwd(item.file);
      // 拿不到 cwd 就没法在正确目录里 --resume，这种条目直接丢掉
      if (!cwd) continue;
      sessions.push({
        sessionId: item.sessionId,
        pid: null,
        cwd,
        projectName: path.basename(cwd),
        status: 'unknown',
        startedAt: null,
        updatedAt: item.mtime.toISOString(),
        userInputs: [],
        live: false,
        source: 'transcript'
      });
    }
    return sessions;
  }

  /** 只读 transcript 头部若干 KB（完整文件可能几 MB）。 */
  async readTranscriptCwd(file) {
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const buf = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
      const { bytesRead } = await handle.read(buf, 0, TRANSCRIPT_HEAD_BYTES, 0);
      return parseTranscriptCwd(buf.subarray(0, bytesRead).toString('utf8'));
    } catch (err) {
      return null;
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  /** transcript 扫描带缓存：轮询 2.5s 一次，每次 stat 完所有 transcript 太浪费。 */
  async readTranscriptsCached() {
    const now = Date.now();
    if (this.transcriptCache && now - this.transcriptCache.at < TRANSCRIPT_CACHE_MS) {
      return this.transcriptCache.list;
    }
    const list = await this.readTranscripts();
    this.transcriptCache = { at: now, list };
    return list;
  }

  /** 检测全部会话（注册表里的活进程 ∪ transcript 里的最近会话），按最后活动倒序。 */
  async detectSessions() {
    const registry = await this.readSessionFiles();
    const aliveResults = await Promise.all(
      registry.map(async (s) => ({ session: s, alive: await this.isProcessAlive(s.pid) }))
    );
    const liveSessions = aliveResults
      .filter(r => r.alive)
      .map(r => Object.assign({}, r.session, { live: true, source: 'registry' }));

    // 注册表为空（本机实测为空）时靠 transcript 兜底；id 已在注册表里的以注册表为准
    const seen = new Set(liveSessions.map(s => s.sessionId));
    const transcripts = (await this.readTranscriptsCached()).filter(t => !seen.has(t.sessionId));
    const merged = liveSessions.concat(transcripts).sort((a, b) => {
      const at = Date.parse(a.updatedAt || a.startedAt || 0);
      const bt = Date.parse(b.updatedAt || b.startedAt || 0);
      return bt - at;
    });

    if (!merged.length) {
      this.lastState = { active: false, sessions: [] };
      return this.lastState;
    }

    const historyMap = await getAllUserInputHistory(20, this.homeDir);
    const summary = await getSessionSummary(this.homeDir);
    const recentCommands = await getRecentCommands(10, this.homeDir);

    const sessionInfos = merged.map(s => ({
      sessionId: s.sessionId,
      pid: s.pid || null,
      cwd: s.cwd,
      projectName: s.name || path.basename(s.cwd || ''),
      status: s.status || 'unknown',
      startedAt: s.startedAt || null,
      updatedAt: s.updatedAt || s.startedAt || null,
      userInputs: historyMap.get(s.sessionId) || [],
      live: Boolean(s.live),
      source: s.source || 'registry'
    }));

    const primary = merged[0];
    const state = {
      active: true,
      status: primary.status || 'unknown',
      cwd: primary.cwd,
      pid: primary.pid || null,
      live: Boolean(primary.live),
      projectName: primary.name || path.basename(primary.cwd || ''),
      sessionId: primary.sessionId,
      startedAt: primary.startedAt || null,
      updatedAt: primary.updatedAt || primary.startedAt || null,
      userInputs: sessionInfos[0].userInputs,
      summary,
      recentCommands,
      sessions: sessionInfos
    };
    this.lastState = state;
    return state;
  }
}

module.exports = ClaudeSessionDetector;
module.exports.getUserInputHistory = getUserInputHistory;
module.exports.getSessionSummary = getSessionSummary;
module.exports.getRecentCommands = getRecentCommands;
module.exports.getAllUserInputHistory = getAllUserInputHistory;
module.exports.defaultIsProcessAlive = defaultIsProcessAlive;
