@echo off
setlocal
set "JAVA_HOME=C:\Users\Lenovo\.jdks\jdk-17.0.13+11"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0"
echo Using JAVA_HOME: %JAVA_HOME%
echo Current directory: %CD%
.\gradlew.bat assembleDebug --no-daemon
endlocal
