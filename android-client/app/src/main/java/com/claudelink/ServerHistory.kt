package com.claudelink

/**
 * 历史连接地址（Android 侧新增，web 端没有对应物）。
 * 最新的排最前，忽略大小写去重，最多保留 [MAX] 条。
 * 纯逻辑、无 Android 依赖，所以能直接单测。
 */
object ServerHistory {

    const val MAX = 8

    fun add(existing: List<String>, server: String): List<String> {
        val clean = server.trim()
        if (clean.isEmpty()) return existing
        val rest = existing.filterNot { it.equals(clean, ignoreCase = true) }
        return (listOf(clean) + rest).take(MAX)
    }
}
