# start.ps1
# PowerShell entry script for starting PeAS on Windows
[CmdletBinding()]
param(
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot

# Delegate to start-native.ps1
& (Join-Path $repoRoot 'start-native.ps1') -Foreground:$Foreground
