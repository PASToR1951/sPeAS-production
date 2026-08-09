#Requires -Version 7.2
[CmdletBinding()]
param(
    [switch]$Native,
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$RepoRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
Set-Location -LiteralPath $repoRoot

if (-not $Native -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        & docker compose up --build
        exit $LASTEXITCODE
    }
}

$nativeSupervisor = Join-Path $repoRoot 'scripts\peas-boot-daemon.ps1'
if (Test-Path -LiteralPath $nativeSupervisor) {
    Write-Warning 'Docker Compose is unavailable; starting the configured native PeAS supervisor.'
    & $nativeSupervisor -AppRoot $AppRoot -RepoRoot $repoRoot
    exit $LASTEXITCODE
}

throw 'Docker Compose is unavailable and no native PeAS supervisor was found.'
