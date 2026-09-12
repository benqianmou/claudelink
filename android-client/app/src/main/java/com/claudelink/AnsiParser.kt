package com.claudelink

import android.graphics.Color

data class StyledSegment(
    val text: String,
    val fgColor: Int? = null,
    val bgColor: Int? = null,
    val bold: Boolean = false
)

class AnsiParser {
    companion object {
        private const val ESC = '\u001B'
    }
    
    private val ansiPattern = """$ESC\[([0-9;]*)m""".toRegex()

    private val colorMap = intArrayOf(
        Color.parseColor("#000000"),
        Color.parseColor("#CC0000"),
        Color.parseColor("#00CC00"),
        Color.parseColor("#CCCC00"),
        Color.parseColor("#0000CC"),
        Color.parseColor("#CC00CC"),
        Color.parseColor("#00CCCC"),
        Color.parseColor("#CCCCCC")
    )

    private val brightColorMap = intArrayOf(
        Color.parseColor("#555555"),
        Color.parseColor("#FF5555"),
        Color.parseColor("#55FF55"),
        Color.parseColor("#FFFF55"),
        Color.parseColor("#5555FF"),
        Color.parseColor("#FF55FF"),
        Color.parseColor("#55FFFF"),
        Color.parseColor("#FFFFFF")
    )

    fun parse(raw: String): List<StyledSegment> {
        val segments = mutableListOf<StyledSegment>()
        var currentFg: Int? = null
        var currentBg: Int? = null
        var currentBold = false
        var lastEnd = 0

        ansiPattern.findAll(raw).forEach { match ->
            if (match.range.first > lastEnd) {
                val text = raw.substring(lastEnd, match.range.first)
                if (text.isNotEmpty()) {
                    segments.add(StyledSegment(text, currentFg, currentBg, currentBold))
                }
            }

            val codes = match.groupValues[1]
            if (codes.isEmpty()) {
                currentFg = null
                currentBg = null
                currentBold = false
            } else {
                codes.split(";").mapNotNull { it.toIntOrNull() }.forEach { code ->
                    when (code) {
                        0 -> {
                            currentFg = null
                            currentBg = null
                            currentBold = false
                        }
                        1 -> currentBold = true
                        22 -> currentBold = false
                        in 30..37 -> currentFg = colorMap[code - 30]
                        in 40..47 -> currentBg = colorMap[code - 40]
                        in 90..97 -> currentFg = brightColorMap[code - 90]
                        in 100..107 -> currentBg = brightColorMap[code - 100]
                    }
                }
            }
            lastEnd = match.range.last + 1
        }

        if (lastEnd < raw.length) {
            val text = raw.substring(lastEnd)
            if (text.isNotEmpty()) {
                segments.add(StyledSegment(text, currentFg, currentBg, currentBold))
            }
        }

        return segments
    }
}
