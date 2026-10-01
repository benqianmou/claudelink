package com.claudelink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** ServerAddress：明文只连内网、令牌不进 URL 这两条规矩的回归测试。 */
class ServerAddressTest {

    @Test
    fun `内网地址用明文`() {
        assertEquals("http://192.168.1.5:3000/ws", ServerAddress.buildUrl("192.168.1.5:3000"))
        assertEquals("http://10.0.0.7:3000/ws", ServerAddress.buildUrl("10.0.0.7:3000"))
        assertEquals("http://172.20.3.4:3000/ws", ServerAddress.buildUrl("172.20.3.4:3000"))
        assertEquals("http://localhost:3000/ws", ServerAddress.buildUrl("localhost:3000"))
        assertEquals("http://claude-pc:3000/ws", ServerAddress.buildUrl("claude-pc:3000"))
        assertEquals("http://[::1]:3000/ws", ServerAddress.buildUrl("[::1]:3000"))
    }

    @Test
    fun `公网地址明文一律拒绝`() {
        val public = listOf("8.8.8.8:3000", "203.0.113.9:3000", "example.ngrok-free.app", "abc.ngrok.io:443")
        for (input in public) {
            try {
                ServerAddress.buildUrl(input)
                fail("应当拒绝明文公网地址：$input")
            } catch (e: IllegalArgumentException) {
                assertTrue("提示要提到 https：${e.message}", e.message!!.contains("https"))
            }
        }
    }

    @Test
    fun `公网地址用 https 就放行_并升成 https`() {
        assertEquals("https://abc.ngrok-free.app/ws", ServerAddress.buildUrl("https://abc.ngrok-free.app"))
        assertEquals("https://abc.ngrok-free.app/ws", ServerAddress.buildUrl("wss://abc.ngrok-free.app"))
        assertEquals("https://203.0.113.9:8443/ws", ServerAddress.buildUrl("https://203.0.113.9:8443/"))
    }

    @Test
    fun `地址里不含令牌`() {
        val url = ServerAddress.buildUrl("192.168.1.5:3000")
        assertFalse(url.contains("token"))
        assertFalse(url.contains("?"))
    }

    @Test
    fun `空地址报错`() {
        try {
            ServerAddress.buildUrl("   ")
            fail("空地址应当报错")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.isNotEmpty())
        }
    }

    @Test
    fun `内网判定不误伤域名`() {
        assertTrue(ServerAddress.isCleartextTrusted("192.168.0.1"))
        assertTrue(ServerAddress.isCleartextTrusted("100.101.102.103"))   // Tailscale 段
        assertTrue(ServerAddress.isCleartextTrusted("nas"))
        assertTrue(ServerAddress.isCleartextTrusted("nas.lan"))
        assertTrue(ServerAddress.isCleartextTrusted("fe80::1"))
        assertTrue(ServerAddress.isCleartextTrusted("fe90::1"))           // fe80::/10 的邻居
        assertFalse(ServerAddress.isCleartextTrusted("192.168.0.256"))
        assertFalse(ServerAddress.isCleartextTrusted("fc-host.example.com"))
        assertFalse(ServerAddress.isCleartextTrusted("172.32.0.1"))       // 172.32 已出私网段
        assertFalse(ServerAddress.isCleartextTrusted("134744072"))        // IPv4 遗留数字写法 = 8.8.8.8
        assertFalse(ServerAddress.isCleartextTrusted("ff02::1"))          // 组播不是链路本地单播
        assertFalse(ServerAddress.isCleartextTrusted(""))
    }

    @Test
    fun `userinfo 与大小写前缀都不能绕过明文闸门`() {
        // user@host：我判定成内网、OkHttp 实际连公网 —— 必须直接拒
        try {
            ServerAddress.buildUrl("192.168.1.1:3000@evil.com")
            fail("带 userinfo 的地址应当被拒")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("地址无效"))
        }
        // 大写前缀也要按 https 处理，而不是当成主机名 "HTTPS"
        assertEquals("https://8.8.8.8:8443/ws", ServerAddress.buildUrl("HTTPS://8.8.8.8:8443"))
        try {
            ServerAddress.buildUrl("Http://8.8.8.8:8443")
            fail("大写 HTTP 前缀的公网地址应当被拒")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("https"))
        }
    }

    @Test
    fun `主机名解析去掉端口与路径`() {
        assertEquals("192.168.1.5", ServerAddress.hostOf("192.168.1.5:3000/ws"))
        assertEquals("::1", ServerAddress.hostOf("[::1]:3000"))
        assertEquals("example.com", ServerAddress.hostOf("example.com?x=1"))
    }
}
