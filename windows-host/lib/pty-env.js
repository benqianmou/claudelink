'use strict';

/**
 * 构建 PTY 子进程（claude.exe）的环境变量。
 *
 * 背景：宿主进程可能携带 NO_COLOR=1 —— 某些终端、CI、沙箱环境会设置它，
 * claude.exe 继承后遵循 NO_COLOR 约定禁用所有 ANSI 颜色，
 * WebUI 终端就会变成黑白。这里剥离该变量并显式声明终端色彩能力，
 * 保证显示效果与服务器从哪里启动无关。
 */
function buildPtyEnv(base = process.env) {
  const env = { ...base };
  delete env.NO_COLOR; // 剥离宿主环境注入的单色开关
  if (!env.TERM || env.TERM === 'dumb') {
    env.TERM = 'xterm-256color'; // dumb/缺失视为无效，声明 256 色终端
  }
  if (!env.COLORTERM) {
    env.COLORTERM = 'truecolor'; // Claude Code 按此启用 24 位主题色
  }
  return env;
}

module.exports = { buildPtyEnv };
