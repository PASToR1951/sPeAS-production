#Requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'The native converter must be built on Windows.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.8 compiler is required.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = Join-Path $OutputDirectory 'peas-convert-word.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$output" (Join-Path $PSScriptRoot '..\tools\native-converter\PeasConvertWord.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native converter build failed.' }
Get-FileHash -LiteralPath $output -Algorithm SHA256
