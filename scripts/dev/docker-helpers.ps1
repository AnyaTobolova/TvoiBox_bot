$ErrorActionPreference = "Stop"

function Initialize-DockerClient {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath
  )

  $dockerConfigPath = Join-Path $RootPath ".docker-dev"
  New-Item -ItemType Directory -Path $dockerConfigPath -Force | Out-Null
  $env:DOCKER_CONFIG = $dockerConfigPath
}

function Get-DockerCliPath {
  $preferredPath = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

  if (Test-Path -LiteralPath $preferredPath) {
    return $preferredPath
  }

  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -ne $dockerCommand) {
    return $dockerCommand.Source
  }

  return $null
}

function Test-DockerCliAvailable {
  return $null -ne (Get-DockerCliPath)
}

function Get-DockerDaemonStatus {
  $dockerCliPath = Get-DockerCliPath
  if (-not $dockerCliPath) {
    return [ordered]@{
      cliAvailable = $false
      daemonAvailable = $false
      cliPath = $null
      details = "Docker CLI not found."
    }
  }

  $dockerCliEscaped = $dockerCliPath.Replace('"', '""')
  $output = & cmd.exe /d /c """$dockerCliEscaped"" version --format ""{{.Server.APIVersion}}"" 2>&1"

  if ($LASTEXITCODE -eq 0) {
    return [ordered]@{
      cliAvailable = $true
      daemonAvailable = $true
      cliPath = $dockerCliPath
      details = ($output | Out-String).Trim()
    }
  }

  return [ordered]@{
    cliAvailable = $true
    daemonAvailable = $false
    cliPath = $dockerCliPath
    details = (($output | Out-String).Trim())
  }
}

function Get-DockerUnavailableMessage {
  param(
    [Parameter(Mandatory = $true)]
    [object]$DockerStatus
  )

  if (-not $DockerStatus.cliAvailable) {
    return "Docker CLI was not found. Install Docker Desktop and retry the command."
  }

  $details = if ($DockerStatus.details) { $DockerStatus.details } else { "no details" }
  return (
    "Docker Desktop is installed, but the daemon is not reachable from the current session. " +
    "Open Docker Desktop and wait until it shows Engine running. " +
    "If the window is already open, wait 10-20 seconds and retry the command. " +
    "Technical detail: {0}" -f $details
  )
}
