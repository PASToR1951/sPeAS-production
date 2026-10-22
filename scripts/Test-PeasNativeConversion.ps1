#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Launcher,
    [Parameter(Mandatory)][string]$SofficePath,
    [Parameter(Mandatory)][string]$QualifiedVersion,
    [Parameter(Mandatory)][string]$FontManifestPath,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [switch]$LayoutReviewed,
    [switch]$StartupVerified,
    [switch]$RestartVerified
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Run qualification on the target Windows host under the actual worker identity.' }
$Launcher = (Resolve-Path -LiteralPath $Launcher).Path
$SofficePath = (Resolve-Path -LiteralPath $SofficePath).Path
$FontManifestPath = (Resolve-Path -LiteralPath $FontManifestPath).Path
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$root = Join-Path $OutputDirectory 'import-staging'
$run = Join-Path $root ([guid]::NewGuid().ToString())
$probe = Join-Path $run 'isolation'
$fixtures = Join-Path $run 'fixtures'
New-Item -ItemType Directory -Path $probe, $fixtures -Force | Out-Null
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
$identity = (& $Launcher --identity | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $identity -notmatch '^S-1-') { throw 'Unable to determine converter service identity.' }
$receipt = [ordered]@{
    schemaVersion = 1; mode = 'synthetic'; isolationPassed = $false
    launcherSha256 = (Hash $Launcher)
    engineSha256 = (Hash (Join-Path (Split-Path -Parent $SofficePath) 'soffice.bin'))
    engineLauncherSha256 = (Hash $SofficePath)
    fontManifestSha256 = (Hash $FontManifestPath)
    serviceSid = $identity; version = $QualifiedVersion
    layoutReviewed = [bool]$LayoutReviewed; startupVerified = [bool]$StartupVerified; restartVerified = [bool]$RestartVerified
    releaseId = $env:PEAS_RELEASE_ID; checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
}
$testReceipt = Join-Path $run 'synthetic-receipt.json'
$variables = @{
    DENO_ENV = 'test'; IMPORT_STAGING_ROOT = $root
    IMPORT_LIBREOFFICE_PATH = $Launcher; IMPORT_WINDOWS_SOFFICE_PATH = $SofficePath
    IMPORT_LIBREOFFICE_VERSION = $QualifiedVersion; IMPORT_CONVERTER_ISOLATED = 'true'
    IMPORT_FONT_MANIFEST_SHA256 = $receipt.fontManifestSha256
    IMPORT_WINDOWS_QUALIFICATION_FILE = $testReceipt
    IMPORT_QUALIFICATION_OUTPUT = $fixtures
    # Only the script-generated synthetic DOCX is passed to this unrestricted fixture generator.
    IMPORT_QUALIFICATION_FIXTURE_GENERATOR = $SofficePath
}
$previous = @{}
foreach ($name in $variables.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $variables[$name], 'Process')
}
try {
    & $Launcher --self-test $probe
    if ($LASTEXITCODE -ne 0) { throw 'Native isolation or process-tree termination failed.' }
    $receipt.isolationPassed = $true
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $testReceipt -Encoding utf8NoBOM
    & deno run --allow-env --allow-read --allow-write "--allow-run=$Launcher,$SofficePath,pdfinfo,pdftotext,pdftoppm" (Join-Path $PSScriptRoot '..\Deno\integration\importWord.qualification.ts')
    if ($LASTEXITCODE -ne 0) { throw 'DOC/DOCX qualification failed. Word conversion must remain disabled.' }
    if ((Hash $Launcher) -ne $receipt.launcherSha256 -or (Hash $SofficePath) -ne $receipt.engineLauncherSha256 -or (Hash (Join-Path (Split-Path -Parent $SofficePath) 'soffice.bin')) -ne $receipt.engineSha256 -or (Hash $FontManifestPath) -ne $receipt.fontManifestSha256) { throw 'Converter or fonts changed during qualification.' }
    $receipt.mode = if ($LayoutReviewed -and $StartupVerified -and $RestartVerified) { 'qualified' } else { 'pending-review' }
    $receipt.artifacts = $fixtures
    $finalReceipt = Join-Path $OutputDirectory 'native-qualification.json'
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $finalReceipt -Encoding utf8NoBOM
    Write-Output "Receipt: $finalReceipt ($($receipt.mode)). Inspect DOC/DOCX PNGs in $fixtures."
    if ($receipt.mode -ne 'qualified') { Write-Warning 'Conversion remains disabled until layout, pre-sign-in startup and restart are verified under this service identity.' }
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
