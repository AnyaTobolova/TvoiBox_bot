$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$composePath = Join-Path $rootPath "docker-compose.yml"
$dockerHelpersPath = Join-Path $PSScriptRoot "docker-helpers.ps1"

. $dockerHelpersPath

Initialize-DockerClient -RootPath $rootPath
$dockerStatus = Get-DockerDaemonStatus
if (-not $dockerStatus.cliAvailable) {
  throw (Get-DockerUnavailableMessage -DockerStatus $dockerStatus)
}

if (-not $dockerStatus.daemonAvailable) {
  throw (Get-DockerUnavailableMessage -DockerStatus $dockerStatus)
}

& $dockerStatus.cliPath compose -f $composePath up -d postgres
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up -d postgres failed with exit code $LASTEXITCODE"
}

& $dockerStatus.cliPath compose -f $composePath ps postgres
exit $LASTEXITCODE
