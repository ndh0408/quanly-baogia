<#
  2-deploy-app.ps1
  Cài dependencies, sinh .env (nếu chưa có), tạo schema DB, seed admin.
  Chạy TRONG thư mục gốc app (nơi có package.json), quyền Administrator.

  Ví dụ:
    cd C:\apps\quanly
    .\deploy\windows\2-deploy-app.ps1 -DbPassword "MatKhauManh123"
#>
[CmdletBinding()]
param(
  [string]$AppDir     = (Get-Location).Path,
  [string]$DbPassword = "",                 # mật khẩu role 'quanly' (để ghép DATABASE_URL khi tạo .env mới)
  [string]$Domain     = "gianguyen.cloud"
)

$ErrorActionPreference = "Stop"
Set-Location $AppDir

if (-not (Test-Path (Join-Path $AppDir "package.json"))) {
  throw "Không thấy package.json trong $AppDir. Hãy chạy đúng thư mục gốc app."
}

# --- Kiểm tra Node >= 18 ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Chưa cài Node.js. Tải LTS tại https://nodejs.org (>= 18)." }
$nodeMajor = [int](((& node -v) -replace '^v','') -split '\.')[0]
if ($nodeMajor -lt 18) { throw "Node $((& node -v)) quá cũ. Cần >= 18." }
Write-Host "✓ Node $((& node -v))" -ForegroundColor Green

# --- Tạo .env nếu chưa có ---
$envPath = Join-Path $AppDir ".env"
if (-not (Test-Path $envPath)) {
  Write-Host "• .env chưa có — đang tạo + sinh secret..." -ForegroundColor Yellow
  if (-not $DbPassword) { throw "Cần -DbPassword để dựng DATABASE_URL trong .env mới." }
  $sessionSecret = & node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  $jwtSecret     = & node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  $dbUrl = "postgresql://quanly:$DbPassword@localhost:5432/quanly?schema=public"
  $envContent = @"
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DATABASE_URL="$dbUrl"
SESSION_SECRET="$sessionSecret"
JWT_SECRET="$jwtSecret"
TRUST_PROXY=1
CORS_ORIGINS=https://$Domain
REDIS_URL=redis://127.0.0.1:6379
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
ADMIN_DISPLAY_NAME=Quản trị viên
"@
  Set-Content -Path $envPath -Value $envContent -Encoding UTF8
  Write-Host "✓ Đã tạo .env (SESSION_SECRET/JWT_SECRET sinh tự động)" -ForegroundColor Green
} else {
  Write-Host "• .env đã tồn tại — giữ nguyên" -ForegroundColor Yellow
}

# --- Cài dependencies (gồm devDeps để có prisma CLI) ---
Write-Host "• npm ci ..." -ForegroundColor Cyan
& npm ci --include=dev
if ($LASTEXITCODE -ne 0) { throw "npm ci thất bại." }

# --- Prisma: generate client + tạo schema vào DB ---
Write-Host "• prisma generate ..." -ForegroundColor Cyan
& npx prisma generate
if ($LASTEXITCODE -ne 0) { throw "prisma generate thất bại." }

# Áp schema bằng migration history (KHÔNG dùng db push — không có lịch sử/rollback).
# Idempotent cho cả 2 trường hợp:
#  - DB mới (trống): migrate deploy tạo bảng từ 0_init.
#  - DB cũ (đã tạo bằng db push trước đây): migrate deploy lần đầu sẽ lỗi vì bảng
#    đã tồn tại → baseline một lần (resolve --applied 0_init) rồi deploy lại (no-op).
Write-Host "• prisma migrate deploy ..." -ForegroundColor Cyan
& npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host "  → migrate deploy lỗi: baseline DB cũ (db push) một lần rồi thử lại..." -ForegroundColor Yellow
  & npx prisma migrate resolve --applied 0_init
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate resolve thất bại — kiểm tra DATABASE_URL / baseline thủ công." }
  & npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy thất bại sau baseline." }
}

# --- Seed admin + companies (GN/CLF) ---
Write-Host "• seed dữ liệu khởi tạo ..." -ForegroundColor Cyan
& node prisma/seed.js
if ($LASTEXITCODE -ne 0) { throw "seed thất bại." }

Write-Host ""
Write-Host "HOÀN TẤT bước deploy app." -ForegroundColor Green
if (Test-Path (Join-Path $AppDir ".admin-credentials.local")) {
  Write-Host "→ Mật khẩu admin nằm ở .admin-credentials.local — đọc, đăng nhập, đổi mật khẩu, rồi XÓA file đó." -ForegroundColor Yellow
}
Write-Host "→ Tiếp theo: chạy 3-install-services.ps1 để dựng Windows Service." -ForegroundColor Cyan
