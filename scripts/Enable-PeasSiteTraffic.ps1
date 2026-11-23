#Requires -Version 5.1
<#
.SYNOPSIS
Enables page views and visits on the native PeAS dashboard.

.EXAMPLE
.\scripts\Enable-PeasSiteTraffic.ps1
#>
[CmdletBinding()]
param(
    [string]$AppRoot = 'C:\ProgramData\PeAS',
    [string]$EnvFile = (Join-Path $AppRoot 'config/peas.env')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "PeAS environment file not found at '$EnvFile'. Pass its path with -EnvFile."
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $EnvFile) {
    $line = $line.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $key, $value = $line.Split('=', 2)
        $settings[$key.Trim()] = $value.Trim()
    }
}
if ($settings.PEAS_REPORTING_V2_WRITES -ceq 'false') {
    throw 'PeAS analytics writes are disabled by PEAS_REPORTING_V2_WRITES in the service configuration.'
}

$psql = Join-Path $AppRoot 'postgres/bin/psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    $psql = (Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Path
}
if (-not $psql) { throw 'psql was not found under the PeAS app root or on PATH.' }

$databaseEnvironment = @{
    PGHOST = if ($settings.PGHOST) { $settings.PGHOST } else { 'localhost' }
    PGPORT = if ($settings.PGPORT) { $settings.PGPORT } else { '5432' }
    PGDATABASE = $settings.PGDATABASE
    PGUSER = $settings.PGUSER
    PGPASSWORD = $settings.PGPASSWORD
}
if (-not $databaseEnvironment.PGPASSWORD -and $settings.PGPASSWORD_FILE) {
    $databaseEnvironment.PGPASSWORD = (Get-Content -LiteralPath $settings.PGPASSWORD_FILE -Raw).Trim()
}
foreach ($name in @('PGDATABASE', 'PGUSER', 'PGPASSWORD')) {
    if (-not $databaseEnvironment[$name]) { throw "PeAS database configuration is missing $name." }
}

$sql = @'
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF to_regclass('public.site_session_rollups') IS NULL THEN
        RAISE undefined_table;
    END IF;

    UPDATE public.operational_analytics_state
    SET traffic_v3_writes_enabled = TRUE,
        traffic_v3_reads_enabled = TRUE,
        updated_at = CURRENT_TIMESTAMP
    WHERE state_id = TRUE AND reads_enabled = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PeAS operational reporting must already be enabled on this database.';
    END IF;

    UPDATE public.page_activity_rollups
    SET view_count = visit_count
    WHERE view_count < visit_count;

    UPDATE public.author_activity_rollups
    SET view_count = visit_count
    WHERE view_count < visit_count;
EXCEPTION WHEN undefined_table OR undefined_column THEN
    RAISE EXCEPTION 'Reporting v3 schema is incomplete. Apply the PeAS reporting migration before enabling Site Traffic.';
END $$;

SELECT current_database() AS database, traffic_v3_writes_enabled, traffic_v3_reads_enabled
FROM public.operational_analytics_state
WHERE state_id = TRUE;
'@

$previousEnvironment = @{}
try {
    foreach ($name in $databaseEnvironment.Keys) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $databaseEnvironment[$name], 'Process')
    }
    $sql | & $psql --no-psqlrc --no-password --quiet --pset=pager=off --set=ON_ERROR_STOP=1 --single-transaction --file=-
    if ($LASTEXITCODE -ne 0) { throw "Could not enable Site Traffic. psql exited with code $LASTEXITCODE." }
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}

Write-Host 'PeAS Site Traffic is enabled. Visit the public site while signed out, then refresh the admin dashboard.'
