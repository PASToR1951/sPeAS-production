#Requires -Version 7.2
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [int]$ExpectedSupervisorId,
    [Parameter(Mandatory)]
    [int]$ExpectedWebId,
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$RepoRoot = 'C:\Users\peas\Desktop\sPeAS-production',
    [string]$ApplicationAddress = '192.168.2.104',
    [int]$ApplicationPort = 80,
    [string]$NginxAddress = '192.168.2.3'
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $AppRoot 'logs\release-a-closure-elevated.log'
$envPath = Join-Path $AppRoot 'config\peas.env'
$backup = "$envPath.pre-proxy-correction-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')).bak"

function Write-ClosureLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [vm304-closure] $Message" -Encoding utf8
}

function Set-EnvValue([string]$Name, [string]$Value) {
    $lines = [Collections.Generic.List[string]]::new()
    $updated = $false
    foreach ($line in @(Get-Content -LiteralPath $envPath -ErrorAction Stop)) {
        if ($line -match "^\s*$([regex]::Escape($Name))=") {
            $lines.Add("$Name=$Value")
            $updated = $true
        } else { $lines.Add($line) }
    }
    if (-not $updated) { $lines.Add("$Name=$Value") }
    $temporary = "$envPath.$PID.tmp"
    Set-Content -LiteralPath $temporary -Value $lines -Encoding utf8NoBOM
    Move-Item -LiteralPath $temporary -Destination $envPath -Force
}

try {
    Write-ClosureLog "Starting VM 304 closure for proxy $NginxAddress and app ${ApplicationAddress}:$ApplicationPort."
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw "Production environment file is missing: $envPath" }
    foreach ($script in @('configure-native-firewall.ps1','Invoke-PeasReleaseARestart.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "scripts\$script") -PathType Leaf)) { throw "Required script is missing: $script" }
    }

    $requestJob = Start-Job -ScriptBlock {
        1..100 | ForEach-Object {
            try { Invoke-WebRequest -Uri "https://peas.spud.edu.ph/health/live?closure_peer=$_" -Headers @{Connection='close'} -UseBasicParsing -TimeoutSec 5 | Out-Null } catch { }
            Start-Sleep -Milliseconds 50
        }
    }
    try {
        $peerEvidence = & (Join-Path $RepoRoot 'scripts\Test-PeasProxyPeer.ps1') -ApplicationAddress $ApplicationAddress -ApplicationPort $ApplicationPort -DurationSeconds 10 -ExpectedProxyAddress $NginxAddress 2>&1
    } finally {
        Wait-Job $requestJob -Timeout 15 | Out-Null
        Remove-Job $requestJob -Force -ErrorAction SilentlyContinue
    }
    $peerEvidence | ForEach-Object { Write-ClosureLog ([string]$_) }

    $firewallPreview = & (Join-Path $RepoRoot 'scripts\configure-native-firewall.ps1') -ApplicationAddress $ApplicationAddress -ApplicationPort $ApplicationPort -NginxAddress $NginxAddress 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Firewall dry run failed: $($firewallPreview -join ' ')" }
    $firewallPreview | ForEach-Object { Write-ClosureLog ([string]$_) }

    Copy-Item -LiteralPath $envPath -Destination $backup
    Set-EnvValue 'TRUSTED_PROXY_RANGES' $NginxAddress
    Set-EnvValue 'PEAS_RELEASE_ID' 'v1.0.2-rc.1'
    Write-ClosureLog "Updated proxy trust after backing up the environment to $backup."

    & (Join-Path $RepoRoot 'scripts\Invoke-PeasReleaseARestart.ps1') -ExpectedSupervisorId $ExpectedSupervisorId -ExpectedWebId $ExpectedWebId -AppRoot $AppRoot -RepoRoot $RepoRoot
    if ($LASTEXITCODE -ne 0) {
        Copy-Item -LiteralPath $backup -Destination $envPath -Force
        Start-ScheduledTask -TaskName 'PeAS-Boot-Daemon' -ErrorAction SilentlyContinue
        throw 'Supervised restart failed; the previous environment was restored.'
    }

    $localBase = "http://${ApplicationAddress}:$ApplicationPort"
    $ready = Invoke-WebRequest -Uri "$localBase/health/ready" -UseBasicParsing -TimeoutSec 10
    if ($ready.StatusCode -ne 200 -or $ready.Content -notmatch '"status"\s*:\s*"ready"') { throw 'Local database readiness failed after restart.' }
    try {
        Invoke-WebRequest -Uri "$localBase/api/security/csp-report" -Method Post -ContentType 'text/plain' -Body '{}' -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop | Out-Null
        throw 'CSP receiver unexpectedly accepted text/plain.'
    } catch {
        $status = [int]$_.Exception.Response.StatusCode
        if ($status -ne 415) { throw }
    }

    & (Join-Path $RepoRoot 'scripts\configure-native-firewall.ps1') -ApplicationAddress $ApplicationAddress -ApplicationPort $ApplicationPort -NginxAddress $NginxAddress -Apply -Confirmation "ISOLATE PEAS PORT $ApplicationPort"
    if ($LASTEXITCODE -ne 0) { throw 'PeAS firewall isolation failed after the application restart.' }

    $public = Invoke-WebRequest -Uri 'https://peas.spud.edu.ph/health/ready' -UseBasicParsing -TimeoutSec 20
    if ($public.StatusCode -ne 200) { throw 'Public readiness failed after firewall isolation.' }
    Write-ClosureLog 'SUCCESS: proxy trust, CSP receiver, readiness, and PeAS-only firewall isolation passed.'
    [ordered]@{status='passed';proxy=$NginxAddress;application="$ApplicationAddress`:$ApplicationPort";environmentBackup=$backup}|ConvertTo-Json -Depth 4
} catch {
    Write-ClosureLog "FAILED: $($_.Exception.Message)"
    throw
}
