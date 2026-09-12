package com.claudelink

import okhttp3.*
import java.util.concurrent.TimeUnit

class WebSocketClient(private val url: String, private val listener: Listener) {
    private var ws: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    interface Listener {
        fun onConnected()
        fun onDataReceived(data: String)
        fun onDisconnected()
        fun onError(error: String)
    }

    fun connect() {
        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                listener.onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                listener.onDataReceived(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                listener.onDisconnected()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                listener.onError(t.message ?: "Unknown error")
            }
        })
    }

    fun sendInput(input: String) {
        ws?.send(input)
    }

    fun disconnect() {
        ws?.close(1000, "User disconnect")
        ws = null
    }
}
