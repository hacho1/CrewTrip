# release 빌드와 서명

저장소의 APK는 `emulatorRelease` 빌드입니다. `release` 설정을 바탕으로 디버깅을 해제하고, 에뮬레이터 시연을 위한 앱 ID와 로컬 서버 주소를 지정합니다. 개인 참가 식별자로 GitHub 계정명 `hacho1`을 파일명에 사용했습니다.

## 제공 APK

- 경로는 `apk/hacho1_CrewTrip_release.apk`입니다.
- 패키지는 `app.crewtrip.vehicle.demo`입니다.
- 서버는 `http://10.0.2.2:4310`입니다.
- 최소 Android API는 28이며 target API는 34입니다.
- 전용 인증서로 서명하고 `apksigner verify`로 검증합니다.

## 소스에서 재현

본인의 서명키와 비밀번호 파일을 저장소 외부에 준비합니다. 다음 스크립트는 비밀번호 파일 경로를 전달받아 읽으며 키와 비밀번호를 저장소에 기록하지 않습니다.

```powershell
.\scripts\build-emulator-release.ps1 `
  -Keystore D:\private-signing\your-release.p12 `
  -PasswordFile D:\private-signing\store-password.txt `
  -KeyAlias crewtrip-contest `
  -Participant hacho1
```

JDK 17과 Android SDK Build Tools가 필요합니다. Android SDK의 기본 위치는 `%LOCALAPPDATA%\Android\Sdk`입니다. `tools/gradle-8.11.1`이 있으면 해당 Gradle을 사용하고, 그 외에는 프로젝트의 Gradle Wrapper를 사용합니다.

자신의 키로 다시 서명한 APK는 저장소의 APK와 인증서가 달라 기존 설치를 바로 갱신할 수 없습니다. 별도의 검증용 에뮬레이터에서 실행합니다.

## HTTPS 서버를 사용하는 release

기본 `release`는 `-PcrewtripServerOrigin=https://운영서버주소`를 지정해야 합니다. 서버 운영과 HTTPS 접속을 준비한 뒤 해당 주소로 빌드·서명하고 기기에서 다시 검증합니다. 저장소에 제공한 시연 APK의 실행 방법은 [RUN.md](RUN.md)에 있습니다.
