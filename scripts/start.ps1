$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
if(-not(Test-Path node_modules)){npm ci --no-audit --no-fund}
if(-not(Test-Path dist\index.html)){npm run build;if($LASTEXITCODE -ne 0){throw 'Web build failed'}}
Write-Host 'CrewTrip: http://127.0.0.1:4310/vehicle'
npm start
