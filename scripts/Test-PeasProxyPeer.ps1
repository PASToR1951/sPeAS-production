#Requires -Version 7.2
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$ApplicationPort = 80,
    [Parameter(Mandatory)]
    [string]$ApplicationAddress,
    [ValidateRange(5, 120)]
    [int]$DurationSeconds = 30,
    [string[]]$ExpectedProxyAddress = @()
)

$ErrorActionPreference = 'Stop'
$applicationIp = [Net.IPAddress]::Parse($ApplicationAddress)
if ($applicationIp.Equals([Net.IPAddress]::Any) -or $applicationIp.Equals([Net.IPAddress]::IPv6Any)) {
    throw 'ApplicationAddress must not be a wildcard address.'
}

$expected = @($ExpectedProxyAddress | Where-Object { $_ } | ForEach-Object { [Net.IPAddress]::Parse($_).ToString() } | Sort-Object -Unique)
$observed = [Collections.Generic.Dictionary[string,System.Collections.Generic.HashSet[string]]]::new([StringComparer]::OrdinalIgnoreCase)
$deadline = [DateTimeOffset]::UtcNow.AddSeconds($DurationSeconds)

Write-Warning "For the next $DurationSeconds seconds, send several requests through the public PeAS hostname. This command does not change networking or firewall state."
do {
    $connections = @(Get-NetTCPConnection -LocalAddress $applicationIp.ToString() -LocalPort $ApplicationPort -ErrorAction SilentlyContinue | Where-Object State -notin @('Listen','Bound','Closed'))
    foreach ($connection in $connections) {
        if ($connection.RemoteAddress -and $connection.RemoteAddress -notin @('127.0.0.1','::1',$applicationIp.ToString())) {
            $remote = [string]$connection.RemoteAddress
            if (-not $observed.ContainsKey($remote)) { $observed[$remote] = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase) }
            $null = $observed[$remote].Add([string]$connection.State)
        }
    }
    Start-Sleep -Milliseconds 100
} while ([DateTimeOffset]::UtcNow -lt $deadline)

$addresses = @($observed.Keys | Sort-Object)
$unexpected = if ($expected.Count) { @($addresses | Where-Object { $_ -notin $expected }) } else { @() }
$missing = if ($expected.Count) { @($expected | Where-Object { $_ -notin $addresses }) } else { @() }
$result = [ordered]@{
    applicationAddress = $applicationIp.ToString()
    applicationPort = $ApplicationPort
    durationSeconds = $DurationSeconds
    observedRemoteAddresses = $addresses
    observedStates = @($addresses | ForEach-Object { [ordered]@{ address=$_; states=@($observed[$_] | Sort-Object) } })
    expectedProxyAddresses = $expected
    unexpectedRemoteAddresses = $unexpected
    missingExpectedAddresses = $missing
    passed = $addresses.Count -gt 0 -and $unexpected.Count -eq 0 -and $missing.Count -eq 0
}
$result | ConvertTo-Json -Depth 5

if (-not $addresses.Count) { throw 'No non-local application peers were observed. Repeat during active public requests.' }
if ($unexpected.Count) { throw "Unexpected direct application peers were observed: $($unexpected -join ', ')" }
if ($missing.Count) { throw "The expected proxy peers were not observed: $($missing -join ', ')" }
