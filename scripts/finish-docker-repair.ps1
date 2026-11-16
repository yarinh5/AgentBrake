#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$report = [ordered]@{ startedAt=(Get-Date).ToUniversalTime().ToString('o'); action='Recover stopped-VM WSL service deadlock'; success=$false }
try {
    $service = Get-CimInstance Win32_Service -Filter "Name='WslService'"
    if ($service.State -eq 'Stop Pending') {
        $activeVm = Get-Process -Name 'vmmem','vmmemWSL' -ErrorAction SilentlyContinue
        if ($activeVm) { throw 'A VM is still active; refusing forced service termination.' }
        $serviceProcess = Get-Process -Id $service.ProcessId
        if ($serviceProcess.ProcessName -ne 'wslservice') { throw 'Service process identity mismatch' }
        Stop-Process -Id $service.ProcessId -Force
    }
    Start-Service -Name WslService
    (Get-Service WslService).WaitForStatus('Running',[TimeSpan]::FromSeconds(20))
    Start-Process -FilePath 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden
    $report.success=$true
} catch { $report.error=$_.Exception.Message }
finally {
    $report.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot '.agentbrake-local/docker-recovery-result.json') -Encoding utf8
}
