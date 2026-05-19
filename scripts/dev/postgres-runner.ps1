$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
chcp 65001 > $null

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$postgresBinDir = Join-Path $rootPath ".tools\postgres\dist\pgsql\bin"
$postgresExePath = Join-Path $postgresBinDir "postgres.exe"
$postgresDataPath = Join-Path $rootPath ".tools\postgres\data"

Set-Location $postgresBinDir

& $postgresExePath -D $postgresDataPath
exit $LASTEXITCODE
