# Restore a PostgreSQL dump produced by backup-db.ps1 into the app database.
# DESTRUCTIVE: --clean drops existing objects before recreating them. Requires an
# explicit -Confirm to proceed. Stop the app (pm2) before restoring.
#
#   powershell -ExecutionPolicy Bypass -File restore-db.ps1 -DumpFile C:\Backups\quanly\quanly_20260617_020000.dump -Confirm

param(
  [Parameter(Mandatory = $true)][string]$DumpFile,
  [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$PgRestore = "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe",
  [switch]$Confirm
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $DumpFile)) { throw "Dump file not found: $DumpFile" }

$envPath = Join-Path $AppDir ".env"
if (-not (Test-Path $envPath)) { throw ".env not found at $envPath" }
$dbUrl = (Get-Content $envPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1)
if ($dbUrl -notmatch 'postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?"]+)') {
  throw "Could not parse DATABASE_URL from .env"
}
$pgUser = [uri]::UnescapeDataString($Matches[1])
$pgPass = [uri]::UnescapeDataString($Matches[2])
$pgHost = $Matches[3]
$pgPort = $Matches[4]
$pgDb   = $Matches[5]

Write-Output "About to RESTORE '$DumpFile' into database '$pgDb' on $pgHost:$pgPort (DESTRUCTIVE)."
if (-not $Confirm) {
  Write-Output "Re-run with -Confirm to actually perform the restore. Aborting."
  exit 1
}

$env:PGPASSWORD = $pgPass
try {
  & $PgRestore -h $pgHost -p $pgPort -U $pgUser -d $pgDb --clean --if-exists --no-owner $DumpFile
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed (exit $LASTEXITCODE)" }
} finally {
  $env:PGPASSWORD = $null
}
Write-Output "RESTORE_DONE"
