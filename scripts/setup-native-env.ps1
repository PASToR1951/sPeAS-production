# setup-native-env.ps1
# Powershell script to setup environment configuration and secrets for PeAS native setup

[CmdletBinding()]
param(
    [string]$AppRoot = (Join-Path $env:ProgramData 'PeAS'),
    [string]$PublicAppUrl = 'http://localhost',
    [string]$DbAdminPassword,
    [string]$DbAppPassword
)

$ErrorActionPreference = 'Stop'

Write-Host "[peas-setup] Setting up directory structure and secrets..." -ForegroundColor Cyan

$configDir = Join-Path $AppRoot 'config'
$secretsDir = Join-Path $configDir 'secrets'
$storageDir = Join-Path $AppRoot 'storage'
$logsDir = Join-Path $AppRoot 'logs'
$configFile = Join-Path $configDir 'peas.env'

# Create directories
New-Item -ItemType Directory -Force -Path $configDir, $secretsDir, $storageDir, $logsDir | Out-Null

function New-RandomSecretHex {
    $bytes = [byte[]]::new(32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function Write-SecretFile([string]$Name, [string]$Value) {
    $path = Join-Path $secretsDir $Name
    if (-not (Test-Path $path) -or [string]::IsNullOrWhiteSpace([IO.File]::ReadAllText($path))) {
        [IO.File]::WriteAllText($path, $Value, [Text.UTF8Encoding]::new($false))
        Write-Host "[peas-setup] Generated secret: $Name" -ForegroundColor Yellow
    } else {
        Write-Host "[peas-setup] Existing secret kept: $Name" -ForegroundColor Gray
    }
}

# Generate secret values if not provided
$adminSecret = if ($DbAdminPassword) { $DbAdminPassword } else { New-RandomSecretHex }
$appSecret = if ($DbAppPassword) { $DbAppPassword } else { New-RandomSecretHex }
$authSecret = New-RandomSecretHex

Write-SecretFile 'db_admin_password' $adminSecret
Write-SecretFile 'db_app_password' $appSecret
Write-SecretFile 'better_auth_secret' $authSecret
Write-SecretFile 'microsoft_client_secret' 'none'
Write-SecretFile 'smtp_password' 'none'

# Generate config file (peas.env)
$envContent = @"
PORT=80
HOST=0.0.0.0
TRUSTED_ORIGINS=
PUBLIC_APP_URL=$PublicAppUrl
BETTER_AUTH_URL=$PublicAppUrl
AUTH_ALLOWED_EMAIL_DOMAIN=spud.edu.ph
PEAS_RELEASE_ID=v1.0.0-production-native
STORAGE_ROOT=$storageDir
PGHOST=localhost
PGPORT=5432
PGDATABASE=peas_db
PGUSER=peas_app
PGPASSWORD_FILE=$(Join-Path $secretsDir 'db_app_password')
BETTER_AUTH_SECRET_FILE=$(Join-Path $secretsDir 'better_auth_secret')
MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
MICROSOFT_TENANT_ID=00000000-0000-0000-0000-000000000000
MICROSOFT_CLIENT_SECRET_FILE=$(Join-Path $secretsDir 'microsoft_client_secret')
SMTP_HOST=127.0.0.1
SMTP_PORT=587
SMTP_USERNAME=peas-noreply@spud.edu.ph
SMTP_PASSWORD_FILE=$(Join-Path $secretsDir 'smtp_password')
SMTP_TLS=false
CONTACT_RECIPIENT_EMAIL=admin@spud.edu.ph
DOCUMENT_ANNOTATIONS_ENABLED=true
DOCUMENT_ACCESS_TOKEN_TTL_HOURS=168
ABSTRACT_OCR_LANGUAGES=eng+fil
NEWS_MEDIA_WORKER_ENABLED=false
NEWS_MEDIA_CLAMAV_ENABLED=false
PEAS_CONFIG_DIR=$configDir
PEAS_SECRETS_DIR=$secretsDir
PEAS_LOGS_DIR=$logsDir
"@

[IO.File]::WriteAllText($configFile, $envContent, [Text.UTF8Encoding]::new($false))
# Also create .env in local workspace root and Deno root for convenience
$localEnvPath = Join-Path $PSScriptRoot '..\.env'
$denoEnvPath = Join-Path $PSScriptRoot '..\Deno\.env'
[IO.File]::WriteAllText($localEnvPath, $envContent, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($denoEnvPath, $envContent, [Text.UTF8Encoding]::new($false))

Write-Host "[peas-setup] Environment configuration updated for Port 80 at $configFile, .env, and Deno/.env" -ForegroundColor Green
