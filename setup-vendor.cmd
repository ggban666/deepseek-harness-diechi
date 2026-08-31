@echo off
chcp 65001 >nul
setlocal

rem setup-vendor.cmd
rem 在蝶翅-app/vendor/ 下创建 node/python 目录 junction，
rem 让 start-diechi.cmd 不再依赖 C 盘绝对路径。
rem 同时把项目根目录的 models/ 链接到蝶翅-app/models/，保持所有路径都在项目文件夹内。
rem 如果你不用 WorkBuddy，请修改本脚本开头的 NODE_SRC/PYTHON_SRC，
rem 或直接把 node.exe/python.exe 所在目录复制/链接到 vendor/node 和 vendor/python。

rem 允许通过环境变量覆盖源目录
if "%NODE_SRC%"=="" set "NODE_SRC=C:\Users\%USERNAME%\.workbuddy\binaries\node\versions\22.22.2-2"
if "%PYTHON_SRC%"=="" set "PYTHON_SRC=C:\Users\%USERNAME%\.workbuddy\binaries\python\versions\3.13.12"

set "VENDOR=%~dp0vendor"
set "MODELS_SRC=%~dp0..\models"
set "MODELS_DST=%~dp0models"

if not exist "%NODE_SRC%\node.exe" (
  echo ERROR: Node 源目录不存在: %NODE_SRC%
  echo 请修改本脚本开头的 NODE_SRC 为你的 Node 安装目录，或安装 WorkBuddy。
  pause
  exit /b 1
)

if not exist "%PYTHON_SRC%\python.exe" (
  echo ERROR: Python 源目录不存在: %PYTHON_SRC%
  echo 请修改本脚本开头的 PYTHON_SRC 为你的 Python 安装目录，或安装 WorkBuddy。
  pause
  exit /b 1
)

if not exist "%VENDOR%" mkdir "%VENDOR%"

if exist "%VENDOR%\node" rmdir /s /q "%VENDOR%\node"
mklink /j "%VENDOR%\node" "%NODE_SRC%" >nul
if %ERRORLEVEL% neq 0 (
  echo ERROR: 创建 node junction 失败
  pause
  exit /b 1
)

if exist "%VENDOR%\python" rmdir /s /q "%VENDOR%\python"
mklink /j "%VENDOR%\python" "%PYTHON_SRC%" >nul
if %ERRORLEVEL% neq 0 (
  echo ERROR: 创建 python junction 失败
  pause
  exit /b 1
)

rem 若项目根目录存在 models，则在蝶翅-app内创建一个 junction，保持路径自包含
if exist "%MODELS_SRC%" (
  if exist "%MODELS_DST%" rmdir /s /q "%MODELS_DST%"
  mklink /j "%MODELS_DST%" "%MODELS_SRC%" >nul
  if %ERRORLEVEL% neq 0 (
    echo WARNING: 创建 models junction 失败，将直接使用 %MODELS_SRC%
  ) else (
    echo models          -> %MODELS_SRC%
  )
) else (
  echo WARNING: 未找到项目根目录的 models 文件夹，请自行准备模型数据。
)

echo.
echo vendor/node  -> %NODE_SRC%
echo vendor/python -> %PYTHON_SRC%
echo.
echo 完成。现在可以双击 deploy-tools/start-diechi.cmd 或桌面快捷方式启动蝶翅APP。
pause
exit /b 0
