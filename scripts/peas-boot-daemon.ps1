# peas-boot-daemon.ps1
# System boot startup runner script for PeAS production system on Windows.
# Designed to run automatically at Windows boot (under SYSTEM or Administrator) before user login.

[CmdletBinding()]
param(
    [string]$AppRoot = (Join-Path $env:ProgramData 'PeAS'),
    [string]$RepoRoot = 'c:\Users\peas\Desktop\sPeAS-production'
)

$ErrorActionPreference = 'Continue'

$logsDir = Join-Path $AppRoot 'logs'
$logFile = Join-Path $logsDir 'boot-daemon.log'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$mediaOutLog = Join-Path $logsDir 'media-worker.out.log'
$mediaErrLog = Join-Path $logsDir 'media-worker.err.log'
$abstractOutLog = Join-Path $logsDir 'abstract-worker.out.log'
$abstractErrLog = Join-Path $logsDir 'abstract-worker.err.log'
$webOutLog = Join-Path $logsDir 'web.out.log'
$webErrLog = Join-Path $logsDir 'web.err.log'

function Log-Message([string]$Message) {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $formatted = "[$timestamp] [peas-boot] $Message"
    Write-Host $formatted
    Add-Content -Path $logFile -Value $formatted -ErrorAction SilentlyContinue
}

Log-Message "Starting PeAS System Boot Daemon..."

# Set environment paths for SYSTEM account
$pgBin = Join-Path $AppRoot 'postgres\bin'
$denoDir = 'C:\Users\peas\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe'
$nodeDir = 'C:\Users\peas\AppData\Local\OpenAI\Codex\runtimes\cua_node\fb8898c05a62885e\bin'

$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
$newPath = "$pgBin;$denoDir;$nodeDir;$currentPath"
[Environment]::SetEnvironmentVariable('PATH', $newPath, 'Process')

# Locate Deno executable
$denoExe = Join-Path $denoDir 'deno.exe'
if (-not (Test-Path $denoExe)) {
    $denoExe = (Get-Command deno -ErrorAction SilentlyContinue).Source
}

if (-not $denoExe -or -not (Test-Path $denoExe)) {
    Log-Message "ERROR: Deno executable not found."
    exit 1
}

# 1. Start PostgreSQL Server Daemon
$postgresExe = Join-Path $pgBin 'postgres.exe'
$pgData = Join-Path $AppRoot 'postgres\data'

if (Test-Path $postgresExe) {
    $isreadyExe = Join-Path $pgBin 'pg_isready.exe'
    $isReady = & $isreadyExe -h 127.0.0.1 -p 5432 -U postgres 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log-Message "Starting native PostgreSQL server..."
        Start-Process -FilePath $postgresExe -ArgumentList '-D',$pgData -WorkingDirectory $pgBin -NoNewWindow
        Start-Sleep -Seconds 3
    } else {
        Log-Message "PostgreSQL server is already running."
    }
} else {
    Log-Message "ERROR: postgres.exe not found at $postgresExe"
    exit 1
}

# 2. Load environment configuration
$envFile = Join-Path $RepoRoot '.env'
if (-not (Test-Path $envFile)) {
    $envFile = Join-Path $AppRoot 'config\peas.env'
}

if (Test-Path $envFile) {
    Log-Message "Loading environment from $envFile"
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
}

# Ensure PORT is 80
$env:PORT = '80'
$denoWorkDir = Join-Path $RepoRoot 'Deno'

if (-not (Test-Path -LiteralPath $denoWorkDir)) {
    Log-Message "ERROR: Deno working directory not found at $denoWorkDir"
    exit 1
}

function Start-DenoTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$OutputLog,
        [Parameter(Mandatory = $true)][string]$ErrorLog
    )

    return Start-Process -FilePath $denoExe `
        -ArgumentList 'task', $TaskName `
        -WorkingDirectory $denoWorkDir `
        -RedirectStandardOutput $OutputLog `
        -RedirectStandardError $ErrorLog `
        -PassThru `
        -NoNewWindow
}

# 3. Launch Deno Background Workers & Main Web Server
Log-Message "Launching Deno background workers and web server on Port 80..."

$mediaWorkerProc = Start-DenoTask -TaskName 'media-worker' -OutputLog $mediaOutLog -ErrorLog $mediaErrLog
Log-Message "Media worker started (PID: $($mediaWorkerProc.Id))"

$abstractWorkerProc = Start-DenoTask -TaskName 'abstract:worker' -OutputLog $abstractOutLog -ErrorLog $abstractErrLog
Log-Message "Abstract worker started (PID: $($abstractWorkerProc.Id))"

$serverProc = Start-DenoTask -TaskName 'start' -OutputLog $webOutLog -ErrorLog $webErrLog
Log-Message "Main Deno web server started (PID: $($serverProc.Id))"

$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 1
    if ($serverProc.HasExited) {
        Log-Message "ERROR: Main Deno web server exited during startup with code $($serverProc.ExitCode). See $webErrLog"
        break
    }

    try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1/health/ready' -TimeoutSec 2 -UseBasicParsing
        if ($resp.StatusCode -eq 200) {
            $ready = $true
            Log-Message 'SUCCESS: System is READY on Port 80 (HTTP 200)'
            break
        }
    } catch {
        # The server can take several seconds to initialize.
    }
}

if (-not $ready) {
    Log-Message "ERROR: System did not become ready within 30 seconds. See $webErrLog"
    if (-not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $mediaWorkerProc.Id, $abstractWorkerProc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

# Keep this scheduled task alive as the supervisor. Task Scheduler can otherwise
# tear down child processes as soon as the task's PowerShell process exits.
while (-not $serverProc.HasExited) {
    Start-Sleep -Seconds 5

    if ($mediaWorkerProc.HasExited) {
        Log-Message "WARNING: Media worker exited with code $($mediaWorkerProc.ExitCode); restarting it."
        $mediaWorkerProc = Start-DenoTask -TaskName 'media-worker' -OutputLog $mediaOutLog -ErrorLog $mediaErrLog
        Log-Message "Media worker restarted (PID: $($mediaWorkerProc.Id))"
    }

    if ($abstractWorkerProc.HasExited) {
        Log-Message "WARNING: Abstract worker exited with code $($abstractWorkerProc.ExitCode); restarting it."
        $abstractWorkerProc = Start-DenoTask -TaskName 'abstract:worker' -OutputLog $abstractOutLog -ErrorLog $abstractErrLog
        Log-Message "Abstract worker restarted (PID: $($abstractWorkerProc.Id))"
    }
}

Log-Message "ERROR: Main Deno web server exited with code $($serverProc.ExitCode)."
Stop-Process -Id $mediaWorkerProc.Id, $abstractWorkerProc.Id -Force -ErrorAction SilentlyContinue
exit 1
