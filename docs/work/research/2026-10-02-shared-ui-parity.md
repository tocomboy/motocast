# 웹·앱 동작 일치와 공통 UI 이관

## 목표와 확정 범위

2026-10-02 사용자 요청: 앱 출발 기본값을 웹과 일치시키고, 지도 경유지 확인 팝업에 선택 위치를 표시한다. 홈 로그아웃은 화면 하단에 고정한다. 초대 관리·가입 코드는 폐기하고 사용자 공지는 `업데이트 내역`으로 통일해 짧고 쉬운 문장으로 쓴다.

- 신규 회원은 기존 AUTH-007의 Play 설치 검증을 통과한 앱 Kakao 로그인으로 가입한다. 웹은 기존 활성 회원만 로그인하며, 미가입자에게 앱에서 먼저 가입하라는 안내를 표시한다. 기존 관리자·일반 회원·회수 상태와 데이터를 보존한다. 웹 로그인만으로 회원을 만들지 않는다.
- 웹·앱 기능뿐 아니라 UI 기술도 통일한다. 사용자 선택에 따라 현행 제품의 수정부터 함께 배포하고, React Native/Expo 및 React Native Web 공통 화면으로 단계적 이관을 계속한다. 현재 Kotlin/Compose와 React 화면은 공통 UI 구현 완료가 아니다.
- 지도 제스처 정상 동작은 사용자 보고다. 이번 보고에는 버전/code가 별도로 명시되지 않았으므로 0.7.0/code7 전체 기기 검증 PASS로 확대하지 않는다.
- Production 웹과 Play 내부 배포 승인은 유지한다. 정식 공개와 실기기 잔여 항목은 별도 조건이다.

## 계획과 진행

1. **완료**: 기존 코드·정책 및 Figma 확인, 화면 상태 디자인, 회원 가입 계약·공통 UI 결정 반영.
2. **진행 중**: 웹·앱 화면과 출발 기본값, 초대 코드 폐기, 간결한 업데이트 내역 및 배포 스킬 수정. 출발 기본값 집중 JVM 검사 양쪽 43 PASS; 전체 후보 검사와 구분한다.
3. **대기**: 고정 후보의 자동 검사, DB 권한·기존 회원/회수/미가입·Play 가입 호환성, Preview 실제 검증. 실패·취소·미실행을 분리한다.
4. **대기**: 서버 호환 준비 → 웹 develop→main → Android develop→main 내부 배포. 같은 서비스 버전·각 artifact/readback 및 사용자 설치 안내를 기록한다.
5. **대기**: 공통 UI 첫 수직 기능을 별도 검증 가능한 변경으로 이관하고 로그인·지도·주행의 기존 네이티브 계약을 보존한다.

## 기반과 소유권

- 웹 작업 branch `review-shared-ui-parity-20261002`, develop 기반 `d4d38434c8b0764f4cac64e78f0cf22b6ee05b0b`. review branch에서는 exact-head CI-only/zero-deployment 절차를 적용한다.
- Android branch `feat/shared-ui-parity-20261002`, main 기반 `94f745a47fc77c0df7b8ad60f08232690f4ab655`.
- 이전 공동 출시 0.7.0 근거: [전체화면 지도](2026-10-01-fullscreen-map.md). 이번 작업의 검사로 이전 출시 결과를 덮어쓰지 않는다.
- 기존 migration과 초대·회원 기록은 보존한다. 초대 발급/사용의 실행 권한은 비파괴 변경으로 폐기하고 Play 가입·기존 로그인은 유지한다.
- 사용자 위치·세션·비밀값을 기록하지 않는다. 지도 검증에는 공개 장소만 사용한다.

## 수용과 검증 경계

- 출발 미설정: 현재 시각 이후 가장 가까운 5분 제안, 정확한 경계와 초/밀리초·일/월/연도 전환; 명시값 보존, 적용 시 과거 거절.
- 지도: 확인 팝업에서 선택 좌표의 실제 지도와 임시 표시를 함께 보여 준다. 조회 중/실패에서도 선택 위치를 유지하고 취소·닫기는 코스를 바꾸지 않으며 확정 한 번만 추가한다. 주소가 반환한 다른 좌표를 대신 쓰지 않는다.
- 홈: 내용만 스크롤하고 로그아웃은 안전 영역 위 하단에 고정한다. 작은 화면·큰 글자·가로 화면에서 접근 가능해야 한다.
- 가입: 웹 미가입·회수 계정은 회원 생성/권한 복구 없이 거절. 기존 회원/관리자 정상 로그인. 이전 앱 code7과 신규 후보의 Play 가입·기존 회원 호환성 확인.
- 명칭·버전: 웹/앱 UI는 `업데이트 내역`, 짧은 사용자 변화만 공지. 기술·검증·환경 근거는 출시 기록에 둔다. 과거 공지 버전·날짜·플랫폼 범위 보존.
- 디자인 완료, 자동 검사, 실제 Preview/Production, Play 게시, 사용자 기기 결과를 각각 기록한다.

## 디자인과 후보 구현

- 공통 서비스 후보는 **0.8.0**, Android 후보는 **code8**이다. 2026-10-02 Play Console 모든 App Bundle 6개(code2–7) 및 최대 code7/내부0.7.0 제공을 확인했다. 새 AAB 업로드 직전 API readback과 중복 검증은 별도로 유지한다.
- [Figma G01](https://www.figma.com/design/wVNriNWb1OlF21DVq8rqlJ/MOTOCAST?node-id=214-2077): 준비214:2077 / 조회214:2119 / 오류214:2161 / 하단고정홈214:2203 / 업데이트214:2228 / 웹안내214:2246 / 작은화면216:2143 / 넓은화면216:2191. 디자인 렌더와 design-context screenshot을 코드 작성 전에 확인했다.
- 사용자 추가 요청에 따라 [카카오맵 공식 경유지 안내](https://kakaomap.tistory.com/323)의 추가/위치 표시를 참고했다. ＋ 주황 핀218:2167을 공통 원본으로 사용하고 웹 SVG·Android VectorDrawable은40×48/끝점20,46을 공유한다. 특정 최신 카카오맵 UI를 그대로 복제했다고 주장하지 않는다. Figma 지도 그림은 시안용이며 제품에는 실제 SDK 지도를 사용한다.
- 웹 MapPointConfirmation/KakaoMapCanvas와 Android MapPointConfirmationSheet/MapPointPreview는 주소 응답 좌표 대신 선택 원좌표를 유지한다. 새 SDK 지도를 팝업 생명주기에 연결하고 cancel/close 때 해제한다. 명시 확인 전 코스는 변경하지 않는다.
- 배포 스킬 원본 dev-environment **851c51e9291c63a101d9cabe42a8b5016feb79d2** push 완료. Windows·WSL 적용 검증과 Planned mutations0 확인. 업데이트 내역은 변화별 짧은 사용자 문장으로 작성하고 기술 근거는 출시 기록에 둔다.

## 현재 검사와 미실행

- 웹: npm ci/lint/typecheck/Deno8 PASS, 단위84파일884 PASS. Chromium 첫 실행49 PASS/8 FAIL/기존연결2 SKIP; 실패는 로그인 alert의 Next route-announcer 중복 선택과 폐기된 초대/이전 공지 기대값이었다. 실제 새 사용자 경로로 수정한 영향3파일 재검증31 PASS. 실패 이력 보존; 전체 고정후보 CI는 별도다.
- Android: 두환경 단위334 PASS씩, debug APK 및 instrumentation APK 컴파일 PASS. 첫 lint는 MapPointPreview의 LocalContext 리소스 조회1 ERROR/14 WARNING; LocalResources 사용으로 수정 후 양쪽 lint PASS. 이 수치는 로그인 설정 없는 로컬 debug 검사이며 실제 SDK·Play 가입 PASS가 아니다. 웹 main 고정 후 내장 공지/기준 증거 연결과 최종 후보 검사를 수행한다.
- 실제 로컬 PostgreSQL17.6: 지정 보존 container의 schema+data snapshot SHA256 `61cbab3ae0f192434ddbc0d2c12c3c41eaad85457d24e70d37c0ede78c5c3279` 후 누락 migration9개를 단일 transaction으로 적용했다. reset/DROP/hosted 변경 없음. 역할·RLS·권한·코스·공유·예산·회원·실제 동시성 **563 PASS/0 FAIL/0 SKIP**; 마지막 ACL186 PASS는 반복게이트로 합계에서 중복 제외. Play DB proof/commit 경쟁과 구형 초대동시거절을 포함한다. Google·기기 실제 증명과 구분한다.
- DB 실행 원본/hash/adapter/로그/자원manifest는 저장소 밖 `verification-logs/shared-parity-db-20261002`에 보존한다. 소유 target은 `supabase_db_motocast-production-validation166-202609`/127.0.0.1:55434이며 합성 fixture를 보존한다. 완료48시간 후 처분 검토만 가능하고 자동삭제하지 않는다.
- npm audit: 기존 lockfile의 Next16.3.3에 GHSA-vcvr-r3jv-pc5j, 개발용 brace-expansion에 알려진 취약점2건을 보고했다. 공식 advisory와 실제 소스 검색을 대조한 결과 next/og·ImageResponse 사용이 없고 brace-expansion은 lint 의존성이다. 이번 변경으로 추가된 경로가 없으므로 별도 의존성 보완으로 분리하며 audit0이라고 보고하지 않는다. 현재 기능 후보의 배포 전 보안검수에서 이 범위를 다시 명시한다.
- 실제 Preview/Production 후보, Play code8 게시, 사용자 실기기 검증은 아직 NOT_RUN이다. 사용자 지도 제스처 정상 보고만 별도로 보존한다.


## Preview 적용과 시각 검수 (2026-10-02)

- PR88 exact head `21cdd2b400be0f582897875ea493a95570703c6c`, CI36894380095 SUCCESS: 단위884/Chromium57 PASS, 기존 연결2 SKIP. CI 완료 뒤 GitHub Deployments0/Vercel checks0/statuses0을 확인했다.
- PR 미병합 상태에서 Preview에 source 그대로 `retire_invitation_enrollment`를 적용했다. 관리 도구 기록 version은20261001165655이며 source filename과 다르므로 이름·SQL hash로 결속한다. 기존 회원3/admin1/rider2, profiles3/invitations3/trips23 보존, 회원·프로필·초대 aggregate SHA256 `c83412810edf04741568c890e1a507a2704779fb89426337eaad4365d474c5f7` 전후 일치. 세 역할×세 초대 RPC 모두 실행 불가, invitation SELECT 불가, service-role14 RPC 유지.
- 원격 develop 기반d4d3843 불변 재확인 후 정확히21cdd2b로 fast-forward. Preview `dpl_FxvZ1rroBz5sqBoG85PkwCoTcQUf` READY/alias 일치. 기존 로그인으로 홈·저장 목록·0.8.0 업데이트 내역 표시와 한 번 확인을 관찰했다. 실제 Kakao 공개 장소 검색·좌표 주소 조회도 성공했다.
- 시각 검수에서 웹 미리보기가 공통 map-shell의 absolute 배치를 상속해 제목·주소를 가리는 회귀를 발견했다. 미리보기만 relative/normal flow로 고쳐 기존 지도 배치는 보존한다. 이 후속 후보의 CI와 실제 반응형 검수를 완료하기 전 운영 승격하지 않는다.
- Android 실제 SDK 검사에서 전체화면 Dialog 안에 중첩한 확인 시트가 뒤에 가려지는 기존 구조 문제를 발견했다. 확인 시트를 전체화면 Dialog 다음에 생성하고, 화면 좌표 터치로 확인이 실제 작동하는 검사를 추가했다. 수정 후 실제 SDK 지도·확대·이동·선택·취소·한 번 추가·오류 팝업 검사는 PASS. API 주소/경로는 합성 fixture이며 실제 Play 가입은 아니다.
- Android Compose 홈·업데이트 등 세 크기48단계 PASS, 로그인 UI4단계 PASS. 신규 단위334×2와 최종 native 원본/CI 검증은 구분한다. 기존 지도 getter/팝업 제거 확인의 비동기 관찰 실패와 JRE 설정 빌드 실패는 로그에 보존한다.
- 운영 설정 변경 전 Android PR32→33으로 control revision10/HOLD(CONFIG_CHANGE)를 main `98498a75b5dde6428d08a777e1625a007213e4d2`에 반영했다. epoch3 및 code7 원본은 보존한다. Main CI·실행 drain 확인 전 Production 설정 변경은 하지 않는다.
