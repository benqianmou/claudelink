package com.claudelink

import android.content.Context
import android.graphics.Typeface
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatTextView

class TerminalView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : AppCompatTextView(context, attrs) {

    private val ansiParser = AnsiParser()
    private val controlHandler = AnsiControlHandler()
    private val maxLines = 1000

    init {
        typeface = Typeface.MONOSPACE
        textSize = 12f
        setTextIsSelectable(true)
    }

    fun appendData(data: String) {
        // 1. 先处理控制序列（清屏、光标移动等）
        val processed = controlHandler.process(data)

        // 2. 执行控制命令
        processed.commands.forEach { command ->
            when (command) {
                is AnsiControlHandler.ControlCommand.ClearScreen -> {
                    text = ""
                    return@forEach
                }
                is AnsiControlHandler.ControlCommand.CursorHome -> {
                    // 光标归位，暂时不处理，Android TextView 无法精确控制光标
                }
            }
        }

        // 3. 清理回车换行
        val cleaned = processed.text.replace("\r\n", "\n").replace("\r", "\n")

        // 4. 解析 ANSI 色彩序列
        val segments = ansiParser.parse(cleaned)
        val spannable = SpannableStringBuilder()

        segments.forEach { seg ->
            val start = spannable.length
            spannable.append(seg.text)
            val end = spannable.length

            seg.fgColor?.let {
                spannable.setSpan(
                    ForegroundColorSpan(it),
                    start, end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }

            seg.bgColor?.let {
                spannable.setSpan(
                    BackgroundColorSpan(it),
                    start, end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }

            if (seg.bold) {
                spannable.setSpan(
                    StyleSpan(Typeface.BOLD),
                    start, end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
        }

        append(spannable)

        // ponytail: 限制行数防止OOM, 超1000行时删除前200行
        val lineCount = lineCount
        if (lineCount > maxLines) {
            val layout = layout ?: return
            val linesToRemove = 200
            val endOffset = layout.getLineEnd(linesToRemove)
            text = text.subSequence(endOffset, text.length)
        }

        post {
            val scrollAmount = layout?.getLineTop(lineCount) ?: 0
            scrollTo(0, scrollAmount)
        }
    }

    fun clear() {
        text = ""
    }
}
