package com.claudelink

/**
 * 看板规则：输入即任务，PTY 输出静默即完成。
 * 纯逻辑、无 Android 依赖，便于单测；规则与 web 端一致
 * （windows-host/public/index.html:920-1016 taskBoard）。
 */
class TaskBoard(private val maxDone: Int = 20) {

    /** 新任务在前，与 web 端 tasks.unshift 一致 */
    private val list = mutableListOf<Task>()

    val tasks: List<Task> get() = list.toList()

    fun hasRunning(): Boolean = list.any { it.status == TaskStatus.RUNNING }

    fun runningCount(): Int = list.count { it.status == TaskStatus.RUNNING }

    /** 发出一条命令 = 新增一个执行中的任务 */
    fun add(text: String, now: Long): Task {
        val task = Task(
            title = text.take(80),
            status = TaskStatus.RUNNING,
            createdAt = now,
            updatedAt = now
        )
        list.add(0, task)
        return task
    }

    /**
     * 输出静默到期：把所有执行中的任务标记完成，并把超额的历史丢掉。
     * @return 是否有变化
     */
    fun finishRunning(now: Long): Boolean {
        var changed = false
        for (t in list) {
            if (t.status == TaskStatus.RUNNING) {
                t.status = TaskStatus.COMPLETED
                t.updatedAt = now
                changed = true
            }
        }
        if (!changed) return false

        val done = list.filter { it.status != TaskStatus.RUNNING }
        if (done.size > maxDone) list.removeAll(done.drop(maxDone).toSet())
        return true
    }

    /** 面板「清空历史」：只清已完成的，执行中的不动。@return 是否真的清了东西 */
    fun clearDone(): Boolean = list.removeAll(list.filter { it.status != TaskStatus.RUNNING }.toSet())

    /** 持久化快照：只留已完成的历史，最多 maxDone 条 */
    fun doneSnapshot(): List<Task> = list.filter { it.status != TaskStatus.RUNNING }.take(maxDone)

    /** 恢复历史（按持久化顺序追加） */
    fun load(done: List<Task>) {
        list.addAll(done)
    }
}
