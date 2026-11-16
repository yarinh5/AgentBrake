#Requires -RunAsAdministrator
# Upgrade only from the already downloaded, hash-pinned, signed official installer.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $taskRoot '.tools/docker-upgrade/Docker Desktop_4.99.0_Machine_X64_exe_en-US.exe'
$expected = 'A5E299131C9C53D60F3F752B162078945EB5FAF6EEDCF0BE20A214C6E6CEA444'
$report = [ordered]@{startedAt=(Get-Date).ToUniversalTime().ToString('o'); action='Upgrade Docker Desktop to signed 4.99.0'; success=$false}
try {
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash -ne $expected) { throw 'Installer SHA-256 mismatch' }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Docker Inc') { throw 'Installer publisher signature is invalid' }
    $process = Start-Process -FilePath $installer -ArgumentList @('install','--quiet') -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(1800000)) { throw 'Installer still running; do not kill it or assume success. Check Docker installer UI/logs.' }
    $report.exitCode=$process.ExitCode
    if ($process.ExitCode -notin @(0,3010)) { throw "Installer returned $($process.ExitCode)" }
    $report.rebootRequired=$process.ExitCode -eq 3010
    $report.version=(Get-Item 'C:\Program Files\Docker\Docker\Docker Desktop.exe').VersionInfo.ProductVersion
    $report.success=$report.version.StartsWith('4.99.0')
    if(-not $report.success){throw 'Installed version does not match 4.99.0'}
    if(-not $report.rebootRequired){Start-Process -FilePath 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden}
}catch{$report.error=$_.Exception.Message}
finally{
    $report.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot '.agentbrake-local/docker-upgrade-result.json') -Encoding utf8
}
