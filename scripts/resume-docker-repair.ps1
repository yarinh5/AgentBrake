#Requires -RunAsAdministrator
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Write-Host 'AgentBrake local Docker repair: no data reset, unregister or prune.'
try {
    Write-Host 'Recovering the unresponsive WSL service...'
    & (Join-Path $PSScriptRoot 'finish-docker-repair.ps1')
    $recovery=Get-Content -LiteralPath (Join-Path $taskRoot '.agentbrake-local/docker-recovery-result.json') -Raw | ConvertFrom-Json
    if(-not $recovery.success){throw $recovery.error}
    Write-Host 'WSL recovered. Installing the verified Docker Desktop 4.99.0 update...'
    & (Join-Path $PSScriptRoot 'upgrade-docker.ps1')
    $upgrade=Get-Content -LiteralPath (Join-Path $taskRoot '.agentbrake-local/docker-upgrade-result.json') -Raw | ConvertFrom-Json
    if(-not $upgrade.success){throw $upgrade.error}
    Write-Host "Update complete. Reboot required: $($upgrade.rebootRequired). AgentBrake will now verify the engine."
}catch{
    Write-Host ('Repair could not finish: '+$_.Exception.Message) -ForegroundColor Red
    Read-Host 'Press Enter to close; no data was reset'
}
