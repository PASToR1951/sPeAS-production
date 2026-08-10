# Registers PeAS to run before user login. Must be run elevated.
[CmdletBinding()]
param(
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$taskName = 'PeAS-Boot-Daemon'
$source = Join-Path $RepoRoot 'scripts\peas-boot-daemon.ps1'
$targetDir = Join-Path $AppRoot 'scripts'
$target = Join-Path $targetDir 'peas-boot-daemon.ps1'
if (-not (Test-Path -LiteralPath $source)) { throw "Missing boot daemon: $source" }
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force

$startupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'PeAS-AutoStart.lnk'
$startupPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$target`" -AppRoot `"$AppRoot`" -RepoRoot `"$RepoRoot`""
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startupShortcut)
$shortcut.TargetPath = $startupPowerShell
$shortcut.Arguments = $startupArguments
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Starts the PeAS native supervisor at user logon.'
$shortcut.Save()

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$target`" -AppRoot `"$AppRoot`" -RepoRoot `"$RepoRoot`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts PeAS before Windows user login and supervises its native processes.' -Force | Out-Null
$registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($registered.Principal.UserId -ne 'SYSTEM') { throw "Unexpected task principal: $($registered.Principal.UserId)" }
Write-Host "Registered $taskName as SYSTEM at startup."
