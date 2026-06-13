# Giai nen code QuanLY tu zip vao C:\Projects\quanly
$ErrorActionPreference = 'Stop'
$zip = Join-Path $env:USERPROFILE 'quanly.zip'
$dest = 'C:\Projects\quanly'
if (-not (Test-Path $zip)) { throw "Khong thay $zip" }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
New-Item -ItemType Directory -Force -Path (Join-Path $dest 'logs') | Out-Null
$n = (Get-ChildItem $dest -Recurse -File | Measure-Object).Count
Write-Output ("EXTRACT_OK files=$n dest=$dest")
$havePkg = Test-Path (Join-Path $dest 'package.json')
$haveSrv = Test-Path (Join-Path $dest 'src\server.js')
Write-Output ("package.json=$havePkg server.js=$haveSrv")
