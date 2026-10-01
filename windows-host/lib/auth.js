'use strict';
/**
 * ClaudeLink 访问令牌认证。
 * 默认免认证；设置环境变量 ACCESS_TOKEN 后启用（连接需 ?token= 或 Bearer）。
 * 比较使用 SHA-256 摘要 + timingSafeEqual（恒定时间），避免时序攻击。
 */
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest();
}

/** 恒定时间字符串比较（先哈希对齐长度）。 */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = hashToken(a);
  const hb = hashToken(b);
  if (ha.length !== hb.length) return false;
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * 日志里代替令牌显示的指纹（前 8 位十六进制）。启动横幅只打印它：
 * ACCESS_TOKEN 在 .env 里，用户不需要从日志里抄；而 start.bat 把 stdout 重定向进
 * server.log，打印明文等于让令牌落盘（README「令牌只保存在环境变量，不落盘」）。
 * @param {string|null} token
 * @returns {string}
 */
function tokenFingerprint(token) {
  if (!token) return '未设置';
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 8);
}

/**
 * 从请求里取令牌：优先 `Authorization: Bearer`，退回 `?token=`。
 * 头优先是因为 URL 会被写进服务端/代理/隧道（ngrok inspector）日志，头不会；
 * 但浏览器无法给 WebSocket 握手加自定义头，所以查询参数必须继续支持。
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function extractToken(req) {
  const header = (req && req.headers && req.headers.authorization) || '';
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null;
  if (match) return match[1].trim();
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('token');
  } catch (e) {
    return null;
  }
}

/**
 * 请求是否通过认证。HTTP 请求与 WebSocket 升级握手共用这一条判据（server.js:229、http-handler.js）。
 * @param {import('http').IncomingMessage} req
 * @param {{verify:(t:any)=>boolean}} auth
 */
function isAuthorized(req, auth) {
  return auth.verify(extractToken(req));
}

function createAuth() {
  const token = (process.env.ACCESS_TOKEN || '').trim();
  if (!token) {
    return { enabled: false, token: null, verify: () => true };
  }
  return {
    enabled: true,
    token,
    verify(candidate) { return timingSafeEqualStr(candidate, token); }
  };
}

module.exports = { createAuth, timingSafeEqualStr, tokenFingerprint, extractToken, isAuthorized };
