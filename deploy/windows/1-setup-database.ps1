<#
  1-setup-database.ps1
  Tạo role 'quanly' + database 'quanly' trên PostgreSQL CÓ SẴN của server.
  Chạy bằng quyền Administrator. Idempotent (chạy lại nhiều lần không sao).

  Ví dụ:
    .\1-setup-database.ps1 -DbPassword "MatKhauManh123"
    .\1-setup-database.ps1 -DbPassword "..." -PgBin "C:\Program Files\PostgreSQL\16\bin"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DbPassword,   # mật khẩu cho role 'quanly' (nên chỉ chữ+số)
  [string]$DbName       = "quanly",
  [string]$DbUser       = "quanly",
  [string]$PgSuperUser  = "postgres",
  [string]$PgHost       = "localhost",
  [int]   $PgPort       = 5432,
  [string]$PgBin        = ""    # để trống = tự dò
)

$ErrorActionPreference = "Stop"

# --- Tìm psql.exe ---
function Find-Psql {
  param([string]$Hint)
  if ($Hint -and (Test-Path (Join-Path $Hint "psql.exe"))) { return (Join-Path $Hint "psql.exe") }
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending
  if ($candidates) { return $candidates[0].FullName }
  throw "Không tìm thấy psql.exe. Truyền -PgBin 'C:\Program Files\PostgreSQL\16\bin'."
}

$psql = Find-Psql -Hint $PgBin
Write-Host "psql: $psql" -ForegroundColor Cyan

# --- Mật khẩu superuser postgres ---
$superSecure = Read-Host "Nhập mật khẩu của superuser '$PgSuperUser'" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($superSecure))

$baseArgs = @("-h", $PgHost, "-p", "$PgPort", "-U", $PgSuperUser, "-v", "ON_ERROR_STOP=1", "-w")

# --- Kiểm tra kết nối ---
& $psql @baseArgs -d postgres -tAc "SELECT version();" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Không kết nối được PostgreSQL bằng superuser '$PgSuperUser'." }
Write-Host "✓ Kết nối PostgreSQL OK" -ForegroundColor Green

# --- Tạo role nếu chưa có ---
$escPwd = $DbPassword.Replace("'", "''")
$roleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE "$DbUser" LOGIN PASSWORD '$escPwd';
  ELSE
    ALTER ROLE "$DbUser" WITH LOGIN PASSWORD '$escPwd';
  END IF;
END
`$`$;
"@
& $psql @baseArgs -d postgres -c $roleSql
Write-Host "✓ Role '$DbUser' sẵn sàng" -ForegroundColor Green

# --- Tạo database nếu chưa có (CREATE DATABASE không chạy trong DO block) ---
$dbExists = & $psql @baseArgs -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName';"
if (-not ($dbExists -match "1")) {
  & $psql @baseArgs -d postgres -c "CREATE DATABASE `"$DbName`" OWNER `"$DbUser`";"
  Write-Host "✓ Tạo database '$DbName'" -ForegroundColor Green
} else {
  Write-Host "• Database '$DbName' đã tồn tại — bỏ qua" -ForegroundColor Yellow
}

# --- Cấp quyền schema public (PostgreSQL 15+ siết mặc định) ---
& $psql @baseArgs -d $DbName -c "GRANT ALL ON SCHEMA public TO `"$DbUser`";"
& $psql @baseArgs -d $DbName -c "ALTER DATABASE `"$DbName`" OWNER TO `"$DbUser`";"

$env:PGPASSWORD = $null
Write-Host ""
Write-Host "HOÀN TẤT. DATABASE_URL sẽ là:" -ForegroundColor Green
Write-Host "  postgresql://${DbUser}:<mat-khau>@${PgHost}:${PgPort}/${DbName}?schema=public"
