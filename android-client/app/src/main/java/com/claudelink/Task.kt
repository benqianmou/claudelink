package com.claudelink

import androidx.annotation.ColorRes
import java.util.*

enum class TaskStatus {
    PENDING,
    RUNNING,
    COMPLETED,
    FAILED
}

data class Task(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val description: String = "",
    var status: TaskStatus = TaskStatus.PENDING,
    val createdAt: Long = System.currentTimeMillis(),
    var updatedAt: Long = System.currentTimeMillis()
) {
    /**
     * 卡片右下角的时间：执行中的任务显示已经跑了多久，完成后的显示相对时间。
     * 秒级展示与 web 端一致（index.html:984-987 显示耗时秒数）。
     */
    fun getTimeAgo(): String {
        val base = if (status == TaskStatus.RUNNING) createdAt else updatedAt
        val diff = System.currentTimeMillis() - base
        return when {
            diff < 60_000 -> "${diff / 1000}s"
            diff < 3_600_000 -> "${diff / 60_000}分钟前"
            diff < 86_400_000 -> "${diff / 3_600_000}小时前"
            else -> "${diff / 86_400_000}天前"
        }
    }

    /** 卡片右下角：执行中显示已经跑了多久，完成后显示相对时间 + 实际耗时 */
    fun getTimeLabel(): String =
        if (status == TaskStatus.RUNNING) "已跑 ${getTimeAgo()}" else "${getTimeAgo()} · 耗时 ${getDuration()}"

    /** 实际耗时：完成后是 updatedAt - createdAt，执行中按当前时间算 */
    fun getDuration(): String {
        val end = if (status == TaskStatus.RUNNING) System.currentTimeMillis() else updatedAt
        val ms = (end - createdAt).coerceAtLeast(0)
        return when {
            ms < 1000 -> "${ms}ms"
            ms < 60_000 -> String.format(Locale.US, "%.1fs", ms / 1000.0)
            else -> "${ms / 60_000}分${(ms % 60_000) / 1000}秒"
        }
    }

    /** 状态色条：只给资源 id，具体颜色留在 colors.xml，代码里不再抄一份十六进制（全站只有一个强调色） */
    @ColorRes
    fun getStatusColorRes(): Int = when (status) {
        TaskStatus.PENDING -> R.color.status_pending
        TaskStatus.RUNNING -> R.color.primary
        TaskStatus.COMPLETED -> R.color.success
        TaskStatus.FAILED -> R.color.error
    }

    /** 单色符号，不用 emoji（web 端 index.html:977 同样是 ◌ / ✓） */
    fun getStatusIcon(): String {
        return when (status) {
            TaskStatus.PENDING -> "○"
            TaskStatus.RUNNING -> "◌"
            TaskStatus.COMPLETED -> "✓"
            TaskStatus.FAILED -> "✕"
        }
    }

    fun getStatusText(): String {
        return when (status) {
            TaskStatus.PENDING -> "等待中"
            TaskStatus.RUNNING -> "执行中"
            TaskStatus.COMPLETED -> "已完成"
            TaskStatus.FAILED -> "失败"
        }
    }
}
