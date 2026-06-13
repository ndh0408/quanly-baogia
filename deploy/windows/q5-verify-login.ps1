# Verify dang nhap end-to-end qua https://gianguyen.cloud (chung minh secure-cookie + trust-proxy OK).
param([string]$AppDir = 'C:\Projects\quanly', [string]$BaseUrl = 'https://gianguyen.cloud')
$ErrorActionPreference = 'Stop'
$cred = Join-Path $AppDir '.admin-credentials.local'
if (-not (Test-Path $cred)) { Write-Output "NO_CRED_FILE (admin da ton tai tu truoc - bo qua)"; return }
$adminPw = ((Get-Content $cred | Where-Object { $_ -match '^ADMIN_PASSWORD=' }) -replace '^ADMIN_PASSWORD=', '').Trim()
$adminUser = ((Get-Content $cred | Where-Object { $_ -match '^ADMIN_USERNAME=' }) -replace '^ADMIN_USERNAME=', '').Trim()
if (-not $adminUser) { $adminUser = 'admin' }
$body = @{ username = $adminUser; password = $adminPw } | ConvertTo-Json -Compress
try {
  $r = Invoke-WebRequest "$BaseUrl/api/auth/login" -Method POST -Body $body -ContentType 'application/json' `
    -SessionVariable s -UseBasicParsing -TimeoutSec 20
  $cookie = ($r.Headers['Set-Cookie'] -join ' ; ')
  $hasSid = [bool]($cookie -match 'qly\.sid')
  $secure = [bool]($cookie -match 'Secure')
  Write-Output ("LOGIN status=" + $r.StatusCode + " qly_sid=" + $hasSid + " secureFlag=" + $secure)
  try {
    $me = Invoke-WebRequest "$BaseUrl/api/auth/me" -WebSession $s -UseBasicParsing -TimeoutSec 15
    $txt = $me.Content; if ($txt.Length -gt 220) { $txt = $txt.Substring(0, 220) }
    Write-Output ("ME status=" + $me.StatusCode + " body=" + $txt)
  } catch { Write-Output ("ME err: " + $_.Exception.Message) }
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $code = [int]$resp.StatusCode; $b = ''
    try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $b = $sr.ReadToEnd() } catch {}
    Write-Output ("LOGIN_FAIL status=$code body=$b")
  } else { Write-Output ("LOGIN_ERR " + $_.Exception.Message) }
}
