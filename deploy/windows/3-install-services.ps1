<#
  3-install-services.ps1
  Dựng 2 Windows Service bằng NSSM:
    - QuanLY-Web     : node src/server.js   (web, cổng 3000)
    - QuanLY-Worker  : node src/worker.js   (xử lý hàng đợi nền, WORKER_MODE=true)
  Tự tải NSSM nếu máy chưa có. Kiểm tra Memurai (Redis) ở cổng 6379.
  Chạy quyền Administrator.

  Ví dụ:
    .\3-install-services.ps1 -AppDir C:\apps\quanly
#>
[CmdletBinding()]
param(
  [string]$AppDir      = (Get-Location).Path,
  [string]$WebService  = "QuanLY-Web",
  [string]$WorkerService = "QuanLY-Worker"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $AppDir "src\server.js"))) {
  throw "Không thấy src\server.js trong $AppDir."
}
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { throw "Chưa cài Node.js." }

$logDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# --- Đảm bảo có NSSM ---
function Get-Nssm {
  param([string]$AppDir)
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $local = Join-Path $AppDir "tools\nssm\nssm.exe"
  if (Test-Path $local) { return $local }

  Write-Host "• Tải NSSM..." -ForegroundColor Cyan
  $toolsDir = Join-Path $AppDir "tools"
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $zip = Join-Path $toolsDir "nssm.zip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $toolsDir -Force
  $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
  $src = Get-ChildItem -Path $toolsDir -Recurse -Filter "nssm.exe" |
         Where-Object { $_.FullName -match "\\$arch\\" } | Select-Object -First 1
  if (-not $src) { throw "Không tìm thấy nssm.exe sau khi giải nén." }
  New-Item -ItemType Directory -Force -Path (Split-Path $local) | Out-Null
  Copy-Item $src.FullName $local -Force
  Remove-Item $zip -Force
  return $local
}
$nssm = Get-Nssm -AppDir $AppDir
Write-Host "✓ NSSM: $nssm" -ForegroundColor Green

# --- Cảnh báo nếu Memurai/Redis chưa chạy ---
$redisUp = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $redisUp) {
  Write-Host "⚠ Cổng 6379 (Redis/Memurai) chưa mở. Worker sẽ retry tới khi Memurai chạy." -ForegroundColor Yellow
  Write-Host "  Cài Memurai (free):  choco install memurai-developer -y" -ForegroundColor Yellow
  Write-Host "  Hoặc MSI:            https://www.memurai.com/get-memurai" -ForegroundColor Yellow
} else {
  Write-Host "✓ Redis/Memurai đang chạy ở 6379" -ForegroundColor Green
}

# --- Helper: cài 1 service (idempotent) ---
function Install-Svc {
  param([string]$Name, [string]$Script, [string[]]$ExtraEnv)
  $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "• Service '$Name' đã có — gỡ để cài lại..." -ForegroundColor Yellow
    if ($existing.Status -ne 'Stopped') { & $nssm stop $Name | Out-Null }
    & $nssm remove $Name confirm | Out-Null
    Start-Sleep -Milliseconds 500
  }
  & $nssm install $Name $nodeExe (Join-Path $AppDir $Script)
  & $nssm set $Name AppDirectory $AppDir
  & $nssm set $Name AppStdout (Join-Path $logDir "$Name.out.log")
  & $nssm set $Name AppStderr (Join-Path $logDir "$Name.err.log")
  & $nssm set $Name AppRotateFiles 1
  & $nssm set $Name AppRotateBytes 10485760
  & $nssm set $Name Start SERVICE_AUTO_START
  & $nssm set $Name AppStopMethodConsole 5000
  & $nssm set $Name AppExit Default Restart
  & $nssm set $Name AppRestartDelay 3000
  & $nssm set $Name DisplayName "QuanLY - $Name"
  if ($ExtraEnv) { & $nssm set $Name AppEnvironmentExtra $ExtraEnv }
  Write-Host "✓ Cài service '$Name'" -ForegroundColor Green
}

Install-Svc -Name $WebService    -Script "src\server.js"
Install-Svc -Name $WorkerService -Script "src\worker.js" -ExtraEnv @("WORKER_MODE=true")

# --- Khởi động ---
Start-Service $WebService
try { Start-Service $WorkerService } catch { Write-Host "⚠ Worker chưa start (chờ Memurai)." -ForegroundColor Yellow }

Start-Sleep -Seconds 3
Write-Host ""
Get-Service $WebService, $WorkerService | Format-Table Name, Status, StartType -AutoSize

# --- Kiểm tra health ---
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/livez" -UseBasicParsing -TimeoutSec 5
  Write-Host "✓ /livez → $($r.StatusCode) $($r.Content)" -ForegroundColor Green
} catch {
  Write-Host "⚠ Chưa gọi được http://127.0.0.1:3000/livez — xem log: $logDir\$WebService.err.log" -ForegroundColor Yellow
}
Write-Host "→ Tiếp theo: 4-setup-iis-proxy.ps1 để IIS trỏ domain vào Node." -ForegroundColor Cyan
