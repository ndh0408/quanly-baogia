# Automated PostgreSQL backup for the LIVE Windows production server.
# Dumps the app database (custom/compressed format) to a timestamped file and
# prunes dumps older than -KeepDays. Schedule it with Task Scheduler, e.g. daily:
#
#   schtasks /Create /TN "QuanLY DB Backup" /SC DAILY /ST 02:00 /RL HIGHEST ^
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\path\to\deploy\windows\backup-db.ps1"
#
# Reads the connection string from the app's .env (DATABASE_URL). Restore with
# restore-db.ps1. Test your restores periodically — an untested backup is not a backup.

param(
  # App root containing .env. Defaults to the repo root (two levels up from here).
  [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  # Where to write dumps.
  [string]$BackupDir = "C:\Backups\quanly",
  # Delete dumps older than this many days.
  [int]$KeepDays = 14,
  # pg_dump location (PostgreSQL 16 default install path).
  [string]$PgDump = "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
)
$ErrorActionPreference = 'Stop'

function Read-DatabaseUrl([string]$appDir) {
  $envPath = Join-Path $appDir ".env"
  if (-not (Test-Path $envPath)) { throw ".env not found at $envPath" }
  foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*DATABASE_URL\s*=\s*"?([^"]+)"?\s*$') { return $Matches[1] }
  }
  throw "DATABASE_URL not found in $envPath"
}

# postgresql://USER:PASS@HOST:PORT/DB?params  (password is URL-decoded)
$dbUrl = Read-DatabaseUrl $AppDir
if ($dbUrl -notmatch '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)') {
  throw "Could not parse DATABASE_URL"
}
$pgUser = [uri]::UnescapeDataString($Matches[1])
$pgPass = [uri]::UnescapeDataString($Matches[2])
$pgHost = $Matches[3]
$pgPort = $Matches[4]
$pgDb   = $Matches[5]

if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $BackupDir "$($pgDb)_$stamp.dump"

Write-Output "Backing up '$pgDb' → $outFile"
$env:PGPASSWORD = $pgPass
try {
  # -Fc = custom format (compressed, restorable with pg_restore --clean).
  & $PgDump -h $pgHost -p $pgPort -U $pgUser -d $pgDb -Fc -f $outFile
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }
} finally {
  $env:PGPASSWORD = $null
}
$sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Output "OK: $outFile ($sizeMb MB)"

# Retention: prune old dumps.
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -Path $BackupDir -Filter "*.dump" |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object { Write-Output "Pruning old backup: $($_.Name)"; Remove-Item $_.FullName -Force }

Write-Output "BACKUP_DONE"
