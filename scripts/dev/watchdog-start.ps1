$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$watchdogDir = Join-Path $rootPath "logs\watchdog"
$managerPidPath = Join-Path $watchdogDir "manager.pid"
$loopScriptPath = Join-Path $PSScriptRoot "watchdog-loop.ps1"
$postgresBinDir = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin"
$postgresCtlPath = Join-Path $postgresBinDir "pg_ctl.exe"
$postgresReadyPath = Join-Path $postgresBinDir "pg_isready.exe"
$postgresDataPath = Join-Path $rootPath ".tools\postgres\data"
$postgresLogPath = Join-Path $rootPath ".tools\postgres\postgres.log"

New-Item -ItemType Directory -Path $watchdogDir -Force | Out-Null

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

function Start-PostgresIfNeeded {
  if (Test-PostgresReady) {
    Write-Output "PostgreSQL already accepting connections"
    return
  }

  if (-not (Test-Path -LiteralPath $postgresCtlPath)) {
    throw "Portable PostgreSQL not found: $postgresCtlPath"
  }

  & $postgresCtlPath -D $postgresDataPath -l $postgresLogPath start | Out-Null
  Start-Sleep -Seconds 3

  if (-not (Test-PostgresReady)) {
    throw "PostgreSQL failed to start"
  }

  Write-Output "PostgreSQL started"
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

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = "powershell.exe"
$startInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$loopScriptPath`""
$startInfo.WorkingDirectory = $rootPath
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true

$process = [System.Diagnostics.Process]::Start($startInfo)

Start-Sleep -Seconds 2
if (-not (Test-ProcessAlive -ProcessId $process.Id)) {
  Write-Output ("Watchdog failed to start (pid={0})" -f $process.Id)
  exit 1
}

Write-Output ("Watchdog started (pid={0})" -f $process.Id)
