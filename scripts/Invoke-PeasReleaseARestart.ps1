# Performs the privileged, application-only portion of the PeAS Release A
# restart. The script fails before stopping anything unless the current port
# owner and process tree match the expected PeAS supervisor.
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [int]$ExpectedSupervisorId,

    [Parameter(Mandatory)]
    [int]$ExpectedWebId,

    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$RepoRoot = 'C:\Users\peas\Desktop\sPeAS-production'
)

$ErrorActionPreference = 'Stop'
$taskName = 'PeAS-Boot-Daemon'
$logPath = Join-Path $AppRoot 'logs\release-a-elevated-restart.log'

function Write-RestartLog([string]$Message) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [release-a] $Message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8 -ErrorAction SilentlyContinue
}

function Assert-ProductionEnvironment {
    $environmentPath = Join-Path $AppRoot 'config\peas.env'
    $settings = @{}
    Get-Content -LiteralPath $environmentPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $parts = $line.Split('=', 2)
            $settings[$parts[0].Trim()] = $parts[1].Trim()
        }
    }

    $expected = [ordered]@{
        DENO_ENV = 'production'
        HOST = '192.168.2.104'
        PEAS_BIND_HOST = '192.168.2.104'
        PORT = '80'
        TRUSTED_ORIGINS = 'https://peas.spud.edu.ph'
        TRUSTED_PROXY_RANGES = '192.168.2.3'
        PEAS_CSP_MODE = 'report-only'
        PEAS_VERIFY_PUBLIC_DOCUMENT_ID = '2'
    }
    foreach ($entry in $expected.GetEnumerator()) {
        if ($settings[$entry.Key] -ne $entry.Value) {
            throw "Production setting $($entry.Key) does not match the reviewed Release A value."
        }
    }
    foreach ($required in @('SECURITY_CONTACT_EMAIL', 'SECURITY_TXT_EXPIRES')) {
        if ([string]::IsNullOrWhiteSpace($settings[$required])) {
            throw "Required production setting $required is missing."
        }
    }
}

try {
    Write-RestartLog "Starting privileged restart validation for supervisor $ExpectedSupervisorId and web PID $ExpectedWebId."
    Assert-ProductionEnvironment

    $setupScript = Join-Path $RepoRoot 'scripts\setup-autostart-boot.ps1'
    if (-not (Test-Path -LiteralPath $setupScript)) { throw "Missing setup script: $setupScript" }

    # Register and validate the SYSTEM task before taking down the current web
    # process. A permissions or task-registration failure therefore leaves the
    # live service untouched.
    & $setupScript -AppRoot $AppRoot -RepoRoot $RepoRoot
    $registeredTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if ($registeredTask.Principal.UserId -ne 'SYSTEM') {
        throw "Unexpected $taskName principal: $($registeredTask.Principal.UserId)"
    }
    Write-RestartLog "$taskName registered and validated as SYSTEM."

    $supervisor = Get-Process -Id $ExpectedSupervisorId -ErrorAction Stop
    if ($supervisor.ProcessName -notin @('powershell', 'pwsh')) {
        throw "PID $ExpectedSupervisorId is not the expected PowerShell supervisor."
    }

    $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ExpectedSupervisorId })
    $unexpectedChildren = @($children | Where-Object { $_.Name -notin @('deno.exe', 'conhost.exe') })
    if ($unexpectedChildren.Count -gt 0) {
        throw "Unexpected supervisor children: $($unexpectedChildren.Name -join ', ')"
    }
    $denoChildren = @($children | Where-Object { $_.Name -eq 'deno.exe' })
    if ($denoChildren.Count -lt 3) {
        throw "Expected at least three PeAS Deno children; found $($denoChildren.Count)."
    }

    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 80 -ErrorAction Stop)
    if ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $ExpectedWebId) {
        throw 'TCP 80 is no longer owned solely by the expected PeAS web process.'
    }
    $webProcess = $children | Where-Object { $_.ProcessId -eq $ExpectedWebId -and $_.Name -eq 'deno.exe' }
    if (-not $webProcess) {
        throw "Web PID $ExpectedWebId is not a Deno child of supervisor $ExpectedSupervisorId."
    }

    $childIds = @($children.ProcessId)
    Write-RestartLog "Validated PeAS-only process tree. Stopping supervisor and children: $($childIds -join ',')."
    Stop-Process -Id $ExpectedSupervisorId -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 500
    foreach ($processId in $childIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }

    $releaseDeadline = (Get-Date).AddSeconds(20)
    do {
        $remainingListener = Get-NetTCPConnection -State Listen -LocalPort 80 -ErrorAction SilentlyContinue
        if (-not $remainingListener) { break }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $releaseDeadline)
    if ($remainingListener) { throw 'TCP 80 did not release after the validated PeAS processes stopped.' }

    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Write-RestartLog "$taskName started. Waiting for database-backed readiness."

    $ready = $false
    $readyDeadline = (Get-Date).AddSeconds(180)
    do {
        try {
            $response = Invoke-WebRequest -Uri 'http://192.168.2.104:80/health/ready' -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ready"') {
                $ready = $true
                break
            }
        } catch {
            # The listener is expected to be unavailable during startup.
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $readyDeadline)
    if (-not $ready) { throw 'PeAS did not return database-backed readiness within 180 seconds.' }

    Start-Sleep -Seconds 5
    $stable = Invoke-WebRequest -Uri 'http://192.168.2.104:80/health/ready' -UseBasicParsing -TimeoutSec 5
    if ($stable.StatusCode -ne 200) { throw 'PeAS readiness did not remain stable.' }

    $newListeners = @(Get-NetTCPConnection -State Listen -LocalPort 80 -ErrorAction Stop)
    if ($newListeners.Count -ne 1 -or $newListeners[0].LocalAddress -ne '192.168.2.104') {
        throw "PeAS listener is not restricted to 192.168.2.104:80."
    }
    if ($newListeners[0].OwningProcess -eq $ExpectedWebId) {
        throw 'The web process PID did not change during the restart.'
    }

    Write-RestartLog "SUCCESS: PeAS is ready on 192.168.2.104:80 with web PID $($newListeners[0].OwningProcess)."
    exit 0
} catch {
    Write-RestartLog "FAILED: $($_.Exception.Message)"
    exit 1
}
