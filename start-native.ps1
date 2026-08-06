# start-native.ps1
# PowerShell script to start PeAS Deno server and background workers natively on Windows

[CmdletBinding()]
param(
    [string]$AppRoot = (Join-Path $env:ProgramData 'PeAS'),
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot

$denoExe = 'C:\Users\peas\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe'
if (-not (Test-Path $denoExe)) {
    $denoExe = (Get-Command deno -ErrorAction SilentlyContinue).Source
}

# Ensure PostgreSQL database server is running first
& (Join-Path $repoRoot 'scripts\start-postgres.ps1') -AppRoot $AppRoot

# Load environment configuration
$envFile = Join-Path $repoRoot '.env'
if (-not (Test-Path $envFile)) {
    $envFile = Join-Path $AppRoot 'config\peas.env'
}

if (Test-Path $envFile) {
    Write-Host "[peas-start] Loading configuration from $envFile..." -ForegroundColor Cyan
    Get-Content -LiteralPath $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $idx = $line.IndexOf('=')
            if ($idx -gt 0) {
                $k = $line.Substring(0, $idx).Trim()
                $v = $line.Substring($idx + 1).Trim()
                [Environment]::SetEnvironmentVariable($k, $v, 'Process')
            }
        }
    }
} else {
    Write-Warning "[peas-start] No .env or peas.env found. Run ops/peas-deploy-native.ps1 install first."
}

# Ensure storage directory exists
$storageRoot = $env:STORAGE_ROOT
if (-not $storageRoot) { $storageRoot = Join-Path $AppRoot 'storage'; $env:STORAGE_ROOT = $storageRoot }
New-Item -ItemType Directory -Force -Path $storageRoot | Out-Null

$denoDir = Join-Path $repoRoot 'Deno'

Write-Host "[peas-start] Launching PeAS Background Workers..." -ForegroundColor Cyan

# Start media worker
$mediaWorkerProc = Start-Process $denoExe -ArgumentList "task","media-worker" -WorkingDirectory $denoDir -PassThru -NoNewWindow
Write-Host "[peas-start] Media worker started (PID: $($mediaWorkerProc.Id))" -ForegroundColor Green

# Start abstract worker
$abstractWorkerProc = Start-Process $denoExe -ArgumentList "task","abstract:worker" -WorkingDirectory $denoDir -PassThru -NoNewWindow
Write-Host "[peas-start] Abstract worker started (PID: $($abstractWorkerProc.Id))" -ForegroundColor Green

if (-not $PSBoundParameters.ContainsKey('Foreground')) {
    $Foreground = $true
}

$port = if ($env:PORT) { $env:PORT } else { "80" }
$hostIp = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
Write-Host "[peas-start] Starting main Deno web server on $hostIp`:$port..." -ForegroundColor Cyan

Write-Host "`n[peas-start] ========================================================" -ForegroundColor Green
Write-Host "[peas-start] System is active and serving requests throughout the network!" -ForegroundColor Green
Write-Host "[peas-start]   Local URL:   http://localhost:$port" -ForegroundColor Cyan
try {
    $netIps = Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
    foreach ($ip in $netIps) {
        Write-Host "[peas-start]   Network URL: http://${ip}:$port" -ForegroundColor Green
    }
} catch {}
Write-Host "[peas-start] ========================================================" -ForegroundColor Green

if ($Foreground) {
    Set-Location $denoDir
    & $denoExe task start
} else {
    $serverProc = Start-Process $denoExe -ArgumentList "task","start" -WorkingDirectory $denoDir -PassThru -NoNewWindow
    Write-Host "[peas-start] Main web server started (PID: $($serverProc.Id))" -ForegroundColor Green
}
