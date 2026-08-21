# 安装蝶翅技能到 Codex skills 目录。
# 用法: powershell -ExecutionPolicy Bypass -File .\diechi-skill\install.ps1
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$target = Join-Path $HOME '.codex\skills\diechi'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source 'SKILL.md') -Destination $target -Force
Copy-Item -Path (Join-Path $source 'README.md') -Destination $target -Force
New-Item -ItemType Directory -Path (Join-Path $target 'scripts') -Force | Out-Null
Copy-Item -Path (Join-Path $source 'scripts\*') -Destination (Join-Path $target 'scripts') -Force
New-Item -ItemType Directory -Path (Join-Path $target 'memory') -Force | Out-Null
Write-Host "已安装蝶翅技能到: $target"
Write-Host '在新对话中即可使用（以蝶翅身份对话 / 看图片视频 / 朗读转写 / 记忆回忆）。'
