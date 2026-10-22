[CmdletBinding()]
param([string]$AppRoot = 'C:\ProgramData\PeAS', [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this activation script as Administrator to restart the elevated PeAS service.' }
$log = Join-Path $RepoRoot 'output\document-conversion-test-2026-10-23\activation.log'
Start-Transcript -LiteralPath $log -Append | Out-Null
try {
    $supervisors = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('powershell.exe', 'pwsh.exe') -and $_.CommandLine -match '-File\s+"?[^"\r\n]*peas-boot-daemon\.ps1' })
    if ($supervisors.Count -ne 1) { throw "Expected exactly one PeAS supervisor; found $($supervisors.Count). No processes were stopped." }
    $supervisor = $supervisors[0]
    $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $supervisor.ProcessId -and $_.Name -eq 'deno.exe' })
    if (-not ($children | Where-Object { $_.CommandLine -match 'server\.ts' })) { throw 'Could not identify the supervised web server. No processes were stopped.' }
    $runtime = Join-Path $AppRoot 'tools\libreoffice'
    if (-not (Test-Path -LiteralPath (Join-Path $runtime 'program\soffice.exe'))) {
        $source = Join-Path $RepoRoot '.tmp\libreoffice-runtime'
        if (-not (Test-Path -LiteralPath (Join-Path $source 'program\soffice.exe'))) { throw 'The tested LibreOffice runtime is missing. No processes were stopped.' }
        New-Item -ItemType Directory -Force -Path $runtime | Out-Null
        Copy-Item -Path (Join-Path $source '*') -Destination $runtime -Recurse -Force
    }
    # Preserve existing supervisor behavior, changing only converter permissions and PATH.
    $scripts = @((Join-Path $AppRoot 'scripts\peas-boot-daemon.ps1'), (Join-Path $RepoRoot 'scripts\peas-boot-daemon.ps1'))
    foreach ($script in $scripts) {
        if (-not (Test-Path -LiteralPath $script)) { continue }
        $text = [IO.File]::ReadAllText($script)
        $updated = $text.Replace('--allow-run=pdftoppm,pdfinfo,cwebp,ffmpeg,ffprobe,clamdscan', '--allow-run=soffice,pdftoppm,pdfinfo,cwebp,ffmpeg,ffprobe,clamdscan')
        if ($updated -notmatch '\$libreOfficeProgram\s*=') {
            $insertion = @'
$libreOfficeProgram = Join-Path $AppRoot 'tools\libreoffice\program'
if (Test-Path -LiteralPath (Join-Path $libreOfficeProgram 'soffice.exe')) { $env:PATH = "$libreOfficeProgram;$env:PATH" }
'@
            $updated = $updated.Replace('$env:PEAS_APP_ROOT = $AppRoot', $insertion + "`r`n" + '$env:PEAS_APP_ROOT = $AppRoot')
        }
        if ($updated -ne $text) {
            Copy-Item -LiteralPath $script -Destination "$script.before-document-conversion-$(Get-Date -Format yyyyMMddHHmmss).bak"
            [IO.File]::WriteAllText($script, $updated, [Text.UTF8Encoding]::new($false))
        }
    }
    # Restart only the identified supervisor and its application children. PostgreSQL stays running.
    $command = $supervisor.CommandLine
    $executable = $supervisor.ExecutablePath
    if (-not $executable) { throw 'Could not resolve supervisor executable. No processes were stopped.' }
    $arguments = if ($command.StartsWith('"')) { $command.Substring($command.IndexOf('"', 1) + 1).Trim() } else { $command.Substring($command.IndexOf(' ') + 1) }
    Stop-Process -Id $supervisor.ProcessId -Force
    foreach ($child in $children) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    $replacement = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru
    Write-Output "Replacement supervisor: $($replacement.Id)"
    $ready = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        Start-Sleep -Seconds 2
        try {
            $response = Invoke-WebRequest 'https://peas.spud.edu.ph/health/ready' -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) { throw 'The restarted service did not become ready. Inspect the PeAS boot log.' }
    $web = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $replacement.Id -and $_.Name -eq 'deno.exe' -and $_.CommandLine -match 'server\.ts' }
    if (-not $web -or $web.CommandLine -notmatch '--allow-run=soffice,') { throw 'The replacement web process does not have converter permission.' }
    Write-Output "SUCCESS: Web PID $($web.ProcessId) is ready with LibreOffice installed and converter permission enabled."
} finally { Stop-Transcript | Out-Null }
