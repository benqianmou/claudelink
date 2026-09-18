@echo off
echo ========================================
echo Ngrok 问题修复脚本
echo ========================================
echo.

echo [1/4] 清理旧的 ngrok 配置...
if exist "%USERPROFILE%\.ngrok2\ngrok.yml" (
    del /F /Q "%USERPROFILE%\.ngrok2\ngrok.yml"
    echo ✓ 已删除旧配置
) else (
    echo ✓ 无旧配置需要清理
)

echo.
echo [2/4] 检查 ngrok 是否安装...
where ngrok >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✓ Ngrok 已安装
    ngrok version
) else (
    echo ✗ Ngrok 未安装
    echo.
    echo 请访问 https://ngrok.com/download 下载并安装
    pause
    exit /b 1
)

echo.
echo [3/4] 设置 authtoken...
if not defined NGROK_AUTHTOKEN (
    echo ✗ 环境变量 NGROK_AUTHTOKEN 未设置
    echo.
    set /p TOKEN="请输入你的 ngrok authtoken: "
    ngrok authtoken %TOKEN%
) else (
    echo ✓ 使用 .env 中的 authtoken
    ngrok authtoken %NGROK_AUTHTOKEN%
)

echo.
echo [4/4] 测试连接...
echo 启动测试隧道 (按 Ctrl+C 停止)...
timeout /t 2 >nul
ngrok http 3000

pause
