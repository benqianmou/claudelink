package com.claudelink

/**
 * 服务器地址 → OkHttp 认的 http(s) 地址。两条规矩，别在这里让步：
 *
 * 1. 令牌**绝不进 URL**。URL 会被写进服务端日志、代理日志和 ngrok 的请求检查器，
 *    访问令牌等于宿主机终端（能跑任意命令），所以只能走 Authorization 头（见 WebSocketClient）。
 * 2. **明文只连内网**。公网地址上 `ws://` 就是把自己的令牌和终端一起送给链路上任何人；
 *    公网必须用 https（ngrok/cloudflared 隧道），okhttp 会自动升成 wss。
 */
object ServerAddress {

    /** 局域网里常见的私有后缀（`.local` 是 mDNS，其余是路由器默认域） */
    private val LAN_SUFFIXES = listOf(".local", ".lan", ".home", ".internal")

    /** 解析输入并给出最终连接地址；不合法/不安全时抛 [IllegalArgumentException]，消息直接给用户看。 */
    @Throws(IllegalArgumentException::class)
    fun buildUrl(input: String): String {
        val trimmed = input.trim().trimEnd('/')
        if (trimmed.isEmpty()) throw IllegalArgumentException("请填写服务器地址")

        val lower = trimmed.lowercase()
        val secure = lower.startsWith("https://") || lower.startsWith("wss://")
        val address = when {
            lower.startsWith("https://") -> trimmed.substring(8)
            lower.startsWith("http://") -> trimmed.substring(7)
            lower.startsWith("wss://") -> trimmed.substring(6)
            lower.startsWith("ws://") -> trimmed.substring(5)
            else -> trimmed
        }
        // userinfo（user@host）会让"我判定的主机"和"OkHttp 实际连的主机"不是同一台：
        // 判定看成内网而实际连的是公网，正好绕过下面这条明文闸门
        if (address.contains('@')) throw IllegalArgumentException("地址无效：$input")
        val host = hostOf(address)
        if (host.isEmpty()) throw IllegalArgumentException("地址无效：$input")

        if (!secure && !isCleartextTrusted(host)) {
            throw IllegalArgumentException("公网地址必须用 https:// —— 明文连接会把访问令牌暴露给链路上任何人")
        }
        return (if (secure) "https://" else "http://") + address + "/ws"
    }

    /** 取主机名：去掉路径、端口和 IPv6 的方括号。 */
    fun hostOf(address: String): String {
        val authority = address.substringBefore('/').substringBefore('?')
        return when {
            authority.startsWith("[") -> authority.substringAfter("[").substringBefore("]")
            authority.count { it == ':' } == 1 -> authority.substringBefore(':')
            else -> authority
        }
    }

    /**
     * 明文连接是否允许连这台主机（本机 / 内网 / 局域网私有域名）。
     * 名字直说结论：它不只是"是不是私有 IP"，而是**明文信任边界**（分组播、公网域名都在外面）。
     */
    fun isCleartextTrusted(host: String): Boolean {
        val h = host.lowercase()
        if (h.isEmpty()) return false
        if (h == "localhost" || h.endsWith(".localhost")) return true
        if (LAN_SUFFIXES.any { h.endsWith(it) }) return true
        // IPv6：::1、ULA(fc00::/7)、链路本地(fe80::/10)。只有含冒号的才算字面量，避免误判域名
        if (h.contains(':')) {
            if (h == "::1" || h.startsWith("fc") || h.startsWith("fd")) return true
            val hextet = h.substringBefore(':').toIntOrNull(16) ?: return false
            return hextet and 0xFFC0 == 0xFE80
        }

        val parts = h.split('.')
        if (parts.size != 4) {
            if (h.contains('.')) return false   // 域名当公网
            // 裸主机名当内网名，但 IPv4 的遗留数字写法（2130706433、0x7f000001）系统会当 IP 解析，
            // 不能当内网名放行；同时要求是一个像样的主机名标签
            val legacyNumeric = h.all { it.isDigit() } ||
                (h.startsWith("0x") && h.length > 2 && h.drop(2).all { it in '0'..'9' || it in 'a'..'f' })
            if (legacyNumeric) return false
            return h.all { it in 'a'..'z' || it in '0'..'9' || it == '-' } && h.any { it in 'a'..'z' }
        }
        val nums = parts.map { it.toIntOrNull() ?: return false }
        if (nums.any { it !in 0..255 }) return false
        return when {
            nums[0] == 10 || nums[0] == 127 -> true
            nums[0] == 192 && nums[1] == 168 -> true
            nums[0] == 172 && nums[1] in 16..31 -> true
            nums[0] == 169 && nums[1] == 254 -> true
            nums[0] == 100 && nums[1] in 64..127 -> true   // CGNAT / Tailscale
            else -> false
        }
    }
}
