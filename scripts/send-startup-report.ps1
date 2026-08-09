[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'

function Get-RequiredEnvironmentValue([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Name is not configured."
    }
    return $value.Trim()
}

$message = $null
$smtp = $null
try {
    if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) {
        throw "Startup report not found: $ReportPath"
    }

    $reportInfo = Get-Item -LiteralPath $ReportPath -ErrorAction Stop
    if ($reportInfo.Length -le 0) {
        throw 'The startup report is empty.'
    }
    if ($reportInfo.Length -gt 512KB) {
        throw 'The startup report exceeds 512 KB.'
    }

    $recipient = Get-RequiredEnvironmentValue 'PEAS_STARTUP_REPORT_EMAIL'
    $hostName = if ($env:SMTP_HOST) { $env:SMTP_HOST.Trim() } else { 'smtp.gmail.com' }
    $portText = if ($env:SMTP_PORT) { $env:SMTP_PORT.Trim() } else { '587' }
    $port = 0
    if (-not [int]::TryParse($portText, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw "SMTP_PORT is invalid: $portText"
    }
    $username = Get-RequiredEnvironmentValue 'SMTP_USERNAME'
    $passwordFile = Get-RequiredEnvironmentValue 'SMTP_PASSWORD_FILE'
    if (-not (Test-Path -LiteralPath $passwordFile -PathType Leaf)) {
        throw "SMTP password file not found: $passwordFile"
    }
    $password = (Get-Content -LiteralPath $passwordFile -Raw -ErrorAction Stop).Trim()
    if ([string]::IsNullOrWhiteSpace($password)) {
        throw 'SMTP password file is empty.'
    }

    $computerName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME.Trim() } else { $env:HOSTNAME }
    if ([string]::IsNullOrWhiteSpace($computerName)) { $computerName = 'PeAS host' }
    $releaseId = if ($env:PEAS_RELEASE_ID) { $env:PEAS_RELEASE_ID.Trim() } else { 'development' }
    $subject = "[PeAS] Startup verification on $computerName ($releaseId)"

    # System.Net.Mail.SmtpClient supports Gmail's authenticated STARTTLS endpoint
    # on port 587. It does not support Gmail's implicit-TLS port 465.
    if ($port -eq 465) {
        throw 'SMTP_PORT 465 is not supported by the Windows SMTP client; use smtp.gmail.com on port 587.'
    }

    $body = Get-Content -LiteralPath $ReportPath -Raw -ErrorAction Stop
    $message = New-Object System.Net.Mail.MailMessage
    $message.From = New-Object System.Net.Mail.MailAddress($username)
    $message.To.Add($recipient)
    $message.Subject = $subject
    $message.Body = $body
    $message.IsBodyHtml = $false
    $message.Attachments.Add((New-Object System.Net.Mail.Attachment($ReportPath))) | Out-Null

    $smtp = New-Object System.Net.Mail.SmtpClient($hostName, $port)
    $smtp.UseDefaultCredentials = $false
    $smtp.Credentials = New-Object System.Net.NetworkCredential($username, $password)
    $smtp.EnableSsl = $true
    $smtp.Timeout = 60000
    $smtp.Send($message)

    Write-Output 'Startup report email sent to the configured recipient.'
    exit 0
} catch {
    # Never print the password or the password-file contents to the boot log.
    Write-Output ("SMTP send failed: " + $_.Exception.GetBaseException().Message)
    exit 1
} finally {
    if ($message) { $message.Dispose() }
    if ($smtp) { $smtp.Dispose() }
}
