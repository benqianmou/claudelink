@echo off
setlocal
set PORT=3000
for /f "delims=" %%p in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"') do set LISTENING_PID=%%p

if not "%LISTENING_PID%"=="" (
    echo ClaudeLink server is already running (PID %LISTENING_PID%).
    echo Opening the existing server in your browser instead of starting a duplicate...
    powershell -NoProfile -Command "Start-Process 'http://localhost:%PORT%/'"
    exit /b 0
)

echo Starting ClaudeLink server... Log: %~dp0server.log
start /B node "%~dp0server.js" > "%~dp0server.log" 2>&1
echo Server is starting. Token and URLs are printed into server.log
echo Tail the log to see them:  powershell -NoProfile -Command "Get-Content server.log -Tail 30"
