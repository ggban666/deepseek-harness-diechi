@echo off
chcp 65001 >nul
setlocal
title Diechi App
set "HARNESS=D:\桌面\振翅新科\蝶翅-app\diechi-harness"
set "DSH_HOME=D:\桌面\振翅新科\蝶翅-app\diechi-home"
set "URL=http://127.0.0.1:3090/"
set "PORT=3090"
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
echo Ready.
pause
exit /b 0
:timeout
echo Service did not start in 90 seconds.
pause
exit /b 1
