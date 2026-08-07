#Requires -Version 7.2
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
Set-Location $repoRoot

if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        & docker compose up --build
        exit $LASTEXITCODE
    }
}

throw 'Docker Desktop with Docker Compose is required to run PeAS.'
