# Tao role+database 'quanly' (dung superuser postgres) + sinh .env (no-BOM, URL-encoded).
# ASCII-only de tranh loi encoding khi PowerShell 5.1 doc script.
param(
  [Parameter(Mandatory = $true)][string]$PgSuperPassword,
  [string]$AppDir = 'C:\Projects\quanly',
  [string]$Port = '5000'
)
$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'
$node = (Get-Command node).Source
Set-Location $AppDir

# 1) Sinh mat khau alphanumeric cho role quanly (tranh ky tu dac biet trong URL)
$bytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$alnum = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '')
$dbPass = $alnum.Substring(0, 24)

# 2) Tao role + database qua superuser
$env:PGPASSWORD = $PgSuperPassword
$ba = @('-h', 'localhost', '-p', '5432', '-U', 'postgres', '-w', '-v', 'ON_ERROR_STOP=1')
& $psql @ba -d postgres -tAc "SELECT 1;" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Khong ket noi duoc PostgreSQL bang superuser." }

$roleExists = & $psql @ba -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='quanly';"
if ($roleExists -match '1') {
  & $psql @ba -d postgres -c "ALTER ROLE quanly WITH LOGIN PASSWORD '$dbPass';"
} else {
  & $psql @ba -d postgres -c "CREATE ROLE quanly LOGIN PASSWORD '$dbPass';"
}
if ($LASTEXITCODE -ne 0) { throw "Tao/sua role quanly that bai." }

$dbExists = & $psql @ba -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='quanly';"
if ($dbExists -notmatch '1') {
  & $psql @ba -d postgres -c "CREATE DATABASE quanly OWNER quanly;"
  if ($LASTEXITCODE -ne 0) { throw "Tao database quanly that bai." }
}
& $psql @ba -d quanly -c "GRANT ALL ON SCHEMA public TO quanly;" | Out-Null
& $psql @ba -d quanly -c "ALTER DATABASE quanly OWNER TO quanly;" | Out-Null
$env:PGPASSWORD = $null

# 3) Sinh secrets
$sessionSecret = & $node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
$jwtSecret = & $node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# 4) DATABASE_URL voi password percent-encoded (defence-in-depth)
$encPwd = [uri]::EscapeDataString($dbPass)
$dbUrl = "postgresql://quanly:$encPwd@localhost:5432/quanly?schema=public"

# 5) Ghi .env KHONG BOM
$lines = @(
  "NODE_ENV=production",
  "PORT=$Port",
  "LOG_LEVEL=info",
  "DATABASE_URL=`"$dbUrl`"",
  "SESSION_SECRET=`"$sessionSecret`"",
  "JWT_SECRET=`"$jwtSecret`"",
  "TRUST_PROXY=1",
  "CORS_ORIGINS=https://gianguyen.cloud",
  "ADMIN_USERNAME=admin",
  "ADMIN_PASSWORD="
)
$content = ($lines -join "`n") + "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $AppDir '.env'), $content, $utf8NoBom)

Write-Output "DB_ENV_OK role+db 'quanly' san sang; .env da ghi (PORT=$Port, khong Redis)."
