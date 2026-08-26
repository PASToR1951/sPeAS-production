#Requires -Version 7.2
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Install','Backup','Status','Verify','Restore','Drill','Activate','Maintain','Archive','CspSummary')]
    [string]$Action,
    [ValidateSet('Scheduled','Manual','PreDeploy','PreMigration','Rotation')]
    [string]$Reason = 'Manual',
    [ValidateSet('Structural','ReadSubset','Full')]
    [string]$VerifyMode = 'Structural',
    [string]$Snapshot = 'latest',
    [string]$TargetRoot,
    [string]$Repository,
    [ValidateSet('Reconcile')]
    [string]$ArchiveMode = 'Reconcile',
    [switch]$Apply,
    [switch]$DryRun,
    [string]$PolicyPath = 'C:\ProgramData\PeAS\config\backup-policy.json',
    [string]$Confirmation
)

$ErrorActionPreference = 'Stop'
$script:Phase = 'initializing'
$script:Policy = $null
$script:Lock = $null
$script:ResticEnvironment = @{}

function Write-PeasEvent([string]$Level, [string]$Message, [hashtable]$Data = @{}) {
    $record = [ordered]@{ timestamp=[DateTimeOffset]::UtcNow.ToString('o'); level=$Level; action=$Action; phase=$script:Phase; message=$Message; data=$Data }
    $json = $record | ConvertTo-Json -Depth 8 -Compress
    if ($script:Policy) {
        $logRoot = Join-Path $script:Policy.appRoot 'state\backup-events'
        New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
        Add-Content -LiteralPath (Join-Path $logRoot "backup-$([DateTime]::UtcNow.ToString('yyyyMM')).jsonl") -Value $json -Encoding utf8NoBOM
    }
    if ($Level -eq 'error') { Write-Error $Message -ErrorAction Continue }
    elseif ($Level -eq 'warning') { Write-Warning $Message }
    else { Write-Host "[peas-recovery] $Message" }
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this command from an elevated PowerShell session.' }
}

function Assert-SafeAbsolutePath([string]$Path, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Label must be an absolute path." }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -eq [IO.Path]::GetPathRoot($full)) { throw "$Label must not be a drive root." }
    return $full.TrimEnd('\')
}

function Read-Policy {
    if (-not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) { throw "Backup policy not found: $PolicyPath. Copy ops\backup-policy.example.json and configure it first." }
    $policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json -Depth 20
    if ($policy.schemaVersion -ne 1) { throw "Unsupported backup policy schema: $($policy.schemaVersion)" }
    $policy.appRoot = Assert-SafeAbsolutePath $policy.appRoot 'appRoot'
    $policy.repoRoot = Assert-SafeAbsolutePath $policy.repoRoot 'repoRoot'
    $policy.postgresBin = Assert-SafeAbsolutePath $policy.postgresBin 'postgresBin'
    if ([IO.Path]::GetPathRoot($policy.repoRoot) -cne [IO.Path]::GetPathRoot($policy.appRoot)) { throw 'repoRoot and appRoot must be on the same VSS-protected volume.' }
    if ($policy.databasePort -lt 1 -or $policy.databasePort -gt 65535) { throw 'databasePort is invalid.' }
    if ($policy.writePauseLimitSeconds -lt 30 -or $policy.writePauseLimitSeconds -gt 120) { throw 'writePauseLimitSeconds must be between 30 and 120.' }
    if ([int]$policy.repositoryMaximumAgeHours -lt 24 -or [int]$policy.repositoryMaximumAgeHours -gt 168) { throw 'repositoryMaximumAgeHours must be between 24 and 168.' }
    if (-not $policy.repositories -or @($policy.repositories|Where-Object enabled).Count -lt 2) { throw 'At least two independently encrypted repositories must be enabled.' }
    foreach ($repo in $policy.repositories) {
        if ($repo.id -notmatch '^[a-z0-9-]+$') { throw "Invalid repository id: $($repo.id)" }
        if ($repo.type -eq 'usb' -and $repo.volumeLabel -notmatch '^PEAS-BACKUP-[AB]$') { throw "USB repository $($repo.id) has an unapproved volume label." }
        if ([string]::IsNullOrWhiteSpace($repo.passwordFile)) { throw "Repository $($repo.id) has no password file." }
        if ($null -ne $repo.maximumAgeHours -and ([int]$repo.maximumAgeHours -lt 24 -or [int]$repo.maximumAgeHours -gt 168)) {
            throw "Repository $($repo.id) maximumAgeHours must be between 24 and 168."
        }
    }
    $enabledRepositories=@($policy.repositories|Where-Object enabled)
    if(@($enabledRepositories.id|Sort-Object -Unique).Count -ne $enabledRepositories.Count){throw 'Enabled repository IDs must be unique.'}
    if(@($enabledRepositories.passwordFile|ForEach-Object{[IO.Path]::GetFullPath([string]$_).ToLowerInvariant()}|Sort-Object -Unique).Count -ne $enabledRepositories.Count){throw 'Each enabled repository must use an independent Restic password file.'}
    $passwordHashes=@($enabledRepositories.passwordFile|ForEach-Object{if(-not(Test-Path -LiteralPath $_ -PathType Leaf)){throw "Repository password file is unavailable: $_"};(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash})
    if(@($passwordHashes|Sort-Object -Unique).Count -ne $enabledRepositories.Count){throw 'Enabled repositories must not reuse the same Restic password.'}
    $usbRepositories=@($enabledRepositories|Where-Object type -eq 'usb')
    if(@($usbRepositories.volumeLabel|Sort-Object -Unique).Count -ne $usbRepositories.Count){throw 'Each USB repository must use a unique volume label.'}
    if (-not $policy.monitoring -or -not $policy.monitoring.enabled) { throw 'Native 15-minute public monitoring must be configured and enabled.' }
    if ([string]::IsNullOrWhiteSpace($policy.monitoring.baseUrl) -or $policy.monitoring.baseUrl -notmatch '^https://') { throw 'monitoring.baseUrl must use HTTPS.' }
    if ([int]$policy.monitoring.publicDocumentId -lt 1) { throw 'monitoring.publicDocumentId must identify a stable approved public document with a PDF.' }
    if ($policy.monitoring.cspMode -notin @('report-only','enforce')) { throw 'monitoring.cspMode must be report-only or enforce.' }
    if ($policy.monitoring.operationsEmail -notmatch '^[^@\s]+@[^@\s]+$') { throw 'monitoring.operationsEmail must be an email address.' }
    if ($policy.monitoring.smtpUsername -notmatch '^[^@\s]+@[^@\s]+$') { throw 'monitoring.smtpUsername must be an email address.' }
    if ([int]$policy.monitoring.smtpPort -ne 587) { throw 'Native monitoring alerts require authenticated STARTTLS on SMTP port 587.' }
    if (-not (Test-Path -LiteralPath $policy.monitoring.smtpPasswordFile -PathType Leaf)) { throw 'monitoring.smtpPasswordFile is unavailable.' }
    $script:Policy = $policy
}

function Get-RepositoryMaximumAgeHours([object]$Definition) {
    if ($null -ne $Definition.maximumAgeHours) { return [int]$Definition.maximumAgeHours }
    return [int]$script:Policy.repositoryMaximumAgeHours
}

function Enter-OperationLock {
    $created = $false
    $script:Lock = [Threading.Mutex]::new($true, 'Global\PeAS-Native-Recovery', [ref]$created)
    if (-not $created -and -not $script:Lock.WaitOne(0)) { throw 'Another PeAS backup, restore, archive, or maintenance operation is active.' }
}

function Require-Command([string]$Name, [string]$ExplicitPath = '') {
    if ($ExplicitPath -and (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) { return $ExplicitPath }
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw "Required command is unavailable: $Name" }
    return $command.Source
}

function Protect-Directory([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    & icacls.exe $Path '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to secure $Path" }
}

function Resolve-Repository([object]$Definition) {
    if (-not $Definition.enabled) { throw "Repository $($Definition.id) is disabled." }
    if (-not (Test-Path -LiteralPath $Definition.passwordFile -PathType Leaf)) { throw "Repository password file is unavailable: $($Definition.passwordFile)" }
    if ($Definition.type -eq 'usb') {
        $matches = @(Get-Volume | Where-Object { $_.FileSystemLabel -ceq $Definition.volumeLabel -and $_.DriveLetter })
        if ($matches.Count -ne 1) { throw "Expected exactly one unlocked volume labelled $($Definition.volumeLabel); found $($matches.Count)." }
        $volume = $matches[0]
        if ($Definition.fileSystem -and $volume.FileSystemType -ne $Definition.fileSystem) { throw "Repository $($Definition.id) filesystem mismatch." }
        if ($volume.HealthStatus -ne 'Healthy') { throw "Repository $($Definition.id) volume is not healthy." }
        if ([uint64]$volume.SizeRemaining -lt [uint64]$script:Policy.minimumFreeBytes) { throw "Repository $($Definition.id) has insufficient free space." }
        $root = "$($volume.DriveLetter):\"
        $bitLocker=Get-BitLockerVolume -MountPoint $root -ErrorAction Stop
        if([string]$bitLocker.VolumeStatus -cne 'FullyEncrypted' -or [string]$bitLocker.ProtectionStatus -cne 'On' -or [string]$bitLocker.LockStatus -cne 'Unlocked'){
            throw "Repository $($Definition.id) must be fully BitLocker-encrypted, protected, and unlocked."
        }
        return [pscustomobject]@{ Definition=$Definition; Uri=(Join-Path $root $Definition.repositoryPath); Volume=$volume }
    }
    if ($Definition.type -eq 'rest') {
        if ($Definition.uri -notmatch '^rest:https://') { throw "Repository $($Definition.id) must use authenticated TLS." }
        return [pscustomobject]@{ Definition=$Definition; Uri=$Definition.uri; Volume=$null }
    }
    throw "Unsupported repository type: $($Definition.type)"
}

function Select-Repositories([switch]$AllowMany) {
    $definitions = @($script:Policy.repositories | Where-Object enabled)
    if ($Repository) { $definitions = @($definitions | Where-Object id -ceq $Repository) }
    if (-not $definitions) { throw 'No matching enabled repository is configured.' }
    $resolved = @()
    foreach ($definition in $definitions) {
        try { $resolved += Resolve-Repository $definition }
        catch { if ($Repository) { throw }; Write-PeasEvent warning $_.Exception.Message }
    }
    if (-not $resolved) { throw 'No configured backup repository is connected and usable.' }
    if (-not $AllowMany -and $resolved.Count -ne 1) { throw 'Exactly one active USB repository must be connected for an hourly backup.' }
    return $resolved
}

function Invoke-Restic([object]$Repo, [string[]]$Arguments, [switch]$Capture) {
    $restic = Require-Command 'restic.exe' (Join-Path $script:Policy.appRoot 'tools\restic.exe')
    $previousRepository = $env:RESTIC_REPOSITORY; $previousPassword = $env:RESTIC_PASSWORD_FILE
    try {
        $env:RESTIC_REPOSITORY = $Repo.Uri
        $env:RESTIC_PASSWORD_FILE = $Repo.Definition.passwordFile
        if ($Repo.Definition.usernameFile) { $env:RESTIC_REST_USERNAME = (Get-Content -LiteralPath $Repo.Definition.usernameFile -Raw).Trim() }
        if ($Repo.Definition.credentialFile) { $env:RESTIC_REST_PASSWORD = (Get-Content -LiteralPath $Repo.Definition.credentialFile -Raw).Trim() }
        $output = & $restic @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw "restic failed for $($Repo.Definition.id): $($output -join [Environment]::NewLine)" }
        if ($Capture) { return $output }
        $output | ForEach-Object { Write-Host $_ }
    } finally {
        $env:RESTIC_REPOSITORY = $previousRepository; $env:RESTIC_PASSWORD_FILE = $previousPassword
        Remove-Item Env:RESTIC_REST_USERNAME,Env:RESTIC_REST_PASSWORD -ErrorAction SilentlyContinue
    }
}

function New-MaintenanceRequest([string]$BackupReason) {
    $stateRoot = Join-Path $script:Policy.appRoot 'state'
    Protect-Directory $stateRoot
    Get-ChildItem -LiteralPath $stateRoot -Filter 'maintenance-ack-*.json' -ErrorAction SilentlyContinue | Remove-Item -Force
    $request = [ordered]@{
        id=[guid]::NewGuid().ToString(); reason=$BackupReason
        requestedAt=[DateTimeOffset]::UtcNow.ToString('o')
        expiresAt=[DateTimeOffset]::UtcNow.AddMinutes([int]$script:Policy.maintenanceExpiryMinutes).ToString('o')
    }
    $path = Join-Path $stateRoot 'maintenance-request.json'; $temporary = "$path.$PID.tmp"
    $request | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
    Move-Item -LiteralPath $temporary -Destination $path -Force
    return [pscustomobject]@{ Request=$request; Path=$path; StateRoot=$stateRoot }
}

function Wait-SupervisorQuiesced([object]$Maintenance) {
    $ackPath = Join-Path $Maintenance.StateRoot 'maintenance-ack-supervisor.json'
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    do {
        if (Test-Path -LiteralPath $ackPath) {
            try {
                $ack = Get-Content -LiteralPath $ackPath -Raw | ConvertFrom-Json
                if ($ack.requestId -ceq $Maintenance.Request.id -and $ack.childrenStopped -eq $true) { return }
            } catch { }
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'The native supervisor did not acknowledge a fully quiesced state within 60 seconds.'
}

function Get-DatabaseEnvironment {
    $password = ''
    if ($script:Policy.databasePasswordFile -and (Test-Path -LiteralPath $script:Policy.databasePasswordFile)) {
        $password = (Get-Content -LiteralPath $script:Policy.databasePasswordFile -Raw).Trim()
    }
    return @{ PGHOST=[string]$script:Policy.databaseHost; PGPORT=[string]$script:Policy.databasePort; PGUSER=[string]$script:Policy.databaseUser; PGPASSWORD=$password }
}

function Invoke-Postgres([string]$Executable, [string[]]$Arguments, [switch]$Capture) {
    $path = Require-Command "$Executable.exe" (Join-Path $script:Policy.postgresBin "$Executable.exe")
    $old = @{}; foreach ($pair in (Get-DatabaseEnvironment).GetEnumerator()) { $old[$pair.Key]=[Environment]::GetEnvironmentVariable($pair.Key,'Process'); [Environment]::SetEnvironmentVariable($pair.Key,$pair.Value,'Process') }
    try {
        $output = & $path @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw "$Executable failed: $($output -join [Environment]::NewLine)" }
        if ($Capture) { return $output }
    } finally { foreach ($pair in $old.GetEnumerator()) { [Environment]::SetEnvironmentVariable($pair.Key,$pair.Value,'Process') } }
}

function Export-Databases([string]$DumpRoot) {
    $dbRoot = Join-Path $DumpRoot 'database'; Protect-Directory $dbRoot
    $databases = @(Invoke-Postgres psql @('-At','-d','postgres','-c',"SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname") -Capture | Where-Object { $_ })
    $globalsPath=Join-Path $dbRoot 'globals.sql'
    Invoke-Postgres pg_dumpall @('--globals-only','--no-role-passwords','--file',$globalsPath)
    $entries = @()
    foreach ($database in $databases) {
        if ($database -notmatch '^[A-Za-z0-9_.-]+$') { throw "Unsafe database name returned by PostgreSQL: $database" }
        $dump = Join-Path $dbRoot "$database.dump"
        Invoke-Postgres pg_dump @('--format=custom','--no-owner','--file',$dump,'--dbname',$database)
        Invoke-Postgres pg_restore @('--list',$dump)
        $tables = Invoke-Postgres psql @('-At','-F',"`t",'-d',$database,'-c',"SELECT schemaname || '.' || relname, n_live_tup::bigint FROM pg_stat_user_tables ORDER BY 1") -Capture
        Set-Content -LiteralPath (Join-Path $dbRoot "$database-table-counts.tsv") -Value $tables -Encoding utf8NoBOM
        $entries += [ordered]@{ name=$database; file="database/$database.dump"; bytes=(Get-Item $dump).Length; sha256=(Get-FileHash $dump -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    Invoke-Postgres psql @('-At','-d','postgres','-c',"SELECT json_build_object('server_version',current_setting('server_version'),'data_directory',current_setting('data_directory'),'extensions',(SELECT json_agg(row_to_json(e)) FROM (SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname)e))") -Capture | Set-Content -LiteralPath (Join-Path $dbRoot 'cluster-inventory.json') -Encoding utf8NoBOM
    return [pscustomobject]@{Databases=$entries;Globals=[ordered]@{file='database/globals.sql';bytes=(Get-Item $globalsPath).Length;sha256=(Get-FileHash $globalsPath -Algorithm SHA256).Hash.ToLowerInvariant()}}
}

function New-ShadowCopy([string]$VolumeRoot) {
    $result = Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{ Volume=$VolumeRoot; Context='ClientAccessible' }
    if ($result.ReturnValue -ne 0) { throw "VSS could not create a shadow copy (code $($result.ReturnValue))." }
    $shadow = Get-CimInstance Win32_ShadowCopy | Where-Object ID -eq $result.ShadowID
    if (-not $shadow) { throw 'VSS created a shadow copy but it could not be resolved.' }
    return $shadow
}

function Convert-ToShadowPath([string]$Path, [object]$Shadow) {
    $full = [IO.Path]::GetFullPath($Path); $root = [IO.Path]::GetPathRoot($full)
    $relative = $full.Substring($root.Length).TrimStart('\')
    return "$($Shadow.DeviceObject)\$relative"
}

function Get-StorageInventory([string]$ShadowStorage, [string]$OutputPath) {
    $rows = Get-ChildItem -LiteralPath $ShadowStorage -File -Recurse -Force -ErrorAction Stop | Where-Object { $_.FullName -notmatch '[\\/]news-media[\\/]staging([\\/]|$)' } | ForEach-Object {
        $relative = $_.FullName.Substring($ShadowStorage.Length).TrimStart('\')
        [ordered]@{ path=$relative.Replace('\','/'); bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $rows | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
    return [pscustomobject]@{ Count=@($rows).Count; Bytes=(@($rows) | Measure-Object bytes -Sum).Sum }
}

function Invoke-Backup {
    Assert-Administrator; $script:Phase='resolving repository'
    $repos = Select-Repositories -AllowMany:($Reason -eq 'Rotation')
    $backupId = [guid]::NewGuid().ToString(); $started=[DateTimeOffset]::UtcNow
    $stagingRoot = Join-Path $script:Policy.appRoot "staging\$backupId"; Protect-Directory $stagingRoot
    $maintenance=$null; $shadow=$null; $pauseWatch=[Diagnostics.Stopwatch]::new()
    try {
        $script:Phase='quiescing writers'; $pauseWatch.Start(); $maintenance=New-MaintenanceRequest $Reason; Wait-SupervisorQuiesced $maintenance
        $script:Phase='exporting PostgreSQL'; $databaseExport=Export-Databases $stagingRoot
        $script:Phase='creating VSS consistency point'
        $volumeRoot=[IO.Path]::GetPathRoot($script:Policy.appRoot); $shadow=New-ShadowCopy $volumeRoot
        Remove-Item -LiteralPath $maintenance.Path -Force; $maintenance=$null; $pauseWatch.Stop()
        if ($pauseWatch.Elapsed.TotalSeconds -gt [double]$script:Policy.writePauseLimitSeconds) { throw "Write pause exceeded policy: $([math]::Round($pauseWatch.Elapsed.TotalSeconds,2)) seconds." }

        $script:Phase='inventorying storage'
        $storagePath=Join-Path $script:Policy.appRoot 'storage'; $shadowStorage=Convert-ToShadowPath $storagePath $shadow
        $storageInventoryPath=Join-Path $stagingRoot 'storage-inventory.json'; $storageSummary=Get-StorageInventory $shadowStorage $storageInventoryPath
        $shadowRelease=Convert-ToShadowPath $script:Policy.repoRoot $shadow
        $releaseInventoryPath=Join-Path $stagingRoot 'release-inventory.json'; $releaseSummary=Get-StorageInventory $shadowRelease $releaseInventoryPath
        $gitCommit = (& git -C $script:Policy.repoRoot rev-parse HEAD 2>$null); if ($LASTEXITCODE -ne 0) { $gitCommit='unknown' }
        $manifest=[ordered]@{
            schemaVersion=1; backupSetId=$backupId; reason=$Reason; host=$env:COMPUTERNAME
            dataCutoffUtc=$started.ToString('o'); completedUtc=$null; windowsBuild=[Environment]::OSVersion.Version.ToString()
            release=[ordered]@{ gitCommit=($gitCommit | Select-Object -First 1); releaseId=$env:PEAS_RELEASE_ID; inventory='release-inventory.json'; files=$releaseSummary.Count; bytes=$releaseSummary.Bytes; inventorySha256=(Get-FileHash $releaseInventoryPath -Algorithm SHA256).Hash.ToLowerInvariant() }
            postgres=[ordered]@{ version=(Invoke-Postgres psql @('-At','-d','postgres','-c','SHOW server_version') -Capture | Select-Object -First 1); globals=$databaseExport.Globals; databases=$databaseExport.Databases }
            storage=[ordered]@{ relativeRoot='storage'; files=$storageSummary.Count; bytes=$storageSummary.Bytes; inventory='storage-inventory.json' }
            included=@('database','storage','config','state','current','scripts','logs'); excluded=@($script:Policy.excludedRelativePaths)
            consistency=[ordered]@{ writePauseSeconds=[math]::Round($pauseWatch.Elapsed.TotalSeconds,3); vssId=$shadow.ID; supervisorAcknowledged=$true }
        }
        $manifestPath=Join-Path $stagingRoot 'manifest.json'; $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM

        $script:Phase='uploading encrypted recovery set'; $receipts=@()
        foreach ($repo in $repos) {
            $paths=@($manifestPath,$storageInventoryPath,$releaseInventoryPath,(Convert-ToShadowPath (Join-Path $script:Policy.appRoot 'config') $shadow),(Convert-ToShadowPath (Join-Path $script:Policy.appRoot 'state') $shadow),$shadowRelease,(Convert-ToShadowPath (Join-Path $script:Policy.appRoot 'scripts') $shadow),(Convert-ToShadowPath (Join-Path $script:Policy.appRoot 'logs') $shadow),(Convert-ToShadowPath $stagingRoot $shadow),$shadowStorage)
            $args=@('backup','--json','--host',$env:COMPUTERNAME,'--tag','peas-native','--tag',"backup-set:$backupId",'--tag',"reason:$($Reason.ToLowerInvariant())")
            foreach($excluded in @($script:Policy.excludedRelativePaths)){ $args += @('--exclude',"*$($excluded.Replace('\','/'))*") }
            $output=Invoke-Restic $repo ($args+$paths) -Capture
            $summary=$output | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object message_type -eq 'summary' | Select-Object -Last 1
            if(-not $summary.snapshot_id){throw "Restic did not return a snapshot ID for $($repo.Definition.id)."}
            $manifestReadback=Invoke-Restic $repo @('find','--snapshot',$summary.snapshot_id,'manifest.json','--json') -Capture
            if(-not(($manifestReadback -join "`n") -match 'manifest\.json')){throw "The uploaded manifest could not be read back from $($repo.Definition.id)."}
            $receipts += [ordered]@{repository=$repo.Definition.id;snapshotId=$summary.snapshot_id;verifiedAt=[DateTimeOffset]::UtcNow.ToString('o')}
        }
        $manifest.completedUtc=[DateTimeOffset]::UtcNow.ToString('o')
        $receipt=[ordered]@{schemaVersion=1;backupSetId=$backupId;dataCutoffUtc=$manifest.dataCutoffUtc;writePauseSeconds=$manifest.consistency.writePauseSeconds;repositories=$receipts}
        $receiptPath=Join-Path (Join-Path $script:Policy.appRoot 'state\backup-receipts') "$backupId.json"; Protect-Directory (Split-Path $receiptPath)
        $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
        Copy-Item -LiteralPath $receiptPath -Destination (Join-Path (Split-Path $receiptPath) 'latest.json') -Force
        Write-PeasEvent info "Backup completed: $backupId" @{ writePauseSeconds=$manifest.consistency.writePauseSeconds; repositories=@($receipts.repository) }
    } finally {
        if ($maintenance -and (Test-Path -LiteralPath $maintenance.Path)) { Remove-Item -LiteralPath $maintenance.Path -Force -ErrorAction SilentlyContinue }
        if ($shadow) { Remove-CimInstance -InputObject $shadow -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Send-OperationsAlert([string]$Subject, [string]$Body) {
    $monitoring=$script:Policy.monitoring
    $password=(Get-Content -LiteralPath $monitoring.smtpPasswordFile -Raw -ErrorAction Stop).Trim()
    if([string]::IsNullOrWhiteSpace($password)){throw 'The native monitoring SMTP password file is empty.'}
    $message=$null;$smtp=$null
    try{
        $message=[Net.Mail.MailMessage]::new()
        $message.From=[Net.Mail.MailAddress]::new([string]$monitoring.smtpUsername)
        $message.To.Add([string]$monitoring.operationsEmail)
        $message.Subject=$Subject
        $message.Body=$Body
        $message.IsBodyHtml=$false
        $smtp=[Net.Mail.SmtpClient]::new([string]$monitoring.smtpHost,[int]$monitoring.smtpPort)
        $smtp.UseDefaultCredentials=$false
        $smtp.Credentials=[Net.NetworkCredential]::new([string]$monitoring.smtpUsername,$password)
        $smtp.EnableSsl=$true
        $smtp.Timeout=60000
        $smtp.Send($message)
    }finally{
        if($message){$message.Dispose()}
        if($smtp){$smtp.Dispose()}
    }
}

function Update-MonitoringState([System.Collections.IDictionary]$Status) {
    $monitorRoot=Join-Path $script:Policy.appRoot 'state\monitoring'
    Protect-Directory $monitorRoot
    $statePath=Join-Path $monitorRoot 'latest.json'
    $previous=if(Test-Path -LiteralPath $statePath -PathType Leaf){Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json -Depth 10}else{$null}
    $signature="healthy=$($Status.healthy);certificate=$($Status.certificateBucket);issues=$(@($Status.issues|Sort-Object)-join ',')"
    $changed=(-not $previous -or $previous.signature -cne $signature)
    $requiresAlert=$changed -and ((-not $Status.healthy) -or $Status.certificateBucket -or $previous)
    if($requiresAlert){
        $hostLabel=if($env:COMPUTERNAME){$env:COMPUTERNAME}else{'PeAS host'}
        $subject=if(-not $Status.healthy){"[PeAS] Operations failure on $hostLabel"}elseif($previous -and -not $previous.healthy){"[PeAS] Operations recovered on $hostLabel"}elseif($Status.certificateBucket){"[PeAS] TLS certificate warning on $hostLabel ($($Status.certificateBucket -replace '_',' '))"}elseif($previous -and $previous.certificateBucket){"[PeAS] TLS certificate renewed on $hostLabel"}else{"[PeAS] Operations state changed on $hostLabel"}
        $body=@(
            "PeAS native monitoring detected a state transition at $([DateTimeOffset]::UtcNow.ToString('o')).",
            '',
            ($Status|ConvertTo-Json -Depth 10)
        ) -join [Environment]::NewLine
        Send-OperationsAlert -Subject $subject -Body $body
        Write-PeasEvent warning "Operations state transition alert sent: $signature"
    }
    [ordered]@{schemaVersion=1;checkedAt=[DateTimeOffset]::UtcNow.ToString('o');signature=$signature;healthy=[bool]$Status.healthy;certificateBucket=[string]$Status.certificateBucket;issues=@($Status.issues)}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
}

function Invoke-Status {
    $receiptPath=Join-Path $script:Policy.appRoot 'state\backup-receipts\latest.json'
    $receipt=if(Test-Path $receiptPath){Get-Content $receiptPath -Raw|ConvertFrom-Json}else{$null}
    $age=if($receipt){([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($receipt.dataCutoffUtc)).TotalMinutes}else{[double]::PositiveInfinity}
    $issues=[Collections.Generic.List[string]]::new()
    if($age -gt 75){$issues.Add('backup_stale')}
    $receiptRoot=Split-Path $receiptPath
    $receiptHistory=@(Get-ChildItem -LiteralPath $receiptRoot -Filter '*.json' -File -ErrorAction SilentlyContinue|Where-Object Name -ne 'latest.json'|ForEach-Object{try{Get-Content -LiteralPath $_.FullName -Raw|ConvertFrom-Json -Depth 10}catch{$null}}|Where-Object{$_})
    $repositories=@()
    foreach($definition in @($script:Policy.repositories|Where-Object enabled)){
        $repositoryReceipt=@($receiptHistory|Where-Object{@($_.repositories.repository) -contains $definition.id}|Sort-Object{[DateTimeOffset]::Parse($_.dataCutoffUtc)} -Descending|Select-Object -First 1)
        $repositoryAgeHours=if($repositoryReceipt){([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($repositoryReceipt[0].dataCutoffUtc)).TotalHours}else{[double]::PositiveInfinity}
        $repositoryMaximumAgeHours=Get-RepositoryMaximumAgeHours $definition
        if($repositoryAgeHours -gt $repositoryMaximumAgeHours){$issues.Add("repository_rotation_stale:$($definition.id)")}
        try{
            $resolved=Resolve-Repository $definition
            $latest=Invoke-Restic $resolved @('snapshots','--latest','1','--json') -Capture|ConvertFrom-Json
            $repositories += [ordered]@{id=$definition.id;available=$true;latest=$latest[-1].short_id;freeBytes=if($resolved.Volume){$resolved.Volume.SizeRemaining}else{$null};lastBackupUtc=if($repositoryReceipt){$repositoryReceipt[0].dataCutoffUtc}else{$null};ageHours=if($repositoryReceipt){[math]::Round($repositoryAgeHours,1)}else{$null};maximumAgeHours=$repositoryMaximumAgeHours}
        }catch{
            $connected=if($definition.type -eq 'usb'){@(Get-Volume -ErrorAction SilentlyContinue|Where-Object FileSystemLabel -ceq $definition.volumeLabel).Count -gt 0}else{$true}
            if($connected){$issues.Add("repository_unhealthy:$($definition.id)")}
            $repositories += [ordered]@{id=$definition.id;available=$false;error=$_.Exception.Message;lastBackupUtc=if($repositoryReceipt){$repositoryReceipt[0].dataCutoffUtc}else{$null};ageHours=if($repositoryReceipt){[math]::Round($repositoryAgeHours,1)}else{$null};maximumAgeHours=$repositoryMaximumAgeHours}
        }
    }

    $edge=$null
    $verifier=Join-Path $script:Policy.repoRoot 'scripts\Test-PeasPublicEdge.ps1'
    try {
        if(-not(Test-Path -LiteralPath $verifier -PathType Leaf)){throw "Public edge verifier not found: $verifier"}
        $edgeJson=& $verifier -BaseUrl ([uri]$script:Policy.monitoring.baseUrl) -CspMode ([string]$script:Policy.monitoring.cspMode) -PublicDocumentId ([int]$script:Policy.monitoring.publicDocumentId) -CertificateMinDays 1
        $edge=($edgeJson -join "`n")|ConvertFrom-Json -Depth 10
    } catch {
        $issues.Add('public_edge_or_database_failure')
        $edge=[ordered]@{status='failed';error=$_.Exception.GetBaseException().Message;certificateDaysRemaining=$null}
    }

    $certificateBucket=''
    if($null -ne $edge.certificateDaysRemaining){
        $certificateDays=[double]$edge.certificateDaysRemaining
        if($certificateDays -le 7){$certificateBucket='7_days'}elseif($certificateDays -le 14){$certificateBucket='14_days'}elseif($certificateDays -le 30){$certificateBucket='30_days'}
    }
    $healthy=($issues.Count -eq 0)
    $status=[ordered]@{healthy=$healthy;latestDataCutoffUtc=$receipt.dataCutoffUtc;ageMinutes=if($receipt){[math]::Round($age,1)}else{$null};repositories=$repositories;edge=$edge;issues=@($issues);certificateBucket=$certificateBucket}
    Update-MonitoringState -Status $status
    $status|ConvertTo-Json -Depth 10
    if(-not $healthy){throw "Native health check failed: $($issues -join ', ')"}
}

function Invoke-CspSummary {
    $script:Phase='summarizing sanitized CSP reports'
    $logRoot=Join-Path $script:Policy.appRoot 'logs'
    $monitorRoot=Join-Path $script:Policy.appRoot 'state\monitoring'
    Protect-Directory $monitorRoot
    $now=[DateTimeOffset]::UtcNow
    $cutoff=$now.AddHours(-24)
    $records=[Collections.Generic.List[object]]::new()
    $parseErrors=0
    $files=@(Get-ChildItem -LiteralPath $logRoot -Filter 'csp-violations*.ndjson' -File -ErrorAction SilentlyContinue)
    foreach($file in $files){
        foreach($line in @(Get-Content -LiteralPath $file.FullName -ErrorAction SilentlyContinue)){
            if([string]::IsNullOrWhiteSpace($line)){continue}
            try{
                $record=$line|ConvertFrom-Json -Depth 8 -ErrorAction Stop
                $received=[DateTimeOffset]::Parse([string]$record.receivedAt)
                if($received -ge $cutoff -and $received -le $now.AddMinutes(5)){$records.Add($record)}
            }catch{$parseErrors++}
        }
    }
    $groups=@($records|Group-Object effectiveDirective,blockedLocation,documentLocation,disposition|ForEach-Object{
        $sample=$_.Group|Select-Object -First 1
        [ordered]@{
            effectiveDirective=[string]$sample.effectiveDirective
            blockedLocation=[string]$sample.blockedLocation
            documentLocation=[string]$sample.documentLocation
            disposition=[string]$sample.disposition
            count=$_.Count
        }
    }|Sort-Object count -Descending)
    $summary=[ordered]@{
        schemaVersion=1
        generatedAt=$now.ToString('o')
        windowStart=$cutoff.ToString('o')
        windowEnd=$now.ToString('o')
        reportCount=$records.Count
        parseErrors=$parseErrors
        groups=$groups
    }
    $dateKey=$now.ToString('yyyy-MM-dd')
    $summaryPath=Join-Path $monitorRoot "csp-summary-$dateKey.json"
    $summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding utf8NoBOM
    Copy-Item -LiteralPath $summaryPath -Destination (Join-Path $monitorRoot 'csp-summary-latest.json') -Force
    if($records.Count -gt 0 -or $parseErrors -gt 0){
        $body=@(
            "PeAS CSP report summary for the 24 hours ending $($now.ToString('o')).",
            "Reports: $($records.Count)",
            "Parse errors: $parseErrors",
            '',
            ($groups|ConvertTo-Json -Depth 8)
        ) -join [Environment]::NewLine
        Send-OperationsAlert -Subject "[PeAS] Daily CSP report summary ($dateKey)" -Body $body
    }
    $summary|ConvertTo-Json -Depth 10
}

function Invoke-Verify {
    foreach($repo in (Select-Repositories -AllowMany)){
        $args=@('check'); if($VerifyMode -eq 'Full'){$args+='--read-data'}elseif($VerifyMode -eq 'ReadSubset'){$quarter=((Get-Date).DayOfYear%4)+1;$args += "--read-data-subset=$quarter/4"}
        Invoke-Restic $repo $args
    }
}

function Assert-RestoreTarget([string]$Path) {
    $full=Assert-SafeAbsolutePath $Path 'TargetRoot'; $app=[IO.Path]::GetFullPath($script:Policy.appRoot)
    if($full.StartsWith($app+'\',[StringComparison]::OrdinalIgnoreCase) -and -not $full.StartsWith((Join-Path $app 'restore')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Restore target must be outside the live application root or below its restore directory.'}
    if(Test-Path -LiteralPath $full){if((Get-ChildItem -LiteralPath $full -Force|Select-Object -First 1)){throw 'Restore target must be empty.'}}else{New-Item -ItemType Directory -Path $full|Out-Null}
    return $full
}

function Invoke-Restore {
    if(-not $TargetRoot){throw '-TargetRoot is required.'}
    if($Snapshot -notmatch '^(latest|[a-f0-9]{8,64})$'){throw 'Snapshot must be latest or an exact hexadecimal Restic snapshot ID.'}
    $repo=(Select-Repositories|Select-Object -First 1); $target=Assert-RestoreTarget $TargetRoot
    Invoke-Restic $repo @('restore',$Snapshot,'--target',$target)
    $manifest=Get-ChildItem -LiteralPath $target -Filter manifest.json -Recurse|Select-Object -First 1
    if(-not $manifest){throw 'Restored snapshot has no manifest.json.'}
    $data=Get-Content $manifest.FullName -Raw|ConvertFrom-Json -Depth 20
    foreach($db in $data.postgres.databases){$dump=Get-ChildItem -LiteralPath $target -Filter ([IO.Path]::GetFileName($db.file)) -Recurse|Select-Object -First 1;if(-not $dump){throw "Missing database dump $($db.file)"};if((Get-FileHash $dump.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $db.sha256){throw "Database dump checksum mismatch: $($db.name)"};Invoke-Postgres pg_restore @('--list',$dump.FullName)}
    $globals=Get-ChildItem -LiteralPath $target -Filter globals.sql -Recurse|Select-Object -First 1;if(-not$globals){throw 'Cluster globals export is missing.'};if((Get-FileHash $globals.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $data.postgres.globals.sha256){throw 'Cluster globals checksum mismatch.'}
    Set-Content -LiteralPath (Join-Path $target 'RESTORE-VALIDATED.txt') -Value "Artifact validation completed $([DateTimeOffset]::UtcNow.ToString('o')). No production paths were changed." -Encoding utf8NoBOM
    Write-PeasEvent info "Snapshot restored and artifact-validated at $target"
}

function Invoke-Drill {
    if(-not $TargetRoot){$TargetRoot=Join-Path $script:Policy.appRoot "restore\drill-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"}
    Invoke-Restore
    Write-Warning 'Artifact and dump-list validation passed. Application/database behavioral validation must run on an isolated Windows VM before this drill is accepted.'
}

function Invoke-Maintain {
    if(-not $Repository){throw '-Repository is required for maintenance.'}; $repo=(Select-Repositories|Select-Object -First 1); $r=$script:Policy.retention
    $args=@('forget','--keep-hourly',[string]$r.hourly,'--keep-daily',[string]$r.daily,'--keep-monthly',[string]$r.monthly,'--keep-yearly',[string]$r.yearly,'--keep-tag','legal-hold')
    if($DryRun -or -not $Apply){$args+='--dry-run';Invoke-Restic $repo $args;return}
    if($Confirmation -cne "MAINTAIN $Repository"){throw "Applying retention requires -Confirmation 'MAINTAIN $Repository'."}
    Invoke-Restic $repo $args; Invoke-Restic $repo @('prune'); Invoke-Restic $repo @('check')
}

function Invoke-Archive {
    $archiveRoot=Join-Path $script:Policy.appRoot 'archive-manifests'; Protect-Directory $archiveRoot
    $storage=Join-Path $script:Policy.appRoot 'storage'; $entries=Get-ChildItem -LiteralPath $storage -File -Recurse -ErrorAction Stop|Where-Object{$_.FullName -notmatch '[\\/]news-media[\\/]staging([\\/]|$)'}|ForEach-Object{[ordered]@{path=$_.FullName.Substring($storage.Length).TrimStart('\').Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}
    [ordered]@{schemaVersion=1;generatedAt=[DateTimeOffset]::UtcNow.ToString('o');mode=$ArchiveMode;notice='Candidate inventory only. Records-owner approval and normalized metadata export are required before permanent preservation.';files=$entries}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $archiveRoot 'research-candidates.json') -Encoding utf8NoBOM
}

function Install-NativeRecovery {
    Assert-Administrator
    foreach($path in @((Join-Path $script:Policy.appRoot 'ops'),(Join-Path $script:Policy.appRoot 'state'),(Join-Path $script:Policy.appRoot 'staging'),(Join-Path $script:Policy.appRoot 'restore'),(Join-Path $script:Policy.appRoot 'archive-manifests'))){Protect-Directory $path}
    $installed=Join-Path $script:Policy.appRoot 'ops\peas-native-recovery.ps1';Copy-Item -LiteralPath $PSCommandPath -Destination $installed -Force
    $pwsh=(Get-Command pwsh.exe).Source
    $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 55)
    $hourly=New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(10));$hourly.Repetition.Interval='PT1H';$hourly.Repetition.Duration='P1D'
    $health=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5);$health.Repetition.Interval='PT15M';$health.Repetition.Duration='P1D'
    $verify=New-ScheduledTaskTrigger -Daily -At '03:30';$archive=New-ScheduledTaskTrigger -Daily -At '04:30';$cspSummary=New-ScheduledTaskTrigger -Daily -At '05:00'
    $definitions=@(
      @{Name='PeAS-Native-Backup-Hourly';Trigger=$hourly;Args="-Action Backup -Reason Scheduled -PolicyPath `"$PolicyPath`""},
      @{Name='PeAS-Native-Backup-Health';Trigger=$health;Args="-Action Status -PolicyPath `"$PolicyPath`""},
      @{Name='PeAS-Native-Backup-Verify';Trigger=$verify;Args="-Action Verify -VerifyMode Structural -PolicyPath `"$PolicyPath`""},
      @{Name='PeAS-Native-Archive-Reconcile';Trigger=$archive;Args="-Action Archive -ArchiveMode Reconcile -PolicyPath `"$PolicyPath`""},
      @{Name='PeAS-Native-CSP-Summary';Trigger=$cspSummary;Args="-Action CspSummary -PolicyPath `"$PolicyPath`""}
    )
    foreach($item in $definitions){$taskAction=New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -NonInteractive -File `"$installed`" $($item.Args)";Register-ScheduledTask -TaskName $item.Name -Action $taskAction -Trigger $item.Trigger -Principal $principal -Settings $settings -Force|Out-Null}
    Write-PeasEvent info 'Native recovery tooling installed. No repository was initialized and no ACL outside the recovery directories was changed.'
}

function Invoke-Activate {
    Assert-Administrator
    if(-not $TargetRoot){throw '-TargetRoot must identify a validated restore root.'};$target=Assert-SafeAbsolutePath $TargetRoot 'TargetRoot';$marker=Join-Path $target 'RESTORE-VALIDATED.txt'
    if(-not(Test-Path $marker)){throw 'Restore root has not passed artifact validation.'}
    $manifest=Get-ChildItem -LiteralPath $target -Filter manifest.json -Recurse|Select-Object -First 1;if(-not$manifest){throw 'Restore manifest is missing.'};$data=Get-Content $manifest.FullName -Raw|ConvertFrom-Json
    if($Confirmation -cne "ACTIVATE $($data.backupSetId)"){throw "Activation requires -Confirmation 'ACTIVATE $($data.backupSetId)'."}
    throw 'Automated activation is intentionally blocked until a full isolated database/application drill writes an operator-approved ACTIVATION-APPROVED.json record.'
}

try {
    Read-Policy; Enter-OperationLock
    switch($Action){
        Install { Install-NativeRecovery }
        Backup { Invoke-Backup }
        Status { Invoke-Status }
        Verify { Invoke-Verify }
        Restore { Invoke-Restore }
        Drill { Invoke-Drill }
        Activate { Invoke-Activate }
        Maintain { Invoke-Maintain }
        Archive { Invoke-Archive }
        CspSummary { Invoke-CspSummary }
    }
} catch {
    Write-PeasEvent error $_.Exception.Message
    exit 1
} finally { if($script:Lock){$script:Lock.ReleaseMutex();$script:Lock.Dispose()} }
