package com.claudelink

import android.content.Context
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * 无设备冒烟测试：这台机器没有 AVD，真机又只能靠用户来回试，
 * 所以用 Robolectric 在 JVM 上真的 inflate 布局、跑 Activity 生命周期与 OkHttp 回调。
 * 目的：把「一点连接就闪退」「屏幕上没有终端界面」这两类问题在本地就拦住。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MainActivitySmokeTest {

    private val screenWidth = 1080
    private val screenHeight = 2000

    /** Robolectric 不会自动 measure/layout，不铺开就查不出「控件是 0 高度」 */
    private fun launch(): MainActivity {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val decor = activity.window.decorView
        decor.measure(
            View.MeasureSpec.makeMeasureSpec(screenWidth, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(screenHeight, View.MeasureSpec.EXACTLY)
        )
        decor.layout(0, 0, screenWidth, screenHeight)
        return activity
    }

    private fun idle(times: Int = 1) = repeat(times) { shadowOf(Looper.getMainLooper()).idle() }

    private fun MainActivity.name(id: Int) = resources.getResourceName(id)

    @Test
    fun `启动后控件齐全且不会量出 0 高度`() {
        val activity = launch()
        val ids = listOf(
            R.id.boardButton, R.id.serverInput, R.id.connectButton,
            R.id.statusText, R.id.scrollView, R.id.terminalView, R.id.keyBar,
            R.id.fontDownButton, R.id.fontUpButton, R.id.clearButton, R.id.restartButton,
            R.id.inputField, R.id.sendButton, R.id.taskCount, R.id.activeTasks, R.id.taskHistory,
            R.id.panelAddress, R.id.panelStatus, R.id.panelActionButton, R.id.panelHistory,
            R.id.clearHistoryButton
        )
        for (id in ids) {
            val v = activity.findViewById<View>(id)
            assertNotNull("布局里没有控件 ${activity.name(id)}", v)
            assertEquals("控件不可见 ${activity.name(id)}", View.VISIBLE, v.visibility)
            // 空终端本来就是 wrap_content，别的不许是 0 高
            if (id != R.id.terminalView) {
                assertTrue("控件高度为 0，屏幕上根本看不到 ${activity.name(id)}", v.height > 0)
            }
        }
        val scroll = activity.findViewById<View>(R.id.scrollView)
        assertTrue(
            "终端区域只有 ${scroll.height}px（屏幕 ${screenHeight}px），难怪看不到终端界面",
            scroll.height > screenHeight / 3
        )

        // 面板上的连接区与状态行必须是同一份状态
        assertEquals(
            "面板的断开-重连按钮文案不对",
            "连接",
            activity.findViewById<Button>(R.id.panelActionButton).text.toString()
        )
        assertEquals(
            "面板状态没跟状态行同步",
            activity.findViewById<TextView>(R.id.statusText).text.toString(),
            activity.findViewById<TextView>(R.id.panelStatus).text.toString()
        )
    }

    @Test
    fun `连不上服务器时走失败重连路径且不崩`() {
        val activity = launch()
        activity.findViewById<EditText>(R.id.serverInput).setText("127.0.0.1:1")
        activity.findViewById<Button>(R.id.connectButton).performClick()

        // OkHttp 在自己的线程里连，回调 post 回主线程；这里把主线程队列排空几轮
        val deadline = System.currentTimeMillis() + 8000
        while (System.currentTimeMillis() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(50)
        }

        assertTrue("Activity 已经崩掉/退出了", !activity.isFinishing)
        val status = activity.findViewById<TextView>(R.id.statusText).text.toString()
        assertTrue("状态行没有反映连接状态：$status", status.contains("已断开") || status.contains("重连"))
        assertEquals("连接按钮文字应为断开", "断开", activity.findViewById<Button>(R.id.connectButton).text.toString())
    }

    @Test
    fun `终端输出与清屏交错不会崩`() {
        val activity = launch()
        val terminal = activity.findViewById<TerminalView>(R.id.terminalView)

        // 真实终端字节：OSC 标题、400 行输出、清屏 + 光标归位、SGR 颜色、光标显隐
        terminal.writeFrame("\u001B]0;claude\u0007" + (1..400).joinToString("\n") { "line $it" })
        terminal.writeFrame("\u001B[2J\u001B[H")
        idle(3)                     // 清屏后再追加：老实现会在这儿拿过期行号去 getLineTop
        terminal.writeFrame("\u001B[1;32mdone\u001B[0m\u001B[?25l\n")
        idle(3)

        val shown = terminal.plainText()
        assertTrue("终端没有内容：$shown", shown.contains("done"))
        assertTrue("终端高度为 0，屏幕上什么都看不到", terminal.height > 0)
        assertTrue("控制序列漏到屏幕上了：$shown", !shown.contains('\u001B'))
    }

    @Test
    fun `面板里的历史地址能直接连`() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        ctx.getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE).edit()
            .putString(Prefs.KEY_SERVERS, """["192.168.1.10:3000","10.0.0.2:3000"]""")
            .apply()

        val activity = launch()
        val rows = activity.findViewById<LinearLayout>(R.id.panelHistory)
        assertEquals("面板没有列出两条历史地址", 2, rows.childCount)
        assertEquals(
            "最新的地址应排最前",
            "192.168.1.10:3000",
            (rows.getChildAt(0) as TextView).text.toString()
        )

        rows.getChildAt(0).performClick()
        idle(2)
        assertEquals(
            "点历史地址没有把地址填进输入框",
            "192.168.1.10:3000",
            activity.findViewById<EditText>(R.id.serverInput).text.toString()
        )
    }

    @Test
    fun `没有历史地址时面板给占位文案`() {
        val activity = launch()
        val rows = activity.findViewById<LinearLayout>(R.id.panelHistory)
        assertEquals("空历史应只放一行占位", 1, rows.childCount)
    }

    @Test
    fun `未连接时发送命令只提示不清空输入框`() {
        val activity = launch()
        val input = activity.findViewById<EditText>(R.id.inputField)
        input.setText("ls -la")
        activity.findViewById<Button>(R.id.sendButton).performClick()
        idle(2)
        assertEquals("命令没发出去却把输入框清了", "ls -la", input.text.toString())
    }
}
