package com.claudelink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 纯 JVM 测试（不需要 Robolectric）：每一条都对应真机上真踩过的乱码。
 * 抓下来的原始流里 `CSI 1C` 出现 58 次、`CSI K` 3 次、CUP 8 次 —— 它们一旦被当成噪音丢掉，
 * 屏幕就是「词粘成一坨 + 重绘叠影」。
 */
class TerminalScreenTest {

    private fun screen(cols: Int = 20, rows: Int = 5) = TerminalScreen(cols, rows)

    @Test
    fun `光标右移必须真的占位_否则词会粘成一坨`() {
        val s = screen()
        s.feed("Claude\u001B[1CCode\u001B[1Cv2")
        assertEquals("Claude Code v2", s.plainText())
    }

    @Test
    fun `跨块收到半截转义序列要缓存`() {
        val s = screen()
        s.feed("a\u001B[")
        s.feed("2Cb")
        assertEquals("a  b", s.plainText())
    }

    @Test
    fun `擦到行尾要真的清掉后面的字符`() {
        val s = screen()
        s.feed("hello world\u001B[6D\u001B[K")
        assertEquals("hello", s.plainText())
    }

    @Test
    fun `光标定位后覆盖同一行不叠字`() {
        val s = screen()
        s.feed("abc\r\ndef")
        s.feed("\u001B[1;1HXY")
        assertEquals("XYc\ndef", s.plainText())
    }

    @Test
    fun `清屏清掉全部内容`() {
        val s = screen()
        s.feed("junk\r\nmore\u001B[2J")
        assertTrue("清屏后还有残留：${s.plainText()}", s.plainText().isBlank())
        // ED 2 只清屏、不动光标（claude 后面会跟一个 CSI H 归位）
        assertEquals(1, s.cursor.first)
        s.feed("\u001B[H")
        assertEquals(0 to 0, s.cursor)
    }

    @Test
    fun `CJK 按两格算`() {
        val s = screen()
        s.feed("中a")
        assertEquals(0 to 3, s.cursor)
        assertEquals(TerminalScreen.WIDE_TAIL, s.cellAt(0, 1).ch)
        assertEquals("中a", s.plainText())
    }

    @Test
    fun `写到底部要滚动并把旧行收进 scrollback`() {
        val s = screen(cols = 10, rows = 2)
        s.feed("1\r\n2\r\n3")
        assertEquals(1, s.scrollbackSize)
        assertEquals("1\n2\n3", s.plainText())
    }

    @Test
    fun `SGR 颜色和粗体落在格子上`() {
        val s = screen()
        s.feed("\u001B[1;32mok\u001B[0m")
        val cell = s.cellAt(0, 0)
        assertTrue("粗体没生效", cell.bold)
        assertEquals(0xFF27A644.toInt(), cell.fg)
        assertEquals("复位后不该还有颜色", TerminalScreen.NO_COLOR, s.cellAt(0, 3).fg)
    }

    @Test
    fun `反显标记留在格子上`() {
        val s = screen()
        s.feed("\u001B[7mX\u001B[27m")
        assertTrue(s.cellAt(0, 0).reverse)
        assertFalse(s.cellAt(0, 1).reverse)
    }

    @Test
    fun `OSC 标题序列不许漏到屏幕上`() {
        val s = screen()
        s.feed("\u001B]0;claude\u0007hi")
        assertEquals("hi", s.plainText())
    }

    @Test
    fun `行尾空白不进渲染结果`() {
        val s = screen()
        s.feed("hi")
        assertEquals("hi", s.rowTextAt(0))
    }

    @Test
    fun `写满一行后跟 SGR 也不会盖掉最后一格`() {
        // xterm 在 SGR 之后仍然保留「待换行」：写满一行再来一个颜色序列，下一个字符必须换行。
        // 曾经 dispatchCsi 对任何 CSI 都清 wrapPending，于是 X 盖在第 10 格上，整条框线看着左移一格。
        val s = screen(cols = 10, rows = 3)
        s.feed("0123456789" + "\u001B[0m" + "X")
        assertEquals("0123456789", s.rowTextAt(0))
        assertEquals("X", s.rowTextAt(1))
    }

    @Test
    fun `亮白色不是空色`() {
        // NO_COLOR 曾经是 -1，而 PALETTE[15]（亮白 0xFFFFFFFF）正好也是 -1：亮白于是被当成
        // 「没设色」画成默认色。下面这条 assertNotEquals 就是钉这个撞车的（SGR 97 / 38;5;15 /
        // 38;2;255;255;255 都落到第 15 号色）。
        val s = screen()
        s.feed("\u001B[97mW")
        assertEquals(0xFFFFFFFF.toInt(), s.cellAt(0, 0).fg)
        assertNotEquals(TerminalScreen.NO_COLOR, s.cellAt(0, 0).fg)
    }

    @Test
    fun `换尺寸保留左上角内容并夹紧光标`() {
        val s = screen(cols = 20, rows = 5)
        s.feed("abc\u001B[5;9H")
        s.resize(10, 3)
        assertEquals(10, s.cols)
        assertEquals(3, s.rows)
        assertTrue(s.plainText().startsWith("abc"))
        assertTrue(s.cursor.first <= 2 && s.cursor.second <= 9)
    }
}
