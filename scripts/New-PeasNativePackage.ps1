#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$ReleaseId,
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts')
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$commit = (& git -C $RepositoryRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'RepositoryRoot is not a readable Git checkout.' }
$dirty = @(& git -C $RepositoryRoot status --porcelain=v1 --untracked-files=normal)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect repository cleanliness.' }
if ($dirty.Count) { throw 'Refusing to package a dirty working tree.' }
$tagCommit = (& git -C $RepositoryRoot rev-list -n 1 $ReleaseId 2>$null | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or $tagCommit -cne $commit) { throw "$ReleaseId must resolve to the checked-out commit." }

$requiredBuildOutputs = @(
    'Deno\Public\react-ui\main-public.js',
    'Deno\Public\react-ui\style.css',
    'Deno\admin\react-ui\main-admin.js',
    'Deno\admin\react-ui\style.css',
    'Deno\admin\experience-studio\studio.js',
    'Deno\admin\experience-studio\style.css'
)
foreach ($relative in $requiredBuildOutputs) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot $relative) -PathType Leaf)) {
        throw "Required production UI output is missing: $relative. Run npm run build:ui first."
    }
}
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "peas-native-package-$([guid]::NewGuid())"
$staging = Join-Path $temporaryRoot 'root'
$archive = Join-Path $temporaryRoot 'tracked.zip'
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
    & git -C $RepositoryRoot archive --format=zip --output=$archive HEAD
    if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force

    foreach ($directory in @('Deno\Public\react-ui','Deno\admin\react-ui','Deno\admin\experience-studio')) {
        $source = Join-Path $RepositoryRoot $directory
        $destination = Join-Path $staging $directory
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    }

    [ordered]@{
        schemaVersion = 1
        releaseId = $ReleaseId
        gitCommit = $commit
        createdAt = [DateTimeOffset]::UtcNow.ToString('o')
        packageType = 'peas-native-windows'
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $staging 'native-release.json') -Encoding utf8NoBOM

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $packagePath = Join-Path $OutputDirectory "peas-native-$ReleaseId.zip"
    if (Test-Path -LiteralPath $packagePath) { throw "Output already exists: $packagePath" }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $packagePath -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$packagePath.sha256" -Value "$hash  $([IO.Path]::GetFileName($packagePath))" -Encoding ascii
    [ordered]@{releaseId=$ReleaseId;gitCommit=$commit;package=$packagePath;sha256=$hash}|ConvertTo-Json -Depth 4
} finally {
    $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
    $systemTemporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTemporary.StartsWith($systemTemporary, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemporary) -like 'peas-native-package-*') {
        Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
    }
}
