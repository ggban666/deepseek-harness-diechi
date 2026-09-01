# 蝶翅APP 一键启动器

## 作用

`蝶翅APP启动器.exe` 是桌面快捷入口，双击后会调用同目录下的 `deploy-tools/start-diechi.cmd`，由它统一完成：

1. 停止占用 3090/8081 端口的旧进程
2. 启动 8081 本地 Qwen3.8 懒加载代理（首次请求才上 GPU，空闲 600 秒自动卸载）
3. 启动 3090 蝶翅主服务
4. 打开浏览器访问 `http://127.0.0.1:3090`

> 启动逻辑以 `deploy-tools/start-diechi.cmd` 为唯一事实来源，启动器只是它的包装器（负责日志、弹窗、端口检查）。

## 环境要求

- Windows 10/11 x64
- 无需安装 .NET 运行时（exe 为单文件自包含发布，已内嵌 .NET 9）
- Node.js 22+ 和 Python 3.13+（本项目通过 `vendor/node` 和 `vendor/python` 目录 junction 引用，保持运行依赖在 `蝶翅-app` 文件夹内）
- 已正确放置模型文件：`models/Qwen3.8-27B-UD-IQ1_S/Qwen3.8-27B-UD-IQ1_S.gguf`（项目根目录的 `models/` 会被链接到 `蝶翅-app/models/`）

## 首次准备（vendor 链接）

项目根目录运行：

```cmd
setup-vendor.cmd
```

它会在 `vendor/` 下创建 `node` 和 `python` 两个 junction，分别指向 WorkBuddy 托管的运行时；若项目根目录已存在 `models/`，还会创建 `蝶翅-app/models/` junction。这样 `start-diechi.cmd` 就不依赖 `C:\Users\%USERNAME%\.workbuddy` 这类绝对路径。

> `vendor/` 目录本身被 `.gitignore` 忽略，不会进入 git。别人下载后需要先运行一次 `setup-vendor.cmd`（或自行把 node/python 放到 `vendor/node`、`vendor/python`）。

## 从源码编译

源码位于 `deploy-tools/DiechiLauncher.cs` + `deploy-tools/DiechiLauncher.csproj`。若需重新生成 exe：

```powershell
cd "D:\桌面\振翅科技\蝶翅-app\deploy-tools"
dotnet build DiechiLauncher.csproj -c Release -o ..
```

编译产物（`.exe`、`.dll`、`.runtimeconfig.json`、`.deps.json`）会出现在 `蝶翅-app` 根目录，不被 git 跟踪，仅在本地使用。

## 使用方法

1. 把 `蝶翅APP启动器.exe` 发送到桌面快捷方式
2. 快捷方式目标：`D:\桌面\振翅科技\蝶翅-app\蝶翅APP启动器.exe`
3. 快捷方式起始位置：`D:\桌面\振翅科技\蝶翅-app`
4. 双击即可启动

## 常见问题

### 提示"蝶翅APP 启动失败：找不到启动脚本"

确保 `蝶翅APP启动器.exe` 放在 `蝶翅-app` 根目录或 `deploy-tools` 子目录，且 `deploy-tools/start-diechi.cmd` 存在。

### 提示需要安装 .NET

当前版本为单文件自包含发布（`net9.0-windows` + `SelfContained`），正常情况下**无需安装**任何 .NET 运行时。若仍提示缺少运行时，说明 exe 是旧版框架依赖产物——请用下方「从源码编译」重新生成自包含版。

### 启动后 3090 无法访问

查看 `deploy-tools/start-diechi.cmd` 弹出的命令行窗口，或检查 `diechi-home/_3090.log`。
最常见原因是 `DSH_HOME` 未正确设置——启动器会调用 start-diechi.cmd，由它在子进程中设置正确的环境变量。

### 启动器闪退

查看同目录下的 `DiechiLauncher.log`。
