# 공통 UI 첫 이관 실행 계획 — 업데이트 내역

정본 작업 기록: docs/work/research/2026-10-02-shared-ui-parity.md. SCOPE-003 사용자 결정에 따라 0.8.1 웹·앱 공동 배포 후 첫 화면을 이관 중이다. 구현과 로컬 빌드 검증은 진행했으며 운영 반영 완료는 아니다.

## 첫 수직 기능과 완료 조건

하나의 TypeScript React Native `ReleaseHistory`가 버전·날짜·제목·요약·항목을 렌더한다. 웹은 React Native Web으로, Android는 기존 앱 안의 Expo/React Native 화면으로 같은 소스를 사용한다. 기존 Figma 업데이트214:2228의 색상/글꼴/간격과 웹 반응형 표현을 유지하며 새 구성 변경은 Figma부터 갱신한다.

기존 진입 버튼·홈 복귀·뒤로가기·닫기·스크롤·큰 글자·320/384/820/1440폭을 검증한다. 최초 공지의 계정/버전별 읽음 처리는 기존 controller/server가 소유하고 공통 뷰에 세션·토큰을 전달하지 않는다. 초기 이관은 사용자가 여는 전체 업데이트 내역 화면만 바꾼다. 실제 앱 재시작/백그라운드 주행 복귀·보안 저장소·Kakao/App Links·지도는 기존 구현과 회귀 검증을 유지한다.

## 소스와 소비 경계

웹·서버 저장소의 `packages/shared-ui`를 공통 화면 소스 정본으로 둔다. 웹은 로컬 workspace를 소비하고 Android는 검토된 동일 소스 revision과 hash로 고정한 package를 소비한다. 두 저장소의 CI 권한과 WIF 신뢰를 한꺼번에 변경하지 않는다. 앱 저장소의 vendored package 또는 private package 전달 경로는 재현 가능성과 추가 인증 필요 여부를 실제 비교한 후 선택한다. 복사본을 수동으로 따로 수정하지 않는다.

공지 데이터의 정본은 웹 `lib/releases.ts`와 `package.json`이다. 플랫폼 한정 과거 공지는 현재처럼 범위를 보존한다. 공통 화면 변경은 양쪽 검사/버전/공지/배포 확인을 한 출시 기록에 결속하며 웹-only 커밋으로 Play를 자동 게시하지 않는다.

## 공식 호환성 조사와 구현 순서

2026-10-02 공식 Expo SDK 표에서 SDK57은 React Native0.86, React19.2.3, RNWeb0.21 계열을 대상으로 한다. 현재 웹 React19.2.8/Node24, Android compileSDK36과 대조했다. npm 최신 React Native0.87을 임의로 섞지 않는다. 실제 설치 전 Expo57의 bundledNativeModules 권장값과 lockfile을 고정한다.

1. 순수 공통 화면 package와 native/web adapter를 작성한다. 기존 폰트·Figma 상태 및 접근성 역할을 사용한다.
2. 별도 검증 경로에서 RNWeb의 실제 렌더/SSR·hydration과 Android 기존 앱 내 ReactActivity 수명주기를 검증한다. Expo integrated 방식은 현행 Gradle에서 실제 빌드했고 이를 선택했다. AAR isolated 방식은 별도 라이브러리 산출물과 릴리스 관리가 추가되므로 첫 화면에는 도입하지 않는다. AAR 비교 빌드는 NOT_RUN이다. 불필요한 EAS·OTA 계정/공개 registry·새 배포 권한을 추가하지 않는다.
3. 검증된 한 경로를 현행 업데이트 화면에 연결하고 전체 기존 인증·지도·주행 진입 회귀를 수행한다. 보이지 않는 fallback으로 구현 실패를 가리지 않는다.
4. 양쪽 fixed-head CI·Preview·운영 호환/버전/공지·Play 동일 artifact 절차를 통과한 공동 후보로 승격한다. 실기기/공개 트랙은 별도 gate다.
5. 첫 화면이 완료되면 출발 일정/확인창/홈 순으로 동일한 사용자 동작 단위로 이관한다. 지도와 주행 네이티브 모듈은 후속 별도 실패 경계를 갖는다.

## 현재 증거와 자원

### 2026-10-02 검토 PR과 원격 CI

웹 PR97과 Android PR42를 develop 대상 draft로 게시했다. 웹 review-* 브랜치는 배포가 차단되어 있으며 PR 생성 후 해당 SHA의 deployment 0건을 확인했다. 병합·Preview/Production·Play 게시·버전 변경은 수행하지 않았다.

웹 최초 CI36965580883은 npm11.19의 잠금 파일 검사에서 @emnapi/core 및 @emnapi/runtime1.11.3 항목 누락으로 FAIL했다. CI와 같은 npm11.19.0을 npx 사용자 cache에서 실행해 lockfile을 보완했다. 기존 패키지 버전은 유지했고 peer/devOptional metadata를 재계산했다. 실제 npm ci(587 packages)와 typecheck PASS, 로그 shared-ui-npm11-ci.log. 전역 npm/Node 설정은 변경하지 않았다. 최종 원격 CI 결과는 PR97/42의 현재 head에 결속해 기록한다.

### 2026-10-02 ADB 복구와 native UI 완료

이전 ADB 오류 원인은 Windows의 TCP5533–5632 예약 범위였다. 기존5560/5561 bind는 WinError10013, 대체5680/5681은 실제 bind 가능함을 확인했다. 예약·방화벽·AVD 데이터를 변경하지 않고 같은 MOTOCAST_S23Plus_API34를 emulator-5680으로 실행해 연결했다. 실행기는 유효한 emulator serial 및 정확한 AVD 이름을 함께 검사하며 물리/다른 AVD를 거부한다.

실제 화면에서 가변 Noto Sans KR의 기본 wght100 때문에 본문이 가늘게 표시되는 문제를 발견했다. 기존 Compose와 같은400/700 축을 font-family XML에 명시해 해결했다. Android 후보7e76beb는 공통 source a00f4c5를 그대로 사용한다. Preview APK SHA25664abef0971ce7239999389e51f5d9587cb9970a6999bd41faf7a54d3a61525c6, package dev.motocast.android.preview/version0.1.0-dev/code1이며 Play0.8.1/code9와 구분한다.

- 최종 LOCAL_UI: S23+384×832, 320폭/글자1.3배, 820폭 각각19 PASS, 합계57 PASS / FAIL0 / ERROR0. fixture 기반 홈·로그인 안내·주행·날씨·공유 회귀와 공통 업데이트 진입/뒤로가기/홈 복귀를 포함한다.
- 실제 내장 공지15개의 최신/오래된 항목 스크롤, Activity recreate, 백그라운드 후 재진입·홈 복귀 PASS. 세 크기의 직접 스크린샷을 읽어 글꼴·줄바꿈·안전 영역·홈 버튼을 확인했다. 주행·공유 fixture 결과는 서버 왕복 또는 실제 GPS 증거가 아니다.
- 양쪽 debug APK/test APK/단위/lint PASS, 각334단위 PASS. 실제 merged manifest 경계 PASS. CI 규칙230 PASS. 물리 serial 거부 검사 PASS. 로그: Android verification-logs/shared-ui-font-final-build.log, shared-ui-port-ci.log, shared-ui-final-{s23,small,wide}/instrumentation.log 및 각19개 PNG.
- 종료 전1080×2340/450dpi/font_scale1.0 복원 readback, 동일 AVD identity 확인 후 이번 실행만 emu kill로 종료했다. 새 SDK나 emulator 설치는 필요 없었고 기존 도구를 재사용했다. 실패 로그·수정 전후 화면은 보존한다.

초기 Android UI 차단은 해소했다. 원격 CI와 연결 Preview·공동 릴리스·Play/실기기는 별도 gate이며 전체 공통 UI 이관 완료가 아니다. 검토용 PR에서 고정 head CI를 확인한 뒤 후속 출시 후보를 준비한다. 아래는 초기 구현 시점의 증거와 미실행 상태다.

2026-10-02 공통 ReleaseHistory 구현: 웹 workspace와 Android Expo57.0.26/RN0.86.3가 같은 TypeScript 소스를 소비한다. React 웹19.2.8/앱19.2.3은 플랫폼 renderer 호환 버전이다. App Links·세션·위치·지도·주행은 기존 native 구현이 소유한다. 공개 공지 JSON만 ReactActivity에 전달하며 Activity는 exported=false, 번들은 APK 내부에 포함한다.

Figma wVNriNWb1OlF21DVq8rqlJ / 214:2228을 다시 읽고 카드·버전·날짜·제목·항목 상태를 대응했다. 웹 navigation/scroll은 기존 host, 앱 navigation/safe area/scroll은 native host가 소유한다. 신규 화면 구성은 추가하지 않았다.

소스 전달은 private registry 인증 없이 재현 가능한 vendored snapshot을 선택했다. Android tools/sync-shared-ui.py가 정본 저장소의 40자리 commit에서 Git canonical bytes를 가져오고 source.json에 revision/파일별 SHA256을 쓴다. tools/verify-shared-ui.py가 native CI/로컬 검사/서명 전에 파일 목록과 hash를 검증한다. vendor 직접 수정은 하지 않는다.

현재 로컬 검증:
- 웹 lint/typecheck/build PASS, npm test 85 files / 886 PASS. Deno 8 endpoints PASS.
- 웹 전체 Playwright LOCAL_UI: 61 PASS / 2 expected SKIP(연결 인증·실제 mutation 전용) / FAIL0 / ERROR0. 업데이트320/390/820/1440폭·200% 확대·SSR no-JS 스타일·hydration·홈/뒤로가기·문서스크롤 확인.
- Android Preview/Production assemble + unit test + lint PASS. 각 variant 단위334 PASS / FAIL0 / ERROR0 / SKIP0. 구버전 navigation bar 속성을 values-v27로 분리해 lint 오류 수정 후 재검증했다.
- Android CI 규칙 최종230 PASS / FAIL0 / ERROR0 / SKIP0. source 변조/빈 manifest/파일 집합/실제 commit/링크 경로13검사와 merged manifest 권한 회귀를 포함한다. Expo 환경 보존/실제 자식 환경 검사12 PASS; NODE_ENV=production, EXPO_NO_DOTENV=1을 빌드 진입점에 명시했다.
- Android 화면 E2E는 ADB 연결 환경 ERROR/NOT_RUN. 기존 MOTOCAST_S23Plus_API34를 데이터 초기화 없이 cold boot/headless/GUI·명시 포트·serial shell로 시도했지만 adb devices에 등록되지 않았다. tools/test-screen-design.py --serial emulator-5560 --variant s23는 첫 AVD identity 조회에서 ERROR(exit1); 앱 설치·화면 assertion은 NOT_RUN이다. 시작한 에뮬레이터만 종료했고 원래 AVD 데이터와 진단 로그는 보존했다. 연결 복구 후 Preview APK/test APK를 설치하고 s23/small/wide 화면 검사, 화면 재생성·복귀 및 native 기존 회귀를 실행해야 한다.
- 최종 native 검수에서 Expo 의존성의 외부 저장소·개발 overlay 권한 유입을 발견했다. 사용하지 않는 WRITE_EXTERNAL_STORAGE/READ_EXTERNAL_STORAGE/SYSTEM_ALERT_WINDOW를 manifest merge에서 제거하고 두 variant 재빌드/lint/단위검사 PASS. 실제 merged manifest에서 세 권한 부재, shared Activity exported=false 및 cleartext=false를 확인했다. Compose 진입의 launched 상태를 보존해 Activity 재생성 시 중복 실행을 막았으며 실제 재생성 UI 검증은 위 차단에 포함한다.
- 정본 공통 source commit a00f4c514637ed4daeed256b6f6017c919061f3f를 Android에 고정했고 hash/typecheck PASS. native 최종 실행 로그는 verification-logs/shared-ui-verify-permissions.log(BUILD SUCCESS, 각334 PASS)와 shared-ui-screen-attempt.log(ERROR)다. product release 후보는 아직 아니며 versionCode를 소모하지 않았다.
- Debug APK 크기는 Preview180.9MiB/Production179.9MiB다. 실제 배포용 최적화 AAB 크기·설치 후 시작 성능은 NOT_RUN이며 공동 출시 후보에서 측정한다. 이 크기를 Play 다운로드 크기로 해석하지 않는다.
- 최종 CI 동일 진입점 python .github/scripts/check_android.py PASS: npm ci부터 source/typecheck, 양쪽 APK/test APK·단위·lint·실제 merged manifest 검사까지 완료했다. verification-logs/shared-ui-ci-android-final.log(BUILD SUCCESS2m1s,435 tasks, 각334 PASS/FAIL0/ERROR0/SKIP0). 원격 CI 실행을 대신하지 않는다.
- Android 로컬 구현 commit e899dec54375b6d7918db83cd17443903692b9d9; commit 후 check_ci.py230 PASS와 clean worktree 확인. 웹 공통 구현 commit a00f4c5와 함께 로컬 보존했으며 push/PR/배포는 하지 않았다.
- fixed-head 원격 CI, 연결 Preview, 새 버전 출시·Play 서명/게시·실기기는 NOT_RUN. 제품 버전0.8.1 유지. 기존 배포 승인과 별개로 첫 화면 완료 gate가 아직 충족되지 않았다. 다음 화면 이관 전 native 화면 검증을 끝낸다.

작업 소유 root. 기존 task-owned worktree C:/Users/Public/Documents/ESTsoft/CreatorTemp/motocast-shared-ui-20261002(branch review-shared-release-ui-20261002)와 motocast-play-android-20260930(branch feat/shared-release-ui-20261002)를 재사용했다. 원래 사용자의 dirty workspace는 보존했다. 시작 C: 여유118.5GB, native 양쪽 빌드 후108.2GB. 기존8GB 예산보다 npm/Gradle/C++ cache가 커져16GB로 조정했으며 추가 VM/DB는 없다. 기존 SDK/NDK/JBR/AVD를 재사용하고 프로젝트 npm 의존성만 설치했다. Android verification-logs/shared-ui-* 및 웹 shared-ui-*.log와 CreatorTemp/motocast-shared-ui-full-e2e-20261002에 실행 증거를 보존한다. 진행 중 소스·실패 진단은 보존하며 완료되고 재생성 가능한 산출물만48시간 뒤 처분 검토한다. 자동 삭제하지 않는다.

공식 근거:
- https://docs.expo.dev/versions/latest/ — SDK 호환 표
- https://docs.expo.dev/brownfield/integrated-approach/ — 기존 네이티브 앱에 통합
- https://docs.expo.dev/brownfield/isolated-approach/ — AAR 소비 방식
- https://reactnative.dev/docs/integration-with-existing-apps.html
- https://necolas.github.io/react-native-web/docs/installation/
