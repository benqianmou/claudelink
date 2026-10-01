package com.claudelink

import android.os.Handler
import android.os.Looper
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class WebSocketClient(
    private val url: String,
    private val token: String,
    private val listener: Listener
) {

    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val handler = Handler(Looper.getMainLooper())
    private val retry = Runnable { open() }

    private var ws: WebSocket? = null
    private var attempts = 0
    private var stopped = false

    interface Listener {
        fun onConnected()
        fun onDataReceived(data: String)
        fun onDisconnected()
        fun onError(error: String)

        /** 服务端以 4401 拒绝连接：需要访问令牌 */
        fun onUnauthorized()

        /** 掉线后正在退避重连（第 attempt 次） */
        fun onReconnecting(attempt: Int) {}
    }

    fun connect() {
        stopped = false
        attempts = 0
        open()
    }

    /**
     * OkHttp 的回调跑在它自己的读写线程上，直接改视图会抛
     * CalledFromWrongThreadException ——「一点连接就闪退」的元凶，所以一律转回主线程。
     */
    private fun post(block: () -> Unit) {
        handler.post(block)
    }

    private fun open() {
        if (stopped) return
        val request = try {
            Request.Builder()
                .url(url)
                // 令牌放握手头：URL 会进服务端/代理/隧道日志，头不会（服务端见 extractToken）
                .apply { if (token.isNotEmpty()) header("Authorization", "Bearer $token") }
                .build()
        } catch (e: IllegalArgumentException) {
            // 地址写错不是网络故障，不该进重连循环
            stopped = true
            post { listener.onError("地址无效：${e.message}") }
            return
        }
        ws = client.newWebSocket(request, socketListener)
    }

    private val socketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            attempts = 0
            post { listener.onConnected() }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            post { listener.onDataReceived(text) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, reason)
            if (code == 4401) {
                stopped = true
                post { listener.onUnauthorized() }
            } else if (!stopped) {
                // 主动断开时同样会回调 onClosing，这里不能再报一次「已断开」
                post { listener.onDisconnected() }
                scheduleRetry()
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (stopped) return
            if (response?.code == 4401) {
                stopped = true
                post { listener.onUnauthorized() }
            } else {
                post { listener.onError(t.message ?: "Unknown error") }
                scheduleRetry()
            }
        }
    }

    /** 与 web 端一致：1s 起指数退避，封顶 15s（index.html:1332-1336） */
    private fun scheduleRetry() {
        if (stopped) return
        val delay = minOf(15_000L, 1_000L shl minOf(attempts, 4))
        attempts++
        handler.postDelayed(retry, delay)
        post { listener.onReconnecting(attempts) }
    }

    /**
     * 命令要包成服务端认识的 input 帧（server.js:250），web 端同样如此（index.html:1152）。
     * 裸文本会被服务端先 JSON.parse：像 `123\r` 这种本身就是合法 JSON 的命令会被解析成数字，
     * 落不进任何分支而被静默丢掉。
     */
    fun sendInput(input: String) {
        val socket = ws ?: return
        socket.send(inputFrame(input))
    }

    /**
     * 重启 PTY：`restart` 必须是**顶层**帧（server.js 只在顶层认 `parsed.type === 'restart'`）。
     * 之前这里用 sendInput 包了一层，服务端把它当普通输入写进 PTY，按钮等于没反应。
     */
    fun restart() {
        val socket = ws ?: return
        socket.send(restartFrame())
    }

    /**
     * 终端尺寸变了要告诉服务端，否则 PTY 一直是 100×30，claude 的 TUI 按 100 列排版、
     * 到手机窄屏上就是满屏错位（服务端已支持，见 server.js 的 resize 分支）。
     */
    fun sendResize(cols: Int, rows: Int) {
        val socket = ws ?: return
        socket.send(resizeFrame(cols, rows))
    }

    /** 是否真的有可发送的套接字（避免"输入框清空了但命令没发出去"） */
    fun isOpen(): Boolean = ws != null

    fun disconnect() {
        stopped = true
        handler.removeCallbacks(retry)
        ws?.close(1000, "User disconnect")
        ws = null
        attempts = 0
    }

    companion object {
        /** 三种帧的形状（纯函数，FrameTest 直接钉住，避免再包错层） */
        fun inputFrame(data: String): String =
            JSONObject().put("type", "input").put("data", data).toString()

        fun resizeFrame(cols: Int, rows: Int): String =
            JSONObject().put("type", "resize").put("cols", cols).put("rows", rows).toString()

        fun restartFrame(): String = JSONObject().put("type", "restart").toString()
    }
}
