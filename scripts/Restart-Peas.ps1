#Requires -Version 7.2

<#
.SYNOPSIS
Safely restarts the native PeAS application and workers.

.DESCRIPTION
Discovers the web process from the configured PeAS listener, verifies that it
belongs to the expected PowerShell supervisor and Deno child-process tree, and
then delegates the privileged restart to the repository's fail-closed native
restart helper. The helper registers the SYSTEM boot task before stopping the
current processes and waits for database-backed readiness after restart.

.EXAMPLE
.\scripts\Restart-PeAS.ps1 -WhatIf

.EXAMPLE
.\scripts\Restart-PeAS.ps1
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$AppRoot = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
if ($AppRoot -eq [IO.Path]::GetPathRoot($AppRoot)) {
    throw 'AppRoot must not be a drive root.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdministrator -and -not $WhatIfPreference) {
    $powerShell = (Get-Process -Id $PID).Path
    $arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-AppRoot', "`"$AppRoot`"",
        '-RepoRoot', "`"$RepoRoot`""
    )
    $elevated = Start-Process -FilePath $powerShell -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($elevated.ExitCode -ne 0) {
        throw "Elevated PeAS restart failed with exit code $($elevated.ExitCode)."
    }
    Write-Host 'PeAS restart completed successfully. See C:\ProgramData\PeAS\logs\release-a-elevated-restart.log for the privileged audit trail.'
    return
}

$environmentPath = Join-Path $AppRoot 'config\peas.env'
$restartHelper = Join-Path $RepoRoot 'scripts\Invoke-PeasReleaseARestart.ps1'
foreach ($requiredPath in @($environmentPath, $restartHelper)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required PeAS file is missing: $requiredPath"
    }
}

$settings = @{}
Get-Content -LiteralPath $environmentPath | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $parts = $line.Split('=', 2)
        $settings[$parts[0].Trim()] = $parts[1].Trim()
    }
}

$bindHost = [string]$settings.PEAS_BIND_HOST
if ([string]::IsNullOrWhiteSpace($bindHost)) {
    $bindHost = [string]$settings.HOST
}
if ([string]::IsNullOrWhiteSpace($bindHost)) {
    throw 'PEAS_BIND_HOST or HOST must be configured in peas.env.'
}

$port = 0
if (-not [int]::TryParse([string]$settings.PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw 'PORT must be a valid TCP port in peas.env.'
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop |
    Where-Object { $_.LocalAddress -eq $bindHost })
if ($listeners.Count -ne 1) {
    throw "Expected exactly one listener on ${bindHost}:$port; found $($listeners.Count)."
}

$webId = [int]$listeners[0].OwningProcess
$webProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $webId" -ErrorAction Stop
if ($webProcess.Name -ne 'deno.exe') {
    throw "The ${bindHost}:$port listener is not owned by Deno."
}

$supervisorId = [int]$webProcess.ParentProcessId
$supervisor = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisorId" -ErrorAction Stop
if ($supervisor.Name -notin @('powershell.exe', 'pwsh.exe')) {
    throw "The listener's parent PID $supervisorId is not a PowerShell supervisor."
}

$children = @(Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object { $_.ParentProcessId -eq $supervisorId })
$unexpectedChildren = @($children | Where-Object { $_.Name -notin @('deno.exe', 'conhost.exe') })
if ($unexpectedChildren.Count -gt 0) {
    throw "Unexpected supervisor children: $($unexpectedChildren.Name -join ', ')."
}
$denoChildren = @($children | Where-Object { $_.Name -eq 'deno.exe' })
if ($denoChildren.Count -lt 3) {
    throw "Expected at least three PeAS Deno children; found $($denoChildren.Count)."
}

$target = "PeAS application at ${bindHost}:$port (supervisor PID $supervisorId)"
if (-not $PSCmdlet.ShouldProcess($target, 'Restart the validated web server and worker process tree')) {
    [pscustomobject]@{
        Status = 'Validated'
        Restarted = $false
        BindHost = $bindHost
        Port = $port
        SupervisorId = $supervisorId
        WebProcessId = $webId
        DenoChildren = $denoChildren.Count
    }
    return
}

& $restartHelper `
    -ExpectedSupervisorId $supervisorId `
    -ExpectedWebId $webId `
    -AppRoot $AppRoot `
    -RepoRoot $RepoRoot `
    -ExpectedBindHost $bindHost `
    -ExpectedPort $port
if ($LASTEXITCODE -ne 0) {
    throw "PeAS restart helper failed with exit code $LASTEXITCODE. Review C:\ProgramData\PeAS\logs\release-a-elevated-restart.log."
}

$newListeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop |
    Where-Object { $_.LocalAddress -eq $bindHost })
if ($newListeners.Count -ne 1 -or $newListeners[0].OwningProcess -eq $webId) {
    throw 'PeAS restarted but the expected replacement web listener was not found.'
}

$readinessUri = "http://${bindHost}:$port/health/ready"
$readiness = Invoke-WebRequest -Uri $readinessUri -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
if ($readiness.StatusCode -ne 200 -or $readiness.Content -notmatch '"status"\s*:\s*"ready"') {
    throw 'PeAS restart completed but database-backed readiness did not pass.'
}

[pscustomobject]@{
    Status = 'Ready'
    Restarted = $true
    BindHost = $bindHost
    Port = $port
    PreviousWebProcessId = $webId
    WebProcessId = [int]$newListeners[0].OwningProcess
    ReadinessUri = $readinessUri
}
