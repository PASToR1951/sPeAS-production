# install-native-prereqs.ps1
# Powershell script to install required native tools for PeAS (Deno, Node.js LTS, PostgreSQL 17)

$ErrorActionPreference = 'Stop'

Write-Host "[peas-install] Checking and installing native prerequisites via winget..." -ForegroundColor Cyan

# Function to install a winget package if not already installed
function Install-WingetPackage([string]$PackageId, [string]$Name) {
    Write-Host "[peas-install] Installing $Name ($PackageId)..." -ForegroundColor Yellow
    winget install --id $PackageId --exact --silent --accept-package-agreements --accept-source-agreements --scope machine
    if ($LASTEXITCODE -ne 0) {
        # Try scope user if machine scope failed
        winget install --id $PackageId --exact --silent --accept-package-agreements --accept-source-agreements --scope user
    }
}

# 1. Deno
if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
    Install-WingetPackage 'DenoLand.Deno' 'Deno'
} else {
    Write-Host "[peas-install] Deno is already installed: $(deno --version | Select-Object -First 1)" -ForegroundColor Green
}

# 2. Node.js LTS
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js LTS'
} else {
    Write-Host "[peas-install] Node.js is already installed: $(node --version)" -ForegroundColor Green
}

# 3. PostgreSQL 17
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Install-WingetPackage 'PostgreSQL.PostgreSQL.17' 'PostgreSQL 17'
} else {
    Write-Host "[peas-install] PostgreSQL is already installed: $(psql --version)" -ForegroundColor Green
}

Write-Host "[peas-install] Prerequisite check/installation complete." -ForegroundColor Green
