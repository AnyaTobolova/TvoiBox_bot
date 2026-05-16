$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$watchdogDir = Join-Path $rootPath "logs\watchdog"
$managerPidPath = Join-Path $watchdogDir "manager.pid"
$statePath = Join-Path $watchdogDir "state.json"
$postgresReadyPath = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin\pg_isready.exe"

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
if (Test-Path -LiteralPath $postgresReadyPath) {
  & $postgresReadyPath -h localhost -p 5432 *> $null
  $postgresRunning = $LASTEXITCODE -eq 0
}

$status = [ordered]@{
  watchdog = [ordered]@{
    "pid" = $managerPid
    "running" = (Test-ProcessAlive -ProcessId $managerPid)
  }
  postgres = [ordered]@{
    "pid" = $null
    "running" = $postgresRunning
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
