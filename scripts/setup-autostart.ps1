# setup-autostart.ps1
# PowerShell script to configure automatic startup of PeAS on Windows at boot / logon

[CmdletBinding()]
param(
    [ValidateSet('RegisterTask', 'CreateShortcut', 'Remove')]
    [string]$TaskMode = 'RegisterTask',
    [string]$TaskName = 'PeAS-AutoStart'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$startScript = Join-Path $repoRoot 'start-native.ps1'

if (-not (Test-Path $startScript)) {
    throw "Startup script not found at $startScript"
}

switch ($TaskMode) {
    'RegisterTask' {
        Write-Host "[peas-autostart] Registering Windows Scheduled Task '$TaskName'..." -ForegroundColor Cyan
        
        $powershellExe = (Get-Command powershell.exe).Source
        $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

        try {
            $taskActionObj = New-ScheduledTaskAction -Execute $powershellExe -Argument $argList -WorkingDirectory $repoRoot
            $triggerAtLogon = New-ScheduledTaskTrigger -AtLogOn
            $triggerAtStartup = New-ScheduledTaskTrigger -AtStartup
            $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

            Register-ScheduledTask -TaskName $TaskName -Action $taskActionObj -Trigger @($triggerAtLogon, $triggerAtStartup) -Settings $settings -RunLevel Highest -Force | Out-Null
            Write-Host "[peas-autostart] Scheduled Task '$TaskName' registered successfully in Windows Task Scheduler!" -ForegroundColor Green
            Write-Host "[peas-autostart] PeAS will start automatically whenever the computer boots or user logs in." -ForegroundColor Green
        } catch {
            Write-Warning "[peas-autostart] Task Scheduler requires elevation or Administrator privileges."
            Write-Host "[peas-autostart] Creating startup shortcut in user Startup folder (shell:startup)..." -ForegroundColor Yellow
            
            $WshShell = New-Object -ComObject WScript.Shell
            $startupFolder = $WshShell.SpecialFolders.Item("Startup")
            $shortcutPath = Join-Path $startupFolder "$TaskName.lnk"
            $shortcut = $WshShell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = $powershellExe
            $shortcut.Arguments = $argList
            $shortcut.WorkingDirectory = $repoRoot
            $shortcut.WindowStyle = 7 # Minimized
            $shortcut.Description = "PeAS Electronic Archiving System Startup"
            $shortcut.Save()
            
            Write-Host "[peas-autostart] Created user startup shortcut at:" -ForegroundColor Green
            Write-Host "  $shortcutPath" -ForegroundColor Cyan
        }
    }

    'CreateShortcut' {
        Write-Host "[peas-autostart] Creating startup shortcut in user Startup folder..." -ForegroundColor Cyan
        $powershellExe = (Get-Command powershell.exe).Source
        $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

        $WshShell = New-Object -ComObject WScript.Shell
        $startupFolder = $WshShell.SpecialFolders.Item("Startup")
        $shortcutPath = Join-Path $startupFolder "$TaskName.lnk"
        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $powershellExe
        $shortcut.Arguments = $argList
        $shortcut.WorkingDirectory = $repoRoot
        $shortcut.WindowStyle = 7 # Minimized
        $shortcut.Description = "PeAS Electronic Archiving System Startup"
        $shortcut.Save()

        Write-Host "[peas-autostart] Startup shortcut created successfully at:" -ForegroundColor Green
        Write-Host "  $shortcutPath" -ForegroundColor Cyan
    }

    'Remove' {
        Write-Host "[peas-autostart] Removing automatic startup configuration..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        
        $WshShell = New-Object -ComObject WScript.Shell
        $startupFolder = $WshShell.SpecialFolders.Item("Startup")
        $shortcutPath = Join-Path $startupFolder "$TaskName.lnk"
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force
        }
        Write-Host "[peas-autostart] Automatic startup configuration removed." -ForegroundColor Green
    }
}
