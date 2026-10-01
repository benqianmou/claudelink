package com.claudelink

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import org.json.JSONArray
import org.json.JSONObject

/**
 * 看板状态：规则在纯逻辑 [TaskBoard]，这里只负责 Android 侧的三件事
 * —— LiveData 通知、静默计时器、SharedPreferences 持久化。
 * 持久化键沿用 web 端的 localStorage 键名（claudelink_tasks）。
 */
class TaskManager private constructor(private val appContext: Context) {

    private val board = TaskBoard()
    private val handler = Handler(Looper.getMainLooper())

    private val _tasks = MutableLiveData<List<Task>>(emptyList())
    val tasks: LiveData<List<Task>> = _tasks

    private val finishRunnable = Runnable { finishRunning() }

    /** tickRunnable 是否已经在队列里。PTY 输出每帧都会调 [bumpActivity]，绝不能每帧重置一次，否则永远到不了点 */
    private var tickerArmed = false

    /** 执行中的「已跑 Ns」得一直在走：每秒刷一次，没有执行中任务就自然停 */
    private val tickRunnable = object : Runnable {
        override fun run() {
            tickerArmed = false
            if (!board.hasRunning()) return
            publish()
            armTicker()
        }
    }

    /** 只在还没有计时器时排一个；重复调用（每来一帧输出都会调）不会把它推后 */
    private fun armTicker() {
        if (tickerArmed) return
        tickerArmed = true
        handler.postDelayed(tickRunnable, TICK_MS)
    }

    init {
        board.load(readSaved())
        publish()
    }

    /** 用户发出了一条命令：立刻上板 */
    fun addCommand(text: String) {
        board.add(text, System.currentTimeMillis())
        publish()
        bumpActivity()
    }

    /** 每次收到 PTY 输出都推后“完成”判定，阈值与 web 端一致：2.5s */
    fun bumpActivity() {
        if (!board.hasRunning()) return
        handler.removeCallbacks(finishRunnable)
        handler.postDelayed(finishRunnable, IDLE_MS)
        armTicker()
    }

    /**
     * 立刻收尾所有“执行中”的任务。
     * 用于：静默到期、断开连接/掉线、PTY 重启、PTY 退出、按下 ^C
     * （web 端对应 index.html:1321 / :1294 / :1297 / :1083）。
     */
    fun finishRunning() {
        handler.removeCallbacks(finishRunnable)
        handler.removeCallbacks(tickRunnable)
        tickerArmed = false
        if (board.finishRunning(System.currentTimeMillis())) {
            publish()
            save()
        }
    }

    /** 面板「清空看板历史」：连同 prefs 里存的已完成记录一起清掉（历史连接地址不归它管）。@return 是否真的清了东西 */
    fun clearHistory(): Boolean {
        if (!board.clearDone()) return false
        publish()
        save()
        return true
    }

    private fun publish() {
        _tasks.value = board.tasks
    }

    private fun prefs() = appContext.getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE)

    private fun readSaved(): List<Task> = try {
        val arr = JSONArray(prefs().getString(Prefs.KEY_TASKS, "[]"))
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Task(
                title = o.optString("text"),
                status = TaskStatus.COMPLETED,
                createdAt = o.optLong("start"),
                updatedAt = o.optLong("end")
            )
        }
    } catch (e: Exception) {
        emptyList()
    }

    private fun save() {
        val arr = JSONArray()
        for (t in board.doneSnapshot()) {
            arr.put(
                JSONObject()
                    .put("text", t.title)
                    .put("start", t.createdAt)
                    .put("end", t.updatedAt)
            )
        }
        prefs().edit().putString(Prefs.KEY_TASKS, arr.toString()).apply()
    }

    companion object {
        private const val IDLE_MS = 2500L
        private const val TICK_MS = 1000L

        @Volatile
        private var instance: TaskManager? = null

        fun getInstance(context: Context): TaskManager {
            return instance ?: synchronized(this) {
                instance ?: TaskManager(context.applicationContext).also { instance = it }
            }
        }
    }
}
