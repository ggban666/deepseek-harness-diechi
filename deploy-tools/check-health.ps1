# 蝶翅APP 健康自检：启动后调用，防止"供应商消失/服务未起"静默发生
$errs = [System.Collections.Generic.List[string]]::new()
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 6
  if ($h.status -ne "ok") { $errs.Add("8080 health 异常: " + ($h | ConvertTo-Json -Compress)) }
} catch { $errs.Add("8080 视觉/语音服务未响应: " + $_.Exception.Message) }
try {
  $body = '{"type":"client-request","rpcId":"hc-1","method":"llm.providers","payload":{}}'
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:3090/api/llm.providers" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 8
  $active = @($r.result.value.providers | Where-Object { $_.active -eq $true })
  foreach ($need in @('minmax','local-vision','abl','agnes','qwen38')) {
    if ($active.provider -notcontains $need) { $errs.Add("供应商缺失: " + $need + "（可能 DSH_HOME 起错，检查启动脚本）") }
  }
} catch { $errs.Add("3090 供应商查询失败: " + $_.Exception.Message) }
if ($errs.Count -gt 0) {
  Write-Host ""
  Write-Host "[蝶翅自检] 发现问题:" -ForegroundColor Yellow
  foreach ($e in $errs) { Write-Host "  - $e" -ForegroundColor Yellow }
  Write-Host "[蝶翅自检] 建议: 用 蝶翅APP启动器.cmd / start-diechi.cmd 重启（必须带 DSH_HOME）" -ForegroundColor Yellow
  exit 1
}
Write-Host ""
Write-Host "[蝶翅自检] 通过: 3090 供应商齐全, 8080 视觉/语音正常" -ForegroundColor Green
exit 0