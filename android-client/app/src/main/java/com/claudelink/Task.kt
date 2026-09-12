package com.claudelink

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
    fun getTimeAgo(): String {
        val diff = System.currentTimeMillis() - updatedAt
        return when {
            diff < 60000 -> "刚刚"
            diff < 3600000 -> "${diff / 60000}分钟前"
            diff < 86400000 -> "${diff / 3600000}小时前"
            else -> "${diff / 86400000}天前"
        }
    }
    
    fun getStatusColor(): Int {
        return when (status) {
            TaskStatus.PENDING -> android.graphics.Color.parseColor("#F59E0B")
            TaskStatus.RUNNING -> android.graphics.Color.parseColor("#3B82F6")
            TaskStatus.COMPLETED -> android.graphics.Color.parseColor("#10B981")
            TaskStatus.FAILED -> android.graphics.Color.parseColor("#EF4444")
        }
    }
    
    fun getStatusIcon(): String {
        return when (status) {
            TaskStatus.PENDING -> "⏳"
            TaskStatus.RUNNING -> "🔄"
            TaskStatus.COMPLETED -> "✅"
            TaskStatus.FAILED -> "❌"
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
