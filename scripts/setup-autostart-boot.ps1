# setup-autostart-boot.ps1
# Configures PeAS System to start automatically at Windows BOOT (before user login)

[CmdletBinding()]
param(
    [string]$AppRoot = (Join-Path $env:ProgramData 'PeAS'),
    [string]$RepoRoot = 'c:\Users\peas\Desktop\sPeAS-production'
)

$ErrorActionPreference = 'Stop'

Write-Host "[peas-autostart] Configuring Windows Boot Task (Run At System Startup Before User Login)..." -ForegroundColor Cyan

# 1. Ensure target script directory exists in C:\ProgramData\PeAS\scripts
$targetScriptsDir = Join-Path $AppRoot 'scripts'
New-Item -ItemType Directory -Force -Path $targetScriptsDir | Out-Null

$srcDaemonScript = Join-Path $RepoRoot 'scripts\peas-boot-daemon.ps1'
$dstDaemonScript = Join-Path $targetScriptsDir 'peas-boot-daemon.ps1'

Copy-Item -Path $srcDaemonScript -Destination $dstDaemonScript -Force
Write-Host "[peas-autostart] Copied boot daemon script to $dstDaemonScript" -ForegroundColor Yellow

# 2. Register Windows Scheduled Task for SYSTEM account at Boot
$taskName = 'PeAS-Boot-Daemon'

$trigger = New-ScheduledTaskTrigger -AtStartup
$actionArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dstDaemonScript`" -AppRoot `"$AppRoot`" -RepoRoot `"$RepoRoot`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null

Write-Host "[peas-autostart] Scheduled Task '$taskName' successfully registered!" -ForegroundColor Green
Write-Host "[peas-autostart] Trigger: At Windows System Boot (Before User Login)" -ForegroundColor Green
Write-Host "[peas-autostart] User Account: NT AUTHORITY\SYSTEM (Service Account)" -ForegroundColor Green
