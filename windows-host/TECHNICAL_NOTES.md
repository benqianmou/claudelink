# Windows 宿主端技术要点

用户要求：记录 Windows 端实现中的关键技术细节，特别是自动处理工作区信任对话框的硬核解决方案。

本文档供有经验的后端工程师参考，描述 PTY 流数据处理、ANSI 清理逻辑和自动化交互的技术本质。

## 核心问题：自动处理工作区信任对话框

### 问题描述
Claude Code CLI 首次在新目录启动时，会弹出交互式信任确认对话框：

```
Quick safety check: Is this a project you created or one you trust?
  ❯ No, exit
    Yes, I trust this folder
```

如果不处理，进程会阻塞，无法进入交互模式。

### 解决方案：ANSI 清理 + 自动确认

#### 1. 原始 PTY 输出
```
[?25l[2J[m[H]0;C:\Users\Lenovo\.local\bin\claude.exe[?25h
[3;2HAccessing[1Cworkspace:[m[5;2HC:\Users\Lenovo
[7;2HQuick[1Csafety[1Ccheck:[1CIs[1Cthis[1Ca[1Cproject...
[15;2H❯[1CNo,[1Cexit[m
[16;4HYes,[1CI[1Ctrust[1Cthis[1Cfolder
```

**关键问题**：`[1C` 是 ANSI 光标右移命令，等同于空格。如果简单删除所有转义序列，文本会变成 `QuicksafetycheckIsthisaproject`（无空格），无法匹配关键词。

#### 2. 正确的清理方式
```javascript
handlePtyData(data) {
  if (!this.trustDialogHandled) {
    this.trustDialogBuffer += data;
    
    // 关键：[nC] 光标右移 → 替换成 n 个空格
    const cleanText = this.trustDialogBuffer
      .replace(/\x1B\[(\d+)C/g, (match, n) => ' '.repeat(parseInt(n) || 1))
      .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')  // 其他 CSI 序列
      .replace(/\x1B\][^\x07]*\x07/g, '')      // OSC 序列
      .replace(/\x1B[>=<][0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B[()][AB0]/g, '')
      .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
      .replace(/\s+/g, ' ');  // 多个空白压缩成单个空格
    
    if (cleanText.includes('Yes, I trust this folder')) {
      console.log('[PTY] ✓ 检测到信任对话框，自动确认...');
      setTimeout(() => {
        this.pty.write('\x1B[B');  // 向下箭头，选择 "Yes"
        setTimeout(() => {
          this.pty.write('\r');     // 回车确认
          this.trustDialogHandled = true;
          this.trustDialogBuffer = '';
          console.log('[PTY] ✓ 已自动确认信任');
        }, 150);
      }, 150);
    }
    
    // 限制 buffer 大小防止内存泄漏
    if (this.trustDialogBuffer.length > 5000) {
      this.trustDialogBuffer = this.trustDialogBuffer.slice(-2000);
    }
  }
  
  // 正常数据广播...
}
```

#### 3. 验证结果
```
[PTY] 清理后片段: Quick safety check: Is this a project you created or one you trust?
[PTY] ✓ 检测到信任对话框，自动确认...
[PTY] ✓ 已自动确认信任
```

输出显示：
1. 对话框从 `❯ No, exit` 切换到 `❯ Yes, I trust this folder`
2. 进程继续启动，进入 Claude Code 主界面
3. 显示会话列表和交互式 REPL

## 其他关键技术点

### node-pty 必需参数
```javascript
{
  useConpty: true,           // Windows 必需，启用 ConPTY
  conptyInheritCursor: false // 避免光标闪烁
}
```

### 键盘输入映射
| 按键 | 应发送 | 错误发送 |
|------|--------|----------|
| 回车 | `\r` | `\n` |
| 退格 | `\u007F` | `\u0008` |
| Ctrl-C | `\u0003` | - |
| Ctrl-D | `\u0004` | - |
| 向上箭头 | `\x1B[A` | - |
| 向下箭头 | `\x1B[B` | - |

### ANSI 转义序列分类
| 类型 | 格式 | 示例 | 用途 |
|------|------|------|------|
| CSI | `\x1B[...m` | `\x1B[31m` | 色彩、光标移动 |
| OSC | `\x1B]...\x07` | `\x1B]0;title\x07` | 窗口标题 |
| 私有模式 | `\x1B[?...h` | `\x1B[?25l` | 隐藏光标 |

### 性能优化
```javascript
// 限制历史缓冲区大小
if (this.outputBuffer.length > MAX_BUFFER_CHUNKS) {
  this.outputBuffer = this.outputBuffer.slice(-Math.floor(MAX_BUFFER_CHUNKS / 2));
}

// 防止 Buffer 累积导致内存泄漏
if (this.trustDialogBuffer.length > 5000) {
  this.trustDialogBuffer = this.trustDialogBuffer.slice(-2000);
}
```

## 测试方法

### 基础测试
```bash
node server.js
# 观察输出:
# [PTY] ✓ 检测到信任对话框，自动确认...
# [PTY] ✓ 已自动确认信任
```

### WebSocket 客户端测试
```bash
node ws-test.js
# 预期输出:
# [Test] Connected to server
# [Test] Received: history
# [Test] Received: output
# --- PTY Output ---
# Claude Code 主界面...
```

### 集成测试流程
1. 启动服务器：`node server.js`
2. 连接客户端（浏览器 WebSocket 或 Android 应用）
3. 验证自动通过信任对话框
4. 发送命令：`"help\r"`
5. 验证接收到 Claude Code 响应

## 已知限制

1. **单工作区限制**：目前只能自动信任启动目录，如果运行时切换到新目录仍会弹出对话框
2. **对话框文本变化**：如果 Claude Code 更新了对话框文案，需要调整匹配关键词
3. **延迟敏感**：`setTimeout` 延迟设置为 150ms，如果系统响应慢可能需要调整

## 故障排查

### 问题：对话框未自动处理
**检查**：
```bash
# 查看服务器日志中的清理后文本
[PTY] 清理后片段: ...
```
如果没有看到 `"Yes, I trust this folder"`，说明清理逻辑有问题。

### 问题：进程立即退出
**原因**：可能发送了 `\x1B[A`（向上箭头）而非 `\x1B[B`（向下箭头）

### 问题：连接后无输出
**检查**：
```javascript
// 确认客户端是否正确订阅 'output' 消息
ws.on('message', (msg) => {
  const data = JSON.parse(msg);
  if (data.type === 'output') {
    console.log(data.data);
  }
});
```
