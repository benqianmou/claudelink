'use strict';
/**
 * HTTP 请求处理器：静态文件（防路径穿越）+ 受保护 API。
 * 认证范围：所有 /api/* 需 Bearer token 或 ?token= 查询参数；
 * 静态页面与资源不受限（便于用户在浏览器输入令牌）。
 */
const fs = require('fs');
const path = require('path');
const { isAuthorized } = require('./auth');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/**
 * 创建请求处理器。
 * @param {object} options
 * @param {string} options.publicDir 静态资源根目录（绝对路径）
 * @param {{verify:(t:string)=>boolean}} options.auth 认证实例
 * @param {()=>object} options.getStatus 返回 /api/status 负载（不含 version/ok）
 * @param {string} [options.version] 服务版本号
 */
function createHttpHandler(options) {
  const { publicDir, auth, getStatus, version = 'unknown' } = options;
  const publicRoot = path.resolve(publicDir);

  return function handleRequest(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    // ---- API（受认证保护）----
    if (pathname === '/api/status') {
      if (!isAuthorized(req, auth)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const status = typeof getStatus === 'function' ? getStatus() : {};
      sendJson(res, 200, { ok: true, ...status, version });
      return;
    }
    if (pathname.startsWith('/api/')) {
      if (!isAuthorized(req, auth)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    // ---- 静态文件（防路径穿越）----
    let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (relative.includes('\0') || relative.split('/').includes('..')) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const fullPath = path.resolve(publicRoot, relative);
    if (fullPath !== publicRoot && !fullPath.startsWith(publicRoot + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  };
}

module.exports = { createHttpHandler, CONTENT_TYPES };
