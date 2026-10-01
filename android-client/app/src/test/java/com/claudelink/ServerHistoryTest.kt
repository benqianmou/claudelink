package com.claudelink

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerHistoryTest {

    @Test
    fun `新地址排在最前`() {
        val list = ServerHistory.add(listOf("192.168.1.10:3000"), "192.168.1.11:3000")
        assertEquals(listOf("192.168.1.11:3000", "192.168.1.10:3000"), list)
    }

    @Test
    fun `重复地址去重并提到最前`() {
        val list = ServerHistory.add(
            listOf("192.168.1.11:3000", "192.168.1.10:3000"),
            "192.168.1.10:3000"
        )
        assertEquals(listOf("192.168.1.10:3000", "192.168.1.11:3000"), list)
    }

    @Test
    fun `比较时忽略大小写与首尾空白`() {
        val list = ServerHistory.add(listOf("MyHost:3000"), "  myhost:3000  ")
        assertEquals(listOf("myhost:3000"), list)
    }

    @Test
    fun `最多保留 8 条`() {
        var list = emptyList<String>()
        for (i in 1..12) list = ServerHistory.add(list, "host$i")
        assertEquals(ServerHistory.MAX, list.size)
        assertEquals("host12", list.first())
        assertEquals("host5", list.last())
    }

    @Test
    fun `空地址不进历史`() {
        val list = ServerHistory.add(listOf("host1"), "   ")
        assertEquals(listOf("host1"), list)
    }
}
