# Bring up Memurai (modern Redis 7.2 API, BullMQ-compatible) on a DEDICATED port
# for the quanly app, isolated from the legacy Redis 3.0.504 on 6379 that serves
# other apps. Reconfigures Memurai to the given port, (re)starts the service,
# verifies, and writes REDIS_URL into the app .env. Does NOT print the password.
param(
  [string]$AppDir = "C:\Projects\quanly",
  [string]$Conf = "C:\Program Files\Memurai\memurai.conf",
  [string]$Cli = "C:\Program Files\Redis\redis-cli.exe", # protocol-compatible
  [int]$Port = 6380
)
$ErrorActionPreference = 'Stop'

# 1. Back up + set the dedicated port (replace the existing 'port NNNN' line).
Copy-Item $Conf "$Conf.bak" -Force
$lines = Get-Content $Conf | ForEach-Object {
  if ($_ -match '^\s*port\s+\d+') { "port $Port" } else { $_ }
}
Set-Content -Path $Conf -Value $lines -Encoding ASCII

# 2. (Re)start the service.
Restart-Service Memurai -Force
Start-Sleep -Seconds 3
$svc = (Get-Service Memurai).Status
Write-Output "Memurai service: $svc"

# 3. Read the password and verify connectivity + version (BullMQ needs >= 5).
$pass = ((Select-String -Path $Conf -Pattern '^\s*requirepass\s+(.+)$').Matches[0].Groups[1].Value).Trim().Trim('"').Trim("'")
$ping = (& $Cli -p $Port -a $pass PING 2>$null) -join ''
$ver  = (((& $Cli -p $Port -a $pass INFO server 2>$null) | Select-String 'redis_version') -join '').Trim()
Write-Output "PING=$ping  $ver  port=$Port"
if ($ping -ne 'PONG') { throw "Memurai not answering on port $Port" }

# 4. Write REDIS_URL into the app .env (idempotent; dedicated instance so db 0).
$enc = [uri]::EscapeDataString($pass)
$url = "REDIS_URL=redis://:$enc@127.0.0.1:$Port/0"
$envp = Join-Path $AppDir ".env"
$e = @(Get-Content $envp) | Where-Object { $_ -notmatch '^\s*REDIS_URL\s*=' }
$e += $url
Set-Content -Path $envp -Value $e -Encoding UTF8
Write-Output "REDIS_URL set -> Memurai :$Port"
Write-Output "SETUP_MEMURAI_DONE"
