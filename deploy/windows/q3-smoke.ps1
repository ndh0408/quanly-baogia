# Smoke-test tren port tam (mac dinh 5055). KHONG dung toi app C#.
# dotenv override=false => $env:PORT thang gia tri trong .env.
param([string]$AppDir = 'C:\Projects\quanly', [int]$TestPort = 5055)
$ErrorActionPreference = 'Stop'
Set-Location $AppDir
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'logs') | Out-Null
$node = (Get-Command node).Source
$env:PORT = "$TestPort"
$outLog = Join-Path $AppDir 'logs\smoke-out.log'
$errLog = Join-Path $AppDir 'logs\smoke-err.log'

$p = Start-Process -FilePath $node -ArgumentList 'src/server.js' -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Start-Sleep -Seconds 6

$ready = $null
for ($i = 0; $i -lt 8; $i++) {
  try { $ready = (Invoke-WebRequest "http://127.0.0.1:$TestPort/readyz" -UseBasicParsing -TimeoutSec 4).StatusCode; if ($ready -eq 200) { break } }
  catch { Start-Sleep -Seconds 2 }
}
$live = $null
try { $live = (Invoke-WebRequest "http://127.0.0.1:$TestPort/livez" -UseBasicParsing -TimeoutSec 4).StatusCode } catch {}

Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

if ($ready -eq 200) {
  Write-Output "SMOKE_OK readyz=$ready livez=$live"
} else {
  Write-Output "SMOKE_FAIL readyz=$ready livez=$live"
  Write-Output "---- smoke-err.log (tail) ----"
  Get-Content $errLog -Tail 40 -ErrorAction SilentlyContinue
  Write-Output "---- smoke-out.log (tail) ----"
  Get-Content $outLog -Tail 40 -ErrorAction SilentlyContinue
}
