package com.claudelink

import android.content.Context
import android.widget.Button
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 终端字号：自适应公式 + 捏合后的上下限。
 * 这台机器没有设备，手感只能装机验，但公式和边界能在 JVM 上钉死。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TerminalViewSizeTest {

    @Test
    fun `窄屏按目标列数缩小字号但不低于下限`() {
        // 13sp 下只铺得下 30 列（目标 60）→ 算出来 6.5sp，被下限顶到 9sp
        assertEquals(TerminalView.MIN_FONT_SP, TerminalView.fitFontSp(13f, 30f), 0.001f)
    }

    @Test
    fun `刚好一屏列数时不动字号`() {
        assertEquals(12f, TerminalView.fitFontSp(12f, 60f), 0.001f)
    }

    @Test
    fun `宽屏不自动放大超过默认档`() {
        assertEquals(TerminalView.DEFAULT_FONT_SP, TerminalView.fitFontSp(13f, 120f), 0.001f)
    }

    @Test
    fun `捏合字号被夹在上下限之间`() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val terminal = activity.findViewById<TerminalView>(R.id.terminalView)

        terminal.fontSp = 100f
        assertEquals(TerminalView.MAX_FONT_SP, terminal.fontSp, 0.001f)
        terminal.fontSp = 1f
        assertEquals(TerminalView.MIN_FONT_SP, terminal.fontSp, 0.001f)

        // 一旦手动调过，自适应就该闭嘴（否则用户捏完又被屏宽改回去）
        terminal.fontSp = 15f
        assertEquals(15f, terminal.fontSp, 0.001f)
    }

    @Test
    fun `字号按钮步进一档`() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val terminal = activity.findViewById<TerminalView>(R.id.terminalView)
        terminal.fontSp = 14f

        activity.findViewById<Button>(R.id.fontUpButton).performClick()
        assertEquals(15f, terminal.fontSp, 0.001f)
        activity.findViewById<Button>(R.id.fontDownButton).performClick()
        assertEquals(14f, terminal.fontSp, 0.001f)
    }

    @Test
    @Config(qualifiers = "w360dp-h800dp-xhdpi")
    fun `字号换算不随屏幕密度翻倍`() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val terminal = activity.findViewById<TerminalView>(R.id.terminalView)

        // xhdpi = density 2：13sp 就该是 26px。曾经写成 `textSize = spToPx(13f)`，
        // 而 textSize 的 setter 收的是 sp —— 26 又当 26sp 用，实际 52px（density 3 是 117px）。
        assertEquals(TerminalView.DEFAULT_FONT_SP, terminal.fontSp, 0.001f)
        assertEquals(26f, terminal.textSizePx, 0.001f)
    }

    @Test
    fun `格子按列号定位而不是按字形宽度累积`() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val terminal = activity.findViewById<TerminalView>(R.id.terminalView)

        // 自绘的意义：相邻两列的间距恒等于一个格宽，跟这一行前面出现过什么字形无关
        assertEquals(terminal.paddingLeft.toFloat(), terminal.cellX(0), 0.001f)
        assertEquals(terminal.cellWidthPx, terminal.cellX(10) - terminal.cellX(9), 0.001f)
        assertTrue("格宽必须为正，否则列定位无从谈起", terminal.cellWidthPx > 0f)
    }

    @Test
    fun `旧版本存下的 px 字号不会被当成 sp`() {
        // 第一代键 fontSp 存 px，第二代键 font_sp 存的是被 density 放大过的 sp：
        // 换了单位或修了换算，这两批存档都必须当没看见
        ApplicationProvider.getApplicationContext<Context>()
            .getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE).edit()
            .putFloat("fontSp", 22f)
            .putFloat("font_sp", 22f)
            .apply()

        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val terminal = activity.findViewById<TerminalView>(R.id.terminalView)
        assertEquals(TerminalView.DEFAULT_FONT_SP, terminal.fontSp, 0.001f)
    }
}
