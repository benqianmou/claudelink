package com.claudelink

/**
 * 最小 VT 屏幕模型（纯 Kotlin，无 Android 依赖，JVM 直接可测）。
 *
 * 为什么非要有它：claude 的 TUI 是靠「光标定位 + 擦到行尾」重绘界面的 —— 抓下来的原始流里
 * `CSI 1C`（光标右移当空格用）出现 58 次、`CSI K` 3 次、CUP 8 次。纯追加文本的渲染会把这些
 * 语义全丢掉：右移不留空格 → 词粘成一坨；擦行/定位不生效 → 每次重绘叠一层残影。这就是乱码。
 *
 * 只实现实测出现过的序列，不做滚动区、备用屏、鼠标上报。
 */
class TerminalScreen(cols: Int = DEFAULT_COLS, rows: Int = DEFAULT_ROWS) {

    /** 一格；fg/bg 为 [NO_COLOR] 时用主题默认色 */
    class Cell(
        var ch: Char = ' ',
        var fg: Int = NO_COLOR,
        var bg: Int = NO_COLOR,
        var bold: Boolean = false,
        var reverse: Boolean = false
    ) {
        fun reset() {
            ch = ' '
            fg = NO_COLOR
            bg = NO_COLOR
            bold = false
            reverse = false
        }

        fun copyFrom(other: Cell) {
            ch = other.ch
            fg = other.fg
            bg = other.bg
            bold = other.bold
            reverse = other.reverse
        }
    }

    var cols = cols
        private set
    var rows = rows
        private set

    private var grid = MutableList(rows) { MutableList(cols) { Cell() } }
    private val scrollback = ArrayList<List<Cell>>()
    private val pending = StringBuilder()   // 跨 chunk 没收全的转义序列

    private var cursorRow = 0
    private var cursorCol = 0
    private var savedRow = 0
    private var savedCol = 0
    private var wrapPending = false
    private var fg = NO_COLOR
    private var bg = NO_COLOR
    private var bold = false
    private var reverse = false

    // ───────────────────────── 查询（测试用） ─────────────────────────

    val cursor: Pair<Int, Int> get() = cursorRow to cursorCol
    val scrollbackSize: Int get() = scrollback.size

    fun cellAt(row: Int, col: Int): Cell = grid[row][col]

    /** 整屏行数（回滚区 + 可见区）—— View 拿它算内容高度，ScrollView 才有得滚 */
    fun totalRows(): Int = scrollback.size + rows

    /** 第 index 行的格子，0 是回滚区最早的一行；越界给空行（View 只画看得见的那几行） */
    fun rowAt(index: Int): List<Cell> = when {
        index < 0 -> emptyList()
        index < scrollback.size -> scrollback[index]
        index - scrollback.size < grid.size -> grid[index - scrollback.size]
        else -> emptyList()
    }

    /** 第 index 行的纯文本（行尾空白已裁） */
    fun rowTextAt(index: Int): String = rowText(rowAt(index))

    /** 去掉每行行尾空白与末尾空行后的纯文本（「复制全部输出」用） */
    fun plainText(): String =
        (scrollback.map { rowText(it) } + grid.map { rowText(it) }).joinToString("\n").trimEnd()

    private fun rowText(cells: List<Cell>): String {
        val sb = StringBuilder()
        cells.forEach { if (it.ch != WIDE_TAIL) sb.append(it.ch) }
        return sb.toString().trimEnd()
    }

    // ───────────────────────── 输入 ─────────────────────────

    fun clear() {
        grid.forEach { row -> row.forEach { it.reset() } }
        scrollback.clear()
        cursorRow = 0
        cursorCol = 0
        wrapPending = false
    }

    /** 换尺寸：内容按左上角对齐保留（TUI 会自己收到 SIGWINCH 重绘） */
    fun resize(newCols: Int, newRows: Int) {
        if (newCols == cols && newRows == rows) return
        val next = MutableList(newRows) { MutableList(newCols) { Cell() } }
        for (r in 0 until minOf(rows, newRows)) {
            for (c in 0 until minOf(cols, newCols)) next[r][c].copyFrom(grid[r][c])
        }
        grid = next
        cols = newCols
        rows = newRows
        cursorRow = cursorRow.coerceIn(0, rows - 1)
        cursorCol = cursorCol.coerceIn(0, cols - 1)
    }

    fun feed(data: String) {
        pending.append(data)
        val s = pending
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == ESC -> {
                    val consumed = parseAt(s, i)
                    if (consumed < 0) break      // 序列没收全，留在 pending 等下一块
                    i += consumed
                }
                c == '\n' -> { cursorCol = 0; newline(); i++ }
                c == '\r' -> { cursorCol = 0; wrapPending = false; i++ }
                c == '\b' -> { if (cursorCol > 0) cursorCol--; i++ }
                c == '\t' -> { cursorCol = minOf(cols - 1, (cursorCol / 8 + 1) * 8); i++ }
                c < ' ' -> i++                   // 其余 C0（BEL 等）忽略
                else -> { put(c); i++ }
            }
        }
        s.delete(0, i)
        // 兜底：真收到一个永远结束不了的转义序列时别把 pending 撑爆
        if (s.length > MAX_PENDING) s.setLength(0)
    }

    private fun put(c: Char) {
        if (wrapPending) { wrapPending = false; cursorCol = 0; newline() }
        val width = charWidth(c)
        // 宽字符塞不进最后一个格子时整字换行（终端就是这么干的）
        if (width == 2 && cursorCol == cols - 1) { cursorCol = 0; newline() }
        val row = grid[cursorRow]
        row[cursorCol].set(c, fg, bg, bold, reverse)
        if (width == 2 && cursorCol + 1 < cols) {
            row[cursorCol + 1].set(WIDE_TAIL, fg, bg, bold, reverse)
        }
        cursorCol += width
        if (cursorCol >= cols) { cursorCol = cols - 1; wrapPending = true }
    }

    /** 扩展函数式的小工具，避免每处都写 5 个赋值 */
    private fun Cell.set(ch: Char, f: Int, b: Int, bo: Boolean, rev: Boolean) {
        this.ch = ch
        this.fg = f
        this.bg = b
        this.bold = bo
        this.reverse = rev
    }

    private fun newline() {
        cursorRow++
        if (cursorRow >= rows) {
            cursorRow = rows - 1
            scrollback.add(grid.removeAt(0))
            if (scrollback.size > MAX_SCROLLBACK) scrollback.removeAt(0)
            grid.add(MutableList(cols) { Cell() })
        }
    }

    private fun scrollUp() {
        scrollback.add(grid.removeAt(0))
        if (scrollback.size > MAX_SCROLLBACK) scrollback.removeAt(0)
        grid.add(MutableList(cols) { Cell() })
    }

    private fun scrollDown() {
        grid.removeAt(grid.size - 1)
        grid.add(0, MutableList(cols) { Cell() })
    }

    // ───────────────────────── 转义序列 ─────────────────────────

    /** 返回消耗的字符数；-1 表示这块数据还没收全，等下一块 */
    private fun parseAt(s: CharSequence, start: Int): Int {
        if (start + 1 >= s.length) return -1
        return when (s[start + 1]) {
            '[' -> parseCsi(s, start)
            ']' -> parseOsc(s, start)
            '(', ')', '*', '+', '#', '%', '$' -> if (start + 2 < s.length) 3 else -1
            else -> 2                            // ESC 7/8/=/M/c… 单字符序列
        }
    }

    private fun parseCsi(s: CharSequence, start: Int): Int {
        var i = start + 2
        val params = StringBuilder()
        while (i < s.length && s[i] in '0'..'?') { params.append(s[i]); i++ }
        while (i < s.length && s[i] in ' '..'/') i++          // 中间字节
        if (i >= s.length) return -1
        val final = s[i]
        if (final !in '@'..'~') return i + 1 - start          // 畸形序列，直接吞掉
        dispatchCsi(params.toString(), final)
        return i + 1 - start
    }

    private fun parseOsc(s: CharSequence, start: Int): Int {
        var i = start + 2
        while (i < s.length) {
            if (s[i] == '\u0007') return i + 1 - start        // BEL 结束
            if (s[i] == ESC) {
                if (i + 1 >= s.length) return -1
                // ST（ESC \）结束；其它 ESC 说明 OSC 断了，退回去当普通转义处理
                return if (s[i + 1] == '\\') i + 2 - start else i - start
            }
            i++
        }
        if (s.length - start > MAX_OSC) return s.length - start
        return -1
    }

    private fun dispatchCsi(paramStr: String, final: Char) {
        val priv = paramStr.isNotEmpty() && paramStr[0] in "?><="
        val body = if (priv) paramStr.substring(1) else paramStr
        val nums = if (body.isEmpty()) emptyList() else body.split(';').map { it.toIntOrNull() ?: 0 }
        fun at(i: Int) = nums.getOrNull(i) ?: 0
        fun count(i: Int) = at(i).let { if (it <= 0) 1 else it }   // 缺省/0 当成 1 的几类命令
        fun line(i: Int) = (if (at(i) <= 0) 1 else at(i)) - 1      // 1 基行号
        // 只有「动光标 / 擦内容」的命令才取消待换行。xterm 里 SGR（m）不改光标位置：
        // 若连它也清掉，一整行宽度的制表符写满后紧跟一个 SGR，下一个字符就会盖在最后一列
        // 而不是换行 —— 整条框线会左移一格（用户看到的就是「横杠串位」）。
        if (final in CURSOR_OR_ERASE) wrapPending = false
        when (final) {
            'A' -> cursorRow = (cursorRow - count(0)).coerceAtLeast(0)
            'B' -> cursorRow = (cursorRow + count(0)).coerceAtMost(rows - 1)
            'C' -> cursorCol = (cursorCol + count(0)).coerceAtMost(cols - 1)   // ← 乱码元凶之一：右移必须真的占位
            'D' -> cursorCol = (cursorCol - count(0)).coerceAtLeast(0)
            'E' -> { cursorRow = (cursorRow + count(0)).coerceAtMost(rows - 1); cursorCol = 0 }
            'F' -> { cursorRow = (cursorRow - count(0)).coerceAtLeast(0); cursorCol = 0 }
            'G' -> cursorCol = (count(0) - 1).coerceIn(0, cols - 1)
            'd' -> cursorRow = line(0).coerceIn(0, rows - 1)
            'H', 'f' -> {
                cursorRow = line(0).coerceIn(0, rows - 1)
                cursorCol = line(1).coerceIn(0, cols - 1)
            }
            'J' -> eraseDisplay(at(0))
            'K' -> eraseLine(at(0))
            'm' -> sgr(nums)
            's' -> { savedRow = cursorRow; savedCol = cursorCol }
            'u' -> { cursorRow = savedRow.coerceIn(0, rows - 1); cursorCol = savedCol.coerceIn(0, cols - 1) }
            'P' -> deleteChars(count(0))
            '@' -> insertBlanks(count(0))
            'X' -> eraseChars(count(0))
            'L' -> repeat(count(0)) { grid.add(cursorRow, MutableList(cols) { Cell() }); grid.removeAt(rows) }
            'M' -> repeat(count(0)) {
                grid.removeAt(cursorRow)
                grid.add(MutableList(cols) { Cell() })
            }
            'S' -> repeat(count(0)) { scrollUp() }
            'T' -> repeat(count(0)) { scrollDown() }
            else -> {}   // h/l（含 ?25 光标显隐）、n/c/t/q 等查询：忽略
        }
    }

    private fun eraseLine(mode: Int) {
        val row = grid[cursorRow]
        when (mode) {
            1 -> for (c in 0..cursorCol) row[c].reset()
            2 -> row.forEach { it.reset() }
            else -> for (c in cursorCol until cols) row[c].reset()
        }
    }

    private fun eraseDisplay(mode: Int) {
        when (mode) {
            1 -> {
                for (r in 0 until cursorRow) grid[r].forEach { it.reset() }
                eraseLine(1)
            }
            2, 3 -> {
                grid.forEach { row -> row.forEach { it.reset() } }
                if (mode == 3) scrollback.clear()
            }
            else -> {
                eraseLine(0)
                for (r in cursorRow + 1 until rows) grid[r].forEach { it.reset() }
            }
        }
    }

    private fun deleteChars(n: Int) {
        val row = grid[cursorRow]
        repeat(n.coerceAtMost(cols - cursorCol)) {
            row.removeAt(cursorCol)
            row.add(Cell())
        }
    }

    private fun insertBlanks(n: Int) {
        val row = grid[cursorRow]
        repeat(n.coerceAtMost(cols - cursorCol)) {
            row.add(cursorCol, Cell())
            row.removeAt(cols)
        }
    }

    private fun eraseChars(n: Int) {
        val row = grid[cursorRow]
        for (c in cursorCol until minOf(cols, cursorCol + n)) row[c].reset()
    }

    private fun sgr(nums: List<Int>) {
        if (nums.isEmpty()) { resetAttrs(); return }
        var i = 0
        while (i < nums.size) {
            when (val v = nums[i]) {
                0 -> resetAttrs()
                1 -> bold = true
                22 -> bold = false
                7 -> reverse = true
                27 -> reverse = false
                in 30..37 -> fg = palette(v - 30)
                in 90..97 -> fg = palette(v - 90 + 8)
                39 -> fg = NO_COLOR
                in 40..47 -> bg = palette(v - 40)
                in 100..107 -> bg = palette(v - 100 + 8)
                49 -> bg = NO_COLOR
                38, 48 -> {
                    val target = v
                    when (nums.getOrNull(i + 1)) {
                        5 -> {
                            val c = palette256(nums.getOrNull(i + 2) ?: 0)
                            if (target == 38) fg = c else bg = c
                            i += 2
                        }
                        2 -> {
                            val c = rgb(nums.getOrNull(i + 2) ?: 0, nums.getOrNull(i + 3) ?: 0, nums.getOrNull(i + 4) ?: 0)
                            if (target == 38) fg = c else bg = c
                            i += 4
                        }
                    }
                }
            }
            i++
        }
    }

    private fun resetAttrs() {
        fg = NO_COLOR
        bg = NO_COLOR
        bold = false
        reverse = false
    }

    companion object {
        const val DEFAULT_COLS = 100
        const val DEFAULT_ROWS = 30
        /**
         * 「没有颜色」的哨兵。**不能是 -1**：`PALETTE[15]`（亮白 0xFFFFFFFF）正好也是 -1，
         * 于是亮白会被当成「没设色」画成默认色，反显时还会换错一对颜色。
         * 取 [Int.MIN_VALUE]：调色板与 rgb() 出来的值 alpha 恒为 FF，永远撞不上。
         */
        const val NO_COLOR = Int.MIN_VALUE
        const val WIDE_TAIL = '\u0000'
        /** 会移动光标或改动内容的 CSI 终结符；只有它们该取消待换行状态 */
        private const val CURSOR_OR_ERASE = "ABCDEFGHdfJKLMSTPX@"
        private const val MAX_SCROLLBACK = 400
        private const val MAX_OSC = 2048
        private const val MAX_PENDING = 8192
        private const val ESC = '\u001B'

        /** SGR 16 色（深色底可用；0 号黑按深色主题习惯抬亮成灰，否则黑底黑字看不见） */
        private val PALETTE = intArrayOf(
            0xFF6E7681.toInt(), 0xFFE5484D.toInt(), 0xFF27A644.toInt(), 0xFFD29922.toInt(),
            0xFF5E6AD2.toInt(), 0xFFA371F7.toInt(), 0xFF39C5CF.toInt(), 0xFFF7F8F8.toInt(),
            0xFF8B949E.toInt(), 0xFFFF7B72.toInt(), 0xFF3FB950.toInt(), 0xFFE3B341.toInt(),
            0xFF828FFF.toInt(), 0xFFBC8CFF.toInt(), 0xFF56D4DD.toInt(), 0xFFFFFFFF.toInt()
        )

        private fun palette(i: Int): Int = PALETTE[i.coerceIn(0, PALETTE.size - 1)]

        /** xterm-256：0-15 用调色板，16-231 是 6×6×6 立方，232-255 是灰阶 */
        private fun palette256(i: Int): Int {
            val n = i.coerceIn(0, 255)
            if (n < 16) return palette(n)
            if (n < 232) {
                val v = n - 16
                fun level(x: Int) = if (x == 0) 0 else 55 + x * 40
                return rgb(level(v / 36), level(v / 6 % 6), level(v % 6))
            }
            val g = 8 + (n - 232) * 10
            return rgb(g, g, g)
        }

        private fun rgb(r: Int, g: Int, b: Int): Int =
            0xFF000000.toInt() or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)

        /** CJK / 全角按两格算，否则光标与 TUI 的排版会整体错开 */
        fun charWidth(c: Char): Int {
            val code = c.code
            return when {
                code < 0x1100 -> 1
                code in 0x1100..0x115F -> 2
                code in 0x2E80..0xA4CF -> 2
                code in 0xAC00..0xD7A3 -> 2
                code in 0xF900..0xFAFF -> 2
                code in 0xFE30..0xFE6F -> 2
                code in 0xFF00..0xFF60 -> 2
                code in 0xFFE0..0xFFE6 -> 2
                else -> 1
            }
        }
    }
}
