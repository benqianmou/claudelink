@echo off
cd /d "%~dp0"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Using JAVA_HOME: %JAVA_HOME%
echo Current directory: %CD%
call gradlew.bat clean assembleDebug --no-daemon --stacktrace
