@echo off
chcp 65001 >nul
setlocal
title Diechi App
set "HARNESS=D:\桌面\振翅科技\蝶翅-app\diechi-harness"
set "DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home"
rem 本地 Qwen3.8 供应商（8081）无需真鉴权，llama-server 默认不校验 key；
rem pi-ai 的 openai-completions 要求带 key，这里给个 dummy 即可。
set "QWEN38_API_KEY=sk-local-dummy"
set "EVOLVE_ENGINE_URL=http://127.0.0.1:8081/v1"
set "EVOLVE_ENGINE_MODEL=Qwen3.8-27B-UD-IQ1_S"
set "URL=http://127.0.0.1:3090/"
set "PORT=3090"
set "QWEN38_PORT=8081"
set "QWEN38_MODEL=D:\桌面\振翅科技\models\Qwen3.8-27B-UD-IQ1_S\Qwen3.8-27B-UD-IQ1_S.gguf"
echo.
echo Diechi App (蝶翅APP)
echo Open: %URL%
echo.
if not exist "%HARNESS%\package.json" (
  echo ERROR: diechi harness not found
  pause
  exit /b 1
)
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo ERROR: Node.js not found
  pause
  exit /b 1
)
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo ERROR: pnpm not found
  pause
  exit /b 1
)
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 (
  echo Service already running.
  start "" "%URL%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-health.ps1"
  pause
  exit /b 0
)
if not exist "%HARNESS%\node_modules" (
  echo Installing dependencies...
  pushd "%HARNESS%"
  call pnpm install
  if errorlevel 1 (
    echo ERROR: pnpm install failed
    popd
    pause
    exit /b 1
  )
  popd
)
echo Starting local Qwen3.8 lazy proxy on %QWEN38_PORT%...
netstat -ano | findstr ":%QWEN38_PORT% " | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 (
  echo Qwen3.8 proxy already running.
) else (
  start /b "" "C:\Users\wang\.workbuddy\binaries\python\versions\3.13.12\python.exe" "%~dp0evolve\engine.py" serve-lazy --model "%QWEN38_MODEL%" --port %QWEN38_PORT% --internal-port 18081 --ngl 99 --ctx 2048 --idle-sec 600 > "%DSH_HOME%\_8081_lazy.log" 2>&1
  echo Qwen3.8 lazy proxy started (logs: %DSH_HOME%\_8081_lazy.log).
)
echo Starting Diechi...
start "Diechi App" cmd /k "set DSH_HOME=%DSH_HOME%&& cd /d %HARNESS% && pnpm dsh web --port %PORT%"
echo Waiting for %URL%
set /a n=0
:wait
set /a n+=1
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 goto ready
if %n% geq 45 goto timeout
timeout /t 2 /nobreak >nul
goto wait
:ready
start "" "%URL%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-health.ps1"
echo Ready.
pause
exit /b 0
:timeout
echo Service did not start in 90 seconds.
pause
exit /b 1
