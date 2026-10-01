# 지도 전체화면과 웹·앱 동시 출시 — 2026-10-01

## 목표·범위
웹과 Android의 기존 지도 확대·이동·경유지 확인 기능을 보존하며 전체화면 진입·종료를 추가한다. 읽기 전용 공유 지도도 전체화면을 지원하되 수정 권한을 추가하지 않는다. 서비스 버전과 업데이트 소식·기능 동시 출시를 프로젝트 규범에 기록한다. 스택 전환은 비교·제안 범위이며 이번에 제품을 재작성하지 않는다.

## 순서와 진행
1. [완료] 최신 코드·배포 비교, Figma 선행 디자인과 공통 동작 계약.
2. [완료] 웹·Android 구현 및 실제 실패 경계 검증, 프로젝트 규범과 기술 선택 제안.
3. [결과 연결] 웹 Production 및 준비 증거 확인 완료. Android main CI·Play 내부 배포와 readback의 최종 실행 상태는 [승격 PR31](https://github.com/tocomboy/motocast-android/pull/31)의 배포 근거가 소유한다.
4. [별도 검증] 버전·업데이트 소식·결과물 대조와 설치 안내는 승격 PR31에 연결한다. 사용자 실기기 결과와 정식 공개는 별도 조건을 유지한다.

## 수용 기준
- 전체화면에서 확대·이동·확인 후 경유지 추가; 취소는 코스 변경 없음.
- 진입/종료에서 지도 카메라·코스·스크롤 보존; 닫기, 웹 Escape, Android 뒤로가기 지원.
- 확인창이 지도 위에 보이고 먼저 닫힘; 읽기 전용 지도에 쓰기 기능 없음.
- 320/384/390/820/1440 폭과 큰 글자, 가로 화면, 로딩/오류의 닫기 접근성.
- 자동검사·실서비스·Play 게시·실기기 결과 분리.

## 기준 상태
웹 Production 0.6.0 main 2e831737ab0c89e420620206109fad0e9fc9db3f; develop 53a76b4c0da6c2379709adc8e4220fd902587ce4. Android 최신 main b00fd03c44d355862fdbb4ec18de61ae17a076ca; 배포 원본 0.6.0/code6 c1a4d5992c16e40e4cf4483c5da78993cde7fdba. 기존 코드6 원본 재배포·재서명 금지.

## 디자인
기존 Figma wVNriNWb1OlF21DVq8rqlJ / Android · S23+ 페이지에 F01–F06 (204:2023–204:2028). 기존 Noto Sans KR·MOTOCAST 색상 토큰·버튼 인스턴스 재사용. 지도 이미지는 동적 SDK 영역을 나타내는 예시.

## 개발 구조 선택 제안 (결정 전)

현재 웹은 Next.js 16/React 19/TypeScript, Android는 Kotlin/Jetpack Compose와 Kakao MapView다. 서버·데이터 모델은 이미 Supabase Edge Functions와 공통 계약으로 공유한다. UI만 같은 언어로 바꿔도 Play Integrity·Kakao native 로그인·백그라운드 위치/주행·App Links·앱 저장소의 플랫폼 검증은 남는다.

| 방법 | 공유되는 것 | 기존 제품에 필요한 일 | 판단 |
| --- | --- | --- | --- |
| 현재 스택 유지 + 공통 계약/디자인/출시 | 서버 API·오류 코드·Figma 토큰/상태·동일 시나리오 fixture·공지 정본 | 두 UI 구현은 유지, 양쪽 체크리스트/PR 연결 | 이번 작업 권장. 이미 검증한 인증/주행과 배포를 보존하면서 누락을 줄임 |
| React Native + Expo + React Native Web | TypeScript 도메인 코드와 상당수 화면 컴포넌트 | Compose 화면 이관, DOM 기반 Next 화면 일부 재작성, Kakao 지도/native 로그인·Integrity·주행을 native module로 연결, 데이터/세션/성능 회귀 검증 | 장기적으로 같은 스택을 원할 때 우선 검토할 후보. 기존 코드가 설정만으로 공용화되지는 않음 |
| 웹 React + Capacitor | 기존 웹 화면·CSS·TypeScript 재사용 범위 큼 | Next 서버/API는 별도 유지, 앱용 웹 번들/라우팅 조정, 네이티브 플러그인으로 위치·알림·인증·Integrity 연결, 지도 제스처와 백그라운드 주행 검증 | 웹 중심 앱이면 유리하지만 현재 지속 주행 기능 때문에 먼저 작은 실증이 필요 |

권장 순서: 이번 전체화면 기능은 기존 스택으로 공동 출시한다. 이후 공통 API schema/fixture·디자인 토큰과 업데이트 소식의 단일 원본을 확장하고, 정말 UI 코드 공유가 필요한지 중복 수정 사례로 판단한다. 통일을 선택한다면 읽기 전용 코스 요약·지도 한 화면부터 Expo 시제품으로 기존 Kakao MapView/인증과 공존 가능한지 확인한다. 핵심 계정·주행·Play 인증·저장 데이터의 회귀 검사와 복귀 경로를 확보한 뒤 단계적으로 이전한다. 모노레포는 PR/공통 파일 원자성에는 도움이 되지만 서로 다른 SDK·언어의 UI를 자동으로 공유하지 않으며 현재 WIF/CI 저장소 식별자를 바꾸므로 별도 이관 작업이다.

공식 근거(2026-10-01 확인): [Expo 웹/React Native Web](https://docs.expo.dev/workflow/web/), [Expo Kotlin/Swift native modules](https://docs.expo.dev/modules/overview/), [Capacitor runtime/plugins](https://capacitorjs.com/docs), [Kakao 플랫폼별 지도 SDK](https://developers.kakao.com/docs/ko/kakaomap/common). 위 제품 적합성은 현재 MOTOCAST 코드를 대조한 제안이며 실제 이관 기간·성능·비용은 미측정이다. 스택 변경은 아직 사용자 결정이나 구현 완료가 아니다.

## 후보·변경 검토
- 공동 기능 버전 0.7.0(호환 기능 추가), Android code7. 2026-10-01 Play Console의 전체 최신 트랙과 번들 목록2–6에서 최대6을 확인했다. 업로드 직전 API가 다시 전체 트랙/번들을 검사한다. 내장 소식의 웹 source SHA는 운영 승격 후 최종 Android 후보에 결속한다.
- Android 설정 대기 [PR28](https://github.com/tocomboy/motocast-android/pull/28) c1901a09 / CI36874600809 SUCCESS → develop4b604e58. [PR29](https://github.com/tocomboy/motocast-android/pull/29) CI36875014145 SUCCESS → main4d13231a42f37834ebffbbdb9a358e960a392498. 병합 후36875350928 SUCCESS, 배포는 HOLD에 따른 명시 SKIP. 대기/실행 중 배포0 확인 후 설정 변경했다.
- Production `PLAY_ADMISSION_VERSIONS=5,6,7` 등록/readback 2026-10-01T14:25:22Z, SHA256 `9988e8a737dd629d5014a04ec3c0b97444416bb63e48f3ab7aa4da48a3aeb569` 일치. 기존 인증서·계정·권한·데이터는 변경하지 않았다. 새 함수 metadata와 웹 배포는 후속 관리 API 관찰로 검증한다.
- 기존 운영 DB/함수/인증 코드는 이번 지도 UI 변경에 포함하지 않는다. 기존 실제 서버 검증은 변경되지 않은 범위에서만 재사용하고 새 웹 SHA·Play 허용code 설정·앱 입력 hash는 별도로 검토한다.
- 디자인: F07 기본 지도 전체화면 진입207:2065, F01 204:2023과 F04 204:2026 렌더 PASS. F03 오류 안내206:2112는 실패 시 조작 안내를 제거했다. SDK 지도는 동적 데이터 영역이다.
- 보존 자원: 기존 서버/Android 작업공간 재사용. 별도 HOLD checkout `motocast-code7-hold-20261001`은 이 작업 소유, 약100.7GB 여유 확인 후 생성, 배포 통제 이력 재현 목적으로 보존. 병합·증거 정리 완료48시간 후 처분 검토; 자동 삭제 없음.

## 검증·검수
- 웹 집중 단위41 PASS, 전체887 PASS. 전체 타입 검사에서 테스트의 `ReactTestRenderer` props unknown 오류 발견·명시 타입으로 수정 후 PASS. lint, Deno8 함수 검사 PASS.
- 전체 브라우저 첫 실행53 PASS/3 FAIL/기존 연결2 SKIP. 실패3개는 최신 공지에 이전0.6 문구와 총12개 이력을 기대하던 assertion이었다. 새0.7 문구·13개 이력으로 대조하고 이전 소식 검증은 보존했다. 영향받은 공지5개 재검사 PASS; 변경 없는51개 통과 근거 재사용, 최종56 PASS/기존 연결2 SKIP. build/lint/typecheck/diff check PASS. CI는 고정 후보에서 전체 실행한다.
- 웹 메인 검수: 동일 DOM/SDK 객체와 카메라 보존, native modal의 확인창 우선순위·초점·스크롤, 지도 로딩/오류·읽기 전용 상태를 확인했다. 인증·서버 API·DB/예산 변경 없음. 실제 SDK 및 연결 사용자 동작은 Preview 배포 후 확인해야 하며 모의 검사로 대신하지 않는다.
- Android JVM 각341 PASS, lint0 ERROR/14 WARNING, instrumentation APK 컴파일 PASS. 실제 SDK 에뮬레이터에서는 지도 렌더링과 테스트 접근성 관찰을 구분해 실패를 진단 중이다. 실기기는 NOT_RUN.

## Preview에서 발견한 필수 보완
- PR84 `a107f316949c96c033d7676990dd650142bf36dd` CI36876718637 SUCCESS, 완료 후 Deployments0/Vercel checks0/statuses0 확인. 동일 SHA를 develop에 fast-forward했고 Preview `dpl_HJ4WXzA8S1zR3VM5Ksu5XkoZHCpN` READY, GitHub Deployment6786984989와 일치한다. develop CI36877106778 및 PR85 CI36877242665/develop-only36877242884 PASS.
- 실제 로그인된 Preview에서0.7 공지·버전, Kakao 장소 검색, 전체화면, 이동/확대(30m→20m), 주소 확인, Escape가 확인창만 닫음, 지도 닫기/재진입 후20m와 동일 중심 주소 보존, 명시 확인1개추가 PASS. 초안만 사용하며 저장/공유 데이터는 변경하지 않았다. 웹 실제 길게 누르기 지속시간 입력은 NOT_RUN; 기존 단위 및 Android SDK 검사와 구분한다.
- 추가 후 하나의 `.map-canvas` 안에 축척/로고2개가 누적되는 기존 생명주기 결함을 확인했다. 기반53a76b4부터 geometry 변경마다 같은 컨테이너에 새 Map을 만들고 참조만 비우는 구조다. 이번 필수 경유지 추가 동작의 선행 결함으로 분류하고 PR85 운영 승격을 보류했다. 지도 하나를 유지하고 기존 마커/선을 공식 `setMap(null)`로 정리하는 최소 보완 후 새 exact-head CI-only 및 실제 Preview 검증을 진행한다.
- 브라우저 viewport override가 실제1280×720 화면에 적용되지 않아 해당 호출을384폭 검사 PASS로 기록하지 않는다. 320/384/390/820/1440 및 가로/큰 글자 자동 브라우저 검사는 별도 PASS다.
- 보완은 컨테이너당 Map 하나를 유지하며 geometry 변경/실패/언마운트 때 마커·선을 제거한다. SDK 정리에 실패하면 오류와 비활성 상태를 유지한다. 공식 [Marker.setMap](https://apis.map.kakao.com/web/documentation/#Marker_setMap)·[Polyline.setMap](https://apis.map.kakao.com/web/documentation/#Polyline_setMap) 대조 완료. 집중45/전체891/Chromium56 PASS, 기존 연결2 SKIP. lint/typecheck PASS; npm ci/Deno8은 변경되지 않은 lockfile·서버 범위의 앞선 PASS 재사용. 전체화면·빈 지도·지연 콜백·Strict Mode·부분 실패·언마운트 경계 검수 BLOCKER0/HIGH0.


## 2026-10-02 최종 후보와 운영 확인

앞선 보류·실패 기록은 발견 시점의 이력이며 아래 재검증 결과와 구분한다.

- 웹 PR86 `9e228fc5815d63e5f0769d092344791177da9680` CI36879201719 SUCCESS 뒤 Deployments0/Vercel checks0/statuses0 확인. 동일 develop Preview `dpl_GhYy36aQ8ay65E8gafnguuVZwWJv`에서 실제 경유지 2개 추가 후 지도/로고 하나 유지 PASS.
- 웹 PR85 정상 승격 main `b29dd215c73e48bad090990dd6c88f99a28bee75`, CI36880151029 SUCCESS, 검토 후보와 tree 동일. Production `dpl_8eCJjbPp5hB4nQdekGiu7r5evHZJ` READY 및 alias/source 일치. HTTP200/no redirect, 공지·버전0.7.0 일치. 기존 운영 관리자 세션에서 실제 타일·확대/이동·주소 조회·확인창 취소/명시추가·닫기/재열기 PASS. 초안만 사용해 기존 저장 데이터는 변경하지 않았다. [운영 readback 근거](https://github.com/tocomboy/motocast/pull/85#issuecomment-5934240508).
- Android [PR30](https://github.com/tocomboy/motocast-android/pull/30) `ad391af870d752cb1239b33ea97f5e6f9a327745`: 동일0.7.0/code7, 웹 main의 업데이트 소식13개 내장. JVM 각341/자동화207/문서52 PASS, lint 각0 errors/14 warnings. 실제 SDK 에뮬레이터 fullscreen 동일 MapView/camera·pan/zoom/terrain-longpress·center·확인 후 추가·취소/뒤로·lifecycle·readonly/unavailable PASS. 320dp 글자150% 및832×384 가로 화면 PASS.
- 에뮬레이터 run7 마지막 접근성 버튼 FAIL을 보존하고 창 전환 경계 분리 run8 PASS. run10은 세로용 지도 높이 가정 FAIL이며 세로 높이 확대 조건을 유지하고 가로는 실제 조작·nonzero 영역·화면 내48dp버튼으로 수정해 run11 PASS. timeout 확대/skip 없음. readonly 캡처의 빈 타일은 layout/편집불가 검증으로만 한정한다. 실제 SDK 오류/retry·실제 서버 왕복·사용자 실기기는 NOT_RUN.
- HOLD revision8 적용과 실행 종료 확인 후 운영 `PLAY_ADMISSION_VERSIONS=5,6,7` 등록/readback(2026-10-01T14:25:22Z), digest `9988e8a737dd629d5014a04ec3c0b97444416bb63e48f3ab7aa4da48a3aeb569`. 기존5/6 보존. Observation36880182764 SUCCESS: 운영 project/웹 배포, migration20/함수8의 내용·JWT·소스 해시 기존과 동일, 함수metadata version만+1. epoch3/revision9 ACTIVE 후보는 새 앱 입력·웹 배포에 결속한다.
- 기존 API/DB/권한/경로·날씨·공유 검증은 변경 없는 범위만 재사용한다. 이번 UI 검증은 일반/회수/신규초대 웹 계정·실제 Play 신규가입/native·OS App Links/기기 검증을 대신하지 않는다. 웹 tag/Release와 정식 Play 공개는 해당 미완료 gate를 유지한다.
- 보존 자원: 에뮬레이터 화면설정1080×2340/450dpi/font1.0 복원 PASS. 실패/최종 캡처·로그 약5.9MB 보존; 종료48시간 뒤 처분 검토하며 자동 삭제하지 않는다. 신규 SDK/AVD 설치 없음.

- Android PR30 exact-head CI36881635680 SUCCESS, 정상 병합 develop `59849660862d7f5edfb576024ce31afa258d3974`, tree 동일. [승격 PR31](https://github.com/tocomboy/motocast-android/pull/31)은 실제 main CI와 Play 내부 트랙·원본 AAB·공지 readback, 설치 안내·사용자 결과의 실행 근거를 소유한다. 이 문서 갱신 시점에는 승격 CI 진행 중이므로 Play code7 성공으로 기록하지 않는다. 웹 운영 SHA는 문서 기록 갱신만으로 바꾸지 않는다.
