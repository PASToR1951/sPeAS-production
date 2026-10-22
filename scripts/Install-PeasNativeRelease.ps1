#Requires -Version 7.2
#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$PackagePath,
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ExpectedSha256,
    [Parameter(Mandatory)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$ReleaseId,
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [switch]$Activate,
    [string]$Confirmation
)

$ErrorActionPreference = 'Stop'
$PackagePath = (Resolve-Path -LiteralPath $PackagePath).Path
$AppRoot = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
if ($AppRoot -eq [IO.Path]::GetPathRoot($AppRoot)) { throw 'AppRoot must not be a drive root.' }
$actualHash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash
if ($actualHash -cne $ExpectedSha256.ToUpperInvariant()) { throw 'Native release package SHA-256 does not match the approved value.' }

$releasesRoot = Join-Path $AppRoot 'releases'
$stagingRoot = Join-Path $AppRoot 'staging'
$target = Join-Path $releasesRoot $ReleaseId
foreach ($path in @($releasesRoot,$stagingRoot)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
if (Test-Path -LiteralPath $target) { throw "Release already exists: $target" }
$staging = Join-Path $stagingRoot "native-release-$ReleaseId-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $staging -Force
    $manifestPath = Join-Path $staging 'native-release.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Native release manifest is missing.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 5
    if ($manifest.schemaVersion -ne 1 -or $manifest.releaseId -cne $ReleaseId -or $manifest.gitCommit -notmatch '^[a-f0-9]{40}$') {
        throw 'Native release manifest does not match the requested release.'
    }
    foreach ($relative in @('Deno\server.ts','scripts\peas-boot-daemon.ps1','scripts\setup-autostart-boot.ps1','Deno\Public\react-ui\main-public.js','Deno\admin\react-ui\main-admin.js','Deno\admin\experience-studio\studio.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $staging $relative) -PathType Leaf)) { throw "Native release is incomplete: $relative" }
    }
    Move-Item -LiteralPath $staging -Destination $target
} finally {
    if (Test-Path -LiteralPath $staging) {
        $resolvedStaging = [IO.Path]::GetFullPath($staging)
        if ($resolvedStaging.StartsWith(([IO.Path]::GetFullPath($stagingRoot) + '\'), [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedStaging -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
[ordered]@{releaseId=$ReleaseId;gitCommit=$manifest.gitCommit;path=$target;sha256=$actualHash;activated=$false}|ConvertTo-Json -Depth 4
if (-not $Activate) { exit 0 }
$expectedConfirmation = "ACTIVATE PEAS $ReleaseId"
if ($Confirmation -cne $expectedConfirmation) { throw "Activation requires -Confirmation '$expectedConfirmation'." }

$taskName = 'PeAS-Boot-Daemon'
$current = Join-Path $AppRoot 'current'
$next = Join-Path $AppRoot "current-next-$([guid]::NewGuid())"
$previous = Join-Path $AppRoot 'previous'
if ($PSCmdlet.ShouldProcess($current, "Activate immutable PeAS release $ReleaseId")) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $running = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if (-not $running -or $running.State -ne 'Running') { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($running -and $running.State -eq 'Running') { throw 'The PeAS boot task did not stop within 30 seconds.' }

    $candidateRoots = @($current,$target) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { [IO.Path]::GetFullPath($_) }
    $peasDeno = @(Get-CimInstance Win32_Process -Filter "Name = 'deno.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $commandLine = [string]$_.CommandLine
        ($commandLine -match '(server|media-worker|abstract-worker)\.ts') -and @($candidateRoots | Where-Object { $commandLine.Contains($_, [StringComparison]::OrdinalIgnoreCase) }).Count
    })
    foreach ($process in $peasDeno) { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }

    New-Item -ItemType Junction -Path $next -Target $target | Out-Null
    if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
    if (Test-Path -LiteralPath $current) {
        $currentItem = Get-Item -LiteralPath $current -Force
        if ($currentItem.LinkType -ne 'Junction') { throw "Refusing to replace non-junction current path: $current" }
        Move-Item -LiteralPath $current -Destination $previous
    }
    Move-Item -LiteralPath $next -Destination $current

    & (Join-Path $current 'scripts\setup-autostart-boot.ps1') -AppRoot $AppRoot -RepoRoot $current
    if ($LASTEXITCODE -ne 0) { throw 'Unable to register the immutable PeAS boot task.' }
    Start-ScheduledTask -TaskName $taskName
    $ready = "http://$([Environment]::GetEnvironmentVariable('PEAS_BIND_HOST','Process')):$([Environment]::GetEnvironmentVariable('PORT','Process'))/health/ready"
    [ordered]@{releaseId=$ReleaseId;gitCommit=$manifest.gitCommit;path=$target;sha256=$actualHash;activated=$true;task=$taskName}|ConvertTo-Json -Depth 4
}
