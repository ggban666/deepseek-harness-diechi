# 蝶翅 dsh web 重启脚本：杀掉旧宿主进程，重新启动加载最新 lib。
# 由独立 PowerShell 进程执行，不依赖宿主自身的 job 管理。
$ErrorActionPreference = 'Continue'

$old = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -match 'bin\.ts.*"web"' -or $_.CommandLine -match 'dsh web'
}
foreach ($p in $old) {
  Write-Host "killing $($p.ProcessId): $($p.CommandLine.Substring(0, [Math]::Min(90, $p.CommandLine.Length)))"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$env:DSH_HOME = 'D:\桌面\振翅科技\蝶翅-app\diechi-home'
$env:NODE_OPTIONS = '--max-old-space-size=8192'
Set-Location 'D:\桌面\振翅科技\蝶翅-app\diechi-harness'
Write-Host "starting dsh web on 3090 with DSH_HOME=$env:DSH_HOME"
& pnpm dsh web --port 3090 2>&1 | ForEach-Object { Write-Host $_ }
Write-Host "dsh web exited (code $LASTEXITCODE)"
