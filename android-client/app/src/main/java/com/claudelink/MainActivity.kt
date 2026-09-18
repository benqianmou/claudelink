package com.claudelink

import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView

class MainActivity : AppCompatActivity() {

    private lateinit var terminalView: TerminalView
    private lateinit var serverInput: EditText
    private lateinit var inputField: EditText
    private lateinit var connectButton: Button
    private lateinit var sendButton: Button
    private lateinit var scrollView: ScrollView

    private lateinit var btnCtrlC: Button
    private lateinit var btnTab: Button
    private lateinit var btnEsc: Button
    private lateinit var btnUp: Button
    private lateinit var btnDown: Button
    private lateinit var btnClear: Button

    private var wsClient: WebSocketClient? = null
    private val taskManager = TaskManager.getInstance()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        setupListeners()
    }

    private fun initViews() {
        terminalView = findViewById(R.id.terminalView)
        serverInput = findViewById(R.id.serverInput)
        inputField = findViewById(R.id.inputField)
        connectButton = findViewById(R.id.connectButton)
        sendButton = findViewById(R.id.sendButton)
        scrollView = findViewById(R.id.scrollView)

        btnCtrlC = findViewById(R.id.btnCtrlC)
        btnTab = findViewById(R.id.btnTab)
        btnEsc = findViewById(R.id.btnEsc)
        btnUp = findViewById(R.id.btnUp)
        btnDown = findViewById(R.id.btnDown)
        btnClear = findViewById(R.id.btnClear)
    }

    private fun setupListeners() {
        connectButton.setOnClickListener {
            val server = serverInput.text.toString().trim()
            if (server.isNotEmpty()) {
                connectToServer(server)
            }
        }

        sendButton.setOnClickListener {
            sendCommand()
        }

        inputField.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_ENTER) {
                sendCommand()
                true
            } else {
                false
            }
        }

        btnCtrlC.setOnClickListener { wsClient?.sendInput("") }
        btnTab.setOnClickListener { wsClient?.sendInput("\t") }
        btnEsc.setOnClickListener { wsClient?.sendInput("") }
        btnUp.setOnClickListener { wsClient?.sendInput("[A") }
        btnDown.setOnClickListener { wsClient?.sendInput("[B") }
        btnClear.setOnClickListener { terminalView.clear() }
    }

    private fun connectToServer(server: String) {
        val url = when {
            server.startsWith("ws://", ignoreCase = true) ||
                server.startsWith("wss://", ignoreCase = true) -> server
            else -> "ws://$server"
        }

        wsClient = WebSocketClient(url, object : WebSocketClient.Listener {
            override fun onConnected() {
                runOnUiThread {
                    connectButton.text = "断开"
                    Toast.makeText(this@MainActivity, "已连接到服务器", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onDataReceived(data: String) {
                runOnUiThread {
                    terminalView.appendData(data)
                    scrollView.post {
                        scrollView.fullScroll(View.FOCUS_DOWN)
                    }
                }
            }

            override fun onDisconnected() {
                runOnUiThread {
                    connectButton.text = "连接"
                    Toast.makeText(this@MainActivity, "已断开连接", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onError(error: String) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "连接错误: $error", Toast.LENGTH_LONG).show()
                    connectButton.text = "连接"
                }
            }
        })

        wsClient?.connect()
    }

    private fun sendCommand() {
        val command = inputField.text.toString()
        if (command.isNotEmpty()) {
            wsClient?.sendInput(command + "\n")
            inputField.text.clear()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        wsClient?.disconnect()
    }
}
