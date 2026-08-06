# init-native-db.ps1
# Powershell script to initialize native PostgreSQL database and user roles for PeAS

[CmdletBinding()]
param(
    [string]$AppRoot = (Join-Path $env:ProgramData 'PeAS'),
    [string]$PgHost = '127.0.0.1',
    [int]$PgPort = 5432
)

$ErrorActionPreference = 'Stop'

Write-Host "[peas-db] Initializing PostgreSQL database and roles..." -ForegroundColor Cyan

# Locate psql executable
$psqlPath = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psqlPath) {
    $pgBin = Join-Path $AppRoot 'postgres\bin'
    $testPsql = Join-Path $pgBin 'psql.exe'
    if (Test-Path $testPsql) {
        $psqlPath = $testPsql
        [Environment]::SetEnvironmentVariable('PATH', "$pgBin;$([Environment]::GetEnvironmentVariable('PATH'))", 'Process')
    }
}

if (-not $psqlPath) {
    throw "psql.exe not found. Please ensure PostgreSQL 17 is installed."
}

$pgBinDir = [IO.Path]::GetDirectoryName($psqlPath)
[Environment]::SetEnvironmentVariable('PATH', "$pgBinDir;$([Environment]::GetEnvironmentVariable('PATH'))", 'Process')

Write-Host "[peas-db] Using psql at $psqlPath" -ForegroundColor Yellow

$secretsDir = Join-Path $AppRoot 'config\secrets'
$adminPasswordFile = Join-Path $secretsDir 'db_admin_password'
$appPasswordFile = Join-Path $secretsDir 'db_app_password'

if (-not (Test-Path $adminPasswordFile) -or -not (Test-Path $appPasswordFile)) {
    throw "Secret files missing in $secretsDir. Run setup-native-env.ps1 first."
}

$appPassword = [IO.File]::ReadAllText($appPasswordFile).Trim()

# 1. Create database peas_db if not exists
Write-Host "[peas-db] Checking database peas_db..." -ForegroundColor Yellow

$dbExists = (& $psqlPath -h $PgHost -p $PgPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'peas_db'" 2>$null)

if ([string]::IsNullOrWhiteSpace($dbExists) -or $dbExists.Trim() -ne '1') {
    Write-Host "[peas-db] Creating database peas_db..." -ForegroundColor Yellow
    & $psqlPath -h $PgHost -p $PgPort -U postgres -d postgres -c "CREATE DATABASE peas_db;"
} else {
    Write-Host "[peas-db] Database peas_db already exists." -ForegroundColor Green
}

# 2. Create role peas_app if not exists and set password
Write-Host "[peas-db] Setting up role peas_app..." -ForegroundColor Yellow

# Try create role, if exists alter password
& $psqlPath -h $PgHost -p $PgPort -U postgres -d peas_db -c "CREATE ROLE peas_app LOGIN PASSWORD '$appPassword';" 2>$null
& $psqlPath -h $PgHost -p $PgPort -U postgres -d peas_db -c "ALTER ROLE peas_app WITH PASSWORD '$appPassword';" 2>$null
& $psqlPath -h $PgHost -p $PgPort -U postgres -d peas_db -c "GRANT ALL PRIVILEGES ON DATABASE peas_db TO peas_app;" 2>$null
& $psqlPath -h $PgHost -p $PgPort -U postgres -d peas_db -c "GRANT ALL PRIVILEGES ON SCHEMA public TO peas_app;" 2>$null
& $psqlPath -h $PgHost -p $PgPort -U postgres -d peas_db -c "ALTER SCHEMA public OWNER TO peas_app;" 2>$null

Write-Host "[peas-db] Database initialization completed successfully." -ForegroundColor Green
