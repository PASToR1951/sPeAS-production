# setup-path.ps1
$pgBin = 'C:\ProgramData\PeAS\postgres\bin'
$denoDir = 'C:\Users\peas\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe'
$nodeDir = 'C:\Users\peas\AppData\Local\OpenAI\Codex\runtimes\cua_node\fb8898c05a62885e\bin'

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }

$additions = @($pgBin, $denoDir, $nodeDir)
foreach ($add in $additions) {
    if (Test-Path $add) {
        if (-not $userPath.Contains($add)) {
            $userPath = "$add;$userPath"
        }
    }
}

[Environment]::SetEnvironmentVariable('Path', $userPath, 'User')
Write-Host "[peas-path] Updated User PATH environment variable:" -ForegroundColor Green
Write-Host $userPath
