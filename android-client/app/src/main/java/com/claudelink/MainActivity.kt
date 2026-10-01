package com.claudelink

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.util.TypedValue
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.drawerlayout.widget.DrawerLayout
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    /** 与 web 端 KEY_SEQ 一致（windows-host/public/index.html:1226-1232） */
    private val keySeq = mapOf(
        "esc" to "\u001B",
        "tab" to "\t",
        "left" to "\u001B[D",
        "up" to "\u001B[A",
        "down" to "\u001B[B",
        "right" to "\u001B[C",
        "enter" to "\r",
        "ctrlc" to "\u0003",
        "ctrld" to "\u0004"
    )

    private lateinit var prefs: SharedPreferences
    private lateinit var drawer: DrawerLayout
    private lateinit var taskBoardView: View
    private lateinit var terminalView: TerminalView
    private lateinit var scrollView: ScrollView
    private lateinit var serverInput: EditText
    private lateinit var inputField: EditText
    private lateinit var connectButton: Button
    private lateinit var statusText: TextView
    private lateinit var panelAddress: TextView
    private lateinit var panelStatus: TextView
    private lateinit var panelActionButton: Button
    private lateinit var panelHistory: LinearLayout
    private lateinit var clearHistoryButton: Button
    private lateinit var activeTasks: LinearLayout
    private lateinit var taskHistory: LinearLayout
    private lateinit var taskCount: TextView

    private val taskManager by lazy { TaskManager.getInstance(this) }

    private var wsClient: WebSocketClient? = null
    private var isConnected = false
    private var clientCount = 0
    private var reconnectAttempt = 0
    private var needsToken = false
    private var token = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE)
        token = prefs.getString(Prefs.KEY_TOKEN, "") ?: ""

        initViews()
        setupListeners()

        // 没手动调过字号就交给 TerminalView 按屏宽自适应；调过（捏合或 A−/A＋）就沿用记住的那档
        if (prefs.contains(Prefs.KEY_FONT_SP)) {
            terminalView.fontSp = prefs.getFloat(Prefs.KEY_FONT_SP, TerminalView.DEFAULT_FONT_SP)
        }
        terminalView.onFontChanged = { sp -> prefs.edit().putFloat(Prefs.KEY_FONT_SP, sp).apply() }
        // 终端格数按 ScrollView 视口量，变了就把新尺寸发给服务端；PTY 尺寸不对，TUI 就按 100 列排版进手机屏
        terminalView.onResize = { cols, rows -> wsClient?.sendResize(cols, rows) }
        terminalView.bindViewport(scrollView)
        taskManager.tasks.observe(this) { renderBoard(it) }

        val savedServer = prefs.getString(Prefs.KEY_SERVER, "")
        if (!savedServer.isNullOrEmpty()) serverInput.setText(savedServer)

        renderHistory()
        renderStatus()
    }

    private fun initViews() {
        drawer = findViewById(R.id.drawer)
        taskBoardView = findViewById(R.id.taskBoard)
        terminalView = findViewById(R.id.terminalView)
        scrollView = findViewById(R.id.scrollView)
        serverInput = findViewById(R.id.serverInput)
        inputField = findViewById(R.id.inputField)
        connectButton = findViewById(R.id.connectButton)
        statusText = findViewById(R.id.statusText)
        panelAddress = findViewById(R.id.panelAddress)
        panelStatus = findViewById(R.id.panelStatus)
        panelActionButton = findViewById(R.id.panelActionButton)
        panelHistory = findViewById(R.id.panelHistory)
        clearHistoryButton = findViewById(R.id.clearHistoryButton)
        activeTasks = findViewById(R.id.activeTasks)
        taskHistory = findViewById(R.id.taskHistory)
        taskCount = findViewById(R.id.taskCount)
    }

    private fun setupListeners() {
        findViewById<Button>(R.id.boardButton).setOnClickListener { toggleBoard() }
        findViewById<Button>(R.id.sendButton).setOnClickListener { sendCommand() }
        findViewById<Button>(R.id.clearButton).setOnClickListener { terminalView.clear() }
        findViewById<Button>(R.id.restartButton).setOnClickListener { confirmRestart() }
        findViewById<Button>(R.id.fontDownButton).setOnClickListener { zoomFont(-1f) }
        findViewById<Button>(R.id.fontUpButton).setOnClickListener { zoomFont(1f) }
        connectButton.setOnClickListener { toggleConnection() }
        panelActionButton.setOnClickListener { toggleConnection() }
        clearHistoryButton.setOnClickListener { clearHistory() }

        // IME 的“发送”键与实体回车走同一条路径（原先只接了 setOnKeyListener，软键盘回车发不出去）
        inputField.setOnEditorActionListener { _, actionId, event ->
            val sendAction = actionId == EditorInfo.IME_ACTION_SEND || actionId == EditorInfo.IME_ACTION_DONE
            val enterKey = event != null && event.keyCode == KeyEvent.KEYCODE_ENTER &&
                event.action == KeyEvent.ACTION_DOWN
            if (sendAction || enterKey) {
                sendCommand()
                true
            } else {
                false
            }
        }

        bindKeys(findViewById(R.id.keyBar))

        // 终端改成自绘之后没有 TextView 的选中了，长按复制全部输出顶上
        terminalView.setOnLongClickListener {
            val text = terminalView.plainText()
            if (text.isBlank()) {
                toast("没有可复制的输出")
            } else {
                getSystemService(ClipboardManager::class.java)
                    ?.setPrimaryClip(ClipData.newPlainText("终端输出", text))
                toast("已复制全部输出")
            }
            true
        }
    }

    /** 按键的 tag 就是键名，等价于 web 端的 data-key + querySelectorAll */
    private fun bindKeys(container: ViewGroup) {
        for (i in 0 until container.childCount) {
            when (val child = container.getChildAt(i)) {
                is Button -> {
                    child.isAllCaps = false
                    keySeq[child.tag as? String]?.let { seq ->
                        child.setOnClickListener {
                            // ^C 视为中断当前任务（web 端 index.html:1083）
                            if (child.tag == "ctrlc") taskManager.finishRunning()
                            send(seq)
                        }
                    }
                }
                is ViewGroup -> bindKeys(child)
            }
        }
    }

    // ───────────────────────── 连接 ─────────────────────────

    /** 顶栏的「连接/断开」与面板里的同一个按钮走同一条路径 */
    private fun toggleConnection() {
        if (wsClient != null) {
            wsClient?.disconnect()
            markLinkDown(0)
            clearClient()
            toast("已断开")
            return
        }
        val server = serverInput.text.toString().trim()
        if (server.isEmpty()) {
            toast("请填写服务器地址")
            return
        }
        rememberServer(server)
        connectTo(server)
    }

    private fun connectTo(server: String) {
        // 地址先校验：公网明文会被 ServerAddress 拒掉，这种情况不该把按钮改成「断开」
        val url = try {
            ServerAddress.buildUrl(server)
        } catch (e: IllegalArgumentException) {
            toast(e.message ?: "地址无效")
            return
        }
        wsClient?.disconnect()
        needsToken = false
        markLinkDown(0)
        connectButton.text = DISCONNECT_LABEL
        // 令牌走 Authorization 头，不进 URL（见 ServerAddress 的注释）
        wsClient = WebSocketClient(url, token, socketListener).also { it.connect() }
    }

    private val socketListener = object : WebSocketClient.Listener {
        override fun onConnected() {
            if (isGone()) return
            isConnected = true
            needsToken = false
            reconnectAttempt = 0
            renderStatus()
            terminalView.reportGrid()
            // 连上就把面板收起来，把整屏还给终端
            if (drawer.isDrawerOpen(taskBoardView)) drawer.closeDrawer(taskBoardView)
            toast("已连接")
        }

        override fun onReconnecting(attempt: Int) {
            if (isGone()) return
            markLinkDown(attempt)
        }

        override fun onDataReceived(data: String) {
            if (isGone()) return
            handleServerMessage(data)
        }

        override fun onDisconnected() {
            if (isGone()) return
            markLinkDown(0)
        }

        override fun onError(error: String) {
            if (isGone()) return
            // 重连期间的网络错误不弹窗刷屏，状态行已经说明了当前状态
            if (reconnectAttempt == 0) toast("连接失败: $error")
        }

        override fun onUnauthorized() {
            if (isGone()) return
            needsToken = true
            markLinkDown(0)
            clearClient()
            showTokenDialog()
        }
    }

    /** 链接已断：复位状态、给还在"执行中"的任务收尾（web 端 index.html:1321 同样如此） */
    private fun markLinkDown(attempt: Int) {
        isConnected = false
        reconnectAttempt = attempt
        taskManager.finishRunning()
        renderStatus()
    }

    /** 连接对象已销毁：按钮回到"连接" */
    private fun clearClient() {
        wsClient = null
        connectButton.text = CONNECT_LABEL
        renderStatus()
    }

    /** Activity 已经走了就别再碰视图：回调是 post 过来的，可能晚于 onDestroy */
    private fun isGone(): Boolean = isFinishing || isDestroyed

    private fun handleServerMessage(text: String) {
        val msg = try {
            JSONObject(text)
        } catch (e: Exception) {
            terminalView.writeFrame(text)
            scrollToBottom()
            return
        }
        when (msg.optString("type")) {
            "output" -> {
                terminalView.writeFrame(msg.optString("data", ""))
                taskManager.bumpActivity()
            }
            "history" -> {
                terminalView.clear()
                terminalView.writeFrame(msg.optString("data", ""))
            }
            "restart" -> {
                if (msg.optBoolean("clearScreen", false)) terminalView.clear()
                taskManager.finishRunning()
            }
            // PTY 退出等同于当前任务结束（web 端 index.html:1297）
            "pty_exited" -> taskManager.finishRunning()
            "error" -> toast(msg.optString("message", "服务器错误"))
            "client_count" -> {
                clientCount = msg.optInt("count")
                renderStatus()
            }
        }
        scrollToBottom()
    }

    /**
     * 一帧最多滚一次。输出流是几十上百帧每秒，每帧都 post 一个 fullScroll 会和用户自己的滚动
     * 打架（屏幕看着就在闪），而且这些 post 会排成一串挨个执行。
     */
    private val scrollToBottomRunnable = Runnable { scrollView.fullScroll(View.FOCUS_DOWN) }

    private fun scrollToBottom() {
        scrollView.removeCallbacks(scrollToBottomRunnable)
        scrollView.postOnAnimation(scrollToBottomRunnable)
    }

    // ───────────────────────── 发送 ─────────────────────────

    private fun sendCommand() {
        val command = inputField.text.toString().trim()
        if (command.isEmpty()) return
        if (!send(command + "\r")) return
        taskManager.addCommand(command)
        inputField.text.clear()
    }

    /** 有可用连接才返回套接字，否则提示并返回 null（避免"动作做了但其实没发出去"） */
    private fun socket(): WebSocketClient? {
        val s = wsClient
        if (!isConnected || s == null || !s.isOpen()) {
            toast("未连接服务器")
            return null
        }
        return s
    }

    /** 真正发出去了才返回 true：否则输入框会被清空而命令其实没走 */
    private fun send(data: String): Boolean {
        val s = socket() ?: return false
        s.sendInput(data)
        return true
    }

    private fun confirmRestart() {
        AlertDialog.Builder(this)
            .setTitle("重启 PTY")
            .setMessage("当前会话将丢失。")
            .setPositiveButton("重启") { _, _ ->
                val s = socket() ?: return@setPositiveButton
                s.restart()
                toast("已发送重启")
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun zoomFont(delta: Float) {
        terminalView.zoomFont(delta)
        prefs.edit().putFloat(Prefs.KEY_FONT_SP, terminalView.fontSp).apply()
    }

    private fun toggleBoard() {
        if (drawer.isDrawerOpen(taskBoardView)) {
            drawer.closeDrawer(taskBoardView)
        } else {
            drawer.openDrawer(taskBoardView)
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(taskBoardView)) drawer.closeDrawers() else super.onBackPressed()
    }

    // ───────────────────────── 历史地址 ─────────────────────────

    private fun rememberServer(server: String) {
        val list = ServerHistory.add(loadHistory(), server)
        prefs.edit().putString(Prefs.KEY_SERVERS, JSONArray(list).toString()).apply()
        renderHistory()
    }

    private fun loadHistory(): List<String> = try {
        val arr = JSONArray(prefs.getString(Prefs.KEY_SERVERS, "[]"))
        (0 until arr.length()).map { arr.getString(it) }
    } catch (e: Exception) {
        emptyList()
    }

    /** 面板里的历史地址：一条一行，点一下直接连 */
    private fun renderHistory() {
        panelHistory.removeAllViews()
        val history = loadHistory()
        if (history.isEmpty()) {
            panelHistory.addView(emptyHint("还没有历史地址"))
            return
        }
        for (server in history) {
            val row = TextView(this).apply {
                text = server
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setTextColor(ContextCompat.getColor(context, R.color.text_secondary))
                setPadding(dp(14), dp(10), dp(14), dp(10))
                background = ContextCompat.getDrawable(context, R.drawable.bg_input)
                isClickable = true
                setOnClickListener { connectFromPanel(server) }
            }
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(6) }
            panelHistory.addView(row, params)
        }
    }

    /** 面板里点一个历史地址：填好地址 → 记住 → 收起面板 → 连接 */
    private fun connectFromPanel(server: String) {
        serverInput.setText(server)
        rememberServer(server)
        if (drawer.isDrawerOpen(taskBoardView)) drawer.closeDrawer(taskBoardView)
        connectTo(server)
    }

    /** 面板「清空看板历史」：看板里与 prefs 里的已完成记录一起清掉（历史连接地址不归它管） */
    private fun clearHistory() {
        toast(if (taskManager.clearHistory()) "看板历史已清空" else "没有看板历史可清")
    }

    // ───────────────────────── 看板 ─────────────────────────

    private fun renderBoard(tasks: List<Task>) {
        val running = tasks.filter { it.status == TaskStatus.RUNNING }
        val done = tasks.filter { it.status != TaskStatus.RUNNING }
        // 面板顶部的计数：进行中 / 已完成（web 端 index.html:955 只有一个数）
        taskCount.text = "${running.size} 进行中 · ${done.size} 已完成"
        fill(activeTasks, running, "暂无任务")
        fill(taskHistory, done, "暂无记录")
    }

    private fun fill(container: LinearLayout, list: List<Task>, emptyText: String) {
        container.removeAllViews()
        if (list.isEmpty()) {
            container.addView(emptyHint(emptyText))
            return
        }
        for (task in list) {
            val card = layoutInflater.inflate(R.layout.item_task_card, container, false)
            card.findViewById<View>(R.id.statusIndicator)
                .setBackgroundColor(ContextCompat.getColor(card.context, task.getStatusColorRes()))
            card.findViewById<TextView>(R.id.priorityIndicator).text = task.getStatusIcon()
            card.findViewById<TextView>(R.id.taskTitle).text = task.title
            card.findViewById<TextView>(R.id.taskStatus).text = task.getStatusText()
            card.findViewById<TextView>(R.id.taskTimestamp).text = task.getTimeLabel()
            container.addView(card)
        }
    }

    /** 空列表占位（任务列表与历史地址共用） */
    private fun emptyHint(message: String): TextView = TextView(this).apply {
        text = message
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setTextColor(ContextCompat.getColor(context, R.color.text_disabled))
        setPadding(dp(8), dp(24), dp(8), dp(24))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun renderStatus() {
        val (text, colorRes) = when {
            needsToken -> "需要访问令牌" to R.color.warning
            isConnected -> (if (clientCount > 0) "● 已连接 · $clientCount 客户端" else "● 已连接") to R.color.success
            reconnectAttempt > 0 -> "◌ 重连中 ($reconnectAttempt)" to R.color.warning
            else -> "○ 已断开" to R.color.text_disabled
        }
        statusText.text = text
        statusText.setTextColor(ContextCompat.getColor(this, colorRes))
        // 面板里同一份状态：地址 / 状态串 / 断开-重连按钮文案
        panelStatus.text = text
        panelStatus.setTextColor(ContextCompat.getColor(this, colorRes))
        panelAddress.text = serverInput.text.toString().trim().ifEmpty { "未连接" }
        panelActionButton.text = if (wsClient != null) DISCONNECT_LABEL else CONNECT_LABEL
    }

    private fun showTokenDialog() {
        val input = EditText(this).apply {
            hint = "访问令牌"
            setText(token)
        }
        AlertDialog.Builder(this)
            .setTitle("需要访问令牌")
            .setView(input)
            .setPositiveButton("保存") { _, _ ->
                token = input.text.toString().trim()
                prefs.edit().putString(Prefs.KEY_TOKEN, token).apply()
                val server = serverInput.text.toString().trim()
                if (server.isNotEmpty()) connectTo(server)
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        wsClient?.disconnect()
        wsClient = null
        super.onDestroy()
    }

    companion object {
        private const val CONNECT_LABEL = "连接"
        private const val DISCONNECT_LABEL = "断开"
    }
}
