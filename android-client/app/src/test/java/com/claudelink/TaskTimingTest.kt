package com.claudelink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 面板新增的「每条耗时」与「清空历史」：纯逻辑，不需要 Robolectric。
 */
class TaskTimingTest {

    private fun done(start: Long, end: Long) = Task(
        title = "ls",
        status = TaskStatus.COMPLETED,
        createdAt = start,
        updatedAt = end
    )

    @Test
    fun `耗时按毫秒_秒_分秒三档显示`() {
        assertEquals("420ms", done(0, 420).getDuration())
        assertEquals("4.2s", done(0, 4200).getDuration())
        assertEquals("1分5秒", done(0, 65_000).getDuration())
    }

    @Test
    fun `执行中的任务按当前时间算耗时`() {
        val task = Task(
            title = "ls",
            status = TaskStatus.RUNNING,
            createdAt = System.currentTimeMillis() - 1500
        )
        assertTrue("执行中的耗时应是几秒，实际 ${task.getDuration()}", task.getDuration().endsWith("s"))
        assertTrue("执行中的标签要写已跑，实际 ${task.getTimeLabel()}", task.getTimeLabel().startsWith("已跑"))
    }

    @Test
    fun `完成后的标签带上耗时`() {
        assertTrue("完成后应显示耗时，实际 ${done(0, 3000).getTimeLabel()}", 
            done(0, 3000).getTimeLabel().contains("耗时 3.0s"))
    }

    @Test
    fun `清空历史只清已完成的`() {
        val board = TaskBoard()
        board.add("a", 1_000)
        board.finishRunning(2_000)
        board.add("b", 3_000)

        assertTrue("有历史却没清掉", board.clearDone())
        assertEquals("执行中的任务不该被清掉", 1, board.tasks.size)
        assertEquals(1, board.runningCount())
        assertFalse("已经没有历史了，再清一次不该报有变化", board.clearDone())
    }
}
