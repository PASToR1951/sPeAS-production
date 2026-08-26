#Requires -Version 7.2
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Position=0, Mandatory)]
    [ValidateSet('install','configure','configure-email','deploy','rollback','backup','restore','bootstrap-admin','set-admin-password','doctor','status','logs','verify')]
    [string]$Command,
    [string]$Domain,
    [string]$AcmeEmail,
    [string]$Image,
    [string]$Snapshot,
    [string]$Service = 'app',
    [string[]]$Set,
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:Phase = 'startup'
$root = if ($env:PEAS_APP_ROOT) { $env:PEAS_APP_ROOT } else { Join-Path $env:ProgramData 'PeAS' }
$configDir = if ($env:PEAS_CONFIG_DIR) { $env:PEAS_CONFIG_DIR } else { Join-Path $root 'config' }
$configFile = if ($env:PEAS_CONFIG_FILE) { $env:PEAS_CONFIG_FILE } else { Join-Path $configDir 'peas.env' }
$secretsDir = if ($env:PEAS_SECRETS_DIR) { $env:PEAS_SECRETS_DIR } else { Join-Path $configDir 'secrets' }
$stateDir = Join-Path $root 'state'
$stagingDir = Join-Path $root 'backup-staging'
$stateFile = Join-Path $stateDir 'releases.tsv'
$auditFile = Join-Path $stateDir 'audit.log'
$lockFile = Join-Path $stateDir 'peas-deploy.lock'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = if (Test-Path (Join-Path $sourceRoot 'docker-compose.production.yml')) { $sourceRoot } else { Join-Path $root 'current' }
$script:Config = @{}
$script:Lock = $null

function Write-Info([string]$Message) { $script:Phase = $Message; Write-Host "[peas] $Message" }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Require-Command([string]$Name) { Assert-True ($null -ne (Get-Command $Name -ErrorAction SilentlyContinue)) "Missing command: $Name" }
function Test-ImageDigest([string]$Value) { return $Value -match '^[^\s@]+@sha256:[0-9A-Fa-f]{64}$' }
function Invoke-Native([string]$Program, [string[]]$Arguments, [switch]$AllowFailure, [switch]$Quiet) {
    if($Quiet){ & $Program @Arguments *> $null } else { & $Program @Arguments }
    $code = $LASTEXITCODE
    if (-not $AllowFailure -and $code -ne 0) { throw "$Program exited with code $code" }
    return $code
}
function Protect-Directory([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    & icacls.exe $Path '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to secure $Path" }
}
function Add-Audit([string]$Result = 'success') {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Add-Content -LiteralPath $auditFile -Value "$([DateTime]::UtcNow.ToString('o'))`t$Command`t$Result" -Encoding utf8
}
function Enter-OperationLock {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    try { $script:Lock = [IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another peas-deploy operation is running' }
}
function Read-SecretValue([string]$Prompt, [switch]$Confirm) {
    $secure = Read-Host $Prompt -AsSecureString
    $value = [Net.NetworkCredential]::new('', $secure).Password
    if ($Confirm) {
        $again = [Net.NetworkCredential]::new('', (Read-Host "Confirm $Prompt" -AsSecureString)).Password
        Assert-True ($value -and $value -ceq $again) 'Secret values did not match'
    }
    return $value
}
function Write-Secret([string]$Name, [string]$Value) {
    Protect-Directory $secretsDir
    $path = Join-Path $secretsDir $Name
    [IO.File]::WriteAllText($path, $Value, [Text.UTF8Encoding]::new($false))
    & icacls.exe $path '/inheritance:r' '/grant:r' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to secure secret $Name" }
}
function New-RandomSecret { $bytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); return [Convert]::ToHexString($bytes).ToLowerInvariant() }
function Load-Config {
    Assert-True (Test-Path $configFile) "Missing $configFile"
    $script:Config = @{}
    foreach ($line in Get-Content -LiteralPath $configFile) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        $index = $line.IndexOf('='); Assert-True ($index -gt 0) "Invalid configuration line in $configFile"
        $key = $line.Substring(0,$index); $value = $line.Substring($index+1)
        Assert-True ($key -match '^[A-Z][A-Z0-9_]*$') "Invalid configuration key: $key"
        $script:Config[$key] = $value; [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
    if ($script:Config.PEAS_SECRETS_DIR) { $script:Config.PEAS_SECRETS_DIR = $script:Config.PEAS_SECRETS_DIR }
}
function Set-ConfigValue([string]$Key, [string]$Value) {
    Assert-True ($Key -match '^[A-Z][A-Z0-9_]*$') "Invalid configuration key: $Key"
    Assert-True ($Value -notmatch "[`r`n]") "$Key contains a newline"
    $lines = if (Test-Path $configFile) { [Collections.Generic.List[string]](Get-Content -LiteralPath $configFile) } else { [Collections.Generic.List[string]]::new() }
    $found = $false
    for ($i=0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^$([regex]::Escape($Key))=") { $lines[$i] = "$Key=$Value"; $found=$true } }
    if (-not $found) { $lines.Add("$Key=$Value") }
    [IO.File]::WriteAllLines($configFile, $lines, [Text.UTF8Encoding]::new($false))
}
function Get-Config([string]$Key, [string]$Default='') { if ($script:Config.ContainsKey($Key)) { return $script:Config[$Key] }; return $Default }
function Invoke-Compose([string[]]$Arguments, [switch]$AllowFailure) {
    $composeFile = Join-Path $repoRoot 'docker-compose.production.yml'
    $args = @('compose','--project-name','peas-prod','--env-file',$configFile,'-f',$composeFile) + $Arguments
    return Invoke-Native docker $args -AllowFailure:$AllowFailure
}
function Validate-Config {
    $required = 'PUBLIC_APP_URL','BETTER_AUTH_URL','ACME_EMAIL','PEAS_IMAGE','PEAS_POSTGRES_IMAGE','PEAS_CADDY_IMAGE','PEAS_CLAMAV_IMAGE','PEAS_UTILITY_IMAGE','PEAS_RELEASE_ID','SMTP_HOST','SMTP_USERNAME','CONTACT_RECIPIENT_EMAIL','RESTIC_REPOSITORY','PEAS_CSP_MODE','TRUSTED_PROXY_RANGES','SECURITY_CONTACT_EMAIL','SECURITY_TXT_EXPIRES','PEAS_VERIFY_PUBLIC_DOCUMENT_ID'
    foreach ($key in $required) { Assert-True (-not [string]::IsNullOrWhiteSpace((Get-Config $key))) "Missing configuration: $key" }
    Assert-True ((Get-Config PUBLIC_APP_URL) -match '^https://') 'PUBLIC_APP_URL must use HTTPS'
    Assert-True ((Get-Config BETTER_AUTH_URL) -ceq (Get-Config PUBLIC_APP_URL)) 'BETTER_AUTH_URL must equal PUBLIC_APP_URL'
    Assert-True ((Get-Config PEAS_CSP_MODE) -in 'report-only','enforce') 'PEAS_CSP_MODE must be report-only or enforce'
    Assert-True ((Get-Config SECURITY_CONTACT_EMAIL) -match '^[^@\s]+@[^@\s]+$') 'SECURITY_CONTACT_EMAIL must be an email address'
    $securityExpiry = [DateTimeOffset]::MinValue
    Assert-True ([DateTimeOffset]::TryParse((Get-Config SECURITY_TXT_EXPIRES), [ref]$securityExpiry) -and $securityExpiry -gt [DateTimeOffset]::UtcNow -and $securityExpiry -le [DateTimeOffset]::UtcNow.AddDays(366)) 'SECURITY_TXT_EXPIRES must be a future timestamp no more than 366 days away'
    $verifyDocumentId = 0
    Assert-True ([int]::TryParse((Get-Config PEAS_VERIFY_PUBLIC_DOCUMENT_ID), [ref]$verifyDocumentId) -and $verifyDocumentId -gt 0) 'PEAS_VERIFY_PUBLIC_DOCUMENT_ID must be a positive integer'
    foreach ($key in 'PEAS_IMAGE','PEAS_POSTGRES_IMAGE','PEAS_CADDY_IMAGE','PEAS_CLAMAV_IMAGE','PEAS_UTILITY_IMAGE') { Assert-True (Test-ImageDigest (Get-Config $key)) "$key must be a complete image digest" }
    foreach ($name in 'db_admin_password','db_app_password','better_auth_secret','newsletter_token_secret','smtp_password','restic_password') { Assert-True (Test-Path (Join-Path $secretsDir $name)) "Missing secret: $name" }
}
function Wait-Healthy([string]$ServiceName, [int]$Timeout=240) {
    $id = (& docker compose --project-name peas-prod --env-file $configFile -f (Join-Path $repoRoot 'docker-compose.production.yml') ps -q $ServiceName).Trim()
    Assert-True ($id) "Compose did not create $ServiceName"
    $end = [DateTime]::UtcNow.AddSeconds($Timeout)
    do {
        $state = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id 2>$null).Trim()
        if ($state -in 'healthy','running') { Write-Info "$ServiceName is $state"; return }
        if ($state -in 'unhealthy','dead','exited') { Invoke-Compose @('logs','--tail','100',$ServiceName); throw "$ServiceName entered $state" }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $end)
    throw "Timed out waiting for $ServiceName"
}
function Initialize-ResticEnvironment {
    $env:RESTIC_PASSWORD_FILE = Join-Path $secretsDir 'restic_password'
    $env:RESTIC_REPOSITORY = Get-Config RESTIC_REPOSITORY
    $access = Join-Path $secretsDir 's3_access_key_id'; $secret = Join-Path $secretsDir 's3_secret_access_key'
    if (Test-Path $access) { $env:AWS_ACCESS_KEY_ID = [IO.File]::ReadAllText($access) }
    if (Test-Path $secret) { $env:AWS_SECRET_ACCESS_KEY = [IO.File]::ReadAllText($secret) }
}
function Invoke-Verify {
    Load-Config; Validate-Config
    $verifier = Join-Path $repoRoot 'scripts\Test-PeasPublicEdge.ps1'
    Assert-True (Test-Path -LiteralPath $verifier -PathType Leaf) "Missing public edge verifier: $verifier"
    & $verifier -BaseUrl (Get-Config PUBLIC_APP_URL) -CspMode (Get-Config PEAS_CSP_MODE) -PublicDocumentId ([int](Get-Config PEAS_VERIFY_PUBLIC_DOCUMENT_ID)) -CertificateMinDays 14
    Write-Info 'HTTPS, certificate, headers, authorization, public DTO, and PDF checks passed'
}
function Invoke-Backup {
    Load-Config; Validate-Config; Require-Command restic; Initialize-ResticEnvironment
    New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'); $dump=Join-Path $stagingDir "peas-db-$stamp.dump"; $archive=Join-Path $stagingDir "peas-storage-$stamp.tar.gz"; $manifest=Join-Path $stagingDir "manifest-$stamp.txt"
    Invoke-Compose @('up','-d','db'); Wait-Healthy db 180
    $running=@(); foreach($svc in 'app','media-worker','abstract-worker','newsletter-worker'){ $id=(& docker compose --project-name peas-prod --env-file $configFile -f (Join-Path $repoRoot 'docker-compose.production.yml') ps -q $svc).Trim(); if($id -and ((& docker inspect -f '{{.State.Running}}' $id).Trim() -eq 'true')){$running += $svc} }
    if($running.Count){ Invoke-Compose (@('stop')+$running) }
    try {
        $dbId=(& docker compose --project-name peas-prod --env-file $configFile -f (Join-Path $repoRoot 'docker-compose.production.yml') ps -q db).Trim()
        Invoke-Native docker @('exec',$dbId,'pg_dump','-U','postgres','-d','peas_db','--format=custom','--no-owner','--file=/tmp/peas-backup.dump')
        Invoke-Native docker @('cp',"${dbId}:/tmp/peas-backup.dump",$dump)
        Invoke-Native docker @('exec',$dbId,'rm','-f','/tmp/peas-backup.dump')
        $volume=Get-Config 'PEAS_STORAGE_VOLUME' 'peas-prod-storage'; Invoke-Native docker @('run','--rm','-v',"${volume}:/data:ro",'-v',"${stagingDir}:/backup",(Get-Config PEAS_UTILITY_IMAGE),'tar','-czf',"/backup/$([IO.Path]::GetFileName($archive))",'-C','/data','.')
        $migration=(& docker compose --project-name peas-prod --env-file $configFile -f (Join-Path $repoRoot 'docker-compose.production.yml') exec -T db psql -U postgres -d peas_db -Atc "SELECT COALESCE(MAX(migration_id), 'uninitialized') FROM public.schema_migrations" 2>$null).Trim()
        @("created_at=$stamp","host=$env:COMPUTERNAME","release=$(Get-Config PEAS_IMAGE)","release_id=$(Get-Config PEAS_RELEASE_ID)","migration=$migration","$((Get-FileHash $dump -Algorithm SHA256).Hash.ToLower())  $([IO.Path]::GetFileName($dump))","$((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower())  $([IO.Path]::GetFileName($archive))") | Set-Content $manifest -Encoding utf8NoBOM
        Invoke-Native restic @('backup',$dump,$archive,$manifest); Invoke-Native restic @('check'); Remove-Item $dump,$archive,$manifest -Force; Write-Info 'backup completed'
    } finally { if($running.Count){ Invoke-Compose (@('start')+$running) -AllowFailure } }
}
function Invoke-Restore([string]$SnapshotId) {
    Load-Config; Validate-Config; Require-Command restic; Initialize-ResticEnvironment
    Assert-True ($SnapshotId -match '^[A-Za-z0-9]+$') 'Restore requires an exact Restic snapshot ID'
    if(-not $Yes){Assert-True ((Read-Host "Type RESTORE $SnapshotId to continue") -ceq "RESTORE $SnapshotId") 'Restore confirmation did not match'}
    $target=Join-Path (Join-Path $root 'restore') $SnapshotId; Assert-True (-not(Test-Path $target)) "Restore target already exists: $target"
    New-Item -ItemType Directory -Force $target | Out-Null; Invoke-Native restic @('restore',$SnapshotId,'--target',$target)
    $dump=Get-ChildItem $target -Recurse -Filter 'peas-db-*.dump' | Select-Object -First 1
    $archive=Get-ChildItem $target -Recurse -Filter 'peas-storage-*.tar.gz' | Select-Object -First 1
    $manifest=Get-ChildItem $target -Recurse -Filter 'manifest-*.txt' | Select-Object -First 1
    Assert-True ($dump -and $archive -and $manifest) 'Snapshot lacks database, storage, or manifest artifacts'
    $manifestLines=Get-Content $manifest.FullName
    foreach($artifact in $dump,$archive){
        $line=$manifestLines | Where-Object {$_ -match "^[0-9a-fA-F]{64}\s+.*$([regex]::Escape($artifact.Name))$"} | Select-Object -First 1
        Assert-True ($line) "Manifest has no checksum for $($artifact.Name)"
        $expected=($line -split '\s+')[0].ToLowerInvariant(); $actual=(Get-FileHash $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Assert-True ($actual -ceq $expected) "Checksum mismatch for $($artifact.Name)"
    }
    Write-Info 'backup manifest checksums passed'
    $recorded=($manifestLines | Where-Object {$_.StartsWith('release=')} | Select-Object -First 1) -replace '^release=',''
    if(Test-ImageDigest $recorded){[Environment]::SetEnvironmentVariable('PEAS_IMAGE',$recorded,'Process')}
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'); $temp="peas-restore-db-$stamp"; $newDb="peas-prod-postgres-restore-$stamp"; $newStorage="peas-prod-storage-restore-$stamp"
    Invoke-Native docker @('volume','create',$newDb); Invoke-Native docker @('volume','create',$newStorage)
    try {
        Invoke-Native docker @('run','--detach','--name',$temp,'--volume',"${newDb}:/var/lib/postgresql/data",'--env','POSTGRES_DB=peas_db','--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD=temporary-restore-admin',(Get-Config PEAS_POSTGRES_IMAGE))
        $ready=$false; for($i=0;$i -lt 60;$i++){if((Invoke-Native docker @('exec',$temp,'pg_isready','-U','postgres','-d','peas_db') -AllowFailure -Quiet) -eq 0){$ready=$true;break};Start-Sleep 2}; Assert-True $ready 'Restore PostgreSQL did not become ready'
        Invoke-Native docker @('cp',(Join-Path $secretsDir 'db_app_password'),"${temp}:/tmp/db_app_password")
        $roleSql=@'
DO $$
DECLARE p text;
BEGIN
  p := pg_read_file('/tmp/db_app_password');
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peas_app') THEN
    EXECUTE format('CREATE ROLE peas_app LOGIN PASSWORD %L', p);
  END IF;
END
$$;
'@
        Invoke-Native docker @('exec',$temp,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','peas_db','-c',$roleSql)
        Invoke-Native docker @('cp',$dump.FullName,"${temp}:/tmp/restore.dump")
        Invoke-Native docker @('exec',$temp,'pg_restore','--exit-on-error','--no-owner','--dbname=peas_db','--username=postgres','/tmp/restore.dump')
        Invoke-Native docker @('run','--rm','--volume',"${newStorage}:/data",'--volume',"$($archive.DirectoryName):/restore:ro",(Get-Config PEAS_UTILITY_IMAGE),'tar','-xzf',"/restore/$($archive.Name)",'-C','/data')
    } finally { Invoke-Native docker @('rm','--force',$temp) -AllowFailure | Out-Null }
    [Environment]::SetEnvironmentVariable('PEAS_POSTGRES_VOLUME',$newDb,'Process'); [Environment]::SetEnvironmentVariable('PEAS_STORAGE_VOLUME',$newStorage,'Process')
    Invoke-Compose @('stop','app','media-worker','abstract-worker','newsletter-worker','caddy','db') -AllowFailure; Invoke-Compose @('up','-d','db'); Wait-Healthy db 180; Invoke-Compose @('run','--rm','migrate'); Invoke-Compose @('up','-d','app','media-worker','abstract-worker','newsletter-worker','caddy'); Wait-Healthy app 240; Invoke-Verify
    Set-ConfigValue PEAS_POSTGRES_VOLUME $newDb; Set-ConfigValue PEAS_STORAGE_VOLUME $newStorage; if(Test-ImageDigest $recorded){Set-ConfigValue PEAS_IMAGE $recorded}
    Write-Info 'restore validated; previous volumes remain untouched'
}
function Invoke-Deploy([string]$Digest) {
    Load-Config; Validate-Config; Assert-True (Test-ImageDigest $Digest) 'Deploy requires a complete image digest'
    $previous=Get-Config PEAS_IMAGE; Invoke-Backup
    if($previous -ne $Digest){Set-ConfigValue PEAS_IMAGE_PREVIOUS $previous}; Set-ConfigValue PEAS_IMAGE $Digest; Load-Config
    Invoke-Compose @('pull','app','media-worker','abstract-worker','newsletter-worker','migrate'); Invoke-Compose @('up','-d','db','clamav'); Wait-Healthy db 180; Wait-Healthy clamav 300
    Invoke-Compose @('run','--rm','migrate'); Invoke-Compose @('up','-d','app','media-worker','abstract-worker','newsletter-worker','caddy'); Wait-Healthy app 240; Invoke-Verify
    Add-Content $stateFile "$([DateTime]::UtcNow.ToString('o'))`t$Digest`t$(Get-Config PEAS_RELEASE_ID)"; Write-Info "deployment completed: $Digest"
}
function Prompt-Config([string]$Key,[string]$Label,[string]$Default='') { $current=Get-Config $Key $Default; $value=Read-Host "$Label [$current]"; if(-not $value){$value=$current}; Assert-True ($value) "$Key is required"; Set-ConfigValue $Key $value; $script:Config[$Key]=$value }
function Prompt-Secret([string]$Name,[string]$Label,[switch]$Replace) { $path=Join-Path $secretsDir $Name; if((Test-Path $path) -and -not $Replace){return}; if((Test-Path $path) -and $Replace -and (Read-Host "$Label exists. Replace it? [y/N]") -notmatch '^[Yy]$'){return}; Write-Secret $Name (Read-SecretValue $Label -Confirm) }
function Configure-Email { Write-Info 'outgoing email configuration'; Prompt-Config SMTP_HOST 'SMTP host'; Prompt-Config SMTP_PORT 'SMTP port' '587'; Prompt-Config SMTP_TLS 'Implicit TLS (true for 465, false for STARTTLS)' 'false'; Prompt-Config SMTP_USERNAME 'SMTP username / sender email'; Prompt-Config CONTACT_RECIPIENT_EMAIL 'Contact recipient email' (Get-Config SMTP_USERNAME); Prompt-Config OFFICE_REPLY_TO_EMAIL 'Newsletter reply-to email' (Get-Config CONTACT_RECIPIENT_EMAIL); Prompt-Config NEWSLETTER_SEND_RATE_PER_MINUTE 'Newsletter messages per minute' '20'; Prompt-Secret smtp_password 'SMTP password' -Replace }
function Restart-AppIfRunning { $id=(& docker compose --project-name peas-prod --env-file $configFile -f (Join-Path $repoRoot 'docker-compose.production.yml') ps -q app 2>$null).Trim(); if($id){Invoke-Compose @('up','-d','--force-recreate','app','newsletter-worker'); Wait-Healthy app; Invoke-Verify} }
function Install-ScheduledTasks {
    $pwsh=(Get-Command pwsh).Source; $deployer=Join-Path $root 'current\ops\peas-deploy.ps1'
    $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 12) -MultipleInstances IgnoreNew -StartWhenAvailable
    $backupAction=New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -File `"$deployer`" backup"; $backupTrigger=New-ScheduledTaskTrigger -Daily -At '2:00 AM'
    Register-ScheduledTask -TaskName 'PeAS Backup' -Action $backupAction -Trigger $backupTrigger -Principal $principal -Settings $settings -Force | Out-Null
    $healthAction=New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -File `"$deployer`" doctor"; $healthTrigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName 'PeAS Health Check' -Action $healthAction -Trigger $healthTrigger -Principal $principal -Settings $settings -Force | Out-Null
}
function Install-Host {
    Assert-True ($Domain -match '^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$') 'Domain must be a DNS hostname'; Assert-True ($AcmeEmail -match '^[^@]+@[^@]+\.[^@]+$') 'Invalid ACME email'; Assert-True (Test-ImageDigest $Image) 'Image must be a complete digest'
    Assert-True ([Environment]::OSVersion.Version.Build -ge 22000) 'Windows 11 or newer is required'; Require-Command docker; Require-Command restic; Require-Command pwsh
    Invoke-Native docker @('info'); Invoke-Native docker @('compose','version')
    $dockerOs=(& docker info --format '{{.OSType}}').Trim(); Assert-True ($dockerOs -eq 'linux') 'Docker must be in Linux-container mode'
    foreach($path in $root,$configDir,$secretsDir,$stateDir,$stagingDir){Protect-Directory $path}
    $current=Join-Path $root 'current'; New-Item -ItemType Directory -Force $current | Out-Null
    $exclude=@('.git','node_modules','storage','test-results'); Get-ChildItem -LiteralPath $sourceRoot -Force | Where-Object {$_.Name -notin $exclude} | Copy-Item -Destination $current -Recurse -Force
    $script:repoRoot=$current
    @("PUBLIC_APP_URL=https://$Domain","BETTER_AUTH_URL=https://$Domain","ACME_EMAIL=$AcmeEmail","PEAS_IMAGE=$Image","PEAS_RELEASE_ID=initial","PEAS_SECRETS_DIR=$secretsDir","PEAS_REPO_ROOT=$current","PEAS_CSP_MODE=report-only","TRUSTED_PROXY_RANGES=172.30.0.0/24","SECURITY_CONTACT_EMAIL=$AcmeEmail","SECURITY_TXT_EXPIRES=$([DateTimeOffset]::UtcNow.AddDays(365).ToString('o'))") | Set-Content $configFile -Encoding utf8NoBOM
    Load-Config; Prompt-Config PEAS_POSTGRES_IMAGE 'Pinned PostgreSQL image digest'; Prompt-Config PEAS_CADDY_IMAGE 'Pinned Caddy image digest'; Prompt-Config PEAS_CLAMAV_IMAGE 'Pinned ClamAV image digest'; Prompt-Config PEAS_UTILITY_IMAGE 'Pinned Alpine utility image digest'; Prompt-Config PEAS_VERIFY_PUBLIC_DOCUMENT_ID 'Stable approved public document ID with an available PDF'; Configure-Email; Prompt-Config RESTIC_REPOSITORY 'Restic S3 repository URL'
    Prompt-Secret restic_password 'Restic repository password'; Prompt-Secret s3_access_key_id 'S3 access key ID'; Prompt-Secret s3_secret_access_key 'S3 secret access key'
    foreach($name in 'db_admin_password','db_app_password','better_auth_secret','newsletter_token_secret'){if(-not(Test-Path(Join-Path $secretsDir $name))){Write-Secret $name (New-RandomSecret)}}
    Set-ConfigValue RESTIC_PASSWORD_FILE (Join-Path $secretsDir 'restic_password'); Set-ConfigValue PEAS_REPO_ROOT $current; Load-Config; Validate-Config
    & icacls.exe $configFile '/inheritance:r' '/grant:r' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    foreach($port in 80,443){if(-not(Get-NetFirewallRule -DisplayName "PeAS HTTPS $port" -ErrorAction SilentlyContinue)){New-NetFirewallRule -DisplayName "PeAS HTTPS $port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null}}
    Install-ScheduledTasks; Initialize-ResticEnvironment
    & restic snapshots | Out-Host; if($LASTEXITCODE -ne 0){Invoke-Native restic @('init')}
    if((Read-Host 'Log in to GHCR now? [Y/n]') -notmatch '^[Nn]$'){ $user=Read-Host 'GHCR username'; $token=Read-SecretValue 'GHCR read-only token'; $token | & docker login ghcr.io --username $user --password-stdin; if($LASTEXITCODE -ne 0){throw 'Docker login failed'} }
    Invoke-Deploy $Image
    if((Read-Host 'Create the first administrator now? [Y/n]') -notmatch '^[Nn]$'){Invoke-Compose @('run','--rm','--interactive','--tty','app','task','admin:bootstrap')}
    Write-Info 'Windows installation and first deployment completed'
}
function Invoke-Doctor { Load-Config; Validate-Config; Require-Command docker; Require-Command restic; Invoke-Native docker @('info'); Invoke-Compose @('config','--quiet'); $drive=(Get-Item $root).PSDrive; Assert-True ($drive.Free -gt 20GB) "Less than 20 GiB free below $root"; $hostName=([Uri](Get-Config PUBLIC_APP_URL)).Host; Assert-True ((Resolve-DnsName $hostName -ErrorAction SilentlyContinue)) "DNS does not resolve $hostName"; $ports=(& docker ps --format '{{.Ports}}') -join "`n"; Assert-True ($ports -notmatch ':(8000|5432)->') 'Application or PostgreSQL port is published publicly'; Initialize-ResticEnvironment; Invoke-Native restic @('snapshots','--latest','1'); Write-Info 'doctor checks passed' }

if($DryRun){Write-Host "[peas] dry run: command=$Command domain=$Domain image=$Image"; exit 0}
Enter-OperationLock
try {
    switch($Command){
        install { Install-Host }
        configure { Load-Config; $allowed='PUBLIC_APP_URL','BETTER_AUTH_URL','TRUSTED_ORIGINS','ACME_EMAIL','PEAS_IMAGE','PEAS_RELEASE_ID','PEAS_POSTGRES_IMAGE','PEAS_CADDY_IMAGE','PEAS_CLAMAV_IMAGE','PEAS_UTILITY_IMAGE','SMTP_HOST','SMTP_PORT','SMTP_USERNAME','SMTP_TLS','CONTACT_RECIPIENT_EMAIL','RESTIC_REPOSITORY','DOCUMENT_ANNOTATIONS_ENABLED','ABSTRACT_OCR_LANGUAGES','PEAS_CSP_MODE','TRUSTED_PROXY_RANGES','SECURITY_CONTACT_EMAIL','SECURITY_TXT_EXPIRES','PEAS_VERIFY_PUBLIC_DOCUMENT_ID'; foreach($item in $Set){$pair=$item -split '=',2; Assert-True ($pair.Count -eq 2 -and $pair[0] -in $allowed) "Unsupported setting: $item"; Set-ConfigValue $pair[0] $pair[1]}; Load-Config; Validate-Config }
        configure-email { Load-Config; Configure-Email; Load-Config; Validate-Config; Restart-AppIfRunning }
        deploy { if(-not $Image){throw '-Image is required'}; Invoke-Deploy $Image }
        rollback { Load-Config; if(-not $Image){$Image=Get-Config PEAS_IMAGE_PREVIOUS}; Invoke-Deploy $Image }
        backup { Invoke-Backup }
        restore { Invoke-Restore $Snapshot }
        bootstrap-admin { Load-Config; Validate-Config; Invoke-Compose @('run','--rm','--interactive','--tty','app','task','admin:bootstrap') }
        set-admin-password { Load-Config; Validate-Config; Invoke-Compose @('run','--rm','--interactive','--tty','app','task','admin:set-password') }
        doctor { Invoke-Doctor }
        status { Load-Config; Validate-Config; Invoke-Compose @('ps'); if(Test-Path $stateFile){Get-Content $stateFile -Tail 5} }
        logs { Load-Config; $output=& docker compose --project-name peas-prod --env-file $configFile -f (Join-Path $repoRoot 'docker-compose.production.yml') logs --tail 200 $Service 2>&1; if($LASTEXITCODE -ne 0){throw 'Unable to read Compose logs'}; $output -replace '(?i)(password|secret|token|authorization)([=:])\S+','$1$2[REDACTED]' }
        verify { Invoke-Verify }
    }
    Add-Audit
} catch { Add-Audit "failed:$script:Phase"; throw } finally { if($script:Lock){$script:Lock.Dispose()} }
