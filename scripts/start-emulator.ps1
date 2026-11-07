param([switch]$Headless,[ValidateSet('auto','host','software','swiftshader')][string]$Gpu='auto',[ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$AvdName='CrewTrip_Pleos_2_1')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'artifacts') | Out-Null
$sdkRoot=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$arguments=@('-avd',$AvdName,'-no-snapshot','-gpu',$Gpu,'-memory','4096','-no-audio')
if($Headless){$arguments+='-no-window'}
Start-Process -FilePath "$sdkRoot\emulator\emulator.exe" -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput "$projectRoot\artifacts\emulator.log" -RedirectStandardError "$projectRoot\artifacts\emulator-error.log"
Write-Host '부팅 후 scripts\install-apk.ps1을 실행하세요. AVD 데이터는 C 드라이브에 저장됩니다.'
