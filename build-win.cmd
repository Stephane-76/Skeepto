@echo off
REM Wrapper so Windows can run the build without changing the global
REM PowerShell execution policy (scripts are often Restricted by default).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-win.ps1" %*
exit /b %ERRORLEVEL%
