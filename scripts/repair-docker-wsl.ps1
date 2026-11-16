# Targeted recovery for the demonstrated unresponsive WSL service.
# No unregister, prune, disk reset, credentials, firewall or global config changes.
# Review then run in an elevated PowerShell; only Docker was running in the
# pre-repair WSL inventory. Other running WSL workloads would be interrupted.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$resultDirectory = Join-Path $taskRoot '.agentbrake-local'
New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
$report = [ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); action = 'Restart unresponsive WslService and Docker Desktop'; success = $false }
try {
    $shutdown = Start-Process -FilePath 'C:\Program Files\Docker\Docker\DockerCli.exe' -ArgumentList '-Shutdown' -WindowStyle Hidden -PassThru
    if (-not $shutdown.WaitForExit(20000)) { $shutdown.Kill() }
    Restart-Service -Name WslService -Force -ErrorAction Stop
    (Get-Service WslService).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    Start-Process -FilePath 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden
    $report.success = $true
    $report.note = 'Service restart completed. Docker health and isolation must still be tested.'
} catch {
    $report.error = $_.Exception.Message
} finally {
    $report.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resultDirectory 'docker-repair-result.json') -Encoding utf8
}
