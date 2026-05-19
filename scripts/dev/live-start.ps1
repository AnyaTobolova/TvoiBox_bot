param(
  [int]$MaxRuntimeSeconds = 0,
  [switch]$EnableTelegramPolling
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$logsDir = Join-Path $rootPath "logs\live"
$statePath = Join-Path $logsDir "state.json"
$dockerHelpersPath = Join-Path $PSScriptRoot "docker-helpers.ps1"
$pgIsReadyPath = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin\pg_isready.exe"
$composePath = Join-Path $rootPath "docker-compose.yml"
$apiStdoutPath = Join-Path $logsDir "api.stdout.log"
$apiStderrPath = Join-Path $logsDir "api.stderr.log"
$botStdoutPath = Join-Path $logsDir "bot.stdout.log"
$botStderrPath = Join-Path $logsDir "bot.stderr.log"
$apiProcess = $null
$botProcess = $null

. $dockerHelpersPath

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
Initialize-DockerClient -RootPath $rootPath
Set-Location $rootPath

$managedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Write-LiveInfo {
  param([string]$Message)
  Write-Output ("[live] {0}" -f $Message)
}

function Remove-StateFile {
  if (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  }
}

function Save-State {
  param(
    [int]$ApiPid,
    [int]$BotPid
  )

  $state = [ordered]@{
    managerPid = $PID
    apiPid = $ApiPid
    botPid = $BotPid
    startedAt = (Get-Date).ToString("o")
  }

  $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Test-ProcessAlive {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return $false
  }

  try {
    return -not $Process.HasExited
  }
  catch {
    return $false
  }
}

function Stop-ManagedProcess {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$Name
  )

  if (-not (Test-ProcessAlive -Process $Process)) {
    return
  }

  try {
    Stop-Process -Id $Process.Id -Force -ErrorAction Stop
    Write-LiveInfo ("Stopped {0} (pid={1})" -f $Name, $Process.Id)
  }
  catch {
    Write-LiveInfo ("Could not stop {0} cleanly (pid={1})" -f $Name, $Process.Id)
  }
}

function Read-LogTail {
  param(
    [string]$Path,
    [int]$Lines = 20
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return "Log file not found: $Path"
  }

  return (Get-Content -LiteralPath $Path -Tail $Lines) -join [Environment]::NewLine
}

function Ensure-DockerPostgresReady {
  $dockerStatus = Get-DockerDaemonStatus

  if (-not $dockerStatus.cliAvailable) {
    throw (Get-DockerUnavailableMessage -DockerStatus $dockerStatus)
  }

  if (-not $dockerStatus.daemonAvailable) {
    throw (Get-DockerUnavailableMessage -DockerStatus $dockerStatus)
  }

  Write-LiveInfo "Starting local PostgreSQL via docker compose"
  & $dockerStatus.cliPath compose -f $composePath up -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up -d postgres failed with exit code $LASTEXITCODE"
  }

  if (-not (Test-Path -LiteralPath $pgIsReadyPath)) {
    throw "pg_isready executable not found: $pgIsReadyPath"
  }

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & $pgIsReadyPath -h localhost -p 5432 *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-LiveInfo "PostgreSQL is accepting connections"
      return
    }

    Start-Sleep -Seconds 1
  }

  throw "PostgreSQL did not become ready on localhost:5432"
}

function Start-ServiceProcess {
  param(
    [ValidateSet("api", "bot")]
    [string]$Name,
    [string]$Command,
    [string]$StdoutPath,
    [string]$StderrPath
  )

  if (Test-Path -LiteralPath $StdoutPath) {
    Remove-Item -LiteralPath $StdoutPath -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path -LiteralPath $StderrPath) {
    Remove-Item -LiteralPath $StderrPath -Force -ErrorAction SilentlyContinue
  }

  $process = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList "/c $Command" `
    -WorkingDirectory $rootPath `
    -RedirectStandardOutput $StdoutPath `
    -RedirectStandardError $StderrPath `
    -WindowStyle Hidden `
    -PassThru

  Write-LiveInfo ("Started {0} process (pid={1})" -f $Name, $process.Id)
  $managedProcesses.Add($process)
  return $process
}

function Wait-ApiHealth {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1

    try {
      $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        Write-LiveInfo "API health endpoint is responding on http://localhost:3000/health"
        return
      }
    }
    catch {
      continue
    }
  }

  throw "API did not become healthy on http://localhost:3000/health"
}

function Wait-BotProcess {
  param([System.Diagnostics.Process]$Process)

  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not $Process.HasExited) {
      Start-Sleep -Seconds 1
      continue
    }

    throw ("Bot process exited too early. stderr tail:`n{0}" -f (Read-LogTail -Path $botStderrPath))
  }

  Write-LiveInfo "Bot process is running"
}

function Assert-Running {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$Name,
    [string]$StderrPath
  )

  if (-not (Test-ProcessAlive -Process $Process)) {
    throw ("{0} process exited. stderr tail:`n{1}" -f $Name, (Read-LogTail -Path $StderrPath))
  }
}

try {
  Remove-StateFile
  Ensure-DockerPostgresReady

  $apiProcess = Start-ServiceProcess `
    -Name "api" `
    -Command "corepack pnpm dev:api" `
    -StdoutPath $apiStdoutPath `
    -StderrPath $apiStderrPath

  Wait-ApiHealth

  $botCommand = if ($EnableTelegramPolling) {
    "corepack pnpm dev:bot"
  }
  else {
    "set BOT_DRY_RUN=true&& corepack pnpm dev:bot"
  }

  $botProcess = Start-ServiceProcess `
    -Name "bot" `
    -Command $botCommand `
    -StdoutPath $botStdoutPath `
    -StderrPath $botStderrPath

  Wait-BotProcess -Process $botProcess
  Save-State -ApiPid $apiProcess.Id -BotPid $botProcess.Id

  Write-LiveInfo "Local live mode is ready."
  if (-not $EnableTelegramPolling) {
    Write-LiveInfo "Bot is running in BOT_DRY_RUN=true mode to avoid Telegram polling conflicts with the production bot."
    Write-LiveInfo "If you really need live Telegram polling locally, run scripts/dev/live-start.ps1 -EnableTelegramPolling after stopping the other polling instance."
  }
  Write-LiveInfo "API logs: $apiStdoutPath"
  Write-LiveInfo "Bot logs: $botStdoutPath"
  Write-LiveInfo "Press Ctrl+C in this window to stop API, bot, and local PostgreSQL."

  $startedAt = Get-Date

  while ($true) {
    Start-Sleep -Seconds 2

    Assert-Running -Process $apiProcess -Name "API" -StderrPath $apiStderrPath
    Assert-Running -Process $botProcess -Name "Bot" -StderrPath $botStderrPath

    if ($MaxRuntimeSeconds -gt 0) {
      $elapsed = (Get-Date) - $startedAt
      if ($elapsed.TotalSeconds -ge $MaxRuntimeSeconds) {
        Write-LiveInfo ("Max runtime reached ({0}s). Stopping live mode." -f $MaxRuntimeSeconds)
        break
      }
    }
  }
}
finally {
  if ($managedProcesses.Count -gt 0) {
    foreach ($process in $managedProcesses) {
      $name = if ($process.Id -eq $apiProcess.Id) { "api" } elseif ($process.Id -eq $botProcess.Id) { "bot" } else { "process" }
      Stop-ManagedProcess -Process $process -Name $name
    }
  }

  $dockerStatus = Get-DockerDaemonStatus
  if ($dockerStatus.daemonAvailable) {
    & $dockerStatus.cliPath compose -f $composePath stop postgres *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-LiveInfo "Stopped local PostgreSQL container"
    }
  }

  Remove-StateFile
}
