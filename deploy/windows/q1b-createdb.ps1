param([Parameter(Mandatory = $true)][string]$PgSuperPassword)
$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'
$env:PGPASSWORD = $PgSuperPassword
$ba = @('-h', 'localhost', '-p', '5432', '-U', 'postgres', '-w', '-v', 'ON_ERROR_STOP=1')

Write-Output ("role quanly: [" + ((& $psql @ba -d postgres -tAc "SELECT rolname FROM pg_roles WHERE rolname='quanly';") -join '') + "]")
Write-Output ("db quanly  : [" + ((& $psql @ba -d postgres -tAc "SELECT datname FROM pg_database WHERE datname='quanly';") -join '') + "]")

$dbExists = & $psql @ba -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='quanly';"
if (($dbExists -join '') -notmatch '1') {
  Write-Output "Creating database quanly..."
  & $psql @ba -d postgres -c "CREATE DATABASE quanly OWNER quanly;"
  Write-Output ("createdb exit=" + $LASTEXITCODE)
} else {
  Write-Output "DB already exists."
}
& $psql @ba -d quanly -c "GRANT ALL ON SCHEMA public TO quanly;"
& $psql @ba -d quanly -c "ALTER DATABASE quanly OWNER TO quanly;"
$env:PGPASSWORD = $null
Write-Output ("final db quanly: [" + ((& $psql -h localhost -U postgres -w -tAc "SELECT datname FROM pg_database WHERE datname='quanly';" 2>$null) -join '') + "]")
Write-Output "FIXDB_DONE"
