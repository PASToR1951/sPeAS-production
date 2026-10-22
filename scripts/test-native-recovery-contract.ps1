#Requires -Version 7.2
[CmdletBinding()]
param([string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$files = @(
    'ops\peas-native-recovery.ps1',
    'scripts\peas-boot-daemon.ps1',
    'scripts\setup-autostart-boot.ps1',
    'scripts\configure-native-firewall.ps1',
    'scripts\Test-PeasProxyPeer.ps1',
    'scripts\Test-PeasPublicEdge.ps1',
    'scripts\New-PeasNativePackage.ps1',
    'scripts\Install-PeasNativeRelease.ps1',
    'scripts\Set-PeasGmailAppPassword.ps1',
    'scripts\Invoke-PeasVm304Closure.ps1'
)
foreach ($relative in $files) {
    $path = Join-Path $RepositoryRoot $relative
    $tokens = $null; $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count) { throw "$relative has PowerShell parse errors: $($errors.Message -join '; ')" }
}

$policy = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'ops\backup-policy.example.json') -Raw | ConvertFrom-Json
if ($policy.schemaVersion -ne 1) { throw 'Unexpected backup policy schema.' }
if ($policy.retention.hourly -ne 48 -or $policy.retention.daily -ne 30 -or $policy.retention.monthly -ne 12 -or $policy.retention.yearly -ne 7) {
    throw 'The example retention policy does not match the approved recovery policy.'
}
if (@($policy.repositories).Count -ne 2) { throw 'Both rotating USB repositories must be represented.' }
if (@($policy.repositories.volumeLabel | Sort-Object) -join ',' -cne 'PEAS-BACKUP-A,PEAS-BACKUP-B') { throw 'Unexpected USB volume labels.' }
if (($policy.repositories | Where-Object id -eq 'usb-a').maximumAgeHours -ne 48 -or ($policy.repositories | Where-Object id -eq 'usb-b').maximumAgeHours -ne 168) {
    throw 'Per-repository rotation freshness is not represented in the example policy.'
}
if (-not $policy.monitoring.enabled -or $policy.monitoring.publicDocumentId -lt 1 -or $policy.monitoring.cspMode -notin @('report-only','enforce')) {
    throw 'Native public monitoring is not fully represented in the example policy.'
}

$recovery = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'ops\peas-native-recovery.ps1') -Raw
foreach ($required in @('Global\PeAS-Native-Recovery','Win32_ShadowCopy','Get-BitLockerVolume','independent Restic password file','--no-role-passwords','legal-hold','ACTIVATION-APPROVED.json','Test-PeasPublicEdge.ps1','Update-MonitoringState','Send-OperationsAlert','PeAS-Native-CSP-Summary','maximumAgeHours')) {
    if (-not $recovery.Contains($required)) { throw "Recovery contract is missing: $required" }
}
$restoreStart = $recovery.IndexOf('function Invoke-Restore')
$drillStart = $recovery.IndexOf('function Invoke-Drill')
$restoreBlock = $recovery.Substring($restoreStart, $drillStart - $restoreStart)
if ($restoreBlock.IndexOf('Snapshot -notmatch') -gt $restoreBlock.IndexOf('Assert-RestoreTarget')) {
    throw 'Restore target creation occurs before snapshot validation.'
}
Write-Host 'Native recovery contract checks passed.'
