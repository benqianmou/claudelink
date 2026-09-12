Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d E:\projects\claudelink\windows-host && node server.js", 0, False
