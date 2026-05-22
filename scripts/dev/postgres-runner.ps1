$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$postgresBinDir = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin"
$postgresCtlPath = Join-Path $postgresBinDir "pg_ctl.exe"
$postgresDataPath = Join-Path $rootPath ".tools\postgres\data"
$postgresLogPath = Join-Path $rootPath ".tools\postgres\postgres.log"

Set-Location $postgresBinDir

& $postgresCtlPath -D $postgresDataPath -l $postgresLogPath start -w
exit $LASTEXITCODE
