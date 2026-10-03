const fs = require('fs');
const os = require('os');
const path = require('path');

// 「打开 web UI 时该接哪个会话」的纯逻辑。用户 2026-10-02 拍板：记忆 > 最近活跃 > 新建。
// 目标形状：{ cwd, sessionId, fork }；sessionId 为 null = 在默认目录（家目录）开新会话。
// fork = 目标进程还活着时加 --fork-session，避免两份进程写同一份 transcript。

// 运行时状态放家目录，不给仓库留未跟踪文件；测试用 SESSION_TARGET_FILE 指向临时文件。
const TARGET_FILE = process.env.SESSION_TARGET_FILE
  || path.join(os.homedir(), '.claudelink', 'session-target.json');

/** 读上次选中的会话；文件不存在/损坏/形状不对都当作「没有记忆」。 */
function readTarget(file = TARGET_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && ('sessionId' in raw || 'cwd' in raw)) {
      return { cwd: raw.cwd || null, sessionId: raw.sessionId || null };
    }
  } catch (e) {}
  return null;
}

/** 记住这次的选择。写不进去只影响下次默认值，不该打断切换。 */
function writeTarget(target, file = TARGET_FILE) {
  try {
    const payload = {
      cwd: (target && target.cwd) || null,
      sessionId: (target && target.sessionId) || null
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/** 会话列表按最后活动倒序（detector 已排好，这里只做兜底）。 */
function byUpdatedDesc(a, b) {
  const at = Date.parse(a.updatedAt || a.startedAt || 0) || 0;
  const bt = Date.parse(b.updatedAt || b.startedAt || 0) || 0;
  return bt - at;
}

/**
 * 挑启动目标：记忆里那个还在列表里的 > 最近活跃的 > null（新建）。
 * @param {{remembered?: object, sessions?: Array}} input
 */
function pickTarget({ remembered, sessions } = {}) {
  const list = (Array.isArray(sessions) ? sessions : []).filter(s => s && s.sessionId && s.cwd);

  if (remembered && remembered.sessionId) {
    const hit = list.find(s => s.sessionId === remembered.sessionId);
    if (hit) return { cwd: hit.cwd, sessionId: hit.sessionId, fork: Boolean(hit.live) };
  }

  // 上次明确选的是「新建」→ 这层记忆也要兑现
  if (remembered && !remembered.sessionId) return null;

  const newest = list.slice().sort(byUpdatedDesc)[0];
  return newest ? { cwd: newest.cwd, sessionId: newest.sessionId, fork: Boolean(newest.live) } : null;
}

/**
 * 把客户端的切换请求解析成可信目标：只认 detector 列表里的会话，
 * 客户端给的 cwd 一律不采信（否则等于开放任意目录启动进程）。
 * @param {string|null} sessionId null = 开新会话
 * @param {{sessions?: Array}} state detector 的最近状态
 * @returns {{cwd, sessionId, fork}|null} null = 该会话已不存在
 */
function resolveSwitch(sessionId, state) {
  if (sessionId == null) return { cwd: null, sessionId: null, fork: false };

  const list = ((state && state.sessions) || []).filter(s => s && s.sessionId && s.cwd);
  const hit = list.find(s => s.sessionId === sessionId);
  if (!hit) return null;

  return { cwd: hit.cwd, sessionId: hit.sessionId, fork: Boolean(hit.live) };
}

module.exports = { pickTarget, resolveSwitch, readTarget, writeTarget, TARGET_FILE };
