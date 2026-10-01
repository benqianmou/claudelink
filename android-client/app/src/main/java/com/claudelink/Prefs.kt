package com.claudelink

/**
 * SharedPreferences 的文件名与键名集中一处。
 * 此前 MainActivity 与 TaskManager 各写了一份 "claudelink"（code-review 的 Duplicated Code 发现）。
 */
object Prefs {
    const val FILE = "claudelink"
    const val KEY_TASKS = "claudelink_tasks"
    const val KEY_SERVER = "server"

    /** 历史连接地址，存 JSON 数组 */
    const val KEY_SERVERS = "servers"
    const val KEY_TOKEN = "token"

    /**
     * 终端字号（单位 sp）。键名已经换过两次，改动原因都写在这：
     * 1. 第一代 `fontSp` 存的是 **px** 数值 —— 单位一换还读同一把键，用户按 A＋ 存下的 22 会被当成 22sp。
     * 2. 第二代 `font_sp` 存的是**被 density 放大过的 sp** —— 那一版 TerminalView 把
     *    `textSize = spToPx(x)` 塞进了收 sp 的属性 setter（getter 给 px、setter 收 sp，单位不对称），
     *    于是用户按一次 A＋ 存下来的是「实际想设的值 × density」。换算修好之后这批存档全是偏大的，
     *    读回来会把字顶到上限，所以这一代键也作废。
     */
    const val KEY_FONT_SP = "font_sp_v2"
}
