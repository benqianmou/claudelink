package com.claudelink

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData

class TaskManager {
    private val _tasks = MutableLiveData<List<Task>>(emptyList())
    val tasks: LiveData<List<Task>> = _tasks

    private val taskList = mutableListOf<Task>()

    init {
        // 添加示例任务
        addTask("修复网络安全配置", "已添加 network_security_config.xml", TaskStatus.COMPLETED)
        addTask("美化 UI 界面", "正在实施 Material Design 3...", TaskStatus.RUNNING)
    }

    fun addTask(title: String, description: String = "", status: TaskStatus = TaskStatus.PENDING): Task {
        val task = Task(
            title = title,
            description = description,
            status = status
        )
        taskList.add(0, task) // 添加到列表顶部
        _tasks.postValue(taskList.toList())
        return task
    }

    fun updateTaskStatus(taskId: String, status: TaskStatus, description: String? = null) {
        val task = taskList.find { it.id == taskId }
        task?.let {
            it.status = status
            it.updatedAt = System.currentTimeMillis()
            if (description != null) {
                taskList[taskList.indexOf(it)] = it.copy(description = description)
            }
            _tasks.postValue(taskList.toList())
        }
    }

    fun removeTask(taskId: String) {
        taskList.removeIf { it.id == taskId }
        _tasks.postValue(taskList.toList())
    }

    fun clearCompleted() {
        taskList.removeIf { it.status == TaskStatus.COMPLETED }
        _tasks.postValue(taskList.toList())
    }

    fun getTasksByStatus(status: TaskStatus): List<Task> {
        return taskList.filter { it.status == status }
    }

    companion object {
        @Volatile
        private var instance: TaskManager? = null

        fun getInstance(): TaskManager {
            return instance ?: synchronized(this) {
                instance ?: TaskManager().also { instance = it }
            }
        }
    }
}
