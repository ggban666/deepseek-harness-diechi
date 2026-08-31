@echo off
chcp 65001 >nul
setlocal

rem setup-vendor.cmd
rem 在项目根目录的 vendor/ 下创建 node/python 目录 junction，
rem 让 start-diechi.cmd 可以不依赖 C 盘绝对路径运行。
rem 如果你不用 WorkBuddy，请把 node.exe/python.exe 所在目录复制或链接到 vendor/node 和 vendor/python。

set "NODE_SRC=C:\Users\wang\.workbuddy\binaries\node\versions\22.22.2-2"
set "PYTHON_SRC=C:\Users\wang\.workbuddy\binaries\python\versions\3.13.12"
set "VENDOR=%~dp0vendor"

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

echo.
echo vendor/node  -> %NODE_SRC%
echo vendor/python -> %PYTHON_SRC%
echo.
echo 完成。现在可以双击 deploy-tools/start-diechi.cmd 或桌面快捷方式启动蝶翅APP。
pause
exit /b 0
