$ErrorActionPreference = "Stop"
$backupDirectory = Join-Path (Get-Location) "backups"
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$output = Join-Path $backupDirectory "videosystem-$timestamp.sql"
$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) { throw "DATABASE_URL no está configurada" }
pg_dump $databaseUrl --format=plain --file=$output
Write-Output "Backup creado: $output"
