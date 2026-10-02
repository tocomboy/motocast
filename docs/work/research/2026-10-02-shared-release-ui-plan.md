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

2026-10-02 공통 ReleaseHistory 구현: 웹 workspace와 Android Expo57.0.26/RN0.86.3가 같은 TypeScript 소스를 소비한다. React 웹19.2.8/앱19.2.3은 플랫폼 renderer 호환 버전이다. App Links·세션·위치·지도·주행은 기존 native 구현이 소유한다. 공개 공지 JSON만 ReactActivity에 전달하며 Activity는 exported=false, 번들은 APK 내부에 포함한다.

Figma wVNriNWb1OlF21DVq8rqlJ / 214:2228을 다시 읽고 카드·버전·날짜·제목·항목 상태를 대응했다. 웹 navigation/scroll은 기존 host, 앱 navigation/safe area/scroll은 native host가 소유한다. 신규 화면 구성은 추가하지 않았다.

소스 전달은 private registry 인증 없이 재현 가능한 vendored snapshot을 선택했다. Android tools/sync-shared-ui.py가 정본 저장소의 40자리 commit에서 Git canonical bytes를 가져오고 source.json에 revision/파일별 SHA256을 쓴다. tools/verify-shared-ui.py가 native CI/로컬 검사/서명 전에 파일 목록과 hash를 검증한다. vendor 직접 수정은 하지 않는다.

현재 로컬 검증:
- 웹 lint/typecheck/build PASS, npm test 85 files / 886 PASS. Deno 8 endpoints PASS.
- 웹 전체 Playwright LOCAL_UI: 61 PASS / 2 expected SKIP(연결 인증·실제 mutation 전용) / FAIL0 / ERROR0. 업데이트320/390/820/1440폭·200% 확대·SSR no-JS 스타일·hydration·홈/뒤로가기·문서스크롤 확인.
- Android Preview/Production assemble + unit test + lint PASS. 각 variant 단위334 PASS / FAIL0 / ERROR0 / SKIP0. 구버전 navigation bar 속성을 values-v27로 분리해 lint 오류 수정 후 재검증했다.
- Android CI 규칙 검사213 PASS. Expo 환경 보존/실제 자식 환경 검사12 PASS; NODE_ENV=production, EXPO_NO_DOTENV=1을 빌드 진입점에 명시했다.
- Android 화면 E2E는 ADB 연결 환경 ERROR/NOT_RUN. 기존 MOTOCAST_S23Plus_API34를 데이터 초기화 없이 cold boot/headless/GUI·명시 포트·serial shell로 시도했지만 adb devices에 등록되지 않았다. tools/test-screen-design.py --serial emulator-5560 --variant s23는 첫 AVD identity 조회에서 ERROR(exit1); 앱 설치·화면 assertion은 NOT_RUN이다. 시작한 에뮬레이터만 종료했고 원래 AVD 데이터와 진단 로그는 보존했다. 연결 복구 후 Preview APK/test APK를 설치하고 s23/small/wide 화면 검사, 화면 재생성·복귀 및 native 기존 회귀를 실행해야 한다.
- 최종 native 검수에서 Expo 의존성의 외부 저장소·개발 overlay 권한 유입을 발견했다. 사용하지 않는 WRITE_EXTERNAL_STORAGE/READ_EXTERNAL_STORAGE/SYSTEM_ALERT_WINDOW를 manifest merge에서 제거하고 두 variant 재빌드/lint/단위검사 PASS. 실제 merged manifest에서 세 권한 부재, shared Activity exported=false 및 cleartext=false를 확인했다. Compose 진입의 launched 상태를 보존해 Activity 재생성 시 중복 실행을 막았으며 실제 재생성 UI 검증은 위 차단에 포함한다.
- 정본 공통 source commit a00f4c514637ed4daeed256b6f6017c919061f3f를 Android에 고정했고 hash/typecheck PASS. native 최종 실행 로그는 verification-logs/shared-ui-verify-permissions.log(BUILD SUCCESS, 각334 PASS)와 shared-ui-screen-attempt.log(ERROR)다. product release 후보는 아직 아니며 versionCode를 소모하지 않았다.
- fixed-head 원격 CI, 연결 Preview, 새 버전 출시·Play 서명/게시·실기기는 NOT_RUN. 제품 버전0.8.1 유지. 기존 배포 승인과 별개로 첫 화면 완료 gate가 아직 충족되지 않았다. 다음 화면 이관 전 native 화면 검증을 끝낸다.

작업 소유 root. 기존 task-owned worktree C:/Users/Public/Documents/ESTsoft/CreatorTemp/motocast-shared-ui-20261002(branch review-shared-release-ui-20261002)와 motocast-play-android-20260930(branch feat/shared-release-ui-20261002)를 재사용했다. 원래 사용자의 dirty workspace는 보존했다. 시작 C: 여유118.5GB, native 양쪽 빌드 후108.2GB. 기존8GB 예산보다 npm/Gradle/C++ cache가 커져16GB로 조정했으며 추가 VM/DB는 없다. 기존 SDK/NDK/JBR/AVD를 재사용하고 프로젝트 npm 의존성만 설치했다. Android verification-logs/shared-ui-* 및 웹 shared-ui-*.log와 CreatorTemp/motocast-shared-ui-full-e2e-20261002에 실행 증거를 보존한다. 진행 중 소스·실패 진단은 보존하며 완료되고 재생성 가능한 산출물만48시간 뒤 처분 검토한다. 자동 삭제하지 않는다.

공식 근거:
- https://docs.expo.dev/versions/latest/ — SDK 호환 표
- https://docs.expo.dev/brownfield/integrated-approach/ — 기존 네이티브 앱에 통합
- https://docs.expo.dev/brownfield/isolated-approach/ — AAR 소비 방식
- https://reactnative.dev/docs/integration-with-existing-apps.html
- https://necolas.github.io/react-native-web/docs/installation/
