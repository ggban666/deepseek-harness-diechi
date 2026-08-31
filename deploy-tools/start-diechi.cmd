@echo off
chcp 65001 >nul
setlocal
 title Diechi App
rem 以本脚本所在目录为基准，所有路径保持在项目文件夹内。
rem 本脚本位于：蝶翅-app/deploy-tools/
set "APP_ROOT=%~dp0.."
set "APP_ROOT=%APP_ROOT:\=/%"
set "HARNESS=%~dp0..\diechi-harness"
set "DSH_HOME=%~dp0..\diechi-home"
set "MODELS_DIR=%~dp0..\models"
set "VENDOR_DIR=%~dp0..\vendor"

rem 本地 Qwen3.8 供应商（8081）无需真鉴权，llama-server 默认不校验 key；
rem pi-ai 的 openai-completions 要求带 key，这里给个 dummy 即可。
set "QWEN38_API_KEY=sk-local-dummy"
set "EVOLVE_ENGINE_URL=http://127.0.0.1:8081/v1"
set "EVOLVE_ENGINE_MODEL=Qwen3.8-27B-UD-IQ1_S"
set "URL=http://127.0.0.1:3090/"
set "PORT=3090"
set "QWEN38_PORT=8081"
set "QWEN38_MODEL=%MODELS_DIR%\Qwen3.8-27B-UD-IQ1_S\Qwen3.8-27B-UD-IQ1_S.gguf"

rem 优先使用项目目录 vendor/ 下的 Node/Python（junction 到 WorkBuddy 托管运行时），
rem 保持项目自包含；若 vendor 缺失则回退到系统 PATH，但不再回退到 C 盘绝对路径。
set "NODE_EXE=%VENDOR_DIR%\node\node.exe"
if not exist "%NODE_EXE%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo ERROR: 找不到项目内置 Node（%NODE_EXE%），也找不到系统 Node。
    echo 请先运行项目根目录的 setup-vendor.cmd 创建 vendor/node junction。
    pause
    exit /b 1
  ) else (
    for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i"
  )
)

set "PYTHON_EXE=%VENDOR_DIR%\python\python.exe"
if not exist "%PYTHON_EXE%" (
  where python >nul 2>&1
  if errorlevel 1 (
    echo ERROR: 找不到项目内置 Python（%PYTHON_EXE%），也找不到系统 Python。
    echo 请先运行项目根目录的 setup-vendor.cmd 创建 vendor/python junction。
    pause
    exit /b 1
  ) else (
    for /f "delims=" %%i in ('where python') do set "PYTHON_EXE=%%i"
  )
)

echo.
echo Diechi App (蝶翅APP)
echo APP_ROOT: %APP_ROOT%
echo Open: %URL%
echo NODE_EXE: %NODE_EXE%
echo PYTHON_EXE: %PYTHON_EXE%
echo.

if not exist "%HARNESS%\package.json" (
  echo ERROR: diechi harness not found at %HARNESS%
  pause
  exit /b 1
)
if not exist "%HARNESS%\apps\cli\lib\bin.js" (
  echo ERROR: %HARNESS%\apps\cli\lib\bin.js not found.
  echo Please build the harness first ^(tsc -b^).
  pause
  exit /b 1
)
if not exist "%QWEN38_MODEL%" (
  echo ERROR: 本地模型未找到: %QWEN38_MODEL%
  echo 请确认 models/Qwen3.8-27B-UD-IQ1_S 目录存在，或修改 QWEN38_MODEL。
  pause
  exit /b 1
)

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 (
  echo Service already running.
  start "" "%URL%"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-health.ps1"
  pause
  exit /b 0
)

echo Starting local Qwen3.8 lazy proxy on %QWEN38_PORT%...
netstat -ano | findstr ":%QWEN38_PORT% " | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 (
  echo Qwen3.8 proxy already running.
) else (
  start /b "" "%PYTHON_EXE%" "%~dp0evolve\engine.py" serve-lazy --model "%QWEN38_MODEL%" --port %QWEN38_PORT% --internal-port 18081 --ngl 99 --ctx 32768 --idle-sec 600 > "%DSH_HOME%\_8081_lazy.log" 2>&1
  echo Qwen3.8 lazy proxy started (logs: %DSH_HOME%\_8081_lazy.log).
)

echo Starting Diechi...
start "Diechi App" cmd /k "set DSH_HOME=%DSH_HOME% && set QWEN38_API_KEY=%QWEN38_API_KEY% && set EVOLVE_ENGINE_URL=%EVOLVE_ENGINE_URL% && set EVOLVE_ENGINE_MODEL=%EVOLVE_ENGINE_MODEL% && cd /d %HARNESS% && %NODE_EXE% apps/cli/lib/bin.js web --port %PORT%"
echo Waiting for %URL%
set /a n=0
:wait
set /a n+=1
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
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
