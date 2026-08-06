# start-postgres.ps1
# PowerShell script to initialize and start native PostgreSQL server

[CmdletBinding()]
param(
    [string]$AppRoot = (Join-Path $env:ProgramData 'PeAS')
)

$ErrorActionPreference = 'Stop'

$pgDir = Join-Path $AppRoot 'postgres'
$pgBin = Join-Path $pgDir 'bin'
$pgData = Join-Path $pgDir 'data'
$logsDir = Join-Path $AppRoot 'logs'

New-Item -ItemType Directory -Force -Path $logsDir, $pgData | Out-Null

$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
if (-not $currentPath.Contains($pgBin)) {
    [Environment]::SetEnvironmentVariable('PATH', "$pgBin;$currentPath", 'Process')
}

$postgresExe = Join-Path $pgBin 'postgres.exe'
$initdbExe = Join-Path $pgBin 'initdb.exe'
$isreadyExe = Join-Path $pgBin 'pg_isready.exe'

# 1. Initialize database cluster if not initialized
if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
    Write-Host "[peas-pg] Initializing PostgreSQL data cluster at $pgData..." -ForegroundColor Cyan
    Start-Process -FilePath $initdbExe -ArgumentList '-U','postgres','-A','trust','-D',$pgData -WorkingDirectory $pgBin -NoNewWindow -Wait
}

# 2. Check if PostgreSQL server is already running
$isReady = & $isreadyExe -U postgres 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[peas-pg] PostgreSQL server is already running." -ForegroundColor Green
    exit 0
}

Write-Host "[peas-pg] Starting native PostgreSQL server process..." -ForegroundColor Cyan
Start-Process -FilePath $postgresExe -ArgumentList '-D',$pgData -WorkingDirectory $pgBin

Start-Sleep -Seconds 3

# 3. Verify server readiness
$isReady = & $isreadyExe -U postgres 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[peas-pg] PostgreSQL server started successfully." -ForegroundColor Green
} else {
    Write-Warning "[peas-pg] Waiting for server initialization..."
    Start-Sleep -Seconds 2
    $isReady = & $isreadyExe -U postgres 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[peas-pg] PostgreSQL server started successfully." -ForegroundColor Green
    } else {
        throw "PostgreSQL server failed to start."
    }
}
