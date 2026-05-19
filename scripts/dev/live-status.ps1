$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$logsDir = Join-Path $rootPath "logs\live"
$statePath = Join-Path $logsDir "state.json"
$composePath = Join-Path $rootPath "docker-compose.yml"
$dockerHelpersPath = Join-Path $PSScriptRoot "docker-helpers.ps1"
$pgIsReadyPath = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin\pg_isready.exe"

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

$apiPid = $null
$botPid = $null
$managerPid = $null

if (Test-Path -LiteralPath $statePath) {
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $apiPid = [int]$state.apiPid
    $botPid = [int]$state.botPid
    $managerPid = [int]$state.managerPid
  }
  catch {
    Write-Output "Live state file is broken."
  }
}

$postgresReady = $false
if (Test-Path -LiteralPath $pgIsReadyPath) {
  & $pgIsReadyPath -h localhost -p 5432 *> $null
  $postgresReady = $LASTEXITCODE -eq 0
}

$postgresDocker = $false
$dockerStatus = Get-DockerDaemonStatus
if ($dockerStatus.daemonAvailable) {
  & $dockerStatus.cliPath compose -f $composePath ps --status running postgres *> $null
  $postgresDocker = $LASTEXITCODE -eq 0
}

$status = [ordered]@{
  manager = [ordered]@{
    pid = $managerPid
    running = (Test-ProcessAlive -ProcessId $managerPid)
  }
  postgres = [ordered]@{
    ready = $postgresReady
    docker = $postgresDocker
  }
  api = [ordered]@{
    pid = $apiPid
    running = (Test-ProcessAlive -ProcessId $apiPid)
  }
  bot = [ordered]@{
    pid = $botPid
    running = (Test-ProcessAlive -ProcessId $botPid)
  }
}

$status | ConvertTo-Json
