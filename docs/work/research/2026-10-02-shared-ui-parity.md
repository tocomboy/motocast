# 웹·앱 동작 일치와 공통 UI 이관

## 후속: E2E 직접 실행과 로그아웃 배치 정정

2026-10-02 사용자 요청으로 아래 0.8.0의 "안전 영역 위 하단 고정" 수용 기준은 재검토 상태다. 고정 배치를 원하지 않는다는 지시는 확정됐고, 홈 내용 끝에서 함께 스크롤할지 다른 고정 위치인지 확인 중이다. 배치 확정 → 기존 Figma 수정·렌더 검수 → 앱 수정 → 실제 스크롤/터치 E2E 순서로 진행한다. 답변 전 새 배치 구현·배포 완료를 주장하지 않는다.

독립 변경: 직접 실행 가능한 E2E를 에이전트가 수행하도록 양쪽 AGENTS와 검증 정본에 반영하고 저장소별 `.agents/skills/motocast-web-e2e` / `motocast-android-e2e`를 추가했다. 정책 정본은 웹 검증 문서 하나이며 각 스킬은 해당 플랫폼의 기존 실행기를 안내한다. 전역 설정·모델·사용자 세션을 변경하지 않는다. Android의 SKILL.md는 docs 경로로 검사하며 미등록 실행 스크립트는 계속 분류 오류다. CI 경로표 수정은 기존 규칙상 Android 필수 CI도 실행하지만, 이번 정책 변경만으로 main 승격·동일 code8 업로드를 하지 않는다.

공식 지침 사전/최종 대조: [OpenAI skills 원문](https://developers.openai.com/codex/skills)을 직접 읽어 저장소 `.agents/skills` 탐색, 이름/설명 기반 선택, 좁은 작업 범위와 명시적 입출력을 확인했다. 스킬 생성에는 내장 `skill-creator`를 적용했다. E2E 직접 실행 의무는 OpenAI 일반 의무가 아니라 사용자 프로젝트 결정이다. 현재 세션의 정확한 모델·클라이언트 버전은 별도 확인하지 않았으며 모델별 행동 향상은 주장하지 않는다. 사전 판정 PASS(기존 권한/데이터 보존·실제 기기 경계 유지), 최종 판정 PASS(아래 실제 검사와 상황 대조 범위). 문서 등록으로 모든 미래 실행의 준수를 보장하지 않는다.

- 스킬 `quick_validate.py`: 웹·Android 각각 PASS. 기존 Markdown 검사기로 링크/문법 3파일+2파일 PASS. `git diff --check` PASS.
- Android CI 분류 회귀16 PASS, 이후 전체 `check_ci.py`208 PASS/0 FAIL/0 ERROR/0 SKIP(16 중복 합산 금지), PowerShell syntax/actionlint PASS. 스킬 Markdown만 바뀌면 Android 빌드를 선택하지 않고 알 수 없는 실행 파일은 실패하는 경계를 검증했다.
- 웹 실제 실행: 보존 작업공간의 제품 후보775e7d30에서 `npm run test:e2e -- tests/e2e/updates.spec.ts`, Chromium5 PASS/0 SKIP. 공지 표시/닫기/재진입·요청 실패·320/1440폭을 직접 실행했다. API 일부는 가로챈 합성 결과이므로 `LOCAL_UI`; 실제 회원/운영 인증 PASS가 아니다. 규범 후보는 제품 코드를 변경하지 않았으므로 이 제품 흐름 증거를 재사용한다.
- 적용 상황 대조: Windows 연결 Playwright 차단 시 guard 해제·세션 복사 없이 연결 브라우저 또는 WSL 경로 확인, 에뮬레이터 fixture PASS를 Play 신규 가입 PASS로 확대하지 않기, 결과 불명 mutation의 재전송/소유 불명 정리 금지. 이는 지침 검수이며 별도 실서비스 실행 결과가 아니다.
- `adb devices -l` 결과 연결 기기0, 기존 `MOTOCAST_S23Plus_API34` AVD 존재 확인. 새로운 로그아웃 수용 기준 확정 전 UI 변경 검사와 Play 실기기 검사는 NOT_RUN. 에뮬레이터 부재만으로 사용자가 검사해야 한다고 결론 내리지 않으며 다음 UI 수정에서 기존 소유 AVD를 실행해 검사한다.
- 이번 변경은 기존 작업공간만 재사용하고 새 VM/DB/AVD·도구 설치 없음. 웹 로컬 E2E 서버는 검사 종료로 정리됐다. PR/고정 SHA/CI와 원격 반영은 연결 PR의 최종 결과를 따른다.

원격 후보 검증: [웹 PR93](https://github.com/tocomboy/motocast/pull/93), [Android PR38](https://github.com/tocomboy/motocast-android/pull/38). Android 최초 fd612e4/CI36954946552에서 `BASELINE_INPUT_MISMATCH`가 발생했다. 로컬 초기 검사는 변경 전 Git HEAD의 입력 해시를 읽어 이 차이를 발견하지 못했다. 커밋된 CI 경로표/스킬 파일 추가에 기존 ACTIVE 근거를 재사용할 수 없다는 올바른 차단이다. develop 후보만 baseline null/control revision13 HOLD로 전환하고 main의 운영 revision12 ACTIVE·code8 원본/receipt는 보존한다. 새 출시 후보는 새 입력·실제 서버 확인에 결속된 baseline을 확정한 뒤 main으로 승격해야 한다. 스킬 Markdown의 docs 분류를 입력 해시·원본 재사용 경계에도 일치시켰으며 스킬 실행 스크립트/잘못 실행 검사로 매핑한 문서는 여전히 거절한다. guard를 제거하지 않았고 공개/내부 업로드 재시도도 하지 않았다. 후속 `check_ci.py`208 PASS/0FAIL/0ERROR/0SKIP, 원격 최종 결과는 해당 PR에 기록한다.

## 목표와 확정 범위

2026-10-02 사용자 요청: 앱 출발 기본값을 웹과 일치시키고, 지도 경유지 확인 팝업에 선택 위치를 표시한다. 홈 로그아웃은 화면 하단에 고정한다. 초대 관리·가입 코드는 폐기하고 사용자 공지는 `업데이트 내역`으로 통일해 짧고 쉬운 문장으로 쓴다.

- 신규 회원은 기존 AUTH-007의 Play 설치 검증을 통과한 앱 Kakao 로그인으로 가입한다. 웹은 기존 활성 회원만 로그인하며, 미가입자에게 앱에서 먼저 가입하라는 안내를 표시한다. 기존 관리자·일반 회원·회수 상태와 데이터를 보존한다. 웹 로그인만으로 회원을 만들지 않는다.
- 웹·앱 기능뿐 아니라 UI 기술도 통일한다. 사용자 선택에 따라 현행 제품의 수정부터 함께 배포하고, React Native/Expo 및 React Native Web 공통 화면으로 단계적 이관을 계속한다. 현재 Kotlin/Compose와 React 화면은 공통 UI 구현 완료가 아니다.
- 지도 제스처 정상 동작은 사용자 보고다. 이번 보고에는 버전/code가 별도로 명시되지 않았으므로 0.7.0/code7 전체 기기 검증 PASS로 확대하지 않는다.
- Production 웹과 Play 내부 배포 승인은 유지한다. 정식 공개와 실기기 잔여 항목은 별도 조건이다.

## 계획과 진행

1. **완료**: 기존 코드·정책 및 Figma 확인, 화면 상태 디자인, 회원 가입 계약·공통 UI 결정 반영.
2. **완료**: 현행 웹·앱 화면과 출발 기본값, 초대 코드 폐기, 간결한 업데이트 내역 및 배포 스킬 수정. 최종 Android 양쪽 JVM334 PASS이며 출발 기본값 집중43을 중복 합산하지 않는다.
3. **완료/한계 유지**: 고정 후보 자동 검사·실제 DB563·Preview UI/기존 Kakao 회원 검증 완료. 미실행 일반/회수 계정 실제 로그인·Play 가입·사용자 실기기는 아래 범위와 기존 조건부 결정을 유지한다.
4. **배포 실행**: 서버 호환 준비와 웹0.8.0 운영 반영, Android0.8.0/code8 main 승격 완료. Play 게시·원본 artifact/readback의 최종 상태와 기기 안내는 [Android PR37](https://github.com/tocomboy/motocast-android/pull/37)의 배포 결과 기록이 소유한다. main 병합을 Play 완료로 간주하지 않는다.
5. **설계 완료/구현 대기**: [공통 업데이트 화면 첫 이관 계획](2026-10-02-shared-release-ui-plan.md). 현행 공동 배포 뒤 같은 RN 화면을 웹·앱에 연결하며 로그인·지도·주행의 기존 네이티브 계약을 보존한다.

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


## 화면 크기 전환 검수 보완

- PR89 `64e80af21df7ddf774f0222e95e3c07d2ce657e8`, CI36896977117 SUCCESS 뒤 Deployments0/statuses0/verify 단독을 확인하고 develop21cdd2b에서 exact SHA로 승격했다. Preview deployment6790720701 성공. 실제 로그인된 Preview에서 제목·지도·주소·버튼 겹침 해소를 확인했다.
- 데스크톱 확인 창을 연 채320폭으로 바꾸면 Kakao SDK가 observer 이전에 중심을 이동해 선택 핀이 오른쪽으로 밀렸다. 읽기 전용 선택 미리보기의 resize는 원좌표로 재중심화하고, 편집 지도는 기존 카메라 유지 규칙을 보존한다. 실제 관찰을 재현한 SDK 상태 테스트를 추가했으며 집중24개/lint/typecheck PASS. 후속 exact-head CI와 Preview 실제 재검증 전 Production 미승격이다.
- Android 가로 화면 첫 검사는 스크롤 아래의 버튼을 곧바로 찾는 가정 때문에 CENTER_LOADING FAIL이었다. 디자인대로 지도와 제목을 먼저 확인한 뒤 시트를 스크롤해48dp 버튼 접근/비활성 로딩/취소를 검사하고 위로 복귀하도록 수정했다. 동일 SDK/가로 화면 재실행19단계 PASS. 앱의 스크롤이나 assertion을 약화하지 않았다. 원본 FAIL과 수정 후 로그를 함께 보존했다.
- Android main98498a75의 Main CI36896631544 SUCCESS, queued/running0 확인. control10/HOLD는 활성화됐지만 운영 웹/앱은 여전히0.7.0/code7이다.

## 0.8.0 운영 승격과 앱 후보

- 최종 웹 PR90 head775e7d30의 CI36899433306 SUCCESS 및 zero-deployment 확인 후 develop 승격, 통합 CI36900055737 SUCCESS. Preview dpl_8sc2Q7bgkqy8yVbMcEf7Y6BiNCDe에서320/390/820/1440폭의 핀 중심·제목/주소/버튼 무겹침, 취소0/확인1, 초대 링크의 앱 가입 안내 PASS. 실제 기존 회원 Kakao roundtrip은 resize-only 직전 동일 인증 후보에서 PASS이며 일반/회수 계정 연결 검증을 대신하지 않는다.
- 웹 PR91 required CI36900862751 PASS 후 main88ecefaeab27837a001470fc9f168b13b571bb33, main CI36902179824 SUCCESS. Production dpl_89A6HVDWX7EjyXuZdueTNy6oTTyj READY/alias 일치. 운영 기존 회원 세션에서 공개 장소의 실제 지도·주황색 ＋ 핀·주소·취소0/확인1과 업데이트0.8.0 표시를 확인하고 저장하지 않은 초안을 정리했다. 이번 검사는 새 Kakao 재인증이 아니다. 공개 updates/assetlinks200(JSON·redirect없음), retired accept410/no-store 확인.
- Production 초대 폐기 migration20261001173717 적용 후 회원/프로필/초대 aggregate SHA25632516e5e64e078011efd14480dacc9475b4551022264501ed138095a5c752f91 보존, 회원2(admin1/rider1)·프로필2·초대2·코스5 유지, retired RPC 역할 조합9개 거부/service-role RPC14 유지. 기존 백업·격리 복원 근거를 재사용했고 새 full backup을 실행했다고 주장하지 않는다. advisor 기존 종류 외 신규 발견 없음; 기존 warning은 남아 있다.
- HOLD10 및 drain0 후 PLAY_ADMISSION_VERSIONS=5,6,7,8 저장, readback2026-10-01T17:32:54Z/SHA25691c38c12fdbcbdee421a34bb33566525fa21badb8c49644f2d957faf675d2a5d. 새 비밀값·키·권한 확대 없음. Android PR34/35와 main CI36901822290 SUCCESS 뒤 [관찰36902895480](https://github.com/tocomboy/motocast-android/actions/runs/36902895480) SUCCESS:21 migrations/8 functions, 기존20 statements·8 body/JWT 불변, 설정 저장에 따른 metadata version+1. 검토 API/function47개와21 SQL source hash 일치.
- Android PR36 head7a4724fa51f060fd2c33757d975eff0347b44777/Required36903662862 SUCCESS, PR37 Required36904860215 SUCCESS 후 maina61b109f9c962a07f760f53c0235919c571022f5로 승격했다. 최종 tree 동일, 입력 hash66c39d4ed79ea426ccbcd15ffc9d7145f64923f7812156c3fa7238724cfa3846 일치. 공지14개는 웹88ecefae에서 가져왔고 역사적0.6.0의 웹 전용 범위는 보존했다. epoch4/revision12 ACTIVE 기준9269768a7a4efc3e9492a5910b6d9e46c6a3886832b4ead217a1f9dd99da0af9를 사용한다.
- Android 양쪽 최종 JVM334/0fail/0skip, 자동화207/0fail/0skip, docs3·actionlint·PowerShell PASS. gitleaks8.30.1을 공식 배포 SHA 검증 후 작업 범위에 설치했다. 최종 Android 커밋 검사1건은 baseline.json의 api_contract_sha256가 정본의 공개 계약 해시와 동일한 오탐이며 확인된 credential0; scanner를 완화하지 않았다. 기존 Next/개발 의존성 audit 경고는0으로 보고하지 않는다.
- [실제 main CI·자동 내부 배포36905968631](https://github.com/tocomboy/motocast-android/actions/runs/36905968631)의 서명·업로드·트랙 readback은 PR37 결과 기록을 확인한다. 검토 후보와 운영 서버 준비 완료를 기기 설치/Play 신규 가입 성공으로 확대하지 않는다. 웹 tag/Release와 정식 Play 공개는 미완료 실제 gate를 유지한다.
