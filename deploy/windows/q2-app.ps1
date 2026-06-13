# Cai dependencies + tao schema + seed. Chay trong C:\Projects\quanly.
param([string]$AppDir = 'C:\Projects\quanly')
$ErrorActionPreference = 'Stop'
Set-Location $AppDir

Write-Output "== npm ci =="
& npm ci --include=dev
if ($LASTEXITCODE -ne 0) { throw "npm ci that bai (exit $LASTEXITCODE)" }

Write-Output "== prisma generate =="
& npx --yes prisma generate
if ($LASTEXITCODE -ne 0) { throw "prisma generate that bai (exit $LASTEXITCODE)" }

Write-Output "== prisma migrate deploy =="
# Idempotent: DB moi -> tao bang tu 0_init; DB cu (db push) -> baseline 1 lan roi deploy lai.
& npx --yes prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Output "-- migrate deploy loi: baseline DB cu (db push) 1 lan roi thu lai --"
  & npx --yes prisma migrate resolve --applied 0_init
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate resolve that bai (exit $LASTEXITCODE)" }
  & npx --yes prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy that bai sau baseline (exit $LASTEXITCODE)" }
}

Write-Output "== seed =="
& node prisma/seed.js
if ($LASTEXITCODE -ne 0) { throw "seed that bai (exit $LASTEXITCODE)" }

Write-Output "APP_SETUP_OK"
