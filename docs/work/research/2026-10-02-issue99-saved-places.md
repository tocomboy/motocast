# Issue99 개인 저장 장소 통합

상태: 0.10.0 Preview DB·웹 적용 및 실제 계정 주요 흐름 PASS, Android develop 통합·Preview APK 설치 완료. Android 직접 로그인과 제공사 측정·출시 gate가 남아 Issue는 OPEN이다.

## 범위와 확정 결정

- 사용자 요청: Figma 댓글 확인·해결 및 [Issue99](https://github.com/tocomboy/motocast/issues/99) 해결.
- 후속 답변: 계정당 라이딩 스팟+식당 합계 **1,000개**, 별표 **5개**, 검색 선택과 **지도 임의 좌표 등록을 이번에 포함**.
- 기존 PLAN-004/UI-001을 갱신했다. 별명은 signed 원본 장소와 분리하며 별표 해제는 삭제가 아니다. 기존 코스·불변 공유 자료를 수정하지 않는다.
- 핀 선택은 상세만 연다. 명시 경유지 확인에서 역할·정차분을 선택한 뒤 도착지 직전에 고유 occurrence ID로 추가한다. 추가·편집·삭제·순서 변경은 경로/날씨를 자동 호출하지 않는다. 오래된 결과와 공유 준비를 무효화하고 명시 재계산 실패에도 초안을 보존한다.
- 후속 사용자 답변 **앱 적용까지 진행**은 직전 제안의 commit·push·PR 게시·develop 반영·Preview DB/앱 적용 승인이다. Production·Play 배포 승인으로 확대하지 않는다. 호환 기능 추가인 공동 후보 **0.10.0**을 선택하고 package/lock/공지 및 Android 내장 공지를 함께 맞춘다. 기존 운영은0.9.0/code10이며 Android 다음 후보는code11이다.

## 작업 공간과 소유권

| 대상 | 기반 | 작업 브랜치 | 상태 |
|---|---|---|---|
| Web/server | develop `ed8c46e` | `review-issue99-saved-places-20261002` | PR101/239b213 MERGED, Preview 적용 |
| Web 연결 회귀 | `239b213` | `review-issue99-connected-fix-20261002` | PR102/7d26424 MERGED, 등록 검색창의 실제 별표 목록 연결 |
| Web 실행 근거 | `7d26424` | `review-issue99-preview-evidence-20261002` | 이 기록의 후속 갱신 |
| Android | develop `0a63d283b187beea0d6cfb9522ee788e10bd7d31` | `feat/issue99-saved-places-20261002` | PR46/b269954 CI SUCCESS, develop merge5825995, Preview debug 설치 |

Web worktree: `C:/Users/User/.codex/worktrees/motocast-issue99/MOTOCAST` (Codex 관리). Android: `C:/Users/User/Desktop/worktrees/motocast-android-issue99`. 원래 웹 dirty develop과 원래 Android checkout은 보존한다. 메인은 웹·통합 검수, backend worker는 migration/SQL, Android worker는 Android 파일을 소유했다.

## Figma와 화면 대응

정본 [Issue99 board 237:1316](https://www.figma.com/design/wVNriNWb1OlF21DVq8rqlJ?node-id=237-1316)의 기존 색상·폰트·컴포넌트를 재사용했다.

| 화면/상태 | Figma 노드 | 구현 |
|---|---|---|
| 3탭·지역·독립 토글 탐색 | 238:1322 | 웹 SavedPlacesManager / Android SavedPlacesScreen |
| 장소 상세 | 238:1402 | 원래 이름·별명·별표·수정·삭제·경유지 추가 |
| 별명·분류·저장 확인 | 239:1563 | 원본 변경 없는 metadata 편집 |
| 최종 장소 저장 확인 | 248:1723 | 분류·별명·별표 최종 확인 |
| 경유 역할·정차 확인 | 상세의 경유지 진입 + 기존 일정 역할 입력 재사용 | 역할·정차분 확인 후 고유 occurrence·목적지 직전 추가 |
| 별표 해제 / 장소 삭제 | 240:1432 / 240:1473 | 원본 유지와 실제 삭제 구분 |
| 지도 좌표 확인 G1 | 274:3829 | 기존 좌표 확인 API 재사용, 확인 후 등록폼 |

Figma 댓글33/34의 중복 하단 닫기 버튼240:1466/240:1503을 제거했다. 헤더 X와 주 행동/취소만 남겨 렌더 확인 후 두 댓글을 해결 처리하고 미해결 패널0을 읽어 확인했다. G1은 선택 좌표 핀 하나를 표시한다. 파일241:1748 계약 문구에 1,000/5/좌표 포함을 반영했다. 주요 loading/empty/error/budget/limit/cancel/late-response 상태는 기존 board와 G1 설명274:3880에 대응한다.

## 서버·클라이언트 계약

Migration `20261002094511_saved_places.sql`은 `place_favorites`를 `saved_places`로 rename하고 원본·created_at·기존 별표를 보존한다. ID/revision/alias/kind/province/updated_at을 추가한다. 구앱 호환 security_invoker view에는 star_slot1..3만 slot으로 노출한다. 구앱 삭제는 canonical 별표 해제로 처리하며 신규 클라이언트는 canonical 5개를 읽는다.

- RPC: `save_place`, `update_saved_place`, `set_saved_place_star`, `delete_saved_place`. Owner advisory lock을 구/신 RPC가 공유해 합계1,000/별표5 및 revision 조건을 직렬화한다. 중복 등록은 원래 행을 반환하며 metadata를 덮어쓰지 않는다.
- 계정별 RLS·active membership·직접 DML 거부를 유지한다. DB는 기존 검증 토큰의 형식을 검사한다. **HMAC 검증 자체는 기존 Edge의 경로/코스 저장 경계**이며, DB 테스트를 서명 검증 완료로 해석하지 않는다.
- 시·도는 검증된 원래 address에서 한 번 파생하고 알아볼 수 없는 기존 주소는 지역 미확인으로 남긴다. 지역 필터/핀/별명/별표는 검색·경로·날씨 API를 호출하지 않는다.
- 웹은 변경 뒤 canonical 목록을 새로 읽고, 결과가 불명확할 때 자동 재전송하지 않는다. 계정 epoch 변경 시 등록/수정/경유지/좌표 팝업 전체를 폐기한다. SDK 레이어만 갱신하며 토글/별명변경으로 지도를 다시 만들거나 카메라를 재설정하지 않는다. 레이어 정리 실패는 지도를 숨기고 오래된 클릭을 거부한다.

## 검증 근거

후보는 위 기반의 dirty diff다. 최종 파일 hash 목록과 최종 실행 결과는 아래 완료 갱신에서 고정한다.

| 검사 | 현재 결과 | 경계 |
|---|---|---|
| npm ci | PASS, 589 packages | Node24.12.0/npm11.6.2, 전용 worktree |
| TypeScript / ESLint / 최종 Next build | PASS | 최종 Unicode 별명 변경 포함 |
| Vitest | 89 files / 913 PASS | 실제 공급자·배포 근거 아님 |
| Deno check | 8 entrypoints PASS | Edge 코드 변경 없음 |
| Chromium | 전체63 PASS / 2 expected SKIP, 최종 영향2 PASS | keyless LOCAL_UI; 마지막 원본보존 수정 뒤 즐겨찾기2개 및 fresh build 재검사 |
| PostgreSQL | 320 PASS / 최종 FAIL0·SKIP0 | 이행10 + canonical78 + concurrency17 + legacy20/2 + ACL193 |
| Web filled LOCAL_UI | PASS | 등록/수정/별표해제/삭제/역할정차/취소, 320/384/820/1440, 글자1.3 |
| Android | 양 flavor 단위365개씩·최종 빌드/lint/manifest PASS | 실제 기기시험은 아래 별도 기록 |
| Connected candidate | 웹 주요 흐름 PASS / Android 실회원 NOT_RUN | hosted canonical 적용·보존 및 실제 웹 등록/수정/삭제 PASS; Android 직접 로그인 대기 |
| Web SDK 실측 | Preview 지도·20회 토글 PASS / 별도 핀수별 계측 미완료 | 실제 SDK 화면·공급자 집계와 로컬 최초 로더401 실패를 구분 |
| Native SDK UI | S23+ / 320폭·글자1.3 / 820폭 각각23 PASS, 합계69 PASS | 소유 AVD, 실제 SDK·합성 계정 API; 쿼터 귀속 미확정 |
| Production / Play | NOT_RUN | 이번 후보 배포 없음 |

Web filled UI는 실제 제품 컴포넌트+provider를 별도 로컬 번들로 실행하고 합성 Supabase 응답을 사용했다. 결과 RPC4(별표해제/별명수정/삭제/등록), 검색1, 경유지 확인1, 좌표0, 외부요청0. 취소는 쓰기0. 이 수치는 실제 서버 또는 지도 쿼터 검증을 대신하지 않는다. 개발 도구 esbuild0.25.12를 저장소 외부 사용자 검증 폴더에 설치했고 Prettier3.6.2/3.9.9를 사용자 npx cache에서 실행했다. 제품 dependency는 바꾸지 않았다. 임시 UI 서버3199는 검증 후 종료했다.

최종 메인 검수에서 canonical 신규 등록의 빈 `roadAddress`가 기존 parser를 통해 null로 바뀌는 경로를 수정했다. 원래 빈 문자열을 RPC payload에 그대로 보내는 회귀를 추가했고 단위913·typecheck·lint·fresh build 및 즐겨찾기 브라우저2개가 PASS다. signed 원본의 나머지 필드와 공유/경로 계약은 바꾸지 않았다.

초기 실패 이력: 웹 단위11 FAIL(새 SDK effect의 keyless window 접근8, 새 canonical mock계약2, 계정전환 stale요약 계약1)은 수정 후 전체 PASS. 최초 웹 브라우저에서 지도 상대위치 누락으로 탭 클릭 차단1 FAIL은 수정 후 재검사 PASS. 새 검수로 role/dwell 무시, 계정전환 후 폼 잔류, stale summary 탈출구 부재, pin cleanup 실패 시 ready 유지 4건을 수정했고 해당 회귀 검사를 추가했다. 초기 fixture 출력행 overflow1은 시험 harness에 한정되어 wrap 후 PASS. DB authoring FAIL1·setup2는 원인과 수정 근거를 로그에 보존한다.

## API 사용량·자원

2026-10-02 약19:24 KST Kakao console 앱1561641 읽기: 일간 maps4(Web)4/300,000, vector/auth(Native)168/300,000, keyword12/100,000, coord2address18/100,000, current directions4/10,000, future2/5,000. 공유 앱 전체 집계이므로 전후 차이를 특정 테스트에 바로 귀속하지 않는다. 핀100/토글20 단위시험은 SDK 사용량 실측이 아니다.

19:47 KST 콘솔 재조회: Native181(+13), 다른 위 항목 변화0. 이 차이는 앞선 실패/재시험을 포함하는 기간 전체 집계이며 특정 UI 조작의 비용이 아니다. S23+ 성공 실행19:45:00~19:45:38 중 지도 측정 구간19:45:33.83~19:45:37.76은 native label0/1/5/50/100·toggle20에서 같은 MapView, 지역 필터 local-only, 실제 doubletap zoom과 재진입을 확인했다. 합성 API callback 읽기7/검색1/좌표2/쓰기4이며 실제 검색·좌표·길찾기 공급자 호출은 없다. 콘솔 합계와 callback 개수를 동일 지표로 취급하지 않는다.

최종 콘솔20:03 KST: Native197(초기 대비+29, 중간 대비+16), 위 다른5항목 변화0. 통계 지연·실패 반복·공유 사용량을 완전히 분리하지 못해 조작별 차감과 일일 예산은 미확정이다. Android 최종 3폭 증거는 전용 worktree의 `docs/artifacts/issue99-s23-final-20261002-195230`, `issue99-small-final-20261002-195610`, `issue99-wide-final-20261002-200220`와 `docs/saved-places-evidence.md`에 있다. 메인은 S23/작은 폭 렌더 및 wide 최종 PASS 로그를 직접 확인했다. 최초 browse 캡처의 부분 타일은 로드 중 상태였으며 안정 후 전체 지도 렌더를 확인했다. 작은 화면의 최초 자동화는 화면 아래 홈 버튼 탐색, wide 최초 자동화는 입력 직후 semantics 갱신 대기 부족으로 실패했고 제품 계약·기대값을 유지한 실행기 수정 후 PASS했다.

증거 디렉터리: `C:/Users/User/.codex/verification-logs/issue99-saved-places-20261002` (DB manifest/SQL/log/hash), `.../issue99-web-sdk` (LOCAL_UI fixture/result/screenshots), `.../issue99-web-*` 및 `.../issue99-deno.log`. 웹 기본 E2E 화면은 `%TEMP%/motocast-playwright-artifacts`에 있다. Figma 렌더는 이 대화 visualization 디렉터리에 보존했다.

로컬 Postgres 컨테이너 `supabase_db_motocast-production-validation166-202609`의 source DB를 수정하지 않았다. template0+schema-only로 만든 소유 DB `motocast_saved_places_20261002_8f174ec2`(20,466,835B), `motocast_saved_places_20261002_final_9d314ef0`(19,390,991B)를 증거 보존한다. 전체 migration chain 재생은 미실행이며 최신 schema의 candidate fresh apply를 확인했다. 다른 client세션0, race fixture/helper0. 완료48시간 이후 처분 검토 가능하나 자동 삭제하지 않는다.

Android 소유 AVD는 원래1080×2340/density450/font1.0으로 복원 후 readback하고 종료했다. ADB 연결기기 및 emulator/qemu 프로세스0을 확인했다. Preview debug 설치본·userdata·미커밋 후보·검증 자료는 보존한다. 최종 자원·hash·실패 이력은 Android 플랫폼 증거 문서가 소유한다. 웹 후보24파일 SHA256은 `C:/Users/User/.codex/verification-logs/issue99-web-candidate-hashes.json`에 기록했다.

## 남은 완료 조건

게시·Preview DB/웹 적용은 아래 기록대로 실행했다. Android 실제 회원 연결은 에뮬레이터의 정상 카카오 로그인에서 비밀번호 직접 입력이 필요하다. 핀0/1/5/50/100, 토글20, 지역·이동·확대·재진입, 오류와 재계산의 사용량을 실제 공급자 집계와 대조하고 플랫폼별 미완료를 구분한다. 남은 검증을 생략해 Issue99를 닫지 않는다. Production/Play 승격은 별도 gate와 해당 배포 권한을 따른다.

## 0.10.0 Preview 적용 준비

원격 develop은 시작 시 ed8c46e로 기존 기반과 같았다. Preview DB lehjmbgfpoemqcwxowbx는 ACTIVE_HEALTHY/PG17.6.1.166/migration21개이며 이번22번째 이행만 적용한다. Edge8개 코드는 변경하지 않는다. 복구는 DB를 되돌려 데이터를 없애지 않고 기존0.9.0 웹ed8c46e/구앱을 호환 view·RPC에 연결한다. 이행 후 원래 장소·created_at·별표 hash와 count를 비교하며 정상 readback 전에 웹을 활성화하지 않는다.

Android 후보는 기존 검사기의 지원 경로인 baseline=null/control HOLD(BASELINE_NOT_CONFIGURED)를 사용해 code10 운영 승인 승계를 막는다. 후보 revision18/epoch6이며 실제 원격main ACTIVE/control과 운영 설정은 변경하지 않는다. 검사기 guard는 수정하지 않는다. 번들의 기존 source.main_sha 필드는 이 단계에서 고정 웹 Preview 후보 출처이며 실제 main 운영 출처로 해석하지 않는다.

버전 변경 뒤 단위913/typecheck/lint PASS. 전체 브라우저 최초62 PASS/1 FAIL/2 expected SKIP은 공지 검사에 남은0.9.0 문구가 원인이었으며0.10.0 확정 문구로 대조를 갱신하고 공지9개·fresh build PASS를 확인했다. 실패 로그를 보존한다. 기존 API/SDK/DB 검증은 구현·의존성이 변하지 않아 재사용한다. 게시한 고정SHA의 CI는 전체 suite를 다시 실행한다.

## Preview 적용 및 실제 계정 검증

- 웹 PR101 고정 `239b2130d04e265b154563fa35ea74dd7270ca63`, CI37000598888 SUCCESS. review 브랜치의 GitHub deployment0 및 Vercel check 부재를 두 번 확인한 후 DB를 먼저 적용하고, 기존 develop ed8c46e를 같은 SHA로 일반 fast-forward했다. Vercel `dpl_HmVUmnBTCf79NejAx6BRLuerVzRR` READY/Preview/develop/동일 SHA 및 branch alias binding을 확인했다.
- Preview `saved_places` migration 도구는 source filename `20261002094511_saved_places.sql`을 hosted version `20261002112456`/name `saved_places`로 등록했다. source SHA256 `0E1CB7E1CCACB4D199A67650651E49FB5A5269A255C85C516CE6DD956886943B`; history22건. 이 timestamp mapping을 기록하며 고정 source나 remote history를 다시 쓰지 않았다. Edge8개는 변경하지 않았다.
- 적용 전후 기존3행/2소유자의 원본·생성시각·순서 combined SHA256 `8d707558018f3c807ed2a154ddf1bdca1207ad0710fb1494f619a96935ffe389` 일치. canonical3/legacy3, RLS=true, legacy view security_invoker=true. 변경 RPC6개의 empty search_path/SECURITY DEFINER 및 authenticated 전용 EXECUTE 확인. 무조건 DML 권한을 추가하지 않았다.
- 실제 로그인 계정의 0.10.0 첫 공지와 확인, 기존1행 표시, 세 목록/지역 필터/실제 Web SDK 표시 PASS. 검색 시험 공개 장소1건 저장→별표만 해제→별명 수정→휴식45분 경유지 추가 및 원래 장소명 보존 PASS. 저장 확인창 취소 시 DB 시험행0을 확인했고, 저장/해제/수정 후 revision3·원본 보존을 readback했다. 지도 중심 임의 좌표의 실제 주소 확인·서명 경로→별명 등록 PASS. 이 연결 실행의 좌표 선택은 중심 버튼이며 길게 누르기 제스처는 이전 로컬/기기 검증과 구분한다.
- 위 시험 장소2건만 UI로 정확히 삭제했다. 최종 canonical3/시험 alias0, 기존 legacy3행 hash 일치. 기존 코스·공유·사용자 장소는 수정하지 않았다. 경유지 추가는 새 로컬 편집 초안에만 적용했고 서버 일정 저장/계산은 실행하지 않았다. 실제 브라우저 error console0.
- 실제 지도에서 네 조합20회/80 checkbox 변경 완료, 카메라 축척30m 및 준비 완료 표시 유지. 초기 locator 역할 오인 1회와 긴 단일 호출 timeout의 미계수 부분 반복은 성공 횟수에서 제외하고 보존했다. 이 관찰만으로 내부 지도 객체 수나 네트워크 바이트를 주장하지 않는다.
- 제공사 console20:32경 기준 Web5/Native199/keyword12/coord20/current4/future4. 토글20회 뒤 변화0. 검색·좌표·등록/수정·경유지 추가·삭제 뒤20:42경 Web5/Native199/keyword13/coord21/current4/future4. 지도 최초 진입은 앞선 Web4→5 관측과 별도다. 공유 앱 집계와 통계 지연 때문에 조작별 과금 보장은 아니며 네트워크 바이트와 구분한다. Preview 당일 내부 ledger는 Local 공용operation `local_keyword_search`11/10000·잔여9989, weather 당일행0. 실제 검색+좌표의 합계가 내부 보수적 예약 단위와 공급자 개별 통계에서 다르게 표시됨을 유지한다.
- 등록 검색창의 즐겨찾기 연결 누락을 실계정 검증에서 발견하여 PR102에서 동일 provider를 연결했다(2줄). 관련6단위/typecheck 및 고정 `7d26424ede0f4ad8909ad5ad6c66c1eced1ffb6c` CI37002201009 전체913단위/63브라우저/2 expected SKIP/Deno8/lint/build PASS. 동일한 review 배포0·개발 기반 readback 후 fast-forward했다. API/DB/SDK 코드는 동일하다.
- Android 실제 설치 후보의 정확한 SHA256은 `51a6906b7d514dfff7ec4ded53ee5f261dd9175b219101add1b2899778aec334`이며 기기 base.apk와 일치한다. 내장공지0.10.0/17건/원문239b213 PASS. 기존 개발용 manifest0.1.0-dev/code1은 release 후보0.10.0/code11과 별개다. 기존 userdata를 보존한 install-r 후 정상 Guest→Kakao SDK→계정선택→비밀번호 단계까지 확인했고 인증값 추출·웹 세션 복사 없이 멈췄다. 실제 회원 공지/저장 API는 NOT_RUN. Production debug 빌드와 실제 Production 설치/Play 제공을 혼동하지 않는다.

- PR102의 Preview `dpl_Dg8BkRzRzFXKFnrPHAouxAr3zvBj`는7d26424/develop/branch alias READY로 확인했다. 새로고침 후 등록 검색창의 현재 별표1/5 표시 PASS, 공지 재노출 없음. 앱/API/공지 변경이 없는 이후 문서 커밋은 이 실행 근거와 구분한다.
- Android PR46 CI37001101575의 필수 Required 포함 전부 SUCCESS. 원격 Gradle20분50초, 양 flavor 각365 tests/실패0/오류0/skip0 및 manifest PASS. merge58259950d7da7107c5cfd2c2ed1a9b07b7967b7e와 후보b269954의 tree `01312d1f088c3c054c38af366ff0ee02df112c9b` 일치. main은527fd2c/ACTIVE17/epoch6 그대로이며 Play 배포 없음. 소유 AVD는 직접 로그인 재개를 위해 hidden으로 보존한다.
- Android 기록 PR47/96f3816은 CI37003756850 SUCCESS 후 develop3ec432e7d4b67e0f1d763523d9f81d69f80b396a로 병합했다. 후보/병합 tree일치. 기능·문서 브랜치는 로컬/원격 정리했고 detached/clean worktree와 검증 APK·로그·소유 AVD는 실제 로그인 검증 재개를 위해 보존한다. 사용자용 APK는 `C:/Users/User/Desktop/worktrees/motocast-android-issue99/app/build/issue99-preview-service0100-debug.apk`(63,031,816B)다.

### 별도 Web SDK 핀수별 계측 차단

실제제품239b213 지도·좌표 코드 blob을 고정한 외부 `issue99-web-sdk-network-20261002-1126` fixture를 준비했다. 현재배포7d26424는 검색창만2줄 변경해 지도코드는 같으며, 공개 배포 JS의 SDK client 식별자만 로컬에서 사용했다. 로그인 상태·쿠키·비밀키·실사용자 데이터는 사용하지 않고 공개 합성좌표와 기존 경로 마커2개를 둔다. saved0은 전체marker0이 아니며 cold0 이후1/5/50/100은 warm 단계로 분리한다. 실제SDK 생성img count·숨김 검증을 props 개수와 따로 작성했다.

첫 실행11:50:28~11:50:43 UTC는 SDK bootstrap1개 실패/나머지 NOT_RUN. 진단 실행11:53:40에는 SDK bootstrap HTTP401과 `net::ERR_BLOCKED_BY_ORB`를 관측했다. 요청 후36ms에 실패하고 canceled=false였으므로15초 UI대기나 종료취소가 원인이 아니다. 수신 바이트는 UNKNOWN이며 실패집계0을 성공0바이트로 해석하지 않는다. 최초실행과진단결과를 각각 보존했다.

카카오 콘솔을 읽어 지도사용ON 및 JavaScript 허용 도메인이 기존 Preview·Production URL 두 개뿐임을 확인했다. localhost/127.0.0.1/3000/5173/3199는 등록되지 않아 현재 허용 범위 안에서 이 로컬계측을 실행할 수 없다. 설정 변경0, 추가 요청중단, 소유서버 종료/listener3199=0.11:47 및11:53 집계 Web6/Native199/keyword13/coord21/current4/future4로 같았다. 도메인 `http://localhost:3199` 하나 추가는 사용자에게 별도 확인했고 답변 전 보류한다.

상태: 로컬 SDK계측 ERROR2, 핀수별/80토글 DOM assertion0·네트워크matrix NOT_RUN. 실제 Preview의 지도표시·20토글 통과를 이 matrix의 성공으로 확대하지 않는다. 재개는 기존식별자·동일fixture·명시적으로 승인된 도메인에서 수행하고 전후 공급자 집계/HTTP바이트를 구분한다. 월간/브라우저SDK 예산은 내부서버 daily reservation으로 강제되지 않는 기존 OPS-007 경계를 유지한다. 따라서 #34규모의 모든 행동별 쿼터/일일예산 충족 및 Issue99완료를 주장하지 않는다.

외부 증거: `C:/Users/User/.codex/verification-logs/issue99-preview-applied.json`, 웹 CI37000598888/37002201009 로그, Android 소유 `docs/artifacts/issue99-connected-20261002-203315`와 `app/build/issue99-pr46-android-job.log`. 로그인 화면의 계정 정보가 담긴 기기 캡처는 외부 게시하지 않는다.


## 후속 수정: 식사 통합과 경유지의 즐겨찾기 진입

2026-10-02 사용자 추가 결정: 점심·저녁을 **식사**로 통합하고 별도 개수 제한 없이 전체 경유지30개 한도 적용. 기본60분과 편집 가능을 유지한다. 경유지 추가에서 즐겨찾기3탭을 열어 장소를 선택한다. Figma 기존238:1455/238:1457은 이미 통과·식사·휴식이었고 248:1617에 진입/복귀/확정 계약을 보완했다.

웹 기반8c54b06, branch `review-issue99-meal-favorites-20261002`, 기존 전용 worktree 재사용. Android 기반3ec432e, branch `feat/meal-saved-waypoint-20261002`. 0.10.0은 아직 Production/Play 미출시이므로 같은 후보를 보완하고 Android code11 유지. 새 stopRole=meal reader/validator를 먼저 반영하며 기존 lunch/dinner 원본·불변공유는 수정하지 않는다. 단순 구버전 앱 롤백은 새 meal 코스 reader 미지원 한계가 있어 새 reader를 유지한 writer 중지가 복구 조건이다.

LOCAL_UI 실제컴포넌트+합성계정 검증:320(글자130%)/384/820/1440 각각 추가→식사70분→즐겨찾기→뒤로복귀→식당(비별표 포함)→확인취소→확정 및 같은 장소 식사3회 PASS. unique ID3, dwell70/60/60, RPC/검색/좌표호출0, console오류0. 증거 `C:/Users/User/.codex/verification-logs/issue99-meal-favorites-ui`; 기존 esbuild 재사용,3198포트; 실제 SDK/회원검증과 별개. 초기 fixture import/locator 오류 수정 이력 보존. 최종 전체 검사와 Preview 적용은 진행 중이다.

후속 최종 후보 검증: npm ci/lint/typecheck/build PASS, Vitest90files948PASS, Deno8PASS, Chromium63PASS/연결전용2 expected SKIP. 기존 연결전용E2E도 식사 반복 허용 계약으로 갱신했고 실제 실행은 별도 연결 검증과 구분한다. PostgreSQL owned final 재사용에서 meal55 + optional_meal13 + plan_collection_share125 + live_acl193 =386PASS/FAIL0/SKIP0. 후보에 DDL4함수 확장만 포함하며 데이터변경0, JWT/소유권/RLS/예산/이륜차/24시간 제한을 유지했다. 초기 검증 실패(구지도문자 기대값1, 공지4개제한1, 신규test 위치TS5097)는 계약을 유지한 수정 후 PASS. 메인 변경검수: 현재 범위 BLOCKER/HIGH0, DB와 Edge reader 선반영 후 웹 exactSHA Preview 배포.

### 2026-10-02 Figma–실제 화면 대조 보완

사용자가 실제 구현과 Figma의 일치 검증을 명시했다. 기존 기능 검사 PASS를 시각 일치로 확대하지 않았다. CONNECTED_PREVIEW c2ee8e5의 384×832 화면에서 중앙 확인 팝업/역할 select/2열 종류 버튼 불일치를 실제 확인했다. 추가 Figma 렌더 대조에서 목록 지도 높이·탭 순서·분류/별표 카드·상세 지도·등록 분류·저장 성공 상세 전환 차이를 확인했다.

- 작업: `review-issue99-design-parity-20261002`, 기반 `c2ee8e595b210647cf2350af1d4ebd6af46bef04`, 기존 전용 worktree 재사용.
- 대응: 목록 `238:1322`, 상세 `238:1402`, 방문 설정 `238:1457`, 등록 `239:1563`, 저장 확인 `248:1723`, PC `240:1584`, 상태 `241:1616`/`241:1657`. Figma 원본을 구현에 맞춰 바꾸지 않았다.
- 수정: 모바일 지도188px와 지도 아래3탭, 분류·별표 카드, 하단 등록; 상세192px 지도/가로관리/고정CTA; 방문3버튼·stepper·고정CTA; 등록2분류·선택장소 요약·고정CTA; PC 왼쪽목록/오른쪽지도·선택상세. 저장 성공 후 새로 읽은 원본 장소 ID로 상세를 연다. 필터 결과0/전체0/오류를 구분하고 5개한도에서 관리 진입을 제공한다.
- 반응형/접근성 차이: 브라우저에는 Android 상태바를 복제하지 않는다. 저장 장소 검색과 전체 한도, 지도 재시도, 직접 분 단위 숫자 입력은 기존 기능/접근성을 위해 유지한다. 320폭·큰 글자는 줄바꿈과 세로 스크롤을 사용한다. 별표 탭의 공통 지도/핀필터는 기존 확정 계약을 유지한다. 따라서 픽셀 단위 완전 동일이라고 주장하지 않는다.
- 로컬 근거: 외부 `issue99-figma-web-readonly-20261002` Figma8렌더/FINDINGS; `issue99-meal-favorites-ui/preview-before-confirm.jpg`, `parity-confirm-{320,384,820,1440}.png`. LOCAL_UI4폭(320은글자130%) 모두 식사70분 유지·취소0개·같은장소3회 고유ID·추가 후70/60/60·가로넘침0·consoleerror0 PASS. RPC/검색/좌표변환0; SDK미연결 합성 API로 CONNECTED 근거를 대신하지 않는다.
- 기능 후보 c2ee8e5 CI37009594847 PASS, PR104 develop 반영. Preview migration source20261002124012→hosted20261002130259; 원본3행 md5 `cc941f07da653aa1eb71ee648d306ab7` 보존, private invoker4함수ACL 유지. Edge plan-route46/save-collection40/journey-route16/journey-weather16 JWTtrue 및 전체 파일 exactGitblob 읽기확인. Vercel `dpl_3vySk1fvDHQG6LgoF9EJwxVCEbKr` Ready exactc2ee8e5. 이번 시각 보완 후보는 별도 최종검사/PR/Preview 실측 후 Issue99에 결과를 갱신한다.
- 후보 검증: lint/typecheck PASS, 단위90파일949 PASS. 전체브라우저62 PASS/1 FAIL/연결전용2 expected SKIP의 최초 실패는 한도 문구가 헤더에서 탭·목록으로 이동한 기존 assertion이었다. 새 위치에서 전체0/1000·자주찾는곳0/5를 각각 확인하도록 수정하고 해당2개 테스트5폭/큰글자/키보드/포커스/등록취소 재실행 PASS. assertion 삭제·skip으로 우회하지 않았다. npm ci/Deno8/Chromium 설치는 같은 lock·서버 원본의 선행후보 유효 근거 재사용; build와 exact-SHA CI는 새후보에서 실행한다. 별표/삭제 중앙 확인 보호는 유지하고 Figma R3 저장 확인만 전체 화면으로 적용한다.

### 상세 지도 Esc 회귀 보완

시각 보완 `010cfd3`/PR105는 CI37013360987 SUCCESS, Preview `dpl_3tbvRkDFbxHkLJVx7eHnLSzPzJcD` Ready로 반영했다. 이후 메인 실제 LOCAL_UI에서 상세 지도 전체화면→Esc가 상위 장소 상세까지 닫는 것을 재현했다. 지도 dialog의 cancel 이벤트 전파를 멈추어 지도만 닫고 상세·확대 버튼 포커스를 보존한다. 기능과 데이터·SDK 호출 경계는 바꾸지 않는다. `review-issue99-map-cancel-20261002`에서 단위949, lint/typecheck, fresh production build를 포함한 지도/즐겨찾기 브라우저9 PASS와 실제 동일 UI 경로 재현 PASS, 이미지 `map-escape-fixed.jpg`를 보존했다. 선행 npm ci/Deno8·나머지62브라우저 근거는 변경 영향 밖이며 exact-head CI는 전체 실행한다.
