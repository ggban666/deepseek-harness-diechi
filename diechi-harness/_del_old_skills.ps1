$root = (Resolve-Path 'D:\桌面\振翅新科\蝶翅-app\diechi-home\skills').Path
foreach ($name in @('sqe-8d','legal-consult','customer-service','hr-management')) {
  $t = Join-Path $root $name
  $resolved = (Resolve-Path $t -ErrorAction SilentlyContinue).Path
  if ($null -ne $resolved -and $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
    Write-Output ("removed: " + $resolved)
  } else {
    Write-Output ("skip: " + $t)
  }
}
Write-Output "--- remaining ---"
Get-ChildItem (Join-Path $root '.') -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name