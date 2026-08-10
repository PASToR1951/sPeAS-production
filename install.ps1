#Requires -Version 7.2
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$localDeploy = Join-Path $scriptRoot 'ops\peas-deploy.ps1'
$installedDeploy = Join-Path $env:ProgramData 'PeAS\current\ops\peas-deploy.ps1'

function Get-DeployProgram {
    if ((Test-Path $installedDeploy) -and (Test-Path (Join-Path $env:ProgramData 'PeAS\config\peas.env'))) {
        return $installedDeploy
    }
    return $localDeploy
}

function Read-Required([string]$Prompt) {
    do { $value = Read-Host $Prompt } while ([string]::IsNullOrWhiteSpace($value))
    return $value.Trim()
}

function Invoke-Action([scriptblock]$Action) {
    try {
        & $Action
        Write-Host "`nCompleted successfully." -ForegroundColor Green
    } catch {
        Write-Error $_
    }
    Read-Host "`nPress Enter to return to the menu" | Out-Null
}

if (-not (Test-Path $localDeploy)) { throw "Missing $localDeploy" }

while ($true) {
    Write-Host @'

PeAS Windows 11 Server Installation
===================================
  1) Install PeAS on a new server
  2) Configure outgoing email
  3) Create an administrator
  4) Set an administrator password
  5) Deploy an application update
  6) Run production readiness checks
  7) Show service status
  8) Create an encrypted backup
  9) View service logs
 10) Verify public HTTPS endpoints
 11) Roll back application image
 12) Restore a Restic snapshot
  0) Exit
'@
    $choice = Read-Host 'Choose an option'
    switch ($choice) {
        '1' { Invoke-Action {
            $domain = Read-Required 'Production domain (without https://)'
            $email = Read-Required 'ACME certificate email'
            $image = Read-Required 'PeAS image digest (ghcr.io/...@sha256:...)'
            & $localDeploy install -Domain $domain -AcmeEmail $email -Image $image
        } }
        '2' { Invoke-Action { & (Get-DeployProgram) configure-email } }
        '3' { Invoke-Action { & (Get-DeployProgram) bootstrap-admin } }
        '4' { Invoke-Action { & (Get-DeployProgram) set-admin-password } }
        '5' { Invoke-Action { & (Get-DeployProgram) deploy -Image (Read-Required 'New PeAS image digest') } }
        '6' { Invoke-Action { & (Get-DeployProgram) doctor } }
        '7' { Invoke-Action { & (Get-DeployProgram) status } }
        '8' { Invoke-Action { & (Get-DeployProgram) backup } }
        '9' { Invoke-Action { & (Get-DeployProgram) logs -Service (Read-Host 'Service [app]' | ForEach-Object { if ($_) { $_ } else { 'app' } }) } }
        '10' { Invoke-Action { & (Get-DeployProgram) verify } }
        '11' { Invoke-Action {
            $image = Read-Host 'Rollback digest (blank uses recorded previous image)'
            if ($image) { & (Get-DeployProgram) rollback -Image $image } else { & (Get-DeployProgram) rollback }
        } }
        '12' { Invoke-Action { & (Get-DeployProgram) restore -Snapshot (Read-Required 'Exact Restic snapshot ID') } }
        '0' { return }
        default { Write-Warning 'Choose a listed option.' }
    }
}
