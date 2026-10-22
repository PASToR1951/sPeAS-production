#Requires -Version 7.2
#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateRange(1, 65535)]
    [int]$ApplicationPort = 8000,
    [Parameter(Mandatory)]
    [string]$ApplicationAddress,
    [Parameter(Mandatory)]
    [string[]]$NginxAddress,
    [string[]]$MonitoringAddress = @(),
    [switch]$Apply,
    [string]$Confirmation
)

$ErrorActionPreference = 'Stop'
$group = 'PeAS Native Application Isolation'
$expectedConfirmation = "ISOLATE PEAS PORT $ApplicationPort"

$firewallProfiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
if (@($firewallProfiles | Where-Object Enabled -ne $true).Count) {
    throw 'Every Windows Firewall profile must be enabled before PeAS application isolation is applied.'
}
if (@($firewallProfiles | Where-Object DefaultInboundAction -eq 'Allow').Count) {
    $unsafeProfiles = @($firewallProfiles | Where-Object DefaultInboundAction -eq 'Allow' | ForEach-Object Name)
    throw "PeAS isolation relies on a default-block inbound policy. These effective profiles allow inbound traffic: $($unsafeProfiles -join ', ')."
}

$applicationIp = [Net.IPAddress]::Parse($ApplicationAddress)
if ($applicationIp.Equals([Net.IPAddress]::Any) -or $applicationIp.Equals([Net.IPAddress]::IPv6Any)) {
    throw 'ApplicationAddress must not be a wildcard address.'
}

$remoteAddresses = @($NginxAddress + $MonitoringAddress | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
if (-not $remoteAddresses.Count) { throw 'At least one nginx source address is required.' }
foreach ($address in $remoteAddresses) {
    if ($address -notmatch '^[0-9A-Fa-f:.]+(?:/[0-9]{1,3})?$') { throw "Invalid source address or CIDR: $address" }
}

$conflicts = @(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction Stop |
    Where-Object DisplayGroup -ne $group |
    Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
    Where-Object { $_.Protocol -eq 'TCP' -and ($_.LocalPort -eq $ApplicationPort -or $_.LocalPort -eq 'Any') })
if ($conflicts.Count) {
    $names = @($conflicts | ForEach-Object { (Get-NetFirewallRule -AssociatedNetFirewallPortFilter $_).DisplayName } | Sort-Object -Unique)
    throw "Other enabled inbound allow rules can reach TCP $ApplicationPort. Review and disable them before applying PeAS isolation: $($names -join '; ')"
}

$summary = [ordered]@{
    applicationAddress = $applicationIp.ToString()
    applicationPort = $ApplicationPort
    allowedRemoteAddresses = $remoteAddresses
    firewallProfiles = @($firewallProfiles | ForEach-Object { [ordered]@{ name=$_.Name; enabled=$_.Enabled; defaultInboundAction=[string]$_.DefaultInboundAction } })
    existingManagedRules = @(Get-NetFirewallRule -DisplayGroup $group -ErrorAction SilentlyContinue).Count
    applyRequested = [bool]$Apply
}
$summary | ConvertTo-Json -Depth 4

if (-not $Apply) {
    Write-Warning "Dry run only. Re-run with -Apply -Confirmation '$expectedConfirmation' after reviewing the resolved addresses."
    exit 0
}
if ($Confirmation -cne $expectedConfirmation) { throw "Applying the rules requires -Confirmation '$expectedConfirmation'." }

if ($PSCmdlet.ShouldProcess("TCP $ApplicationPort on $applicationIp", "Restrict PeAS application ingress to nginx and monitoring sources")) {
    Get-NetFirewallRule -DisplayGroup $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    $rule = @{
        DisplayName = "PeAS app $ApplicationPort from nginx and monitoring"
        DisplayGroup = $group
        Direction = 'Inbound'
        Action = 'Allow'
        Protocol = 'TCP'
        LocalAddress = $applicationIp.ToString()
        LocalPort = $ApplicationPort
        RemoteAddress = $remoteAddresses
        # The exact local address, port, and remote peers remain restrictive if
        # Windows changes the network category after a reboot or domain event.
        Profile = 'Any'
    }
    New-NetFirewallRule @rule | Out-Null
    Write-Host "PeAS TCP $ApplicationPort is allowed only from the configured nginx and monitoring sources."
}
