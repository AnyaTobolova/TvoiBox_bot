$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$watchdogDir = Join-Path $rootPath "logs\watchdog"
$managerPidPath = Join-Path $watchdogDir "manager.pid"
$statePath = Join-Path $watchdogDir "state.json"
$postgresBinDir = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin"
$postgresCtlPath = Join-Path $postgresBinDir "pg_ctl.exe"
$postgresReadyPath = Join-Path $postgresBinDir "pg_isready.exe"
$postgresDataPath = Join-Path $rootPath ".tools\postgres\data"

function Try-StopProcess {
  param([int]$ProcessId, [string]$Name)

  if (-not $ProcessId) {
    return
  }

  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    Write-Output ("Stopped {0} (pid={1})" -f $Name, $ProcessId)
  }
  catch {
    Write-Output ("{0} already stopped or inaccessible (pid={1})" -f $Name, $ProcessId)
  }
}

if (Test-Path -LiteralPath $statePath) {
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    Try-StopProcess -ProcessId ([int]$state.apiPid) -Name "api"
    Try-StopProcess -ProcessId ([int]$state.botPid) -Name "bot"
  }
  catch {
    Write-Output "Could not parse watchdog state file."
  }
}

if (Test-Path -LiteralPath $managerPidPath) {
  $rawPid = Get-Content -LiteralPath $managerPidPath | Select-Object -First 1
  $managerPid = 0
  [void][int]::TryParse($rawPid, [ref]$managerPid)
  Try-StopProcess -ProcessId $managerPid -Name "watchdog"
}

if (Test-Path -LiteralPath $managerPidPath) {
  Remove-Item -LiteralPath $managerPidPath -Force
}

if (Test-Path -LiteralPath $statePath) {
  Remove-Item -LiteralPath $statePath -Force
}

if ((Test-Path -LiteralPath $postgresReadyPath) -and (Test-Path -LiteralPath $postgresCtlPath)) {
  & $postgresReadyPath -h localhost -p 5432 *> $null
  if ($LASTEXITCODE -eq 0) {
    & $postgresCtlPath -D $postgresDataPath stop -m fast | Out-Null
    Write-Output "Stopped postgres"
  }
}

Write-Output "Watchdog stop completed."
