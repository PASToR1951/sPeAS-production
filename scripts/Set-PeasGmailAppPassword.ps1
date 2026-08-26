#Requires -Version 7.2
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$SmtpUsername,
    [string]$OperationsRecipient,
    [switch]$SendTest
)

$ErrorActionPreference = 'Stop'
$AppRoot = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
$envPath = Join-Path $AppRoot 'config\peas.env'
$secretRoot = Join-Path $AppRoot 'config\secrets'
$passwordPath = Join-Path $secretRoot 'smtp_password'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw "PeAS environment file not found: $envPath" }
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot 'scripts\send-startup-report.ps1') -PathType Leaf)) {
    throw 'RepositoryRoot does not contain the PeAS startup-report sender.'
}
function Read-PeasEnv([string]$Path) {
    $values = [ordered]@{}
    foreach ($line in @(Get-Content -LiteralPath $Path -ErrorAction Stop)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
        $pair = $trimmed.Split('=',2)
        $values[$pair[0].Trim()] = $pair[1].Trim()
    }
    return $values
}

function Set-PeasEnvValues([string]$Path, [System.Collections.IDictionary]$Values) {
    $lines = [Collections.Generic.List[string]]::new()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in @(Get-Content -LiteralPath $Path -ErrorAction Stop)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=') {
            $key = $Matches[1]
            if ($Values.Contains($key)) {
                $lines.Add("$key=$($Values[$key])")
                $null = $seen.Add($key)
                continue
            }
        }
        $lines.Add($line)
    }
    foreach ($entry in $Values.GetEnumerator()) {
        if (-not $seen.Contains([string]$entry.Key)) { $lines.Add("$($entry.Key)=$($entry.Value)") }
    }
    $temporary = "$Path.$PID.tmp"
    Set-Content -LiteralPath $temporary -Value $lines -Encoding utf8NoBOM
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

$current = Read-PeasEnv $envPath
if ([string]::IsNullOrWhiteSpace($SmtpUsername)) { $SmtpUsername = [string]$current.SMTP_USERNAME }
if ([string]::IsNullOrWhiteSpace($OperationsRecipient)) { $OperationsRecipient = [string]$current.PEAS_STARTUP_REPORT_EMAIL }
if ($SmtpUsername -notmatch '^[^@\s]+@(?:gmail\.com|[^@\s]+)$') { throw 'SmtpUsername must be the dedicated Gmail or Google Workspace mailbox.' }
if ($OperationsRecipient -notmatch '^[^@\s]+@[^@\s]+$') { throw 'OperationsRecipient must be a valid operations mailbox.' }

$securePassword = Read-Host 'Enter the 16-character Google app password (input is hidden)' -AsSecureString
$credential = [Net.NetworkCredential]::new('', $securePassword)
$plainPassword = $credential.Password -replace '\s',''
if ($plainPassword -notmatch '^[A-Za-z0-9]{16}$') { throw 'Google app passwords must contain exactly 16 letters or digits after spaces are removed.' }

New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null
$temporaryPassword = "$passwordPath.$PID.tmp"
try {
    Set-Content -LiteralPath $temporaryPassword -Value $plainPassword -Encoding ascii -NoNewline
    & icacls.exe $temporaryPassword '/inheritance:r' '/grant:r' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to secure the SMTP app-password file.' }
    Move-Item -LiteralPath $temporaryPassword -Destination $passwordPath -Force
} finally {
    $plainPassword = $null
    $credential = $null
    $securePassword = $null
    if (Test-Path -LiteralPath $temporaryPassword) { Remove-Item -LiteralPath $temporaryPassword -Force }
}

$backup = "$envPath.pre-smtp-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')).bak"
Copy-Item -LiteralPath $envPath -Destination $backup
Set-PeasEnvValues $envPath ([ordered]@{
    SMTP_HOST = 'smtp.gmail.com'
    SMTP_PORT = '587'
    SMTP_TLS = 'false'
    SMTP_USERNAME = $SmtpUsername
    SMTP_PASSWORD_FILE = $passwordPath
    PEAS_STARTUP_REPORT_EMAIL = $OperationsRecipient
})

[ordered]@{
    configured = $true
    smtpHost = 'smtp.gmail.com'
    smtpPort = 587
    transport = 'STARTTLS'
    smtpUsername = $SmtpUsername
    operationsRecipient = $OperationsRecipient
    passwordFile = $passwordPath
    environmentBackup = $backup
}|ConvertTo-Json -Depth 4

if ($SendTest) {
    $updated = Read-PeasEnv $envPath
    foreach ($entry in $updated.GetEnumerator()) { [Environment]::SetEnvironmentVariable([string]$entry.Key,[string]$entry.Value,'Process') }
    $report = Join-Path $AppRoot 'logs\startup-reports\peas-startup-latest-v2.txt'
    if (-not (Test-Path -LiteralPath $report -PathType Leaf)) { throw "Startup report not found for SMTP test: $report" }
    & (Join-Path $RepositoryRoot 'scripts\send-startup-report.ps1') -ReportPath $report
    if ($LASTEXITCODE -ne 0) { throw 'Gmail app-password configuration was saved, but the SMTP test failed.' }
}
