# 심사용 실행 안내

## 검증 환경

Windows, Node.js 24, JDK 17, Android SDK 35, Gradle 8.11.1, Pleos Connect Emulator 2.1.0/API 34에서 개발했습니다. APK는 자동차용 Android 앱이며, 동승자는 휴대폰 브라우저로 참여합니다.

## 서버와 브라우저

저장소 루트에서 `npm ci`, `npm run build`를 실행한 뒤 `.env.example`을 `.env`로 복사하고 `npm start`로 서버를 시작합니다. 서버 기본 포트는 4310입니다. 차량 브라우저 시연 주소는 `http://127.0.0.1:4310/vehicle`입니다.

실제 CCTV를 사용하려면 본인이 발급받은 ITS 인증키를 `.env`의 `ITS_API_KEY`에 넣고 서버를 재시작합니다. 인증키가 없으면 **협업 흐름 시연**으로 제안·의견·투표·확정을 확인할 수 있습니다.

## APK 설치

1. [Pleos 공식 환경 설정 안내](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)에 따라 Pleos 에뮬레이터를 설치합니다.
2. 서버를 실행한 PC에서 에뮬레이터를 부팅합니다. 개발 중 사용한 AVD 메모리 설정은 4GB입니다.
3. 다음 명령으로 APK를 설치하고 실행합니다.

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb devices
& $adb -e install -r .\apk\hacho1_CrewTrip_release.apk
& $adb -e shell am start -W -n app.crewtrip.vehicle.demo/app.crewtrip.vehicle.MainActivity
```

서명된 `emulatorRelease` 빌드를 사용합니다. 서버 주소는 Android 에뮬레이터의 호스트 별칭인 `http://10.0.2.2:4310`으로 고정되어 있습니다. HTTP 허용 대상도 이 호스트로 한정했습니다. 설치 후 CrewTrip 화면이 연결되지 않으면 PC에서 `/api/health`가 열리는지 먼저 확인합니다.

## P/D와 동승자 참여

공식 Virtual Console을 사용할 때는 `adb -e forward tcp:8088 tcp:8088`으로 포트를 연결하고 `http://127.0.0.1:8088/`에서 기어를 P로 설정합니다. 차량의 P 상태와 AAOS 제한이 확인되면 여행방을 만들 수 있습니다.

같은 Wi-Fi의 휴대폰에서 초대 QR을 열려면 PC와 휴대폰 사이의 포트 4310 접근이 가능해야 합니다. 필요한 경우 `.env`의 `PUBLIC_ORIGIN`을 심사용 PC의 사설 IP 주소와 포트로 지정한 뒤 서버를 다시 시작합니다. 예시는 `http://192.168.0.10:4310`입니다.

휴대폰을 사용할 수 없는 상황에서는 PC의 서로 다른 브라우저 프로필로 동승자를 재현할 수 있습니다. 초대 링크가 PC 사설 IP를 가리키며 해당 주소에 접근할 수 없다면, 로컬 브라우저 시연에 한해 주소의 호스트를 `127.0.0.1:4310`으로 변경합니다. 이 방식은 실제 휴대폰 QR 접속 검증과 구분해 기록합니다.

## 시연 순서

1. 차량에서 여행방을 만들고 동승자가 초대 링크로 참여합니다.
2. 동승자가 장소를 제안하고 투표합니다.
3. 앞길 확인에서 **협업 흐름 시연**을 열고 확인 요청을 공유합니다.
4. 동승자가 의견을 보내고 쉬어 갈 곳을 제안합니다.
5. 운전자가 정차 후 계획 변경 투표를 열고 경유지를 확정합니다.
6. 차량의 내비 준비 화면을 열고 CrewTrip으로 돌아와 목적지 연결을 요청합니다. 결과 화면에서 SDK 좌표 확인 여부를 확인합니다.
7. D로 전환하면 차량 조작이 제한되고, 동승자 브라우저에서는 제안·의견을 계속 작성할 수 있습니다.

여행방 확정과 차량 내비 반영은 각각 표시합니다. SDK가 좌표를 반환하지 않거나 권한을 거부하면 미확인·권한 오류를 그대로 표시합니다.
