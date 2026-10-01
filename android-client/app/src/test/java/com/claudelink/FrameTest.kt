package com.claudelink

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 帧形状回归。restart 曾经被 sendInput 包了一层，服务端（只认顶层 `parsed.type`）
 * 把它当普通输入写进 PTY，重启按钮点了等于没点 —— 这里把三种帧的形状钉住。
 * org.json 在裸 JVM 单测里是 stub，所以走 Robolectric（与 MainActivitySmokeTest 一致）。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FrameTest {

    @Test
    fun `restart 必须是顶层帧`() {
        val frame = JSONObject(WebSocketClient.restartFrame())
        assertEquals("restart", frame.getString("type"))
        assertFalse("restart 带了 data 就说明又被包成 input 帧了", frame.has("data"))
    }

    @Test
    fun `input 帧把命令放在 data 里`() {
        val frame = JSONObject(WebSocketClient.inputFrame("ls -la\r"))
        assertEquals("input", frame.getString("type"))
        assertEquals("ls -la\r", frame.getString("data"))
    }

    @Test
    fun `resize 帧带行列`() {
        val frame = JSONObject(WebSocketClient.resizeFrame(80, 24))
        assertEquals("resize", frame.getString("type"))
        assertEquals(80, frame.getInt("cols"))
        assertEquals(24, frame.getInt("rows"))
    }
}
