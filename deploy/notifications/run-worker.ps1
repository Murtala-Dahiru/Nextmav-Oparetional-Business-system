[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$WorkerEnvFile
)

$ErrorActionPreference = 'Stop'
$env:VAPID_ENV_FILE = (Resolve-Path -LiteralPath $WorkerEnvFile).Path
Push-Location (Join-Path $PSScriptRoot '../..')
try {
    & $NodePath --import tsx scripts/notifications-worker.mts
    $result = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $result
