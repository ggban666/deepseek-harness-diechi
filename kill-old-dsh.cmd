@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3090 ^| findstr LISTENING') do (
  if not "%%a"=="0" taskkill /F /PID %%a 2>nul
)
exit /b 0
