@echo off
chcp 65001 >nul
setlocal
set "MARKER=D:\桌面\振翅科技\蝶翅-app\deploy-tools\relaunch-diechi.marker"
set "DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home"
del "%MARKER%" >nul 2>&1
rem 给当前对话留出完成收尾的时间
timeout /t 25 /nobreak >nul
rem 停止占用 3090 的旧服务
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3090" ^| findstr "LISTENING"') do taskkill /f /pid %%P >nul 2>&1
timeout /t 3 /nobreak >nul
rem 以与启动器相同的方式拉起新服务
cd /d "D:\桌面\振翅科技\蝶翅-app\diechi-harness"
start "蝶翅APP" cmd /c "set DSH_HOME=%DSH_HOME%&& pnpm dsh web --port 3090"
rem 等待端口就绪，写入结果标记
set /a n=0
:wait
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":3090" | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 goto up
set /a n+=1
if %n% geq 45 goto down
goto wait
:up
echo OK > "%MARKER%"
exit /b 0
:down
echo FAILED > "%MARKER%"
exit /b 1
