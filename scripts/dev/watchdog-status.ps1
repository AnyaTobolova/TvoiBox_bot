$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$watchdogDir = Join-Path $rootPath "logs\watchdog"
$managerPidPath = Join-Path $watchdogDir "manager.pid"
$statePath = Join-Path $watchdogDir "state.json"
$composePath = Join-Path $rootPath "docker-compose.yml"
$dockerHelpersPath = Join-Path $PSScriptRoot "docker-helpers.ps1"
$postgresCtlPath = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin\pg_ctl.exe"
$postgresReadyPath = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin\pg_isready.exe"
$postmasterPidPath = Join-Path $rootPath ".tools\postgres\data\postmaster.pid"

. $dockerHelpersPath
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

function Test-DockerAvailable {
  return (Get-DockerDaemonStatus).daemonAvailable
}

function Test-DockerPostgresRunning {
  $dockerStatus = Get-DockerDaemonStatus
  if (-not $dockerStatus.daemonAvailable) {
    return $false
  }

  & $dockerStatus.cliPath compose -f $composePath ps --status running postgres *> $null
  return $LASTEXITCODE -eq 0
}

function Test-PostgresRunning {
  if (-not (Test-Path -LiteralPath $postgresCtlPath)) {
    return $false
  }

  & $postgresCtlPath status -D (Join-Path $rootPath ".tools\postgres\data") *> $null
  return $LASTEXITCODE -eq 0
}

$managerPid = 0
if (Test-Path -LiteralPath $managerPidPath) {
  $rawPid = Get-Content -LiteralPath $managerPidPath | Select-Object -First 1
  [void][int]::TryParse($rawPid, [ref]$managerPid)
}

$apiPid = 0
$botPid = 0
if (Test-Path -LiteralPath $statePath) {
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $apiPid = [int]$state.apiPid
    $botPid = [int]$state.botPid
  }
  catch {
    Write-Output "State file is broken."
  }
}

$postgresRunning = $false
$postgresPid = Read-PostgresPidFromPidFile
$postgresProcessAlive = Test-ProcessAlive -ProcessId $postgresPid
if (Test-Path -LiteralPath $postgresReadyPath) {
  & $postgresReadyPath -h localhost -p 5432 *> $null
  $postgresRunning = $LASTEXITCODE -eq 0
}

$postgresManaged = Test-PostgresRunning
$postgresDocker = Test-DockerPostgresRunning

if (-not $postgresProcessAlive -and -not $postgresManaged -and -not $postgresDocker) {
  $postgresPid = $null
}

$status = [ordered]@{
  watchdog = [ordered]@{
    "pid" = $managerPid
    "running" = (Test-ProcessAlive -ProcessId $managerPid)
  }
  postgres = [ordered]@{
    "pid" = $postgresPid
    "running" = ($postgresRunning -and ($postgresProcessAlive -or $postgresManaged -or $postgresDocker))
    "ready" = $postgresRunning
    "managed" = $postgresManaged
    "docker" = $postgresDocker
  }
  api = [ordered]@{
    "pid" = $apiPid
    "running" = (Test-ProcessAlive -ProcessId $apiPid)
  }
  bot = [ordered]@{
    "pid" = $botPid
    "running" = (Test-ProcessAlive -ProcessId $botPid)
  }
}

$status | ConvertTo-Json
