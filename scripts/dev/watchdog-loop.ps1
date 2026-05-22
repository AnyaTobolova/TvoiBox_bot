$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$watchdogDir = Join-Path $rootPath "logs\watchdog"
$logPath = Join-Path $watchdogDir "runtime.log"
$statePath = Join-Path $watchdogDir "state.json"
$managerPidPath = Join-Path $watchdogDir "manager.pid"
$composePath = Join-Path $rootPath "docker-compose.yml"
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
Set-Location $rootPath

function Write-WatchdogLog {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logPath -Value $line
}

function Read-State {
  if (-not (Test-Path -LiteralPath $statePath)) {
    return [ordered]@{
      apiPid = $null
      botPid = $null
      miniAppPid = $null
    }
  }

  try {
    return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  }
  catch {
    Write-WatchdogLog "State file is broken, resetting: $($_.Exception.Message)"
    return [ordered]@{
      apiPid = $null
      botPid = $null
      miniAppPid = $null
    }
  }
}

function Write-State {
  param(
    [Parameter(Mandatory = $true)]
    [object]$State
  )

  $State | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Test-ProcessAlive {
  param(
    [int]$ProcessId
  )

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

  & $dockerStatus.cliPath compose -f $composePath up -d postgres *> $null
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

function Ensure-PostgresReady {
  if (Test-PostgresReady) {
    return
  }

  $dockerStatus = Get-DockerDaemonStatus
  if ($dockerStatus.daemonAvailable) {
    Write-WatchdogLog "PostgreSQL is down, attempting docker compose up -d postgres"
    if (-not (Start-DockerPostgres)) {
      throw "Docker PostgreSQL failed to start via docker compose."
    }
  }
  elseif (-not (Test-PostgresRunning)) {
    Write-WatchdogLog "PostgreSQL is down, attempting restart"
  }
  else {
    Write-WatchdogLog "PostgreSQL process detected but not ready, waiting for readiness"
  }

  $startedPid = $null
  if (-not $dockerStatus.daemonAvailable -and -not (Test-PostgresRunning)) {
    $startedPid = Start-PostgresProcess
  }

  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Seconds 1

    if (Test-PostgresReady) {
      if ($startedPid) {
        Write-WatchdogLog ("PostgreSQL restarted successfully, pid={0}" -f $startedPid)
      }
      else {
        Write-WatchdogLog "PostgreSQL became ready without restart"
      }
      return
    }
  }

  if (-not (Test-PostgresReady)) {
    $errorTail = ""
    if (Test-Path -LiteralPath $postgresLogPath) {
      $errorTail = (Get-Content -LiteralPath $postgresLogPath -Tail 20) -join " | "
    }

    throw ("PostgreSQL failed to restart. Recent log tail: {0}" -f $errorTail)
  }
}

function Find-ApiProcessId {
  try {
    $connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop |
      Select-Object -First 1

    if ($null -ne $connection -and $connection.OwningProcess) {
      return [int]$connection.OwningProcess
    }
  }
  catch {
    return $null
  }

  return $null
}

function Find-BotProcessId {
  try {
    $connection = Get-NetTCPConnection -RemotePort 443 -State Established -ErrorAction Stop |
      Where-Object { $_.RemoteAddress -like "149.154.*" } |
      Select-Object -First 1

    if ($null -ne $connection -and $connection.OwningProcess) {
      return [int]$connection.OwningProcess
    }
  }
  catch {
    return $null
  }

  return $null
}

function Find-MiniAppProcessId {
  try {
    $connection = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction Stop |
      Select-Object -First 1

    if ($null -ne $connection -and $connection.OwningProcess) {
      return [int]$connection.OwningProcess
    }
  }
  catch {
    return $null
  }

  return $null
}

function Start-ServiceProcess {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("api", "bot", "mini-app")]
    [string]$Name
  )

  $command = switch ($Name) {
    "api" {
      "corepack pnpm dev:api"
    }
    "bot" {
      "corepack pnpm dev:bot"
    }
    "mini-app" {
      "corepack pnpm dev:mini-app"
    }
  }
  $workingDirectory = $rootPath

  $stdoutPath = Join-Path $watchdogDir ("{0}.stdout.log" -f $Name)
  $stderrPath = Join-Path $watchdogDir ("{0}.stderr.log" -f $Name)
  $wrappedCommand = "Set-Location `"$workingDirectory`"; $command *> `"$stdoutPath`" 2> `"$stderrPath`""

  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $wrappedCommand) `
    -WorkingDirectory $workingDirectory `
    -WindowStyle Hidden `
    -PassThru

  Write-WatchdogLog ("Started {0} process, pid={1}" -f $Name, $process.Id)
  return $process.Id
}

try {
  Set-Content -LiteralPath $managerPidPath -Value $PID -Encoding UTF8
  Write-WatchdogLog ("Watchdog started, pid={0}" -f $PID)

  while ($true) {
    $state = Read-State

    Ensure-PostgresReady

    if (-not (Test-ProcessAlive -ProcessId $state.apiPid)) {
      $existingApiPid = Find-ApiProcessId
      if ($existingApiPid -and (Test-ProcessAlive -ProcessId $existingApiPid)) {
        $state.apiPid = $existingApiPid
      }
      else {
        $state.apiPid = Start-ServiceProcess -Name "api"
      }
    }

    if (-not (Test-ProcessAlive -ProcessId $state.botPid)) {
      $existingBotPid = Find-BotProcessId
      if ($existingBotPid -and (Test-ProcessAlive -ProcessId $existingBotPid)) {
        $state.botPid = $existingBotPid
      }
      else {
        $state.botPid = Start-ServiceProcess -Name "bot"
      }
    }

    if (-not (Test-ProcessAlive -ProcessId $state.miniAppPid)) {
      $existingMiniAppPid = Find-MiniAppProcessId
      if ($existingMiniAppPid -and (Test-ProcessAlive -ProcessId $existingMiniAppPid)) {
        $state.miniAppPid = $existingMiniAppPid
      }
      else {
        $state.miniAppPid = Start-ServiceProcess -Name "mini-app"
      }
    }

    Write-State -State $state
    Start-Sleep -Seconds 8
  }
}
catch {
  Write-WatchdogLog ("Watchdog crashed: {0}" -f $_.Exception.Message)
  throw
}
