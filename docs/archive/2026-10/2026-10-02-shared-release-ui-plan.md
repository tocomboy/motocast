# 공통 UI 첫 이관 실행 계획 — 업데이트 내역

현재 실행 정본은 이 문서다. 앞선 공동 배포는 docs/archive/2026-10/2026-10-02-shared-ui-parity.md에 보존한다. SCOPE-003·UI-001에 따라 첫 공통 화면과 즐겨찾기·뒤로가기 변경의0.9.0 공동 출시를 진행한다. 최종 후보 검증·병합·운영 반영 상태는 아래 최신 기록에서 구분한다.

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

### 2026-10-02 0.9.0 웹 운영 반영·Android 고정 후보 검증

웹 후보 `30449f274f36827d0fd481498ce663437ddbc263`는 PR97/정확한 head CI36970203660 SUCCESS와 해당 SHA의 배포0건을 확인한 뒤 develop을 같은 SHA로 fast-forward했다. Preview `dpl_BjAt6KurjZBhhKGfUybp4HqugKMf` READY, PR98의 verify/develop-only/Vercel PASS 후 운영 main `7df5b96fb120d14d31ec911c06180954f8031a01`으로 병합했다. main CI36971039099 SUCCESS, Production `dpl_9JfteBiNGd9nUakorNFaKFnmFv82` READY 및 GitHub deployment6802284402의 SHA/URL/status success가 일치한다.

Preview와 Production의 기존 회원 세션에서 실제 장소 검색, 즐겨찾기 중앙 확인/취소/X/ESC, 확인1회 추가·삭제, 재접속을 검증했다. 초기 목록에 없던 공개 장소만 검증용으로 추가하고 삭제해1→2→1 및 기존 항목 보존을 확인했다. 계정별0.9.0공지·확인 후 재표시 없음, 업데이트16개·footer 일치, HTTP200/설정된 보안 헤더 PASS이며 runtime-error 조회는 없음이다.320·384·820·1440폭의 팝업 중앙/글자/동작 버튼/가로 overflow0을 직접 확인했다. 경로 검색에는 조회·선택만 있고 관리 쓰기는 없다. 실제 사용자 장소명·세션·token은 기록하지 않는다.

Android 기능 commit `1d3e809`에 이전 main의 merge 이력만 포함한 고정 후보 `21f7a2814ebd4290c5954c8b09c6a35611cdfbe3`는 제품 tree가 동일하다. PR42의 정확한 head CI36974443601 SUCCESS 후 develop6dcd4db로 병합했다. PR43의 CI36976156685 SUCCESS 및 제품 tree 일치를 확인하고 main77c70175로 승격했다. 이 HOLD main의 병합 후 CI36977518220도 SUCCESS이며 배포만 BASELINE_NOT_CONFIGURED에 따른 expected SKIP이다. 입력해시 `e32581f3f3782fb19bdb6967491148f7feb831158867f6c62334eba2d7bb4cd6`,0.9.0/code10, 내장16개 공지의 출처는 실제 웹 main7df5b96이다.

두 Android 환경 각347단위 PASS(실패/오류/생략0), APK/testAPK/lint/공통 UI typecheck 및 실제 merged manifest PASS. 기존 lint warning24/error0다. 동일 제품 APK의 실제 UI는384·320/글자1.3·820 각28 PASS, 실제 Kakao SDK 지도 제스처24/전체화면15씩 PASS다. 마지막 검사 helper 보완 뒤 wide15·작은 가로 화면의 실제 스크롤19 PASS를 확인했다. 메인이 작은/넓은 화면의 확인 팝업 PNG를 직접 검수했다. 제품 APK SHA `92814d2bdd51b324c3dad57564d721d76debe1cac39aacad3e4c96dba43dc976`, 최종 testAPK local/install SHA `cab7d9f79205102f7699bfebe380531a6d5a648145fec86fe79a2a856daa7867`이 일치한다.

중간 FAIL을 보존했다. 빠른 동일 목록 재조회가 StateFlow 중간값을 생략하는 문제는 owner revision을 관찰 상태에 포함하고 확인 시 다시 검사해 해결했다. RN의 x86 ABI 추가가 ARM 전용 Kakao Map 초기화를 깨뜨린 문제는 SDK 공통 ARMv7/ARM64로 정렬했다. ARM 번역 에뮬레이터의 SoLoader 문제는 debug JNI 추출에만 적용하며 release/AAB 패키징·16KB·서명 검사를 유지했다. 지도 검사의 가로 화면/스크롤 존재 가정은 실제 viewport 포함 판정으로 고쳤고, 화면 밖 접근성 노드 부재는 스크롤 필요로 처리한 후 기존48dp/가시성/스크롤 성공 단언을 유지했다. 검사 완화·skip으로 실패를 숨기지 않았다.

검증 자원: 기존 AVD 이름·소유권과1080×2340/450dpi/font1.0 복원을 메인이 읽어 확인한 뒤 emulator-5680만 종료했다. SDK/VM/DB 추가 설치 없이 기존 환경을 재사용했고 npm11.19.0은 사용자 cache에서 사용했다. task worktree와 실패/최종 로그·PNG는 보존하며 완료 후48시간 처분 검토만 가능하다. 물리 ARM 기기·실제 Play 신규 가입·OS App Links·정식 공개는 NOT_RUN이다. 공통 UI는 업데이트 첫 화면 이관 완료 범위이며 전체 화면 이관 완료가 아니다.

Android HOLD main과 배포 없음이 확인된 뒤 Production의 기존 PLAY_ADMISSION_VERSIONS에 code10만 추가했다. 2026-10-02T07:15:58Z 저장 후 새로 읽은 digest e363a359a4879c5f031d75fe96ea0ef31ff006037232c0d3bcf87404caf9e5ea가 일치한다. 관찰 run36977733932 SUCCESS/artifact11214495544에서 migration21개·function8개 본문/JWT 불변과 운영 웹 출처47개 hash를 확인했다. 공개 assetlinks는 별도 HTTPS200/no redirect/기대 서명 지문 PASS이며 hash a1efb05f1384d4acc8cdadbed4d5f8c9a4d16b32aac8fa030ccc5004f8e822d9다.

새 baseline680624f39a370ce7595652dd00d944008fcb4b09e8bdebb917f62d79c77f9edd와 ACTIVE revision17/config_epoch6만 PR44/45로 검증·병합했다. CI36978243986·36978425976 SUCCESS이며 최종 Android main은527fd2cd95e21ccea1742756ccd29fc106dedd92다. 최종 main CI36978580101의 필수 검사·live readiness·서명·내부 게시 모두 SUCCESS다. 2026-10-02T08:01:15Z Play internal VERIFIED, code10/0.9.0 completed를 새 API readback으로 확인했다. Play Console 새로고침에서도 code10 활성·최신0.9.0·내부 테스터에게 제공됨(17:01 KST)을 확인했다. 원본 artifact11216345121과 receipt11216235624를 private 보관했다. AAB53737259 bytes/SHA256 f5279e3ee8f79bd0f73979db6c7d6a7fcf1303e59ee379dd2ea8f3893413adce가 Play bundle·receipt와 일치한다. 내장16개 공지/최신0.9.0/웹 main7df5b96·한국어 게시 문구·ARMv7/ARM64만 포함·서명/16KB 검사 PASS다. 공개 트랙은 게시하지 않았다. 원본과 upload/commit intent·receipt는 C:/Users/User/AppData/Local/MOTOCAST-PrivateReleases/code10-527fd2cd-36978580101에 최소2027-01-01 및 출시/복구 완료까지 보존하며 자동 삭제하지 않는다.

웹 v0.9.0 tag와 GitHub Release를 검증된 실제 운영 main7df5b96에 게시했고 API로 태그 대상·공개 상태를 재확인했다. 새 제품 버전을 추가하지 않는다.

이번 작업의 검증 자료615개/205537620 bytes를 C:/Users/User/AppData/Local/MOTOCAST-PrivateReleases/ui090-validation-20261002로 복사하고 파일별 SHA256 readback PASS를 확인했다. manifest.json에 기존 Android/web worktree 경로와 대응 파일을 기록했다. 사용자 원본 dirty checkout은 보존한다. 병합 후 필수 검사와 후속 기반을 확인한 웹 review-shared-release-ui-20261002 및 앱 feat/shared-release-ui-20261002의 로컬/원격 브랜치는 정리했다. 남은 release/code10-readiness-20261002, 기록용 review-ui090-release-evidence-20261002와 두 일반 task worktree는 최종 증거 보관·기록 PR 병합 후 안전한 Git 제거 대상으로 둔다. 보존 자료와 사용자 원본 dirty 작업 공간은 삭제하지 않는다.

### 2026-10-02 즐겨찾기·복귀 동작과 공동 0.9.0 후보

사용자는 앱 홈 버튼 제거, 화면/휴대폰 뒤로가기, 팝업 X 닫기, 장소 검색과 즐겨찾기 관리 분리 및 이번 병합·배포까지 병렬 진행을 승인했다. UI-001에 동작을 확정했고 메인은 통합·검수·출시, 웹/Android 작업자는 겹치지 않는 플랫폼 UI와 회귀 검사를 소유한다. 기존 dirty 사용자 workspace는 보존한다.

기존 Figma의 Noto Sans KR·색상 변수·버튼과 장소 카드를 재사용해 코드 수정 전에 [H01–H08](https://www.figma.com/design/wVNriNWb1OlF21DVq8rqlJ?node-id=226-2209)을 디자인하고 렌더를 확인했다. 대응: 관리227:2211, 추가 검색227:2242, 선택 전용227:2273, 업데이트 뒤로227:2305, 팝업 X227:2330, 빈 상태227:2390, 불명확/실패227:2408, 320폭/큰 글자227:2425. 디자인 확인은 실제 앱 검증과 구분한다.

호환되는 즐겨찾기 관리 기능 추가로 공동 버전0.9.0을 선택했다. 웹 package/lock/lib/releases를 함께 변경하고 과거15개 소식을 보존한다. Play Console 모든 번들8개를 읽어 현재 최대code9/0.8.1 활성임을 확인했으므로 새 후보code10을 선택했다. 이 조회는 새 업로드를 뜻하지 않는다. Android 공지는 검증된 웹 commit으로 결속하고 운영 웹 승격 후 실제 main 출처로 갱신한다.

추가 사용자 결정: 즐겨찾기 추가·삭제는 중앙 작은 확인 팝업에서 한 번 더 확인한다. [H09/H10](https://www.figma.com/design/wVNriNWb1OlF21DVq8rqlJ?node-id=231-2284) 추가231:2285/삭제231:2323을 기존 버튼·색상·서체로 디자인하고 렌더 검수했다. 확인 전 요청0, 취소/X/ESC/OS뒤로 변경0, 확인1회만 mutation과 작은 폭/큰 글자·포커스 복귀를 검사한다. 캡처 motocast-favorite-confirm-design-20261002.png에 대상 장소명·중앙 배치·취소/확인·X를 확인했다.

기존 웹0ca7c7d의 CI36965973277은 SUCCESS(단위886·LOCAL_UI61 PASS/연결전용2 expected SKIP). Android7e76beb의 최초CI36965587753은 PR 설명 수정이 edited 이벤트를 발생시켜 취소됐고 Required FAIL이다. 같은head 재시작36966792582도 두환경 빌드·단위 뒤 Production lint 단계에서20분 job 제한으로 취소됐다. Android job만40분으로 변경하고 검사목록·assertion·필수집계는 유지했다. 새로운 기능 후보의 최종 검증을 이 과거 결과로 대체하지 않는다.

승격 순서: 변경별 로컬/실제 UI 검사와 최종 CI → 정확한 웹 develop Preview 및 연결 동작 → 웹 Production → Android main HOLD 확인과 code10 운영 준비 → 새 baseline의 실제 main CI/CD → 같은 원본 AAB와 Play 내부 트랙 readback. 공개 Play·실기기·실제 신규가입의 기존 별도 조건은 유지한다. 이하 후보 준비 시점에는 병합·배포 NOT_RUN이었으며 최신 반영 상태는 위 고정 후보/운영 기록을 따른다.

웹 최종 기능 검증: npm11.19.0 ci, lint, typecheck, Deno8, Chromium 설치 PASS. 단위86 files/900 PASS, fresh production server의 전체 LOCAL_UI63 PASS/연결 전용2 expected SKIP. 모바일 등록 X의 기존 CSS 가림, 중복 접근성 이름, modal close 이전 포커스 복귀 실패를 수정하고 동일 사용자 경로를 재검증했다. 확인/취소/X/ESC·stale owner·중복 확인 회귀 PASS. 연결 후보의 실제 중앙 팝업 렌더와 서버 저장/삭제는 Preview 승격 후 검증한다. 증거는 외부 motocast-web-favorites-verification-20261002 폴더에 보존한다.

메인 변경 검수: 즐겨찾기 기존 RPC·최대3·owner/조회세대·결과불명 재조회 계약을 유지하고 검색 선택 경로에서 쓰기 진입을 제거했다. 새 확인창은 대상 snapshot을 검증하고 취소 시 쓰기0, 확인 중 중복0이다. Android 화면/OS 뒤로가기와 공유 링크 회수 후 목록 실패의 상태 보존을 대조했다. 현재 UI 회귀를 차단하는 미해결 코드 finding은 없으며 실제 화면 결과는 별도로 기록한다.

의존성 감사의 기존 Next16.3.3 advisory GHSA-vcvr-r3jv-pc5j 및 dev brace-expansion 경고는 보존한다. 공식 Next advisory의 Node ImageResponse/next/og SVG 경로를 app/components/lib/packages에서 검색했으나 사용0, production 의존성의 brace-expansion0을 확인했다. 이번 변경은 해당 버전을 바꾸지 않으며 기존 독립 의존성 후속 범위를 유지한다. audit 경고0이나 전체 보안 완료로 보고하지 않는다.

Android 새 UI의 두 variant 단위 각346 PASS, 양쪽 APK/lint/instrumentation Kotlin/typecheck PASS. 실제 s23 첫 실행에서 추가·삭제 확인/취소/X/OS뒤로·owner교체/불명결과 재조회11단계 PASS 후 요청 중 뒤로가기 fixture에서 NoSuchElementException이 나와 원인을 수정 중이다. 해당 실행은 FAIL이며 앞선 단위 결과로 대체하지 않는다. C: 여유93.2GiB를 확인했고 이번 native/RN 산출물 보존 예산을24GiB로 조정하며 여유80GiB를 유지한다. 기존 소유 AVD emulator-5680을 재사용하며 새 VM/DB는 만들지 않는다.

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
