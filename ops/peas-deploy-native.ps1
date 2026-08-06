#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position=0, Mandatory)]
    [ValidateSet('install','bootstrap-admin','doctor','status','migrate','build-ui','start','stop','autostart-boot')]
    [string]$Command,
    [string]$AppRoot = (Join-Path $env:ProgramData 'PeAS')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$denoExe = 'C:\Users\peas\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe'
if (-not (Test-Path $denoExe)) {
    $denoExe = (Get-Command deno -ErrorAction SilentlyContinue).Source
}

function Load-Env {
    $envFile = Join-Path $repoRoot '.env'
    if (-not (Test-Path $envFile)) {
        $envFile = Join-Path $AppRoot 'config\peas.env'
    }
    if (Test-Path $envFile) {
        Get-Content -LiteralPath $envFile | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
                $idx = $line.IndexOf('=')
                if ($idx -gt 0) {
                    $k = $line.Substring(0, $idx).Trim()
                    $v = $line.Substring($idx + 1).Trim()
                    [Environment]::SetEnvironmentVariable($k, $v, 'Process')
                }
            }
        }
    }
    $pgBin = Join-Path $AppRoot 'postgres\bin'
    if (Test-Path $pgBin) {
        $curr = [Environment]::GetEnvironmentVariable('PATH', 'Process')
        if (-not $curr.Contains($pgBin)) {
            [Environment]::SetEnvironmentVariable('PATH', "$pgBin;$curr", 'Process')
        }
    }
}

switch ($Command) {
    'install' {
        Write-Host "[peas-deploy] Starting Native PeAS Installation..." -ForegroundColor Cyan
        & (Join-Path $repoRoot 'scripts\setup-native-env.ps1') -AppRoot $AppRoot
        & (Join-Path $repoRoot 'scripts\start-postgres.ps1') -AppRoot $AppRoot
        & (Join-Path $repoRoot 'scripts\init-native-db.ps1') -AppRoot $AppRoot
        Load-Env
        Write-Host "[peas-deploy] Running database migrations..." -ForegroundColor Yellow
        $secretsDir = Join-Path $AppRoot 'config\secrets'
        [Environment]::SetEnvironmentVariable('PGUSER', 'postgres', 'Process')
        [Environment]::SetEnvironmentVariable('PGPASSWORD_FILE', (Join-Path $secretsDir 'db_admin_password'), 'Process')
        Push-Location (Join-Path $repoRoot 'Deno')
        try { & $denoExe task db:migrate:apply } finally { Pop-Location }
        Write-Host "[peas-deploy] Building UI assets..." -ForegroundColor Yellow
        Push-Location $repoRoot
        try {
            $nodeBin = 'C:\Users\peas\AppData\Local\OpenAI\Codex\runtimes\cua_node\fb8898c05a62885e\bin'
            [Environment]::SetEnvironmentVariable('PATH', "$nodeBin;$([Environment]::GetEnvironmentVariable('PATH'))", 'Process')
            npm run build:ui
        } finally { Pop-Location }
        Write-Host "[peas-deploy] Installation completed successfully!" -ForegroundColor Green
    }

    'autostart-boot' {
        Write-Host "[peas-deploy] Configuring Windows Boot AutoStart Task..." -ForegroundColor Cyan
        & (Join-Path $repoRoot 'scripts\setup-autostart-boot.ps1') -AppRoot $AppRoot -RepoRoot $repoRoot
    }

    'bootstrap-admin' {
        Load-Env
        $secretsDir = Join-Path $AppRoot 'config\secrets'
        [Environment]::SetEnvironmentVariable('PGUSER', 'postgres', 'Process')
        [Environment]::SetEnvironmentVariable('PGPASSWORD_FILE', (Join-Path $secretsDir 'db_admin_password'), 'Process')
        Write-Host "[peas-deploy] Bootstrapping initial administrator..." -ForegroundColor Cyan
        Push-Location (Join-Path $repoRoot 'Deno')
        try { & $denoExe task admin:bootstrap } finally { Pop-Location }
    }

    'migrate' {
        Load-Env
        $secretsDir = Join-Path $AppRoot 'config\secrets'
        [Environment]::SetEnvironmentVariable('PGUSER', 'postgres', 'Process')
        [Environment]::SetEnvironmentVariable('PGPASSWORD_FILE', (Join-Path $secretsDir 'db_admin_password'), 'Process')
        Write-Host "[peas-deploy] Applying forward migrations..." -ForegroundColor Cyan
        Push-Location (Join-Path $repoRoot 'Deno')
        try { & $denoExe task db:migrate:apply } finally { Pop-Location }
    }

    'build-ui' {
        Write-Host "[peas-deploy] Compiling experience-studio and app-ui..." -ForegroundColor Cyan
        Push-Location $repoRoot
        try {
            $nodeBin = 'C:\Users\peas\AppData\Local\OpenAI\Codex\runtimes\cua_node\fb8898c05a62885e\bin'
            [Environment]::SetEnvironmentVariable('PATH', "$nodeBin;$([Environment]::GetEnvironmentVariable('PATH'))", 'Process')
            npm run build:ui
        } finally { Pop-Location }
    }

    'doctor' {
        Load-Env
        Write-Host "[peas-deploy] Running Doctor Diagnostics..." -ForegroundColor Cyan
        $results = @()

        if (Test-Path $denoExe) {
            $ver = & $denoExe --version | Select-Object -First 1
            $results += "[OK] Deno runtime available ($ver)"
        } else {
            $results += "[ERROR] Deno missing"
        }

        $psqlPath = Join-Path $AppRoot 'postgres\bin\psql.exe'
        if (Test-Path $psqlPath) {
            $results += "[OK] Native PostgreSQL 17 client available"
        } else {
            $results += "[ERROR] psql missing"
        }

        $port = if ($env:PORT) { $env:PORT } else { "80" }
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:$port/health/ready" -TimeoutSec 5 -UseBasicParsing
            if ($resp.StatusCode -eq 200) {
                $results += "[OK] PeAS Deno server health check passed (HTTP 200 at port $port)"
            } else {
                $results += "[WARNING] PeAS health check returned status $($resp.StatusCode)"
            }
        } catch {
            $results += "[WARNING] Could not reach health check at http://localhost:$port/health/ready (Server may be stopped)"
        }

        $task = Get-ScheduledTask -TaskName 'PeAS-Boot-Daemon' -ErrorAction SilentlyContinue
        if ($task) {
            $results += "[OK] Boot Scheduled Task 'PeAS-Boot-Daemon' is registered (Runs at system boot before user login)"
        } else {
            $results += "[INFO] Boot Scheduled Task 'PeAS-Boot-Daemon' is not registered"
        }

        $results | ForEach-Object { Write-Host $_ }
    }

    'status' {
        Load-Env
        Write-Host "[peas-deploy] Checking process status..." -ForegroundColor Cyan
        $denoProcs = Get-Process deno -ErrorAction SilentlyContinue
        $pgProcs = Get-Process postgres -ErrorAction SilentlyContinue
        if ($pgProcs) {
            Write-Host "[OK] $($pgProcs.Count) PostgreSQL process(es) running" -ForegroundColor Green
        } else {
            Write-Host "[WARNING] PostgreSQL server is not running" -ForegroundColor Yellow
        }
        if ($denoProcs) {
            Write-Host "[OK] $($denoProcs.Count) Deno process(es) running (PIDs: $($denoProcs.Id -join ', '))" -ForegroundColor Green
        } else {
            Write-Host "[INFO] No Deno processes running." -ForegroundColor Yellow
        }
    }

    'start' {
        Load-Env
        Write-Host "[peas-deploy] Launching native PeAS processes..." -ForegroundColor Cyan
        & (Join-Path $repoRoot 'start-native.ps1')
    }

    'stop' {
        Write-Host "[peas-deploy] Stopping Deno processes..." -ForegroundColor Yellow
        Stop-Process -Name deno -ErrorAction SilentlyContinue -Force
        Write-Host "[peas-deploy] Stopped." -ForegroundColor Green
    }
}
