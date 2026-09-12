# Android 客户端实现指南

用户要求：提供基于 Kotlin 的 Android 原生端核心实现，用于连接 Windows 端 WebSocket 服务器，接收并渲染 Claude Code 的 PTY 输出。

本文档为 Android 开发者提供完整的组件实现代码，无需任何框架依赖（除 OkHttp）。所有代码可直接复制到项目中使用。

## 核心组件

### 1. WebSocketClient.kt
WebSocket 客户端封装，处理连接、消息接收和发送。

```kotlin
class WebSocketClient(private val url: String, private val listener: Listener) {
    private var ws: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)  // 长连接
        .build()

    interface Listener {
        fun onDataReceived(data: String)
        fun onConnected()
        fun onError(error: String)
        fun onDisconnected()
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
            
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                listener.onError(t.message ?: "Unknown error")
            }
            
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                listener.onDisconnected()
            }
        })
    }

    fun sendInput(input: String) {
        ws?.send(input)
    }

    fun disconnect() {
        ws?.close(1000, "User disconnect")
    }
}
```

### 2. AnsiParser.kt
ANSI 转义序列解析器，支持 8 色、加粗、下划线。

```kotlin
data class StyledText(
    val text: String,
    val fgColor: Int? = null,
    val bgColor: Int? = null,
    val bold: Boolean = false,
    val underline: Boolean = false
)

class AnsiParser {
    // ANSI 颜色映射（8色标准）
    private val colorMap = intArrayOf(
        0xFF000000.toInt(),  // 0: 黑
        0xFFCC0000.toInt(),  // 1: 红
        0xFF00CC00.toInt(),  // 2: 绿
        0xFFCCCC00.toInt(),  // 3: 黄
        0xFF0000CC.toInt(),  // 4: 蓝
        0xFFCC00CC.toInt(),  // 5: 品红
        0xFF00CCCC.toInt(),  // 6: 青
        0xFFCCCCCC.toInt()   // 7: 白
    )
    
    private val ansiRegex = Regex("\\x1B\\[([0-9;]+)m")
    
    fun parse(raw: String): List<StyledText> {
        val segments = mutableListOf<StyledText>()
        var currentFg: Int? = null
        var currentBg: Int? = null
        var bold = false
        var underline = false
        var lastEnd = 0
        
        ansiRegex.findAll(raw).forEach { match ->
            // 添加转义序列之前的文本
            if (match.range.first > lastEnd) {
                val text = raw.substring(lastEnd, match.range.first)
                segments.add(StyledText(text, currentFg, currentBg, bold, underline))
            }
            
            // 解析 SGR 参数
            val codes = match.groupValues[1].split(";").map { it.toIntOrNull() ?: 0 }
            codes.forEach { code ->
                when (code) {
                    0 -> {  // 重置
                        currentFg = null
                        currentBg = null
                        bold = false
                        underline = false
                    }
                    1 -> bold = true
                    4 -> underline = true
                    22 -> bold = false
                    24 -> underline = false
                    in 30..37 -> currentFg = colorMap[code - 30]
                    in 40..47 -> currentBg = colorMap[code - 40]
                    // TODO: 支持 256 色和 TrueColor
                }
            }
            lastEnd = match.range.last + 1
        }
        
        // 添加剩余文本
        if (lastEnd < raw.length) {
            segments.add(StyledText(raw.substring(lastEnd), currentFg, currentBg, bold, underline))
        }
        
        return segments
    }
}
```

### 3. TerminalView.kt
自定义终端渲染 View，支持 ANSI 色彩和样式。

```kotlin
class TerminalView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : AppCompatTextView(context, attrs) {
    
    private val ansiParser = AnsiParser()
    private val maxLines = 1000  // 最大行数限制
    
    init {
        typeface = Typeface.MONOSPACE
        textSize = 12f
        setBackgroundColor(0xFF0A0D12.toInt())
        setTextColor(0xFFCCCCCC.toInt())
        movementMethod = ScrollingMovementMethod()
    }
    
    fun appendData(data: String) {
        val styled = ansiParser.parse(data)
        val spannable = SpannableStringBuilder(text)
        
        styled.forEach { seg ->
            val start = spannable.length
            spannable.append(seg.text)
            val end = spannable.length
            
            // 应用样式
            seg.fgColor?.let {
                spannable.setSpan(
                    ForegroundColorSpan(it),
                    start, end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
            seg.bgColor?.let {
                spannable.setSpan(
                    BackgroundColorSpan(it),
                    start, end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
            if (seg.bold) {
                spannable.setSpan(
                    StyleSpan(Typeface.BOLD),
                    start, end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
            if (seg.underline) {
                spannable.setSpan(
                    UnderlineSpan(),
                    start, end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
        }
        
        // 行数限制
        val lines = spannable.split('\n')
        if (lines.size > maxLines) {
            val keepLines = lines.takeLast(maxLines)
            text = keepLines.joinToString("\n")
        } else {
            text = spannable
        }
        
        // 自动滚动到底部
        post {
            val scrollAmount = layout?.getLineTop(lineCount) ?: 0 - height
            if (scrollAmount > 0) {
                scrollTo(0, scrollAmount)
            }
        }
    }
    
    fun clear() {
        text = ""
    }
}
```

### 4. MainActivity.kt
主活动，整合所有组件。

```kotlin
class MainActivity : AppCompatActivity() {
    private lateinit var terminalView: TerminalView
    private lateinit var inputField: EditText
    private lateinit var wsClient: WebSocketClient
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        terminalView = findViewById(R.id.terminalView)
        inputField = findViewById(R.id.inputField)
        
        val serverUrl = "ws://192.168.2.189:3000"  // TODO: 改为配置项
        wsClient = WebSocketClient(serverUrl, object : WebSocketClient.Listener {
            override fun onConnected() {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "已连接", Toast.LENGTH_SHORT).show()
                }
            }
            
            override fun onDataReceived(data: String) {
                runOnUiThread {
                    terminalView.appendData(data)
                }
            }
            
            override fun onError(error: String) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "错误: $error", Toast.LENGTH_LONG).show()
                }
            }
            
            override fun onDisconnected() {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "连接断开", Toast.LENGTH_SHORT).show()
                }
            }
        })
        
        wsClient.connect()
        
        // 输入框处理
        inputField.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_SEND || 
                event?.keyCode == KeyEvent.KEYCODE_ENTER) {
                val text = inputField.text.toString()
                wsClient.sendInput(text + "\r")
                inputField.text.clear()
                true
            } else {
                false
            }
        }
    }
    
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_ENTER -> {
                wsClient.sendInput("\r")
                true
            }
            KeyEvent.KEYCODE_DEL -> {
                wsClient.sendInput("")
                true
            }
            else -> {
                event.unicodeChar.takeIf { it != 0 }?.let {
                    wsClient.sendInput(it.toChar().toString())
                    true
                } ?: super.onKeyDown(keyCode, event)
            }
        }
    }
    
    override fun onDestroy() {
        super.onDestroy()
        wsClient.disconnect()
    }
}
```

## 布局文件 (res/layout/activity_main.xml)
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <com.claudelink.TerminalView
        android:id="@+id/terminalView"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:padding="8dp"
        android:scrollbars="vertical" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:padding="8dp">

        <EditText
            android:id="@+id/inputField"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:hint="输入命令..."
            android:imeOptions="actionSend"
            android:inputType="text" />

        <Button
            android:id="@+id/sendButton"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="发送" />
    </LinearLayout>
</LinearLayout>
```

## Gradle 依赖 (app/build.gradle.kts)
```kotlin
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
}
```

## AndroidManifest.xml 权限
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

## 待优化功能

1. **光标控制序列支持**
   - `\x1B[2J` - 清屏
   - `\x1B[H` - 光标归位
   - `\x1B[nA/B/C/D` - 光标上下左右移动

2. **256 色和 TrueColor 支持**
   - `\x1B[38;5;nm` - 前景色 256 色
   - `\x1B[38;2;r;g;bm` - 前景色 TrueColor

3. **服务器发现**
   - mDNS 自动发现局域网内的 Windows 宿主
   - 保存常用连接历史

4. **输入优化**
   - 虚拟方向键
   - Ctrl/Alt/Shift 组合键支持
   - 文本选择和复制
