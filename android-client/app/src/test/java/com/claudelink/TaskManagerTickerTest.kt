package com.claudelink

import android.content.Context
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * 面板上「已跑 Ns」得自己在走：TaskManager 在执行中时每秒刷一次，没有执行中任务就停。
 * 定时器停不下来的话会白耗电，这条用例就是钉这个边界的。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TaskManagerTickerTest {

    @Test
    fun `执行中每秒刷新_完成后停表`() {
        val manager = TaskManager.getInstance(ApplicationProvider.getApplicationContext<Context>())
        var publishes = 0
        manager.tasks.observeForever { publishes++ }

        manager.addCommand("ls")
        val afterAdd = publishes
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(3))
        val afterTicks = publishes
        assertTrue("执行中 3 秒一次都没刷新（$afterAdd -> $afterTicks）", afterTicks >= afterAdd + 2)

        manager.finishRunning()
        val afterFinish = publishes
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(3))
        assertEquals("收尾后定时器还在跑", afterFinish, publishes)
    }

    /**
     * 每一帧 PTY 输出都会调 bumpActivity()，而输出通常远多于每秒一次。
     * 早期实现每次 bumpActivity 都 removeCallbacks + postDelayed，等于每秒计时器永远被推后
     * ——「已跑 Ns」只在输出停顿 ≥1s 时才动一下，看上去就是死的。
     */
    @Test
    fun `输出帧不断也不会把每秒计时器饿死`() {
        val manager = TaskManager.getInstance(ApplicationProvider.getApplicationContext<Context>())
        var publishes = 0
        manager.tasks.observeForever { publishes++ }

        manager.addCommand("sleep 10")
        val afterAdd = publishes
        repeat(15) {                       // 3 秒里每 200ms 来一帧输出，中间从不停顿
            manager.bumpActivity()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
        }
        assertTrue(
            "输出一直来就把「已跑」计时器饿死了（$afterAdd -> $publishes）",
            publishes >= afterAdd + 2
        )
        manager.finishRunning()
    }
}
