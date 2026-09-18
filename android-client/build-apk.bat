@echo off
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0"
echo Using JAVA_HOME: %JAVA_HOME%
echo Current directory: %CD%
.\gradlew.bat assembleDebug --no-daemon
endlocal
