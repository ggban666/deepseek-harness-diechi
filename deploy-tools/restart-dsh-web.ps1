# 蝶翅 dsh web 重启脚本：杀掉旧宿主进程，重新启动加载最新 lib。
# 由独立 PowerShell 进程执行，不依赖宿主自身的 job 管理。
# 路径以项目根目录（蝶翅-app，本脚本上一级）为基准，保持项目自包含。
$ErrorActionPreference = 'Continue'

$appRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrEmpty($appRoot)) { $appRoot = (Get-Location).Path }

$harness = Join-Path $appRoot 'diechi-harness'
$dshHome = Join-Path $appRoot 'diechi-home'
$nodeExe = Join-Path $appRoot 'vendor\node\node.exe'
if (-not (Test-Path $nodeExe)) {
    $sysNode = Get-Command node -ErrorAction SilentlyContinue
    if ($sysNode) { $nodeExe = $sysNode.Source } else {
        Write-Error "找不到项目内置 Node（$nodeExe），也找不到系统 Node。请先运行 setup-vendor.cmd。"
        exit 1
    }
}

$old = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -match 'bin\.ts.*"web"' -or $_.CommandLine -match 'dsh web' -or $_.CommandLine -match 'apps/cli/lib/bin\.js web'
}
foreach ($p in $old) {
    Write-Host "killing $($p.ProcessId): $($p.CommandLine.Substring(0, [Math]::Min(90, $p.CommandLine.Length)))"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$env:DSH_HOME = $dshHome
$env:NODE_OPTIONS = '--max-old-space-size=8192'
Set-Location $harness
Write-Host "starting dsh web on 3090 with DSH_HOME=$env:DSH_HOME"
& $nodeExe apps/cli/lib/bin.js web --port 3090 2>&1 | ForEach-Object { Write-Host $_ }
Write-Host "dsh web exited (code $LASTEXITCODE)"
