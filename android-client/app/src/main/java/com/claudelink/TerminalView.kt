package com.claudelink

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.util.AttributeSet
import android.util.TypedValue
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import androidx.core.content.ContextCompat

/**
 * 终端显示。内容在 [TerminalScreen]（二维格 + 光标），这里只负责把它画出来。
 *
 * **为什么是自绘，而不是用 TextView 拼 Spannable**：
 * 1. 终端是「一格一字」的网格，TextView 却是让它自己排版 —— 只要某个字形（回退字体里的制表符、
 *    emoji）的实际宽度不等于单元格宽度，它后面同一行的所有字符就整体位移，用户看到的就是
 *    「输入框横杠串位」。自绘把每个字画在「列号 × 格宽」的位置上，字形宽一点只是相邻两格轻微
 *    重叠，永远不会把后面的字推走。
 * 2. 每来一块输出就 `text = spannable` 会让整篇文字重新排版（最坏 400 行回滚 + 120 行可见），
 *    输出流是几十上百帧每秒，屏幕就会闪。自绘只要 `invalidate()`，一帧最多画一次，不碰文字布局。
 */
class TerminalView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val screen = TerminalScreen()

    /**
     * 字体与度量都由自己持有。**sp→px 只在这里换算一次**：`TextView.textSize` 的 setter 收 sp、
     * getter 给 px，历史上就是在那儿把 13sp 当 26sp 写进去，字号被乘了一次 density×fontScale
     * （density 3 的机器上 13sp 变成 39sp）。[TerminalViewSizeTest] 里有一条 xhdpi 用例钉死这点。
     */
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.MONOSPACE
        textSize = spToPx(DEFAULT_FONT_SP)
    }
    private val fillPaint = Paint()

    private var viewport: View? = null
    private var gridCols = 0
    private var gridRows = 0
    private var lastContentHeight = -1

    /** null = 还没人手动调过字号，这时按屏宽自适应；捏合或 A−/A＋ 之后固定为用户选的值 */
    private var userFontSp: Float? = null

    /** 格数变化（首帧/旋转/字号）时通知外面把新尺寸发给服务端 */
    var onResize: ((cols: Int, rows: Int) -> Unit)? = null

    /** 捏合结束时把新字号报给外面持久化（与 A−/A＋ 共用同一个 prefs 键） */
    var onFontChanged: ((Float) -> Unit)? = null

    /** 单元格宽度 = 一个正文字符的宽度；所有列都按它定位，不看字形自己的宽度 */
    val cellWidthPx: Float get() = textPaint.measureText("M")

    /** 第 col 格的左边界（含 padding）。绘制与测试都走这里，列位置只由列号决定 */
    fun cellX(col: Int): Float = paddingLeft + col * cellWidthPx

    /** 每行高度；三处（测量、绘制、算行数）必须用同一个值 */
    private val rowHeight: Float get() = maxOf(textPaint.fontSpacing, textPaint.textSize)

    /** 实际字号（px）。测试用它钉「sp→px 只换算一次」 */
    val textSizePx: Float get() = textPaint.textSize

    /** 字号（sp），等价于 web 端的 A−/A＋；读出来是当前实际字号，可能来自自适应 */
    var fontSp: Float
        get() = pxToSp(textPaint.textSize)
        set(value) {
            val size = value.coerceIn(MIN_FONT_SP, MAX_FONT_SP)
            userFontSp = size
            applyFontSp(size)
            syncGrid()
        }

    private val layoutListener = View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, orr, ob ->
        if (r - l != orr - ol || b - t != ob - ot) syncGrid()
    }

    private var pinchStartSp = 0f

    private val scaleDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
                pinchStartSp = fontSp
                return true
            }

            override fun onScale(detector: ScaleGestureDetector): Boolean {
                fontSp = pinchStartSp * detector.scaleFactor
                return true
            }

            override fun onScaleEnd(detector: ScaleGestureDetector) {
                onFontChanged?.invoke(fontSp)
            }
        }
    )

    init {
        applyFontSp(DEFAULT_FONT_SP)
        isFocusable = true
    }

    /** 双指捏合改字号；单指事件照旧交给 View（长按复制、外层滚动） */
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        // 双指期间自己吃掉事件，否则外层 ScrollView 会把捏合当成滚动
        if (event.pointerCount > 1) {
            parent?.requestDisallowInterceptTouchEvent(true)
            return true
        }
        parent?.requestDisallowInterceptTouchEvent(false)
        return super.onTouchEvent(event)
    }

    fun zoomFont(delta: Float) {
        fontSp += delta
    }

    fun bindViewport(v: View) {
        viewport?.removeOnLayoutChangeListener(layoutListener)
        viewport = v
        v.addOnLayoutChangeListener(layoutListener)
        v.post { syncGrid() }
    }

    /** 连上/重连后重新报一次尺寸：服务端只有一个共享 PTY，谁连上谁定尺寸 */
    fun reportGrid() {
        syncGrid()
        if (gridCols > 0) onResize?.invoke(gridCols, gridRows)
    }

    fun writeFrame(data: String) {
        screen.feed(data)
        refresh()
    }

    fun clear() {
        screen.clear()
        refresh()
    }

    /** 回滚区 + 当前屏的纯文本，「长按复制全部输出」用 */
    fun plainText(): String = screen.plainText()

    // ───────────────────────── 绘制 ─────────────────────────

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // 高度按内容算：外面是 ScrollView，回滚区越长它越该滚得动
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), contentHeight())
    }

    private fun contentHeight(): Int =
        (screen.totalRows() * rowHeight).toInt() + paddingTop + paddingBottom

    /** 内容变了：重画；只有内容高度真的变了才重新测量（否则每帧都 requestLayout） */
    private fun refresh() {
        invalidate()
        val height = contentHeight()
        if (height != lastContentHeight) {
            lastContentHeight = height
            requestLayout()
        }
    }

    override fun onDraw(canvas: Canvas) {
        val defaultFg = ContextCompat.getColor(context, R.color.terminal_text)
        val defaultBg = ContextCompat.getColor(context, R.color.terminal_bg)
        val cellW = cellWidthPx
        val lineH = rowHeight
        if (cellW <= 0f || lineH <= 0f) return

        val top = paddingTop.toFloat()
        val baselineOffset = -textPaint.fontMetrics.top
        val total = screen.totalRows()
        val cols = screen.cols
        val clip = canvas.clipBounds ?: return
        val firstRow = maxOf(0, ((clip.top - top) / lineH).toInt())
        val lastRow = minOf(total - 1, ((clip.bottom - top) / lineH).toInt())

        for (row in firstRow..lastRow) {
            val cells = screen.rowAt(row)
            if (cells.isEmpty()) continue
            val y = top + row * lineH
            val limit = minOf(cols, cells.size)
            var col = 0
            while (col < limit) {
                val cell = cells[col]
                var fg = if (cell.fg == TerminalScreen.NO_COLOR) defaultFg else cell.fg
                var bg = if (cell.bg == TerminalScreen.NO_COLOR) defaultBg else cell.bg
                if (cell.reverse) {
                    val swap = fg
                    fg = bg
                    bg = swap
                }
                if (bg != defaultBg) {
                    fillPaint.color = bg
                    canvas.drawRect(cellX(col), y, cellX(col + 1), y + lineH, fillPaint)
                }
                val ch = cell.ch
                if (ch != ' ' && ch != TerminalScreen.WIDE_TAIL) {
                    val low = if (col + 1 < limit) cells[col + 1].ch else ' '
                    textPaint.color = fg
                    textPaint.isFakeBoldText = cell.bold
                    // 非 BMP 的字符在网格里占两格（两个 Char）：必须整对画，否则画出半个代理对
                    if (ch.isHighSurrogate() && low.isLowSurrogate()) {
                        canvas.drawText("$ch$low", cellX(col), y + baselineOffset, textPaint)
                        col++
                    } else {
                        canvas.drawText(ch.toString(), cellX(col), y + baselineOffset, textPaint)
                    }
                }
                col++
            }
        }
    }

    // ───────────────────────── 尺寸 ─────────────────────────

    private fun syncGrid() {
        val vp = viewport ?: return
        val width = vp.width - vp.paddingLeft - vp.paddingRight
        val height = vp.height - vp.paddingTop - vp.paddingBottom
        if (width <= 0 || height <= 0) return
        if (userFontSp == null) applyAdaptiveFont(width)
        val cellW = cellWidthPx
        val lineH = rowHeight
        if (cellW <= 0f || lineH <= 0f) return
        val cols = (width / cellW).toInt().coerceIn(MIN_COLS, MAX_COLS)
        val rows = (height / lineH).toInt().coerceIn(MIN_ROWS, MAX_ROWS)
        if (cols != gridCols || rows != gridRows) {
            gridCols = cols
            gridRows = rows
            screen.resize(cols, rows)
            onResize?.invoke(cols, rows)
        }
        refresh()
    }

    /** 自适应：按屏宽挑一个能让 [TARGET_COLS] 列铺满的字号（列数少于 TUI 的排版宽度就会折行错位） */
    private fun applyAdaptiveFont(width: Int) {
        val cellW = cellWidthPx
        if (cellW <= 0f) return
        val fitted = fitFontSp(fontSp, width / cellW)
        if (fitted != fontSp) applyFontSp(fitted)
    }

    private fun applyFontSp(sp: Float) {
        textPaint.textSize = spToPx(sp)
    }

    private fun spToPx(sp: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, resources.displayMetrics)

    private fun pxToSp(px: Float): Float = px / spToPx(1f)

    companion object {
        const val DEFAULT_FONT_SP = 13f
        const val MIN_FONT_SP = 8f
        const val MAX_FONT_SP = 22f

        /**
         * 自适应的目标列数。手机竖屏塞 80 列要把字压到 8sp 以下，读起来太吃力，
         * 取 60（经典窄终端宽度）：够 TUI 排版，字号也还看得清。
         * 这是偏好不是硬指标：算出来的字号低于 [MIN_FONT_SP] 时保可读性，宁可少于 60 列。
         * 捏合或 A−/A＋ 调过之后就不再走自适应。
         */
        const val TARGET_COLS = 60

        private const val MIN_COLS = 20
        private const val MAX_COLS = 240
        private const val MIN_ROWS = 4
        private const val MAX_ROWS = 120

        /**
         * 自适应字号：当前 [currentSp] 下只放得下 [cols] 列时，要铺满 [targetCols] 列该用多大。
         * 字符宽与字号成正比，所以一次就收敛；结果夹在 [MIN_FONT_SP]（保可读，宁可列数不够）
         * 与 [DEFAULT_FONT_SP]（宽屏不放大，列数只会更多）之间。
         */
        fun fitFontSp(currentSp: Float, cols: Float, targetCols: Int = TARGET_COLS): Float =
            (currentSp * cols / targetCols).coerceIn(MIN_FONT_SP, DEFAULT_FONT_SP)
    }
}
