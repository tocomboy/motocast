# Issue99 개인 저장 장소 통합

상태: 사용자 후속 승인에 따라 0.10.0 후보 게시·Preview 적용 진행 중. 연결 후보·제공사 실제 쿼터 측정·출시 gate 미완료이므로 Issue는 OPEN이다.

## 범위와 확정 결정

- 사용자 요청: Figma 댓글 확인·해결 및 [Issue99](https://github.com/tocomboy/motocast/issues/99) 해결.
- 후속 답변: 계정당 라이딩 스팟+식당 합계 **1,000개**, 별표 **5개**, 검색 선택과 **지도 임의 좌표 등록을 이번에 포함**.
- 기존 PLAN-004/UI-001을 갱신했다. 별명은 signed 원본 장소와 분리하며 별표 해제는 삭제가 아니다. 기존 코스·불변 공유 자료를 수정하지 않는다.
- 핀 선택은 상세만 연다. 명시 경유지 확인에서 역할·정차분을 선택한 뒤 도착지 직전에 고유 occurrence ID로 추가한다. 추가·편집·삭제·순서 변경은 경로/날씨를 자동 호출하지 않는다. 오래된 결과와 공유 준비를 무효화하고 명시 재계산 실패에도 초안을 보존한다.
- 후속 사용자 답변 **앱 적용까지 진행**은 직전 제안의 commit·push·PR 게시·develop 반영·Preview DB/앱 적용 승인이다. Production·Play 배포 승인으로 확대하지 않는다. 호환 기능 추가인 공동 후보 **0.10.0**을 선택하고 package/lock/공지 및 Android 내장 공지를 함께 맞춘다. 기존 운영은0.9.0/code10이며 Android 다음 후보는code11이다.

## 작업 공간과 소유권

| 대상 | 기반 | 작업 브랜치 | 상태 |
|---|---|---|---|
| Web/server | develop `ed8c46e` | `review-issue99-saved-places-20261002` | 로컬 변경, PR/commit/push 없음 |
| Android | develop `0a63d283b187beea0d6cfb9522ee788e10bd7d31` | `feat/issue99-saved-places-20261002` | 로컬 변경, PR/commit/push 없음 |

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
| Connected candidate | NOT_RUN | hosted canonical migration 및 해당 후보 미적용 |
| Web SDK 실측 | NOT_RUN | 원본 로컬 설정에 JS 공개키 부재, keyless/합성 API와 구분 |
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

승인된 웹/Android의 변경만 commit·push하고 CI-only PR을 게시해 고정 SHA를 검수한다. 웹 review 브랜치의 배포0을 확인한 뒤 Preview DB/후보를 적용하고 develop 반영은 저장소 gate를 따른다. 실제 계정/서버·Web SDK·쿼터/예산 검증을 이어가야 한다. 핀0/1/5/50/100, 토글20, 지역·이동·확대·재진입, 오류와 재계산의 사용량을 실제 공급자 집계와 대조한다. 남은 검증을 생략해 Issue99를 닫지 않는다. Production/Play 승격은 별도 gate와 해당 배포 권한을 따른다.

## 0.10.0 Preview 적용 준비

원격 develop은 시작 시 ed8c46e로 기존 기반과 같았다. Preview DB lehjmbgfpoemqcwxowbx는 ACTIVE_HEALTHY/PG17.6.1.166/migration21개이며 이번22번째 이행만 적용한다. Edge8개 코드는 변경하지 않는다. 복구는 DB를 되돌려 데이터를 없애지 않고 기존0.9.0 웹ed8c46e/구앱을 호환 view·RPC에 연결한다. 이행 후 원래 장소·created_at·별표 hash와 count를 비교하며 정상 readback 전에 웹을 활성화하지 않는다.

Android 후보는 기존 검사기의 지원 경로인 baseline=null/control HOLD(BASELINE_NOT_CONFIGURED)를 사용해 code10 운영 승인 승계를 막는다. 후보 revision18/epoch6이며 실제 원격main ACTIVE/control과 운영 설정은 변경하지 않는다. 검사기 guard는 수정하지 않는다. 번들의 기존 source.main_sha 필드는 이 단계에서 고정 웹 Preview 후보 출처이며 실제 main 운영 출처로 해석하지 않는다.

버전 변경 뒤 단위913/typecheck/lint PASS. 전체 브라우저 최초62 PASS/1 FAIL/2 expected SKIP은 공지 검사에 남은0.9.0 문구가 원인이었으며0.10.0 확정 문구로 대조를 갱신하고 공지9개·fresh build PASS를 확인했다. 실패 로그를 보존한다. 기존 API/SDK/DB 검증은 구현·의존성이 변하지 않아 재사용한다. 게시한 고정SHA의 CI는 전체 suite를 다시 실행한다.
