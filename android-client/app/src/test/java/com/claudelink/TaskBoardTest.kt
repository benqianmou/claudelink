package com.claudelink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskBoardTest {

    @Test
    fun `输入即任务_新的排在最前`() {
        val board = TaskBoard()
        board.add("第一条", 1000L)
        board.add("第二条", 2000L)

        assertEquals(listOf("第二条", "第一条"), board.tasks.map { it.title })
        assertEquals(TaskStatus.RUNNING, board.tasks.first().status)
        assertEquals(2, board.runningCount())
        assertEquals("执行中", board.tasks.first().getStatusText())
    }

    @Test
    fun `标题超过 80 字被截断`() {
        val board = TaskBoard()
        board.add("x".repeat(120), 1000L)
        assertEquals(80, board.tasks.first().title.length)
    }

    @Test
    fun `输出静默到期把所有执行中标记完成`() {
        val board = TaskBoard()
        board.add("a", 1000L)
        board.add("b", 1000L)

        assertTrue(board.finishRunning(9000L))
        assertFalse(board.hasRunning())
        assertTrue(board.tasks.all { it.status == TaskStatus.COMPLETED })
        assertTrue(board.tasks.all { it.updatedAt == 9000L })
        assertEquals("已完成", board.tasks.first().getStatusText())
    }

    @Test
    fun `没有执行中任务时不再变化`() {
        val board = TaskBoard()
        board.add("a", 1000L)
        assertTrue(board.finishRunning(2000L))
        assertFalse(board.finishRunning(3000L))
    }

    @Test
    fun `历史最多 20 条_超出丢最旧的`() {
        val board = TaskBoard()
        for (i in 1..25) {
            board.add("cmd$i", i * 1000L)
            board.finishRunning(i * 1000L + 10)
        }

        assertEquals(20, board.tasks.size)
        // 新的在前：最新一条是 cmd25，最旧一条保留 cmd6
        assertEquals("cmd25", board.tasks.first().title)
        assertEquals("cmd6", board.tasks.last().title)
        assertEquals(20, board.doneSnapshot().size)
    }

    @Test
    fun `历史恢复后仍按新在前排列`() {
        val board = TaskBoard()
        val saved = listOf(
            Task(title = "新的", status = TaskStatus.COMPLETED, createdAt = 2000L, updatedAt = 2100L),
            Task(title = "旧的", status = TaskStatus.COMPLETED, createdAt = 1000L, updatedAt = 1100L)
        )
        board.load(saved)

        assertEquals(listOf("新的", "旧的"), board.tasks.map { it.title })
        assertFalse(board.hasRunning())
    }
}
