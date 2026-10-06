# 자주 찾는 장소 10개·지도 지점 등록 구현 계약 (Issue #123)

상태: V1 인수(1차 6건·재확인 2건 수정 필수 반영, 2026-10-07). DB·서버 구현과 로컬 격리 DB 검증 완료, V2 지적 반영(7절). 화면·Android·hosted 적용은 미완료. 기준 `origin/develop` 8679f63. 웹·Android 함께 적용, 버전 0.13.0.
화면 시안은 Figma 작업 중이며 노드 대응표는 Issue #123에 기록한다. 이 문서는 DB·서버 계약과 클라이언트가 지켜야 할 경계를 소유한다.

## 1. 확인한 현재 상태

- 별표는 `saved_places.star_slot`(1..5, owner별 unique) 한 칸에 있다. 웹 `lib/places/saved.ts`와 Android `SavedPlaceClient.kt`(code13, Play 내부 배포본)는 `saved_places`를 직접 select하고, **별표가 5개를 넘거나 번호가 1..5 밖이면 목록 전체를 오류로 처리**한다.
- 구버전 3칸 호환 view `place_favorites`(star_slot 1..3)와 `add_place_favorite`/`remove_place_favorite`가 남아 있다.
- 지도 지점 등록은 `search-places` coordinate 모드(`coord2address`)를 쓴다. 문서가 0건이면 장소를 만들지 않아 "주소를 찾지 못했어요"로 끝나고 등록할 수 없다.

## 2. 별표 10개 데이터 구조 (고위험: DB·migration·동시성)

`star_slot` 범위를 10으로 늘리면 구버전 Android의 즐겨찾기 화면이 전부 오류가 된다. 그래서 별표를 별도 테이블로 옮기고 기존 칸은 구버전용 거울로 남긴다. #124의 공유 폴더 장소 별표도 같은 테이블에 열을 추가해 수용한다.

```
public.place_stars(
  owner_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot between 1 and 10),
  saved_place_id uuid not null references public.saved_places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, slot),
  unique (owner_id, saved_place_id)
)
```

불변식 (owner마다, 모든 트랜잭션 commit 시점):
- I1. 별표 수 ≤ 10, slot과 장소는 각각 중복 없음. `saved_place_id`는 같은 owner의 장소만 가리킨다.
- I2. 거울: `saved_places.star_slot = s` ⇔ `place_stars`에 (owner, s, 그 장소)가 있고 s ≤ 5. slot 6..10 별표의 `star_slot`은 null. 기존 check(1..5)·unique index는 유지한다.
- I3. 별표 변경 RPC는 해당 `saved_places.revision`을 정확히 1 올리고 `updated_at`을 갱신한다. 변경이 없으면(no-op) revision은 그대로다.
- I4. 모든 변경 RPC는 기존 owner별 advisory lock `place-favorites:<uid>` 안에서 한다.

### 2.1 DB 수준 동기화 (V1 #2: 전환 경계)
RPC 본문 버전과 무관하게 I1·I2가 유지되도록 DB가 강제한다.
- 모든 신규·교체 RPC는 별표를 `place_stars`에만 쓴다. `place_stars` 변경 trigger가 같은 트랜잭션에서 `star_slot` 거울을 맞춘다(revision은 올리지 않음, RPC가 1회 올림).
- `saved_places.star_slot`을 직접 바꾸는 경로(이관 commit 직후에도 옛 본문으로 끝나는 구 RPC 호출 포함)는 `saved_places` trigger가 `place_stars`에 반영한다: 새 값 s → 그 장소의 기존 별표를 s로 맞춤(다른 장소가 s를 가지면 오류로 전체 rollback), null → 그 장소의 1..5 별표만 삭제(6..10은 유지). 거울 trigger가 다시 부른 경우 재귀하지 않는다.
- commit 시점 검사: `DEFERRABLE INITIALLY DEFERRED` constraint trigger가 변경된 owner의 I1·I2를 검사하고 위반이면 트랜잭션을 실패시킨다.
- migration 순서(한 트랜잭션): `saved_places`에 `SHARE ROW EXCLUSIVE` lock → 테이블·trigger 생성 → backfill → 함수 교체 → 전체 I1·I2 검사. lock이 진행 중인 쓰기 트랜잭션의 종료를 기다리고, lock 대기 중이던 옛 본문 호출은 commit 뒤 trigger를 거쳐 반영된다.

### 2.2 조회 경계 (V1 #5)
- 신규 클라이언트는 `security_invoker` view `saved_place_entries`(= `saved_places` left join `place_stars`, 열: 기존 열 + `star_position` 1..10)를 **한 번** select한다. 한 문장이라 한 snapshot이며, 장소·별표·revision이 같은 시점이다. 구버전은 기존 `saved_places` select를 그대로 쓴다.
- 변경 응답(행)과 목록이 다르면 목록을 1회 재조회하고, 그래도 다르면 오류 상태와 재시도를 표시한다. 늦게 도착한 이전 조회 결과는 세대 번호로 버린다(기존 provider 규칙).

### 2.3 RPC와 상태 전이 (V1 #3)
- 신규 `set_place_star(saved_place_id, expected_revision, starred)` → 변경 후 `saved_place_entries` 행. starred=true: 미지정→1..10 최소 빈 slot(가득이면 `SAVED_PLACE_STAR_LIMIT`), 지정됨→no-op. false: 지정됨→삭제, 미지정→no-op. 없음 `SAVED_PLACE_NOT_FOUND`, revision 불일치 `SAVED_PLACE_STALE`.
- 신규 `save_place_v2(saved_place, place_alias, place_kind, starred)` → `saved_place_entries` 행. `save_place`와 같은 검증·중복·1,000개 한도. 새 장소의 별표는 1..10. 중복 장소면 기존 행을 변경 없이 반환.
- 구버전 RPC는 구버전 화면에 보이는 거울 기준으로 동작한다(반환 형태·오류 코드 불변):

| 구 RPC | 현재 별표 | 결과 | revision |
|---|---|---|---|
| `set_saved_place_star` true | 없음 | 1..5 최소 빈 slot, 없으면 `SAVED_PLACE_STAR_LIMIT` | +1 / 불변 |
| 〃 true | 1..5 | no-op | 불변 |
| 〃 true | 6..10(구버전엔 미지정으로 보임) | 빈 1..5로 원자적 이동, 없으면 `SAVED_PLACE_STAR_LIMIT`(6..10 유지) | +1 / 불변 |
| `set_saved_place_star` false | 1..5 | 삭제 | +1 |
| 〃 false | 없음 또는 6..10 | no-op(숨은 별표 유지) | 불변 |
| `save_place` starred | 새 장소 | 1..5, 없으면 `SAVED_PLACE_STAR_LIMIT` | 신규 행 |
| 〃 | 중복 장소 | 기존 행 그대로 반환 | 불변 |
| `add_place_favorite` | 1..3 | 기존 `{slot, place, created_at}` 반환 | 불변 |
| 〃 | 4..5 | `FAVORITE_LIMIT`(기존) | 불변 |
| 〃 | 없음 또는 6..10 | 빈 1..3으로 지정/이동, 없으면 `FAVORITE_LIMIT` | 성공 +1 / `FAVORITE_LIMIT`이면 불변 |
| 〃 | 새 장소 | 빈 1..3에 새 행, 없으면 `FAVORITE_LIMIT` | 신규 행 |
| `remove_place_favorite(slot, id)` | 그 slot(1..3)·그 장소 | 별표 삭제 | +1 |
| 〃 | 그 외 | `FAVORITE_NOT_FOUND` | 불변 |

- `update_saved_place`·`delete_saved_place`: 기존 계약 유지, 삭제 시 별표 cascade. `update_saved_place`는 아래 3절의 지역 지점 별명 필수 규칙을 적용한다.
- RLS·권한: `place_stars`·`saved_place_entries`는 active member 본인 행만 select. 직접 DML은 모든 역할 거부. 신규 security definer 함수는 `search_path = ''`, 첫 줄에서 active member 확인, owner 조건으로만 접근, `authenticated`에만 execute. `service_role` 실행 거부, 허용 함수 정확히 14개와 future-object ACL 불변.

### 2.4 데이터 이관과 복구 (V1 #1)
- backfill: `insert into place_stars(owner_id, slot, saved_place_id, created_at) select owner_id, star_slot, id, created_at from saved_places where star_slot is not null on conflict do nothing` 후 양방향 I1·I2 전체 검사, 실패 시 전체 rollback. 기존 행·원본 place·alias·kind·province·revision 불변. 재실행(6..10이 이미 있는 상태 포함) 무변화.
- 기본 복구는 **클라이언트만 이전 버전으로 되돌리고 DB(`place_stars`·trigger·호환 RPC·거울)는 유지**한다. 구버전 클라이언트는 2.3 표대로 동작하므로 6..10 별표는 숨겨질 뿐 유지된다.
- 이번 범위에서 DB 역이관(`place_stars` 제거·구 RPC 본문 복원)은 하지 않는다. 검사와 실행 사이에 새 6..10 별표가 생길 수 있어 보존을 보장할 수 없기 때문이다(V1 재확인 #1).

### 2.5 migration 잠금과 hosted 적용 (V2 #2)
- 최초 적용과 재실행은 잠금이 다르다. 두 경우 모두 `saved_places`에는 `SHARE ROW EXCLUSIVE`만 잡아 SELECT를 막지 않는다(`DROP TRIGGER/POLICY`는 `ACCESS EXCLUSIVE`라 쓰지 않고, trigger·정책은 없을 때만 만든다).
  - 최초 적용: `create policy`가 commit까지 auth 테이블 16개(`auth.users` 포함)에 `ACCESS EXCLUSIVE`를 잡는다. 로컬 이미지 17.6.1.166에서 확인했고 Supabase `supautils`의 허용 목록 잠금 문제와 일치한다(https://github.com/supabase/supautils/commit/42cc7f0c4b2655ee3f70a834e253e6a79c66f1d6). 그동안 로그인·auth 조회가 대기한다. 그래서 정책 생성을 commit 직전 마지막 문장으로 둔다.
  - 재실행: 정책·trigger가 이미 있으면 만들지 않으므로 auth 테이블을 잠그지 않는다.
- 상한: migration 첫 문장에서 `lock_timeout = 5s`(일반 RPC는 ms 단위라 5초 넘는 대기는 긴 쓰기·auth 트랜잭션이 진행 중이라는 뜻이고, 대기 중인 배타 잠금 요청은 뒤의 조회·로그인을 모두 줄 세운다), `statement_timeout = 60s`(현재 데이터에서 각 문장은 1초 미만이므로 폭주한 문장이 잠금을 오래 쥐지 못하게 한다)를 둔다. 둘 다 넘으면 전체 rollback된다.
- 로컬 실측(격리 DB, fixture 수십 행): 본문 전체 12ms. `saved_places` 쓰기 트랜잭션이나 auth 쓰기(`auth.sessions`)가 잠금을 쥐고 있으면 각각 약 5.1초 뒤 lock timeout으로 실패하고 아무것도 남지 않는다.
- hosted 적용 전 확인(사용자 승인 후, 실제 영향은 NOT_RUN):
  1. 대상 프로젝트의 Postgres 버전(`select version()` 또는 대시보드)을 확인하고, 포함된 `supautils`가 위 commit을 포함하는지 Supabase 릴리스 노트로 대조한다. 판단할 수 없거나 미포함이면 영향이 있는 것으로 본다. Preview는 로컬과 같은 17.6.1.166이었으므로 영향이 있을 것으로 예상한다(미확인).
  2. 필요하면 rollback 전용 probe로 확인한다: `begin; create table public.motocast_lock_probe(id int); alter table public.motocast_lock_probe enable row level security; create policy p on public.motocast_lock_probe for select to authenticated using (true); select count(*) from pg_locks where pid=pg_backend_pid() and mode='AccessExclusiveLock' and relation in (select oid from pg_class where relnamespace='auth'::regnamespace); rollback;` 결과가 0보다 크면 영향이 있다.
  3. 영향이 있으면 저트래픽 시간에 적용한다. 잠금 대기 상한 5초, 문장 실행 상한 60초. 실패하면 자동 rollback되므로 `pg_stat_activity`에서 차단 세션을 확인하고, 재시도는 원인 확인 뒤 1회만 한다. 로그인 오류 보고나 5초를 넘는 auth 대기가 관측되면 중단하고 보고한다.

## 3. 주소 없는 지도 지점 (서버 계약, 비용)

- 신규 클라이언트만 coordinate 요청에 `fallback: "region"`을 보낸다. 없으면(구버전) 지금과 똑같이 동작한다. 서버 요청 파서는 이 선택 키만 추가로 허용한다.
- `coord2address` 문서 0건이고 `fallback: "region"`이면 `coord2regioncode`를 **한 번** 더 조회한다. 두 번째 호출 전에도 같은 `local_keyword_search` 일일 예산을 차감한다. 주소 성공 시 1회, 대체 조회 시 최대 2회. 두 번째 차감 거부·응답 유실·timeout·4xx/5xx·잘못된 JSON은 추가 호출이나 환급 없이 오류이며 빈 결과로 위장하지 않는다. 지역 문서도 없으면 빈 결과.
- 지역 문서는 `region_type = "B"` 1건만 쓴다(B/H 혼합·순서 무관, B 없음이면 빈 결과, B가 여러 개거나 문서가 10건을 넘거나 형식 오류면 오류). 응답 좌표는 쓰지 않고 선택 좌표를 그대로 쓴다.
- 지역만 찾은 장소: `kakaoPlaceId = map:<lat7>:<lng7>:region`(80자 이하, 서명 대상이라 저장 후에도 식별됨), `address` = B 문서 `address_name`, `roadAddress = null`, `name` = `<region_2depth_name> <region_3depth_name> 부근`(비면 address 기반), `category = "지도에서 선택 · 상세 주소 없음"`. 문자열은 서명 전에 trim·제어문자 검사로 정규화한다.
- 별명 필수: `kakaoPlaceId`가 `:region`으로 끝나는 장소는 `save_place_v2`·`update_saved_place`에서 alias null을 `INVALID_SAVED_PLACE_METADATA`로 거부한다. 구 `save_place`·`add_place_favorite`는 이런 장소를 받을 일이 없지만(구버전은 요청하지 않음) 같은 규칙으로 거부한다. 신규 클라이언트는 id 접미사로 "상세 주소 없음"을 표시한다.
- 클라이언트 응답 검사(웹 `map-point-confirmation.tsx`, Android `PlaceSearchContract`): `fallback: "region"`을 보낸 요청에 한해 id가 정확히 `map:<lat7>:<lng7>` 또는 정확히 `map:<lat7>:<lng7>:region`일 때만 통과한다. 선택 좌표 일치·응답 1건 이하·`isEnd` 검사는 유지하고, 다른 좌표·임의 접미사는 거부한다. opt-in이 없는 요청은 기존 검사 그대로다.
- 소비 경로(V1 대조): plan-route·save-collection·journey-route는 기존 서명 검증으로 통과·변조 거부, recommend-restaurants는 기존 형식 검사만 한다(서명 미검증은 기존 동작이며 이번 범위에서 바꾸지 않음).

## 4. 클라이언트 경계 (V1 대상 아님, 참고)

- 명칭 "자주 찾는 장소", 한도 10, 노란 채운 별. 장소 선택 팝업(`PlaceSearchField`를 등록 창에서 쓰는 경우)에서 자주 찾는 장소 목록 제거.
- 등록 창 안 지도 지점 선택(기존 길게 누르기 유지), 검색 결과 지도(이미 받은 좌표만 사용, 추가 검색·길찾기·날씨 호출 0).
- 지도 핀 축소와 줌별 묶음은 클라이언트 계산. 외부 API 호출을 늘리지 않으며 지도 SDK 사용량은 #99 원칙대로 네트워크 요청과 구분해 관측한다.
- 제품 정본 PLAN-004·UI-001(5개→10개, 명칭, 지역 지점)을 같은 PR에서 갱신한다(V1 제안).

## 5. 검증 계획

- 격리 로컬 DB(`127.0.0.1:54322`, reset은 사용자 승인 후): 이관 전 fixture(별표 0/3/5개, 구 3칸 호환 행, 충돌 데이터) → migration → 행 보존·I1·I2, 재실행 무변화(6..10 존재 상태 포함), 충돌 fixture에서 전체 rollback.
- 전환 경계: 두 연결로 옛 본문 구 RPC를 lock 대기시킨 채 migration commit → 대기 호출 종료 후 I1·I2 유지.
- RLS/권한 행렬(관리자·Rider A/B·회원 해지·비회원·익명·service_role): 테이블·view select, 직접 DML 거부, 신규·교체 RPC 각각의 실행 권한·active member·owner 제한·`search_path`, 허용 함수 14개·future ACL 불변.
- 상태 전이: 2.3 표 전체 행(결과·revision·오류), 신규 RPC no-op/limit/stale/not found.
- 동시성: 같은 owner 11번째 별표 동시 요청 → 한도까지만 성공. 구·신 RPC 혼용 시 I2. 별표·거울 변경 사이 강제 실패 → 전체 rollback. 응답 유실 후 재조회만 하고 자동 재전송 없음.
- 구버전 호환: 별표 6..10이 있어도 `saved_places` select가 구버전 파서 조건(별표 ≤5, slot 1..5) 만족. `place_favorites` view 1..3. 구 RPC 응답 형태 불변.
- 조회 경계: view 단일 조회의 snapshot 일관성, 변경 응답과 목록 불일치 시 1회 재조회·오류 표시.
- Edge: `fallback` 없음=기존 동작, 주소 성공 1회, 대체 2회, 잔여 예산 1에서 두 번째 차감 거부, 두 번째 차감 응답 유실, timeout/4xx/5xx/잘못된 JSON, B/H 혼합·B 없음·B 형식 오류, 정규화·선택 좌표 보존, 서명 변조 거부, plan-route·save-collection·journey-route·recommend-restaurants의 정상·변조·저장 후 재사용.
- 별명 필수: 지역 지점 alias null 저장·수정 거부, 저장 후 재조회에서 "상세 주소 없음" 복원.
- 클라이언트 응답 검사: opt-in 요청의 정상 지역 응답 통과, 다른 좌표·임의 접미사·opt-in 없는 요청의 `:region` 응답 거부(웹·Android).
- 웹·Android 단위/화면 검증, Preview 실제 계정, Android 384/320/글자 1.3 기기 확인은 저장소 gate대로.

## 6. V1 판정 기록 (2026-10-07)

| 지적 | 판정 | 처리 |
|---|---|---|
| 1 복구 절차 | 수정 필수 | 2.4 클라이언트 우선 복구, DB 역이관 없음 |
| 2 전환 경계 | 수정 필수 | 2.1 DB trigger 동기화·deferred 검사·lock 순서 |
| 3 구 RPC 상태 전이 | 수정 필수 | 2.3 표 |
| 4 지역 지점 식별 | 수정 필수 | 3절 `:region` id 접미사·서버 별명 필수·`fallback` opt-in |
| 5 조회 경계 | 수정 필수 | 2.2 단일 view 조회 |
| 6 검증 계획 | 수정 필수 | 5절 보강 |
| 제안: 정본 동기화 | 제안 반영 | 4절 |
| 재확인 #1 역이관 경쟁 조건 | 수정 필수 | 2.4 DB 역이관 금지 |
| 재확인 #2 클라이언트 `:region` 검사 | 수정 필수 | 3절 opt-in 한정 허용, 5절 사례 추가 |
| 재확인 제안: revision 표기 | 제안 반영 | 2.3 표 |

재확인 2건은 검증자가 제시한 최소 수정안을 그대로 반영했으므로 별도 V1 라운드 없이 인수하고, 구현 커밋의 V2에서 함께 확인한다. 구현 시 주의(검증자): constraint trigger는 `AFTER ROW`로 두고 재귀 억제가 최종 I1·I2 검사를 건너뛰지 않게 한다. `SHARE ROW EXCLUSIVE`는 SELECT를 막지 않으므로 "모든 옛 호출 배출"로 해석하지 않는다.

## 7. 구현 해석과 V2 판정 기록 (2026-10-07)

구현자 해석(오케스트레이터 인수):
- `add_place_favorite`는 지역 지점으로 새 행을 만들 때만 `INVALID_FAVORITE_PLACE`로 거부한다. 별명이 이미 있는 지역 지점에 별표를 다는 것은 허용한다(alias null 저장이 생기지 않음). `save_place`·`save_place_v2`는 중복 확인 전 검증에서 거부한다.
- `update_saved_place` 오류 순서: `SAVED_PLACE_NOT_FOUND` → `SAVED_PLACE_STALE` → `INVALID_SAVED_PLACE_METADATA`.
- 지역 응답 문서는 10건까지만 받는다(3절).
- 내부 오류 코드: `SAVED_PLACE_STAR_INVARIANT`(commit 시 I1·I2 위반), `SAVED_PLACE_STAR_CONFLICT`(거울 직접 쓰기가 다른 장소의 별표 칸을 가리킬 때. 정상 경로에서는 unique index가 먼저 막아 도달하지 않는 방어용).

V2(후보 b8b9b4d) 판정:

| 지적 | 판정 | 처리 |
|---|---|---|
| 1 0행 반환 시 단언 누락·하네스 `passed > 0` | 수정 필수 | 행 수와 값을 함께 단언, suite별 고정 계획 수(146/26/78/17)와 하네스 계획 수 |
| 2 최초 적용 auth 잠금 | 수정 필수 | 2.5: timeout 상한, 정책 생성을 마지막으로, hosted 사전 확인 절차 |
| 제안 3 지역 문서 10건 제한 | 제안 반영 | 3절 명시, 10/11건 경계 테스트 |
| 제안 4 문서 정리 | 제안 반영 | 상태 줄, 6절 1번 문구, 이 절 |
