# PeAS pre-login boot supervisor.
[CmdletBinding()]
param(
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
$startedAt = Get-Date
$startupStopwatch = [Diagnostics.Stopwatch]::StartNew()
$logs = Join-Path $AppRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$bootLog = Join-Path $logs 'boot-daemon-v2.log'
$startupReportDir = Join-Path $logs 'startup-reports'
# Generation-specific name avoids the legacy lock handle that can remain open
# in a PostgreSQL child after an older supervisor exits unexpectedly.
$bootLockPath = Join-Path $logs 'boot-daemon-v2.lock'

function Write-Log([string]$Message) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [peas-boot] $Message"
    Add-Content -LiteralPath $bootLog -Value $line -ErrorAction SilentlyContinue
}

# A SYSTEM AtStartup task and the user logon fallback can overlap. Hold an
# exclusive file handle for the lifetime of this supervisor so only one copy
# can own the web port and PostgreSQL process at a time.
try {
    $bootLock = [System.IO.File]::Open(
        $bootLockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch {
    Write-Log 'Another PeAS boot supervisor is already running; this instance will exit.'
    exit 0
}

function Import-EnvFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $parts = $line.Split('=', 2)
            if ($parts[0].Trim()) { [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process') }
        }
    }
}

function Resolve-Executable([string]$Name, [string[]]$Candidates) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
    foreach ($candidate in ($Candidates | Where-Object { $_ })) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

$pgBin = Join-Path $AppRoot 'postgres\bin'
$pgData = Join-Path $AppRoot 'postgres\data'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgReady = Join-Path $pgBin 'pg_isready.exe'
$workDir = Join-Path $RepoRoot 'Deno'
$migrationScript = Join-Path $workDir 'scripts\migrate.ts'
$emailScript = Join-Path $RepoRoot 'scripts\send-startup-report.ps1'
$envFile = Join-Path $AppRoot 'config\peas.env'
if (-not (Test-Path -LiteralPath $envFile)) { $envFile = Join-Path $RepoRoot '.env' }
Import-EnvFile $envFile
$repoUserRoot = Split-Path -Parent (Split-Path -Parent $RepoRoot)
$wingetDenoCandidates = @()
$wingetRoot = Join-Path $repoUserRoot 'AppData\Local\Microsoft\WinGet\Packages'
if (Test-Path -LiteralPath $wingetRoot) {
    $wingetDenoCandidates = Get-ChildItem -LiteralPath $wingetRoot -Directory -Filter 'DenoLand.Deno_*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName 'deno.exe' }
}
$deno = Resolve-Executable 'deno.exe' @(
    $env:PEAS_DENO_PATH,
    (Join-Path $AppRoot 'tools\deno.exe'),
    (Join-Path $env:ProgramFiles 'deno\deno.exe'),
    (Join-Path $repoUserRoot 'AppData\Local\Programs\deno\deno.exe'),
    $wingetDenoCandidates
)
$npm = Resolve-Executable 'npm.cmd' @(
    $env:PEAS_NPM_PATH,
    (Join-Path $env:ProgramFiles 'nodejs\npm.cmd'),
    (Join-Path $repoUserRoot 'AppData\Local\Programs\nodejs\npm.cmd'),
    (Join-Path $repoUserRoot 'AppData\Roaming\npm\npm.cmd')
)

Write-Log 'Starting pre-login supervisor.'
Write-Log "Resolved Deno executable: $(if ($deno) { $deno } else { '<not found>' })"
Write-Log "Resolved npm executable: $(if ($npm) { $npm } else { '<not found>' })"
if (-not (Test-Path -LiteralPath $pgCtl)) { Write-Log "ERROR: pg_ctl not found: $pgCtl"; exit 1 }
if (-not $deno -or -not (Test-Path -LiteralPath $deno)) { Write-Log 'ERROR: Deno executable not found.'; exit 1 }
if (-not (Test-Path -LiteralPath $workDir)) { Write-Log "ERROR: Deno directory not found: $workDir"; exit 1 }
if (-not (Test-Path -LiteralPath $migrationScript)) { Write-Log "ERROR: Migration runner not found: $migrationScript"; exit 1 }
if (-not (Test-Path -LiteralPath $emailScript)) { Write-Log "ERROR: Startup email sender not found: $emailScript"; exit 1 }
if (-not (Test-Path -LiteralPath $envFile)) { Write-Log "ERROR: Environment file not found: $envFile"; exit 1 }

$env:PATH = "$pgBin;$(Split-Path -Parent $deno);$env:PATH"
$env:HOST = '0.0.0.0'
if (-not $env:PORT) { $env:PORT = '80' }

function Ensure-PeasUiAssets {
    $requiredAssets = @(
        (Join-Path $RepoRoot 'Deno\Public\react-ui\main-public.js'),
        (Join-Path $RepoRoot 'Deno\Public\react-ui\style.css'),
        (Join-Path $RepoRoot 'Deno\admin\react-ui\main-admin.js'),
        (Join-Path $RepoRoot 'Deno\admin\react-ui\style.css'),
        (Join-Path $RepoRoot 'Deno\admin\experience-studio\studio.js'),
        (Join-Path $RepoRoot 'Deno\admin\experience-studio\style.css')
    )
    $missing = @($requiredAssets | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($missing.Count -eq 0) {
        Write-Log 'UI bundles are present.'
        return
    }
    if (-not $npm) { throw "UI bundles are missing and npm could not be resolved. Missing: $($missing -join ', ')" }

    Write-Log "UI bundles are missing; building with $npm. Missing: $($missing -join ', ')"
    Push-Location $RepoRoot
    try {
        $buildOutput = & $npm run build:ui 2>&1
        $buildExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $buildOutput | ForEach-Object { Add-Content -LiteralPath $bootLog -Value $_ -ErrorAction SilentlyContinue }
    if ($buildExitCode -ne 0) { throw "UI build failed with exit code $buildExitCode." }
    $stillMissing = @($requiredAssets | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($stillMissing.Count -gt 0) { throw "UI build completed but required assets remain missing: $($stillMissing -join ', ')" }
    Write-Log 'UI bundles built successfully.'
}

try {
    Ensure-PeasUiAssets
} catch {
    Write-Log "ERROR preparing UI assets: $($_.Exception.Message)"
    exit 1
}

$null = & $pgReady -h 127.0.0.1 -p 5432 -U postgres 2>$null
$pgReadyExit = $LASTEXITCODE
if ($pgReadyExit -ne 0) {
    Write-Log 'PostgreSQL is not ready; starting it with pg_ctl and waiting for readiness.'
    # Launch pg_ctl with independent output handles. Invoking it through a
    # PowerShell redirection pipeline can remain blocked because the postgres
    # child inherits the pipeline handle after pg_ctl launches it.
    $pgCtlOutputLog = Join-Path $logs 'pg-ctl-start.out.log'
    $pgCtlErrorLog = Join-Path $logs 'pg-ctl-start.err.log'
    try {
        $pgCtlProcess = Start-Process -FilePath $pgCtl -ArgumentList @(
            'start', '-D', $pgData, '-l', (Join-Path $logs 'postgres.log'), '-w', '-t', '120'
        ) -RedirectStandardOutput $pgCtlOutputLog -RedirectStandardError $pgCtlErrorLog -WindowStyle Hidden -PassThru -ErrorAction Stop
    } catch {
        Write-Log "ERROR: PostgreSQL start process could not be launched: $($_.Exception.Message)"
        exit 1
    }

    $pgDeadline = (Get-Date).AddSeconds(120)
    $pgReadyAfterStart = $false
    do {
        Start-Sleep -Seconds 2
        $null = & $pgReady -h 127.0.0.1 -p 5432 -U postgres 2>$null
        if ($LASTEXITCODE -eq 0) {
            $pgReadyAfterStart = $true
            break
        }
        if ($pgCtlProcess.HasExited) { break }
    } while ((Get-Date) -lt $pgDeadline)

    foreach ($pgLog in @($pgCtlOutputLog, $pgCtlErrorLog)) {
        if (Test-Path -LiteralPath $pgLog) {
            Get-Content -LiteralPath $pgLog -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "pg_ctl: $_" }
        }
    }
    if (-not $pgReadyAfterStart) {
        $pgExit = if ($pgCtlProcess.HasExited) { $pgCtlProcess.ExitCode } else { 'timeout' }
        Write-Log "ERROR: PostgreSQL did not become ready after pg_ctl start (exit $pgExit)."
        if (-not $pgCtlProcess.HasExited) { Stop-Process -Id $pgCtlProcess.Id -Force -ErrorAction SilentlyContinue }
        exit 1
    }
    Write-Log 'PostgreSQL became ready after pg_ctl start.'
    # pg_ctl start is a one-shot control command. If it remains attached after
    # readiness, release that control process without touching PostgreSQL.
    if (-not $pgCtlProcess.HasExited) { Stop-Process -Id $pgCtlProcess.Id -Force -ErrorAction SilentlyContinue }
} else { Write-Log 'PostgreSQL is already ready.' }

Write-Log 'Applying database migrations...'
try {
    $migrationOutput = & $deno run "--env-file=$envFile" --allow-env --allow-net --allow-read $migrationScript apply 2>&1
    $migrationExitCode = $LASTEXITCODE
    $migrationOutput | ForEach-Object { Add-Content -LiteralPath $bootLog -Value $_ -ErrorAction SilentlyContinue }
    if ($migrationExitCode -ne 0) {
        Write-Log "ERROR: Database migration runner exited with code $migrationExitCode."
        exit 1
    }
    Write-Log 'Database migrations applied successfully.'
} catch {
    Write-Log "ERROR applying database migrations: $($_.Exception.Message)"
    exit 1
}

function Start-PeasProcess([string]$Name, [string[]]$Arguments, [string]$OutFile, [string]$ErrFile) {
    try {
        $p = Start-Process -FilePath $deno -ArgumentList $Arguments -WorkingDirectory $workDir -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile -PassThru -WindowStyle Hidden -ErrorAction Stop
    } catch {
        Write-Log "$Name failed to launch: $($_.Exception.Message)"
        throw
    }
    Write-Log "$Name started (PID $($p.Id))."
    return $p
}

function Write-DiagnosticTail([string]$Label, [string]$Path, [int]$Count = 80) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Log "$Label log not found: $Path"
        return
    }
    Write-Log "--- $Label (last $Count lines) ---"
    Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue | ForEach-Object { Write-Log $_ }
    Write-Log "--- end $Label ---"
}

function Wait-PeasReady([System.Diagnostics.Process]$WebProcess, [int]$TimeoutSeconds = 90) {
    $healthUri = "http://127.0.0.1:$($env:PORT)/health/ready"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if ($WebProcess.HasExited) { throw "Web server exited with code $($WebProcess.ExitCode) before readiness." }
        try {
            $response = Invoke-WebRequest -Uri $healthUri -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                return [pscustomobject]@{ Uri = $healthUri; StatusCode = $response.StatusCode; Body = $response.Content }
            }
        } catch {
            # Startup polling failures are expected until the listener is ready.
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Readiness check did not return HTTP 200 within $TimeoutSeconds seconds."
}

function Wait-PeasStable(
    [System.Diagnostics.Process]$WebProcess,
    [System.Diagnostics.Process]$MediaProcess,
    [System.Diagnostics.Process]$AbstractProcess,
    [int]$StabilitySeconds = 120
) {
    $healthUri = "http://127.0.0.1:$($env:PORT)/health/ready"
    $deadline = (Get-Date).AddSeconds($StabilitySeconds)
    Write-Log "Beginning sustained readiness check for $StabilitySeconds seconds."
    do {
        foreach ($process in @(
            @{ Name = 'Web server'; Value = $WebProcess },
            @{ Name = 'Media worker'; Value = $MediaProcess },
            @{ Name = 'Abstract worker'; Value = $AbstractProcess }
        )) {
            if ($process.Value.HasExited) {
                throw "$($process.Name) exited during the sustained readiness check (PID $($process.Value.Id), code $($process.Value.ExitCode))."
            }
        }
        try {
            $response = Invoke-WebRequest -Uri $healthUri -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($response.StatusCode -ne 200 -or $response.Content -notmatch '"status"\s*:\s*"ready"') {
                throw "readiness returned HTTP $($response.StatusCode)"
            }
        } catch {
            throw "Readiness dropped during the sustained check: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    Write-Log 'Sustained readiness check passed.'
}

function Get-PublicReadiness([string]$PublicAppUrl) {
    $baseUrl = if ($PublicAppUrl) { $PublicAppUrl.TrimEnd('/') } else { '' }
    if ([string]::IsNullOrWhiteSpace($baseUrl) -or $baseUrl -match '^https?://(localhost|127\.0\.0\.1)(?::\d+)?$') {
        return [pscustomobject]@{ Configured = $false; Ready = $false; Uri = ''; StatusCode = ''; Detail = 'not configured' }
    }
    $uri = "$baseUrl/health/ready"
    try {
        $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        $ready = $response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ready"'
        return [pscustomobject]@{ Configured = $true; Ready = $ready; Uri = $uri; StatusCode = $response.StatusCode; Detail = $response.Content }
    } catch {
        return [pscustomobject]@{ Configured = $true; Ready = $false; Uri = $uri; StatusCode = ''; Detail = $_.Exception.Message }
    }
}

function Format-ProcessState([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return 'not started' }
    if ($Process.HasExited) { return "exited (PID $($Process.Id), code $($Process.ExitCode))" }
    return "running (PID $($Process.Id))"
}

function New-PeasStartupReport(
    [System.Diagnostics.Process]$MediaProcess,
    [System.Diagnostics.Process]$AbstractProcess,
    [System.Diagnostics.Process]$WebProcess,
    [pscustomobject]$Readiness
) {
    New-Item -ItemType Directory -Force -Path $startupReportDir | Out-Null
    $reportPath = Join-Path $startupReportDir ("peas-startup-{0}-{1}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID)
    $latestPath = Join-Path $startupReportDir 'peas-startup-latest-v2.txt'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $systemDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" -ErrorAction SilentlyContinue
    $pgStatus = & $pgReady -h 127.0.0.1 -p 5432 -U postgres 2>&1
    $pgStatusCode = $LASTEXITCODE
    $dependencies = @('pdfinfo', 'pdftotext', 'pdftoppm', 'tesseract', 'cwebp', 'ffmpeg', 'ffprobe', 'clamdscan')
    $dependencyLines = foreach ($dependency in $dependencies) {
        $command = Get-Command $dependency -ErrorAction SilentlyContinue
        if ($command) { "  ${dependency}: available ($($command.Source))" } else { "  ${dependency}: unavailable" }
    }
    $smtpPasswordFileReady = [bool]($env:SMTP_PASSWORD_FILE -and (Test-Path -LiteralPath $env:SMTP_PASSWORD_FILE))
    $recipientReady = [bool]$env:PEAS_STARTUP_REPORT_EMAIL
    $publicReadiness = Get-PublicReadiness $env:PUBLIC_APP_URL
    $diskSummary = if ($systemDrive) {
        "{0:N2} GB free of {1:N2} GB" -f ($systemDrive.FreeSpace / 1GB), ($systemDrive.Size / 1GB)
    } else { 'unavailable' }
    $osSummary = if ($os) { "$($os.Caption) $($os.Version)" } else { 'unavailable' }
    $lastBoot = if ($os) { $os.LastBootUpTime } else { 'unavailable' }

    $lines = @(
        'PeAS Startup Verification Report'
        '==============================='
        "Report generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
        "Startup began: $($startedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
        "Startup duration: $([math]::Round($startupStopwatch.Elapsed.TotalSeconds, 2)) seconds"
        "Computer: $env:COMPUTERNAME"
        "Run identity: $identity"
        "Operating system: $osSummary"
        "Windows last boot: $lastBoot"
        "System drive: $diskSummary"
        "PeAS release: $env:PEAS_RELEASE_ID"
        "Repository root: $RepoRoot"
        "Application root: $AppRoot"
        "Environment file: $envFile"
        ''
        'Readiness'
        '---------'
        "Endpoint: $($Readiness.Uri)"
        "HTTP status: $($Readiness.StatusCode)"
        "Response: $($Readiness.Body)"
        "PostgreSQL: $(if ($pgStatusCode -eq 0) { 'ready' } else { "not ready (exit $pgStatusCode)" })"
        "PostgreSQL response: $($pgStatus -join ' ')"
        "Database migrations: current"
        "Public endpoint: $(if ($publicReadiness.Configured) { $publicReadiness.Uri } else { 'not configured' })"
        "Public readiness: $(if ($publicReadiness.Ready) { 'ready' } else { 'not verified' })"
        "Public HTTP status: $($publicReadiness.StatusCode)"
        "Public response/detail: $($publicReadiness.Detail)"
        ''
        'Processes'
        '---------'
        "Web server: $(Format-ProcessState $WebProcess)"
        "Media worker: $(Format-ProcessState $MediaProcess)"
        "Abstract worker: $(Format-ProcessState $AbstractProcess)"
        ''
        'Email configuration'
        '-------------------'
        "SMTP host configured: $([bool]$env:SMTP_HOST)"
        "SMTP username configured: $([bool]$env:SMTP_USERNAME)"
        "SMTP password file readable: $smtpPasswordFileReady"
        "Startup recipient configured: $recipientReady"
        ''
        'External processing dependencies'
        '--------------------------------'
        $dependencyLines
        ''
        "Boot log: $bootLog"
        "Report path: $reportPath"
    )

    Set-Content -LiteralPath $reportPath -Value $lines -Encoding UTF8
    Copy-Item -LiteralPath $reportPath -Destination $latestPath -Force
    return $reportPath
}

function Send-PeasStartupReport([string]$ReportPath) {
    if (-not $env:PEAS_STARTUP_REPORT_EMAIL) {
        Write-Log "Startup report email skipped: PEAS_STARTUP_REPORT_EMAIL is not configured. The report remains at $ReportPath"
        return
    }
    Write-Log "Sending successful-startup report: $ReportPath"
    try {
        $windowsPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        if (-not (Test-Path -LiteralPath $windowsPowerShell)) { $windowsPowerShell = 'powershell.exe' }
        $emailOutput = & $windowsPowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $emailScript -ReportPath $ReportPath 2>&1
        $emailExitCode = $LASTEXITCODE
        $emailOutput | ForEach-Object { Add-Content -LiteralPath $bootLog -Value $_ -ErrorAction SilentlyContinue }
        if ($emailExitCode -ne 0) {
            Write-Log "WARNING: Startup report email failed with exit code $emailExitCode. The report remains at $ReportPath"
            return
        }
        Write-Log 'Startup verification report email sent.'
    } catch {
        Write-Log "WARNING: Startup report email failed: $($_.Exception.Message). The report remains at $ReportPath"
    }
}

$mediaArgs = @('run', "--env-file=$envFile", '--allow-net', '--allow-read', '--allow-write', '--allow-env', '--allow-run=ffmpeg,ffprobe,clamdscan', 'media-worker.ts')
$abstractArgs = @('run', "--env-file=$envFile", '--allow-env', '--allow-read', '--allow-write', '--allow-net', '--allow-run=pdfinfo,pdftotext,pdftoppm,tesseract', 'abstract-worker.ts')
$webArgs = @('run', "--env-file=$envFile", '--allow-net', '--allow-read', '--allow-write', '--allow-env', '--allow-run=pdftoppm,pdfinfo,cwebp,ffmpeg,ffprobe,clamdscan', 'server.ts')
$media = $null
$abstract = $null
$web = $null
try {
    $media = Start-PeasProcess 'Media worker' $mediaArgs (Join-Path $logs 'media-worker.out.log') (Join-Path $logs 'media-worker.err.log')
    $abstract = Start-PeasProcess 'Abstract worker' $abstractArgs (Join-Path $logs 'abstract-worker.out.log') (Join-Path $logs 'abstract-worker.err.log')
    $web = Start-PeasProcess 'Web server' $webArgs (Join-Path $logs 'web.out.log') (Join-Path $logs 'web.err.log')
    $readiness = Wait-PeasReady $web
    Wait-PeasStable $web $media $abstract 120
    $startupStopwatch.Stop()
    Write-Log "System startup passed local readiness and stability checks in $([math]::Round($startupStopwatch.Elapsed.TotalSeconds, 2)) seconds."
    $startupReport = New-PeasStartupReport $media $abstract $web $readiness
    Write-Log "Detailed startup report created: $startupReport"
    Send-PeasStartupReport $startupReport
} catch {
    Write-Log "ERROR: System startup did not become ready: $($_.Exception.Message)"
    Write-DiagnosticTail 'Web stderr' (Join-Path $logs 'web.err.log')
    Write-DiagnosticTail 'Web stdout' (Join-Path $logs 'web.out.log')
    Write-DiagnosticTail 'Media worker stderr' (Join-Path $logs 'media-worker.err.log') 40
    Write-DiagnosticTail 'Abstract worker stderr' (Join-Path $logs 'abstract-worker.err.log') 40
    $processIds = @($media, $abstract, $web) | Where-Object { $_ -and -not $_.HasExited } | ForEach-Object { $_.Id }
    if ($processIds) { Stop-Process -Id $processIds -Force -ErrorAction SilentlyContinue }
    exit 1
}

while ($true) {
    Start-Sleep -Seconds 5
    if ($media.HasExited) {
        Write-Log 'Media worker exited; restarting.'
        try {
            $media = Start-PeasProcess 'Media worker' $mediaArgs (Join-Path $logs 'media-worker.out.log') (Join-Path $logs 'media-worker.err.log')
        } catch {
            Write-Log "ERROR: Media worker restart failed: $($_.Exception.Message)"
        }
    }
    if ($abstract.HasExited) {
        Write-Log 'Abstract worker exited; restarting.'
        try {
            $abstract = Start-PeasProcess 'Abstract worker' $abstractArgs (Join-Path $logs 'abstract-worker.out.log') (Join-Path $logs 'abstract-worker.err.log')
        } catch {
            Write-Log "ERROR: Abstract worker restart failed: $($_.Exception.Message)"
        }
    }
    if ($null -eq $web -or $web.HasExited) {
        $exitCode = if ($null -eq $web) { 'not started' } else { $web.ExitCode }
        Write-Log "Web server exited with code $exitCode; restarting after 10 seconds."
        Write-DiagnosticTail 'Web stderr' (Join-Path $logs 'web.err.log')
        Start-Sleep -Seconds 10
        try {
            $web = Start-PeasProcess 'Web server' $webArgs (Join-Path $logs 'web.out.log') (Join-Path $logs 'web.err.log')
            $restartReadiness = Wait-PeasReady $web
            Write-Log "Web server restart passed readiness at $($restartReadiness.Uri)."
        } catch {
            Write-Log "ERROR: Web server restart failed: $($_.Exception.Message)"
            if ($web -and -not $web.HasExited) {
                Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
            }
            $web = $null
        }
    }
}
