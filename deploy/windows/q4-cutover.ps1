# Cutover: dung+disable service C# 'gianguyen' -> pm2 start QuanLY tren 5000
# -> verify local + qua tunnel. Fail thi TU ROLLBACK ve app C#.
param([string]$AppDir = 'C:\Projects\quanly')
$ErrorActionPreference = 'Stop'
Set-Location $AppDir

function Get-Status($u) { try { return (Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 8).StatusCode } catch { return $null } }
function Rollback-CSharp() {
  Write-Output "ROLLBACK: khoi phuc app C#..."
  try { & pm2 delete quanly 2>$null | Out-Null } catch {}
  try { Set-Service gianguyen -StartupType Automatic } catch {}
  try { Start-Service gianguyen } catch {}
}

# 1) Giai phong port 5000: stop + disable service C#
Write-Output "== stop + disable service 'gianguyen' (C#) =="
Stop-Service gianguyen -Force
Set-Service gianguyen -StartupType Disabled
Start-Sleep -Seconds 2

# 2) Start QuanLY duoi pm2 tren 5000 (.env da PORT=5000)
Write-Output "== pm2 start quanly =="
& pm2 delete quanly 2>$null | Out-Null
& pm2 start (Join-Path $AppDir 'src\server.js') --name quanly --cwd $AppDir --time
Start-Sleep -Seconds 7

# 3) Verify local
$ready = $null
for ($i = 0; $i -lt 12; $i++) { $ready = Get-Status "http://127.0.0.1:5000/readyz"; if ($ready -eq 200) { break }; Start-Sleep -Seconds 2 }

# 4) Verify qua Cloudflare tunnel
$pub = $null
for ($i = 0; $i -lt 6; $i++) { $pub = Get-Status "https://gianguyen.cloud/livez"; if ($pub -eq 200) { break }; Start-Sleep -Seconds 3 }

if ($ready -eq 200 -and $pub -eq 200) {
  & pm2 save | Out-Null
  Write-Output "CUTOVER_OK local_readyz=$ready public_livez=$pub"
} else {
  Write-Output "CUTOVER_FAIL local_readyz=$ready public_livez=$pub"
  Write-Output "---- pm2 logs quanly (tail) ----"
  try { & pm2 logs quanly --lines 30 --nostream } catch {}
  Rollback-CSharp
  throw "Cutover that bai -> da rollback ve app C#."
}
