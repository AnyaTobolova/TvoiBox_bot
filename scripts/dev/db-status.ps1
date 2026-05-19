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
  Write-Output (Get-DockerUnavailableMessage -DockerStatus $dockerStatus)
  exit 1
}

if (-not $dockerStatus.daemonAvailable) {
  Write-Output (Get-DockerUnavailableMessage -DockerStatus $dockerStatus)
  exit 1
}

& $dockerStatus.cliPath compose -f $composePath ps postgres
exit $LASTEXITCODE
