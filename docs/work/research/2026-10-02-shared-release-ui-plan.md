# 공통 UI 첫 이관 실행 계획 — 업데이트 내역

정본 작업 기록: docs/work/research/2026-10-02-shared-ui-parity.md. SCOPE-003 사용자 결정에 따라 0.8.0 현행 웹·앱 공동 배포를 먼저 마친 후 이관한다. 이 문서는 실행 설계이며 구현/운영 반영 완료가 아니다.

## 첫 수직 기능과 완료 조건

하나의 TypeScript React Native `ReleaseHistory`가 버전·날짜·제목·요약·항목을 렌더한다. 웹은 React Native Web으로, Android는 기존 앱 안의 Expo/React Native 화면으로 같은 소스를 사용한다. 기존 Figma 업데이트214:2228의 색상/글꼴/간격과 웹 반응형 표현을 유지하며 새 구성 변경은 Figma부터 갱신한다.

기존 진입 버튼·홈 복귀·뒤로가기·닫기·스크롤·큰 글자·320/384/820/1440폭을 검증한다. 최초 공지의 계정/버전별 읽음 처리는 기존 controller/server가 소유하고 공통 뷰에 세션·토큰을 전달하지 않는다. 초기 이관은 사용자가 여는 전체 업데이트 내역 화면만 바꾼다. 실제 앱 재시작/백그라운드 주행 복귀·보안 저장소·Kakao/App Links·지도는 기존 구현과 회귀 검증을 유지한다.

## 소스와 소비 경계

웹·서버 저장소의 `packages/shared-ui`를 공통 화면 소스 정본으로 둔다. 웹은 로컬 workspace를 소비하고 Android는 검토된 동일 소스 revision과 hash로 고정한 package를 소비한다. 두 저장소의 CI 권한과 WIF 신뢰를 한꺼번에 변경하지 않는다. 앱 저장소의 vendored package 또는 private package 전달 경로는 재현 가능성과 추가 인증 필요 여부를 실제 비교한 후 선택한다. 복사본을 수동으로 따로 수정하지 않는다.

공지 데이터의 정본은 웹 `lib/releases.ts`와 `package.json`이다. 플랫폼 한정 과거 공지는 현재처럼 범위를 보존한다. 공통 화면 변경은 양쪽 검사/버전/공지/배포 확인을 한 출시 기록에 결속하며 웹-only 커밋으로 Play를 자동 게시하지 않는다.

## 공식 호환성 조사와 구현 순서

2026-10-02 공식 Expo SDK 표에서 SDK57은 React Native0.86, React19.2.3, RNWeb0.21 계열을 대상으로 한다. 현재 웹 React19.2.8/Node24, Android compileSDK36과 대조했다. npm 최신 React Native0.87을 임의로 섞지 않는다. 실제 설치 전 Expo57의 bundledNativeModules 권장값과 lockfile을 고정한다.

1. 순수 공통 화면 package와 native/web adapter를 작성한다. 기존 폰트·Figma 상태 및 접근성 역할을 사용한다.
2. 별도 검증 경로에서 RNWeb의 실제 렌더/SSR·hydration과 Android 기존 앱 내 ReactActivity 또는 Fragment 수명주기를 검증한다. Expo integrated 방식과 AAR isolated 방식은 현행 Gradle/CI를 실제 빌드해 비교한다. 불필요한 EAS·OTA 계정/공개 registry·새 배포 권한을 추가하지 않는다.
3. 검증된 한 경로를 현행 업데이트 화면에 연결하고 전체 기존 인증·지도·주행 진입 회귀를 수행한다. 보이지 않는 fallback으로 구현 실패를 가리지 않는다.
4. 양쪽 fixed-head CI·Preview·운영 호환/버전/공지·Play 동일 artifact 절차를 통과한 공동 후보로 승격한다. 실기기/공개 트랙은 별도 gate다.
5. 첫 화면이 완료되면 출발 일정/확인창/홈 순으로 동일한 사용자 동작 단위로 이관한다. 지도와 주행 네이티브 모듈은 후속 별도 실패 경계를 갖는다.

## 현재 증거와 자원

공식 문서/현재 package metadata 조사는 완료했고 공통 RN 화면 실행·이관은 NOT_RUN이다. 0.8.0의 현행 Compose/React 동작 검증을 공통 UI 검증으로 재사용하지 않는다.

작업 소유 root, branch feat/shared-release-ui-20261002, 기반 웹 main88ecefae. task-owned worktree 이름 motocast-shared-ui-20261002, 생성2026-10-02 KST. 생성 시 C: 여유 약95GB. 공통 UI 의존성/빌드 추가 예산8GB, 기존 AVD/SDK 재사용; 새 VM/DB 없음. 진행 중 소스는 보존하고 완료·재생성 가능 산출물만48시간 후 처분 검토한다. 자동 삭제하지 않는다.

공식 근거:
- https://docs.expo.dev/versions/latest/ — SDK 호환 표
- https://docs.expo.dev/brownfield/integrated-approach/ — 기존 네이티브 앱에 통합
- https://docs.expo.dev/brownfield/isolated-approach/ — AAR 소비 방식
- https://reactnative.dev/docs/integration-with-existing-apps.html
- https://necolas.github.io/react-native-web/docs/installation/

