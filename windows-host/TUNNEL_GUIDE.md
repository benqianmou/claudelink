# 内网穿透功能说明 (Intranet Tunneling Guide)

## 功能介绍

本服务器现已集成内网穿透功能，允许从互联网访问局域网内的 Claude Code 服务。

## 使用方法

### 1. 启用隧道

编辑 `.env` 文件，设置：

```env
ENABLE_TUNNEL=true
```

### 2. 可选：自定义子域名

如果想使用固定的子域名（可能需要多次尝试）：

```env
TUNNEL_SUBDOMAIN=my-claude-server
```

留空则使用随机生成的域名。

### 3. 启动服务器

```bash
npm start
```

或使用批处理文件：

```bash
start.bat
```

### 4. 获取公网地址

服务器启动后，控制台会显示：

```
============================================================
[Tunnel] ✓ 内网穿透已启动！
[Tunnel] 公网访问地址: https://xxxxx.loca.lt
[Tunnel] WebSocket地址: wss://xxxxx.loca.lt
============================================================
```

### 5. 在 Android 客户端中使用

在 Android 应用的服务器地址设置中，使用显示的 WebSocket 地址：

```
wss://xxxxx.loca.lt
```

## 技术说明

- 使用 [localtunnel](https://github.com/localtunnel/localtunnel) 服务
- 免费且无需注册
- 自动 HTTPS/WSS 加密
- 隧道关闭后会自动重连

## 安全建议

1. **首次访问警告**: localtunnel 在浏览器首次访问时会显示警告页面，点击 "Continue" 继续
2. **访问控制**: 建议只在需要时启用隧道功能
3. **密码保护**: 考虑在 WebSocket 层添加身份验证（未来更新）
4. **数据加密**: 所有流量通过 HTTPS/WSS 加密传输

## 故障排查

### 隧道无法启动

- 检查网络连接
- 尝试更换子域名或使用随机域名
- 查看控制台错误信息

### Android 客户端无法连接

- 确保使用 `wss://` 协议（不是 `ws://`）
- 检查地址是否正确复制
- 在浏览器中先访问一次隧道地址，通过警告页面

### 连接不稳定

- localtunnel 服务可能有时不稳定
- 重启服务器获取新的隧道地址
- 考虑使用其他隧道服务（ngrok, cloudflared 等）

## 禁用隧道

如果只需要局域网访问，在 `.env` 中设置：

```env
ENABLE_TUNNEL=false
```

或删除该行。

## 替代方案

如果 localtunnel 不稳定，可以考虑：

- **ngrok**: 更稳定，但免费版有限制
- **cloudflared**: Cloudflare 的隧道服务，需要账号
- **frp**: 需要自己的服务器
- **端口转发**: 在路由器上配置端口转发（需要公网 IP）
