<#
  4-setup-iis-proxy.ps1
  Cấu hình IIS làm reverse proxy cho app QuanLY (Node ở 127.0.0.1:3000),
  thay cho app C# cũ đang chạy domain gianguyen.cloud.

  Việc script làm:
    1. Bật ARR "Enable proxy" ở mức server.
    2. Cho phép server variable HTTP_X_FORWARDED_PROTO / HTTP_X_FORWARDED_HOST.
    3. Backup web.config cũ của site rồi copy web.config (reverse proxy) vào.
    4. Restart site.

  Yêu cầu cài trước (1 lần, KHÔNG tự cài được qua script này):
    - URL Rewrite 2.1        https://www.iis.net/downloads/microsoft/url-rewrite
    - Application Request Routing 3.0  https://www.iis.net/downloads/microsoft/application-request-routing

  Chạy quyền Administrator. Ví dụ:
    .\4-setup-iis-proxy.ps1 -SiteName "gianguyen.cloud" -RepoDir C:\apps\quanly
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SiteName,   # tên site trong IIS (đang gắn domain gianguyen.cloud)
  [string]$RepoDir = (Get-Location).Path             # nơi chứa deploy\windows\web.config
)

$ErrorActionPreference = "Stop"
Import-Module WebAdministration -ErrorAction Stop
$appcmd = Join-Path $env:windir "system32\inetsrv\appcmd.exe"

# --- 0. Kiểm tra ARR/URL Rewrite đã cài chưa ---
$rewriteOk = Test-Path "$env:windir\system32\inetsrv\rewrite.dll"
if (-not $rewriteOk) {
  throw "Chưa cài URL Rewrite. Cài tại https://www.iis.net/downloads/microsoft/url-rewrite rồi chạy lại."
}

# --- 1. Bật ARR proxy ở mức server ---
Write-Host "• Bật ARR proxy..." -ForegroundColor Cyan
& $appcmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Không bật được ARR proxy — nhiều khả năng CHƯA cài Application Request Routing 3.0. " +
        "Cài tại https://www.iis.net/downloads/microsoft/application-request-routing rồi chạy lại."
}
# Tắt rewrite host trong response header để app nhận đúng Host
& $appcmd set config -section:system.webServer/proxy /reverseRewriteHostInResponseHeaders:"False" /commit:apphost 2>&1 | Out-Null

# --- 2. Cho phép set server variable (cần cho HTTP_X_FORWARDED_PROTO) ---
Write-Host "• Cho phép server variables X-Forwarded-*..." -ForegroundColor Cyan
foreach ($v in @("HTTP_X_FORWARDED_PROTO", "HTTP_X_FORWARDED_HOST")) {
  & $appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='$v']" /commit:apphost 2>&1 | Out-Null
  # Bỏ qua lỗi "đã tồn tại"
}

# --- 3. Copy web.config vào physical path của site ---
$site = Get-Website | Where-Object { $_.Name -eq $SiteName }
if (-not $site) {
  Write-Host "Các site hiện có:" -ForegroundColor Yellow
  Get-Website | Format-Table Name, State, PhysicalPath -AutoSize
  throw "Không thấy site tên '$SiteName'. Xem danh sách bên trên và truyền đúng -SiteName."
}
$physical = [Environment]::ExpandEnvironmentVariables($site.PhysicalPath)
Write-Host "• Site '$SiteName' → $physical" -ForegroundColor Cyan

$srcWebConfig = Join-Path $RepoDir "deploy\windows\web.config"
if (-not (Test-Path $srcWebConfig)) { throw "Không thấy $srcWebConfig" }

$destWebConfig = Join-Path $physical "web.config"
if (Test-Path $destWebConfig) {
  $bak = "$destWebConfig.csharp-bak"
  Copy-Item $destWebConfig $bak -Force
  Write-Host "✓ Backup web.config cũ → $bak" -ForegroundColor Green
}
Copy-Item $srcWebConfig $destWebConfig -Force
Write-Host "✓ Đã đặt web.config reverse-proxy vào site" -ForegroundColor Green

# --- 4. Restart site ---
Stop-Website  -Name $SiteName -ErrorAction SilentlyContinue
Start-Website -Name $SiteName
Write-Host "✓ Restart site '$SiteName'" -ForegroundColor Green

Write-Host ""
Write-Host "HOÀN TẤT. Thử mở https://gianguyen.cloud" -ForegroundColor Green
Write-Host "Nếu lỗi 502.3 → Node chưa chạy (kiểm tra service QuanLY-Web)." -ForegroundColor Yellow
Write-Host "Nếu login bị đá ra → kiểm tra web.config có set HTTP_X_FORWARDED_PROTO=https." -ForegroundColor Yellow
Write-Host ""
Write-Host "GHI CHÚ SSE (thông báo realtime): nếu thông báo realtime không đẩy ngay," -ForegroundColor Yellow
Write-Host "vào IIS Manager → server → Application Request Routing Cache → Server Proxy Settings →" -ForegroundColor Yellow
Write-Host "đặt 'Response buffer threshold (KB)' = 0, rồi restart site." -ForegroundColor Yellow
