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

. $dockerHelpersPath
Initialize-DockerClient -RootPath $rootPath

function Try-StopProcess {
  param(
    [int]$ProcessId,
    [string]$Name
  )

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
    Try-StopProcess -ProcessId ([int]$state.managerPid) -Name "live-manager"
  }
  catch {
    Write-Output "Could not parse live state file."
  }

  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}
else {
  Write-Output "No live state file found."
}

$dockerStatus = Get-DockerDaemonStatus
if ($dockerStatus.daemonAvailable) {
  & $dockerStatus.cliPath compose -f $composePath stop postgres *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Output "Stopped local PostgreSQL container"
  }
}

Write-Output "Live stop completed."
