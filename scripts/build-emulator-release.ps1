param(
 [Parameter(Mandatory)][string]$Keystore,
 [Parameter(Mandatory)][string]$PasswordFile,
 [string]$KeyAlias='crewtrip-contest',
 [ValidatePattern('^[\p{L}\p{N}_.-]+$')][string]$Participant='hacho1'
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$keyPath=(Resolve-Path -LiteralPath $Keystore).Path
$passwordPath=(Resolve-Path -LiteralPath $PasswordFile).Path
$sdkRoot=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$buildTools=Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
 Where-Object {$_.Name -match '^\d+\.\d+\.\d+$'} |
 Sort-Object {[version]$_.Name} -Descending | Select-Object -First 1
if(!$buildTools){throw 'Install Android SDK Build Tools before building the APK.'}
$gradle=Join-Path $projectRoot 'tools\gradle-8.11.1\bin\gradle.bat'
if(!(Test-Path -LiteralPath $gradle)){$gradle=Join-Path $projectRoot 'vehicle-app\gradlew.bat'}
$priorEnvironment=@{ANDROID_HOME=$env:ANDROID_HOME;GRADLE_USER_HOME=$env:GRADLE_USER_HOME;JAVA_TOOL_OPTIONS=$env:JAVA_TOOL_OPTIONS}
try {
 $env:ANDROID_HOME=$sdkRoot
 $env:GRADLE_USER_HOME=Join-Path $projectRoot 'tools\gradle-cache'
 $env:JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=$projectRoot\tools\no-unix-sockets"
 Push-Location (Join-Path $projectRoot 'vehicle-app')
 try {
  & $gradle --max-workers=1 --no-daemon '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process' testEmulatorReleaseUnitTest assembleEmulatorRelease --console=plain
  if($LASTEXITCODE -ne 0){throw 'Emulator release build failed.'}
 } finally {Pop-Location}
 $outputDirectory=Join-Path $projectRoot 'apk'
 New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
 $unsigned=Join-Path $projectRoot 'vehicle-app\app\build\outputs\apk\emulatorRelease\app-emulatorRelease-unsigned.apk'
 $signed=Join-Path $outputDirectory "${Participant}_CrewTrip_release.apk"
 & (Join-Path $buildTools.FullName 'apksigner.bat') sign --ks $keyPath --ks-key-alias $KeyAlias --ks-pass "file:$passwordPath" --out $signed $unsigned
 if($LASTEXITCODE -ne 0){throw 'APK signing failed.'}
 & (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose $signed
 if($LASTEXITCODE -ne 0){throw 'APK signature verification failed.'}
 Write-Host "Signed emulator release: $signed"
} finally {
 foreach($entry in $priorEnvironment.GetEnumerator()){
  [Environment]::SetEnvironmentVariable($entry.Key,$entry.Value,'Process')
 }
}
