$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$watchdogDir = Join-Path $rootPath "logs\watchdog"
$managerPidPath = Join-Path $watchdogDir "manager.pid"
$loopScriptPath = Join-Path $PSScriptRoot "watchdog-loop.ps1"
$dockerHelpersPath = Join-Path $PSScriptRoot "docker-helpers.ps1"
$postgresRunnerPath = Join-Path $PSScriptRoot "postgres-runner.ps1"
$postgresBinDir = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin"
$postgresCtlPath = Join-Path $postgresBinDir "pg_ctl.exe"
$postgresReadyPath = Join-Path $postgresBinDir "pg_isready.exe"
$postgresDataPath = Join-Path $rootPath ".tools\postgres\data"
$postgresLogPath = Join-Path $rootPath ".tools\postgres\postgres.log"
$postmasterPidPath = Join-Path $postgresDataPath "postmaster.pid"

. $dockerHelpersPath

New-Item -ItemType Directory -Path $watchdogDir -Force | Out-Null
Initialize-DockerClient -RootPath $rootPath

function Test-ProcessAlive {
  param([int]$ProcessId)

  if (-not $ProcessId) {
    return $false
  }

  try {
    $null = Get-Process -Id $ProcessId -ErrorAction Stop
    return $true
  }
  catch {
    return $false
  }
}

function Test-PostgresReady {
  if (-not (Test-Path -LiteralPath $postgresReadyPath)) {
    return $false
  }

  & $postgresReadyPath -h localhost -p 5432 *> $null
  return $LASTEXITCODE -eq 0
}

function Test-DockerAvailable {
  return (Get-DockerDaemonStatus).daemonAvailable
}

function Start-DockerPostgres {
  $dockerStatus = Get-DockerDaemonStatus
  if (-not $dockerStatus.daemonAvailable) {
    return $false
  }

  & $dockerStatus.cliPath compose -f (Join-Path $rootPath "docker-compose.yml") up -d postgres *> $null
  return $LASTEXITCODE -eq 0
}

function Test-PostgresRunning {
  if (-not (Test-Path -LiteralPath $postgresCtlPath)) {
    return $false
  }

  & $postgresCtlPath status -D "$postgresDataPath" *> $null
  return $LASTEXITCODE -eq 0
}

function Read-PostgresPidFromPidFile {
  if (-not (Test-Path -LiteralPath $postmasterPidPath)) {
    return $null
  }

  try {
    $rawPid = Get-Content -LiteralPath $postmasterPidPath -ErrorAction Stop | Select-Object -First 1
    $postgresPid = 0

    if ([int]::TryParse($rawPid, [ref]$postgresPid)) {
      return $postgresPid
    }
  }
  catch {
    return $null
  }

  return $null
}

function Remove-StalePostmasterPid {
  $postgresPid = Read-PostgresPidFromPidFile

  if (-not $postgresPid) {
    return
  }

  if ((Test-ProcessAlive -ProcessId $postgresPid) -or (Test-PostgresRunning)) {
    return
  }

  Remove-Item -LiteralPath $postmasterPidPath -Force -ErrorAction SilentlyContinue
}

function Start-PostgresProcess {
  if (-not (Test-Path -LiteralPath $postgresRunnerPath)) {
    throw "Portable PostgreSQL runner not found: $postgresRunnerPath"
  }

  Remove-StalePostmasterPid

  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $postgresRunnerPath) `
    -WorkingDirectory $rootPath `
    -WindowStyle Hidden `
    -PassThru

  return $process.Id
}

function Start-PostgresIfNeeded {
  if (Test-PostgresReady) {
    Write-Output "PostgreSQL already accepting connections"
    return
  }

  $dockerStatus = Get-DockerDaemonStatus
  if ($dockerStatus.daemonAvailable) {
    if (-not (Start-DockerPostgres)) {
      throw "Docker PostgreSQL failed to start via docker compose."
    }
  }
  elseif ($dockerStatus.cliAvailable) {
    throw (Get-DockerUnavailableMessage -DockerStatus $dockerStatus)
  }
  elseif (-not (Test-PostgresRunning)) {
    $null = Start-PostgresProcess
  }

  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Seconds 1

    if (Test-PostgresReady) {
      Write-Output "PostgreSQL started"
      return
    }
  }

  $errorTail = ""
  if (Test-Path -LiteralPath $postgresLogPath) {
    $errorTail = (Get-Content -LiteralPath $postgresLogPath -Tail 20) -join [Environment]::NewLine
  }

  if ($dockerStatus.daemonAvailable) {
    throw "PostgreSQL failed to become ready even after docker compose up -d postgres."
  }

  throw (
    "PostgreSQL failed to start in background mode. " +
    "If Docker Desktop is installed, prefer `corepack pnpm dev:db:up`. Otherwise run `corepack pnpm dev:postgres:run` in a separate PowerShell window first, then retry `corepack pnpm dev:watchdog:start`." +
    "`nRecent log tail:`n{0}" -f $errorTail
  )
}

if (Test-Path -LiteralPath $managerPidPath) {
  $rawPid = Get-Content -LiteralPath $managerPidPath -ErrorAction SilentlyContinue | Select-Object -First 1
  $existingPid = 0
  [void][int]::TryParse($rawPid, [ref]$existingPid)

  if (Test-ProcessAlive -ProcessId $existingPid) {
    Write-Output "Watchdog already running (pid=$existingPid)"
    exit 0
  }
}

Start-PostgresIfNeeded

$process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$loopScriptPath`"" `
  -WorkingDirectory $rootPath `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 2
if (-not (Test-ProcessAlive -ProcessId $process.Id)) {
  Write-Output ("Watchdog failed to start (pid={0})" -f $process.Id)
  exit 1
}

Write-Output ("Watchdog started (pid={0})" -f $process.Id)
