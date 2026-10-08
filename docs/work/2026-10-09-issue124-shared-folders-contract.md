# Issue #124 공유 폴더·기피 장소·식당 추천 반영 — 구현 계약

상태: 계약 r3(2026-10-09, Codex V1 지적 1~10과 재검증 R2-1~R2-3 반영). 목표 버전 0.14.0. 결정 원본: Issue #124 본문과 2026-10-09 댓글. 화면 원본: Figma 작업 중 페이지 `389:12914`, 섹션 `367:10933`(대응표는 Issue #124 2026-10-09 댓글).

이 문서는 웹 저장소 slice(DB, Edge, 웹 UI)와 Android 저장소 slice가 함께 의존하는 계약이다. 바꾸려면 이 문서를 먼저 고치고 영향 slice를 다시 맞춘다.

## 1. 범위와 결정 요약

- 공유 폴더: 여러 개, 초대 링크로만 참여, 회원만 조회. 회원은 폴더용 이름(display name)으로만 표시하고 카카오 닉네임(profiles)은 노출·기본값 사용하지 않는다.
- 역할: `owner`(만든 사람, 1명, 항상 전체 권한) / `editor`(장소 추가·수정·삭제) / `viewer`(조회·경로 선택·별표·기피 표시만). 초대 수락 기본값은 `editor`. owner만 이름 변경·삭제·초대 링크 생성/회수·회원 내보내기·권한 변경. owner는 나가기 대신 삭제한다.
- 폴더 켜기/끄기: 회원별(계정 기준, 서버 저장). 꺼진 폴더 장소는 즐겨찾기 지도·목록, 장소 선택의 폴더 장소 목록, **식당 추천 후보**에서 빠진다. 새로 만들거나 참여한 폴더는 켜진 상태. 별표(자주 찾는 장소)는 폴더가 꺼져도 표시하고 경로 선택에 쓸 수 있다.
- 합쳐 보기: 즐겨찾기 "장소" 화면은 내 장소 + 켜 둔 폴더 장소를 함께 보여 준다. 중복 판정은 `place.kakaoPlaceId` **문자열 전체 일치**(정규화 없음). 내 장소 우선, 폴더끼리만 겹치면 `(shared.created_at, shared.id)`가 가장 이른 행을 대표로 쓰고 출처 폴더 목록을 함께 준다. 지도 지점은 `map:<lat7>:<lng7>`, 지역 지점은 그 뒤에 `:region`이 붙은 kakaoPlaceId를 가지며 같은 규칙으로 비교한다(같은 좌표라도 `:region` 유무가 다르면 다른 장소).
- 기피 장소: 개인 목록(나만), 지도에 항상 표시(토글 없음), 식당 추천 후보에서 제외. 공유 폴더 장소를 기피로 표시해도 폴더에서는 지워지지 않는다.
- 별표: 개인 장소 + 공유 장소 합계 10. 공유 장소가 삭제되거나 내가 폴더에서 빠지면(나가기·내보내짐·폴더 삭제·계정 삭제) 그 폴더 장소의 내 별표도 지운다.
- 처음 폴더 만들기: 내 장소를 개수 제한 없이 골라 복사(빈 폴더 허용). 이후 편집 권한자는 "내 장소에서 가져오기"로 추가(이미 있는 장소는 건너뜀).
- 초대 링크를 로그인 전에 열면 폴더 이름·주인 이름을 숨긴다. 로그인한 활성 회원에게만 수락 화면에서 폴더 이름과 주인의 폴더용 이름을 보여 준다.
- 기존 일정·코스·공유 결과는 소급 변경하지 않는다(장소 스냅샷 유지).

## 2. 한도

| 항목 | 값 | 직렬화 lock | 오류 코드 |
|---|---|---|---|
| 사용자당 속한 폴더(주인+회원) | 20 | 사용자 | `PLACE_FOLDER_LIMIT` |
| 폴더당 회원(주인 포함) | 30 | 폴더 | `PLACE_FOLDER_MEMBER_LIMIT` |
| 폴더당 장소 | 1,000 | 폴더 | `PLACE_FOLDER_PLACE_LIMIT` |
| 폴더당 사용 중 초대 링크 | 10 | 폴더 | `PLACE_FOLDER_INVITE_LIMIT` |
| 기피 장소 | 사용자당 200 | 사용자 | `AVOIDED_PLACE_LIMIT` |
| 별표 | 개인+공유 합계 10 | 사용자 | 기존 `SAVED_PLACE_STAR_LIMIT` |
| 폴더 이름 | 1~40자, 앞뒤 공백 없음, 제어문자 없음 | — | `INVALID_PLACE_FOLDER` |
| 폴더용 이름 | 1~20자, 앞뒤 공백 없음, 제어문자 없음, 폴더 안 `lower()` 중복 불가 | 폴더 | `INVALID_FOLDER_DISPLAY_NAME`, `FOLDER_DISPLAY_NAME_TAKEN` |
| 초대 링크 | 생성 후 7일 만료(경계: `expires_at > clock_timestamp()`만 유효), 회수 가능 | 폴더 | `PLACE_FOLDER_INVITE_INVALID`(만료·회수·없음 구분 안 함) |
| 공유 장소 별명 | 기존 saved place 규칙(1~80자). 지역 지점(`:region`)은 별명 필수(기존 규칙 그대로) | — | `INVALID_SAVED_PLACE_METADATA` |

## 3. 데이터 (migration 하나, 운영 데이터 보존)

- `place_folders(id uuid pk, owner_id uuid not null → auth.users on delete cascade, name text, revision bigint >0, created_at, updated_at)`.
- `place_folder_members(folder_id → place_folders on delete cascade, member_id → auth.users on delete cascade, role text check in ('owner','editor','viewer'), display_name text, revision bigint, joined_at, updated_at, pk(folder_id, member_id))`. 폴더마다 owner 행 정확히 1개(부분 unique index), `unique(folder_id, lower(display_name))`.
- `place_folder_preferences(member_id, folder_id, enabled boolean not null default true, updated_at, pk(member_id, folder_id), fk (folder_id, member_id) → place_folder_members on delete cascade)`. 회원 행 생성과 같은 트랜잭션에서 `enabled=true`로 만든다. **본인 행만 SELECT**. 다른 회원의 켜기/끄기는 어떤 경로로도 읽을 수 없다(V1 #4).
- `shared_places(id uuid pk, folder_id → place_folders on delete cascade, place jsonb check is_valid_saved_place, alias, kind riding_spot|restaurant, province, revision, created_by uuid, updated_by uuid, created_at, updated_at, unique(folder_id, (place->>'kakaoPlaceId')))`. `created_by`/`updated_by`는 FK 없이 user id만 저장(나간 회원 표시용). 화면 표시는 현재 회원이면 그 폴더용 이름, 아니면 "나간 회원". 원래 place jsonb(서명 포함)는 바꾸지 않고 복사한다.
- `place_folder_invites(id uuid pk, folder_id cascade, token_hash text unique (SHA-256 hex 64자), created_by, created_at, expires_at (= created_at + 7일), revoked_at)`. 원문 토큰은 생성 RPC 응답에서 한 번만 반환하고 DB·로그에 저장하지 않는다. 토큰은 32바이트 CSPRNG, base64url(SHARE-002 재사용).
- `avoided_places(id uuid pk, owner_id → auth.users cascade, place jsonb check is_valid_saved_place, source_shared_place_id uuid null(참고용, FK 없음), created_at, unique(owner_id, (place->>'kakaoPlaceId')))`.
- `shared_place_stars(owner_id → auth.users cascade, shared_place_id → shared_places on delete cascade, created_at, pk(owner_id, shared_place_id))`. **#123의 `place_stars`(개인 별표, slot 1..10, `saved_places.star_slot` 1..5 mirror, 불변식 trigger)는 표·trigger·불변식을 그대로 둔다**(V1 #1). 공유 별표는 slot이 없고 mirror에 나타나지 않는다.
  - 합계 10 불변식: 사용자별 `count(place_stars) + count(shared_place_stars) <= 10`. 증가시키는 모든 쓰기(개인 별표 RPC 포함)는 사용자 lock 아래에서 두 표를 함께 세고, 두 표 모두에 deferred constraint trigger로 커밋 시 재검사한다.
  - 기존 개인 별표 RPC(0.13.0의 `set_saved_place_star`·`save_place`(starred)·구버전 `add_place_favorite` 등 별표를 늘리는 모든 함수)는 `create or replace`로 합계 검사만 공유 별표까지 넓힌다. 서명·반환 형태·오류 코드는 유지한다. 결과: 구버전(0.13.0) 클라이언트는 개인 별표가 10 미만으로 보여도 공유 별표 때문에 `SAVED_PLACE_STAR_LIMIT`를 받을 수 있다(기존 한도 안내가 뜨고 데이터는 깨지지 않음). 이 차이는 0.14.0 업데이트 안내로 해소하며 Release 기록에 남긴다.
  - 공유 별표의 회원 자격: 회원 행이 삭제되면 같은 트랜잭션에서 그 회원의 해당 폴더 `shared_place_stars`를 삭제한다(trigger). 별표 추가 RPC는 폴더 lock(공유 모드) 아래에서 회원 자격을 확인한다.
  - 자주 찾는 장소 목록 순서: 별표를 붙인 시각(`place_stars.created_at`, `shared_place_stars.created_at`) 오름차순, 같으면 id. 개인 slot은 구버전 mirror용으로만 쓴다.
- 계정 삭제: 주인이면 폴더가 cascade로 삭제, 회원이면 회원 행·설정·별표·기피만 삭제. cascade 경로는 advisory lock을 잡지 않으며 개수를 줄이기만 하므로 한도 불변식에 영향이 없다.

## 4. 권한 (RLS + security definer RPC)

- 모든 표: 직접 INSERT/UPDATE/DELETE 거부(authenticated·anon·service_role에 DML grant 없음). service_role 허용 함수 목록은 바꾸지 않는다(테스트로 정확한 목록 비교).
- 회원 판정은 security definer 헬퍼 `is_place_folder_member(folder_id)`(stable, `search_path=''`, 활성 회원 + 회원 행 존재)로 하며 RLS 정책이 `place_folder_members`를 자기참조하지 않는다.
- SELECT(authenticated, `is_active_member()` 필수):
  - `place_folders`, `shared_places`, `place_folder_members`: 내가 회원인 폴더의 행만. members 열은 folder_id, member_id, role, display_name, joined_at, revision.
  - `place_folder_preferences`, `avoided_places`, `shared_place_stars`: 본인 행만.
  - `place_folder_invites`: 직접 SELECT 없음. 주인용 목록 RPC만(id, created_at, expires_at, revoked_at; 토큰·해시 미노출).
- 익명·비회원·해지 회원은 모든 읽기·RPC 거부(`MEMBERSHIP_REQUIRED`).
- 존재 숨김: 회원이 아닌 폴더의 `folder_id`, 그 폴더의 `shared_place_id`, 주인이 아닌 폴더의 `invite_id`는 존재하지 않는 id와 **같은 오류**(`PLACE_FOLDER_NOT_FOUND` / `SHARED_PLACE_NOT_FOUND` / `PLACE_FOLDER_INVITE_NOT_FOUND`)를 낸다. 권한 부족(회원이지만 viewer 등)은 `PLACE_FOLDER_FORBIDDEN`.
- `profiles`와 카카오 닉네임은 어떤 공유 폴더 RPC·view에서도 읽거나 반환하지 않는다.

## 5. 동시성 규칙 (V1 #2·#3)

- advisory lock 이름: 폴더 `place-folder:<folder_id>`, 사용자 `place-favorites:<user_id>`(#123과 같은 이름 재사용, 별표·기피·폴더 수 모두 이 lock).
- **획득 순서: 필요한 폴더 lock 전부를 folder_id 오름차순으로 → 필요한 사용자 lock 전부를 user_id 오름차순으로.** 행 변경은 모든 lock을 잡은 뒤에만 시작하고, lock 뒤에 권한·대상·revision·한도를 다시 확인한다.
- 개인 장소 RPC(#123 기존 함수 포함)는 사용자 lock만 잡고 폴더 lock을 요구하지 않는다.
- 개수를 줄이기만 하는 삭제(장소 삭제, 회원 내보내기·나가기, 폴더 삭제, cascade)는 다른 사용자의 lock을 잡지 않는다. 별표 정리는 FK cascade 또는 trigger로 같은 트랜잭션에서 한다.
- 별표 추가는 폴더 lock을 공유 모드(`pg_advisory_xact_lock_shared`)로, 사용자 lock을 배타 모드로 잡는다. 회원 내보내기·나가기·폴더 삭제는 폴더 lock을 배타 모드로 잡는다.
- 초대 수락 순서: 폴더 lock → 사용자 lock → (1) 이미 회원이면 기존 회원 행으로 멱등 성공(이름 변경 안 함) → (2) 토큰 무효(없음·만료·회수) `PLACE_FOLDER_INVITE_INVALID` → (3) 폴더 회원 30 → (4) 내 폴더 20 → (5) 폴더용 이름 검증·중복. 폴더 생성은 사용자 lock 아래에서 20을 검사한다.

## 6. RPC (모두 security definer, `set search_path = ''`, authenticated만 execute)

공통: 반환은 바뀐 결과 행(영수증). 영향 행 수가 기대와 다르면 예외(쓰기 누락 숨기지 않음). 수정 RPC는 `expected_revision` 불일치 시 `*_STALE`. 클라이언트는 결과를 모르는 실패(응답 유실·시간 초과)에서 자동 재전송하지 않고 다시 읽어 반영 여부를 판단한다(UI-001, FP39).

- `create_place_folder(folder_name text, display_name text, saved_place_ids uuid[])` → 폴더·내 회원 행. 내 saved_places만 복사(place·서명·alias·kind·province 그대로), 남의 id·없는 id·중복 id가 섞이면 전체 거부, 1,000 초과 거부, 내 폴더 20 한도. 원자적.
- `rename_place_folder(folder_id, expected_revision, folder_name)` 주인.
- `delete_place_folder(folder_id, expected_revision)` 주인.
- `create_place_folder_invite(folder_id)` 주인 → `{ id, token, expires_at }`(token은 이 응답에서만).
- `list_place_folder_invites(folder_id)` 주인 → 사용 중 링크만(회수·만료 제외, SHARE-002 목록 규칙과 같음).
- `revoke_place_folder_invite(invite_id)` 주인. 이미 회수면 성공(멱등).
- `preview_place_folder_invite(token text)` 활성 회원 → `{ status: 'joinable'|'already_member', folder_id?, folder_name, owner_display_name, member_count }` 또는 `PLACE_FOLDER_INVITE_INVALID`.
- `accept_place_folder_invite(token text, display_name text)` → 회원 행(role editor) + 설정 행(enabled true). 순서는 5절.
- `set_place_folder_display_name(folder_id, expected_revision, display_name)` 본인 회원 행.
- `set_place_folder_member_role(folder_id, member_id, expected_revision, role)` 주인, owner 행 변경 불가, role in (editor, viewer).
- `remove_place_folder_member(folder_id, member_id, expected_revision)` 주인, owner 제거 불가.
- `leave_place_folder(folder_id)` 회원(주인은 `PLACE_FOLDER_OWNER_CANNOT_LEAVE`).
- `set_place_folders_enabled(changes jsonb)` 본인: `[{folderId, enabled}]` 1~20개, **사용자가 이번에 바꾼 항목만** 원하는 최종 상태로 보낸다(desired-state, 멱등). revision 없이 마지막 쓰기 우선인 것은 명시적 예외다: 같은 항목을 두 기기에서 바꾸면 나중 것이 이기고, 바꾸지 않은 항목은 건드리지 않는다. 회원 아닌 폴더가 섞이면 전체 거부. 반환은 내 전체 설정 목록.
- `add_shared_place(folder_id, place jsonb, place_alias, place_kind)` editor/owner → `{ status: 'added'|'already_exists', shared_place }`.
- `import_saved_places_to_folder(folder_id, saved_place_ids uuid[])` editor/owner → `{ added, skipped_existing }`. 남은 자리보다 추가할 수가 많으면 전체 거부 `PLACE_FOLDER_PLACE_LIMIT`(부분 추가 없음).
- `update_shared_place(shared_place_id, expected_revision, place_alias, place_kind)` editor/owner, `updated_by` 갱신.
- `delete_shared_place(shared_place_id, expected_revision)` editor/owner.
- `set_shared_place_star(shared_place_id, starred boolean)` 폴더 회원 누구나(viewer 포함). desired-state(멱등)라 revision을 받지 않는다(개인 별표 상태는 공유 장소 revision과 무관). 합계 10.
- `add_avoided_place(place jsonb, source_shared_place_id uuid default null)` 본인, 200 한도, 같은 장소 멱등. source가 주어지면 그 공유 장소를 볼 수 있는 회원인지 확인.
- `remove_avoided_place(avoided_place_id)` 본인.
- 읽기 view(security_invoker): `my_star_entries`(개인+공유 별표를 한 번에, 정렬 3절), `shared_place_entries`(폴더 장소 + 마지막 수정자 폴더용 이름/나간 회원 여부). 클라이언트는 `(folder_id, created_at, id)` 순서로 1,000행씩 페이지를 넘겨 모두 읽는다(잘라 버리지 않음).

### 6.1 확정한 반환 형태와 오류 코드 (DB slice, migration `20261009120000_shared_place_folders.sql`)

JSON 키는 열 이름 그대로 snake_case다. 예외는 계약이 정한 `set_place_folders_enabled` 입력(`folderId`, `enabled`)과 7.2의 `recommendation_shared_restaurants` 바깥 키(`rows`, `truncated`, `enabledTotal`, `disabledFolders`)뿐이다.

- 공통 객체: `folder` = `place_folders` 행 `{id, owner_id, name, revision, created_at, updated_at}`. `member` = `{folder_id, member_id, role, display_name, joined_at, revision}`(정확히 이 6개). `preference` = `{member_id, folder_id, enabled, updated_at}`.
- `create_place_folder` → `{folder, member, preference}`. `accept_place_folder_invite` → `{status: 'joined'|'already_member', folder, member, preference}`(이미 회원이면 기존 행, 이름 변경 없음).
- `rename_place_folder` → `setof place_folders`(1행). `set_place_folder_display_name`·`set_place_folder_member_role` → `member` 객체. 같은 역할로 바꾸면 revision을 올리지 않고 현재 행을 돌려준다.
- `create_place_folder_invite` → `{id, token, expires_at}`(정확히 3개). `list_place_folder_invites`·`revoke_place_folder_invite` → `table(id, created_at, expires_at, revoked_at)`; 목록은 `revoked_at is null and expires_at > now`만, `(created_at, id)` 순서.
- `preview_place_folder_invite` → `{status, folder_name, owner_display_name, member_count}`; `folder_id`는 `status='already_member'`일 때만 들어간다. 이미 회원이면 회수·만료된 링크로도 `already_member`(수락 순서 (1)과 같음).
- `set_place_folders_enabled` → `setof place_folder_preferences`(내 전체 설정, `folder_id` 순서). 값이 같으면 `updated_at`도 바꾸지 않는다. `folderId`는 대소문자 무관 uuid 문자열.
- `add_shared_place(folder_id, place, place_alias default null, place_kind default 'riding_spot')` → `{status: 'added'|'already_exists', shared_place}`; `shared_place`는 `shared_place_entries` 행. `import_saved_places_to_folder` → `{added, skipped_existing}`(정수 개수).
- `update_shared_place`·`set_shared_place_star` → `setof shared_place_entries`(1행). `add_avoided_place` → `setof avoided_places`(같은 장소면 기존 행). 삭제 계열(`delete_place_folder`, `remove_place_folder_member`, `leave_place_folder`, `delete_shared_place`, `remove_avoided_place`)은 `void`이며 영향 행 수가 1이 아니면 오류다.
- `shared_place_entries` 열: `id, folder_id, place, alias, kind, province, revision, created_by, updated_by, created_at, updated_at, updated_by_display_name`(나간 회원이면 null), `updated_by_left`(boolean), `starred`(내 공유 별표 여부).
- `my_star_entries` 열: `owner_id, source('saved'|'shared'), id, folder_id`(개인은 null), `place, alias, kind, province, revision, starred_at, star_slot`(공유는 null). 정렬은 클라이언트가 `(starred_at, id)`.
- `place_folder_members`는 열 단위로 `folder_id, member_id, role, display_name, joined_at, revision`만 SELECT할 수 있다(`select *` 불가).
- `recommendation_shared_restaurants`의 `rows` 원소: `{id, folder_id, place, alias, revision, created_at}`(정확히 6개, 식당만, `(created_at, id)` 순서). 경계 값이 null·NaN·무한대이거나 min > max면 `INVALID_RECOMMENDATION_REQUEST`.
- 이 절에서 더한 오류 코드: `PLACE_FOLDER_STALE`(폴더 revision), `PLACE_FOLDER_MEMBER_STALE`(회원 행 revision), `SHARED_PLACE_STALE`, `PLACE_FOLDER_MEMBER_NOT_FOUND`(주인이 지정한 회원이 없음), `INVALID_PLACE_FOLDER_ROLE`(editor·viewer 외), `INVALID_PLACE_FOLDER_PREFERENCES`(배열 아님·0개·21개 이상·키 오류·uuid 아님·같은 폴더 반복), `AVOIDED_PLACE_NOT_FOUND`, `PLACE_FOLDER_WRITE_CONFLICT`(가져오기 영향 행 불일치, 정상 경로에서는 나오지 않음). 장소 형식 오류는 기존 `INVALID_SAVED_PLACE`, 별명·종류·지역 지점 별명 누락은 `INVALID_SAVED_PLACE_METADATA`, 남의/없는 저장 장소 id는 기존 `SAVED_PLACE_NOT_FOUND`, id 목록의 null·중복은 `INVALID_PLACE_FOLDER`, 1,000개 초과 목록은 `PLACE_FOLDER_PLACE_LIMIT`. 주인 행 변경·주인 내보내기는 `PLACE_FOLDER_FORBIDDEN`.
- 커밋 시 불변식 위반(우회 쓰기에서만 가능): 별표 합계·비회원 공유 별표는 `SAVED_PLACE_STAR_INVARIANT`, 주인 행 1개·주인 일치·회원별 설정 행은 `PLACE_FOLDER_INVARIANT`.
- 잠금: 별표 추가·`set_place_folders_enabled`는 폴더 lock 공유 모드, 나머지 폴더 쓰기는 배타 모드. 사용자 lock을 잡는 RPC는 `create_place_folder`, `accept_place_folder_invite`, `import_saved_places_to_folder`(폴더 lock 다음), `set_shared_place_star`(폴더 lock 다음), `add_avoided_place`, `remove_avoided_place`와 기존 개인 RPC다.

## 7. 식당 추천 (`recommend-restaurants`, 비용 영역) (V1 #6·#7)

### 7.1 요청

- v1(기존, 키 집합 그대로): 동작·응답 형태 불변. 후보 = 내 식당 − 내 기피 장소. 남은 식당이 0이면 기존 `NO_SAVED_RESTAURANTS`.
- v2: 기존 키 + `contractVersion: 2`(정확한 키 집합 검사 유지). 다른 값은 `INVALID_RECOMMENDATION_REQUEST`.

### 7.2 후보 (v2)

- 내 식당(기존 1,000 읽기) + **켜 둔 폴더**의 식당 − 내 기피 장소. 중복은 1절 규칙(kakaoPlaceId 전체 일치, 내 장소 우선, 폴더 간 `(created_at, id)`).
- 공유 식당 읽기는 회원 JWT의 RLS 범위에서 security invoker 함수 `recommendation_shared_restaurants(min_lat, max_lat, min_lng, max_lng)` 하나로 한다. PostgREST `max_rows=1000`을 피하려고 **행 집합이 아니라 단일 JSON 값**을 반환한다: `{ rows: [...최대 2,000], truncated: boolean, enabledTotal: integer, disabledFolders: integer }`.
  - `rows`: 저장된 경로 경계 상자를 기존 사전 필터 반경(30 km)만큼 넓힌 범위 안의 켜 둔 폴더 식당, `(created_at, id)` 순서, 최대 2,000. 2,001번째가 있으면 `truncated=true`(조용히 버리지 않음).
  - `enabledTotal`: 경계 상자와 무관한 켜 둔 폴더 식당 총수(상태 판정용). `disabledFolders`: 내가 꺼 둔 폴더 수.
  - service_role 데이터 접근 없음. 함수 실패는 `RECOMMENDATION_STORAGE_FAILED`.
- 기피 일치: 기피 장소가 POI(`map:`로 시작하지 않음)면 **kakaoPlaceId 일치만**. 기피 장소가 지도 지점(`map:`)이면 kakaoPlaceId 일치 또는 좌표 30 m 이내(사용자 결정 2026-10-09). 지도 지점 기피는 200개 이하이므로 비교는 (후보 ≤ 3,000) × (지도 지점 기피 ≤ 200)이 상한이다.
- 비용 불변: 호출 상한(1끼 6·2끼 14), 예산 선차감, 30 km 사전 필터, 24시간 규칙은 바꾸지 않는다. 전체 후보에 하나의 예산 실행기만 쓴다(폴더별 반복 없음). 기피·폴더·공유 읽기 실패는 빈 목록이 아니라 `RECOMMENDATION_STORAGE_FAILED`로 실패한다. 예산 소진·설정 오류·provider 오류 뒤 추가 호출 없음. 후보가 모두 제외되면 provider 호출 0회.

### 7.3 응답 v2

```ts
type SourceRef =
  | { type: "saved"; id: string; revision: number }
  | { type: "shared"; id: string; revision: number; folderId: string };
type CandidateV2 = Omit<RecommendationCandidate, "savedPlaceId" | "savedPlaceRevision"> & {
  source: SourceRef;
  otherFolderIds: string[]; // 같은 장소가 있는 다른 켜 둔 폴더(표시용, 대표 제외)
};
type PairV2 = Omit<RecommendationPair, "firstSavedPlaceId" | "secondSavedPlaceId"> & { first: SourceRef; second: SourceRef };
type CoverageV2 = RecommendationCoverage & {
  sharedRestaurants: number;     // 중복 제거 전 켜 둔 폴더 식당 수(읽은 범위)
  duplicateMerged: number;
  avoidedExcluded: number;
  disabledFolders: number;       // 내가 꺼 둔 폴더 수
  sharedReadTruncated: boolean;
};
type ResponseV2 = { contractVersion: 2; status: "OK" | "NO_SAVED_RESTAURANTS" | "ALL_EXCLUDED"; /* 나머지 v1과 같음 */ meals; pairs: PairV2[]; coverage: CoverageV2 };
```

- `NO_SAVED_RESTAURANTS`: 내 식당 수 + `enabledTotal`이 0(경계 상자와 무관하게 후보가 될 식당 자체가 없음).
- `ALL_EXCLUDED`: 식당은 있고, 읽은 후보(내 식당 + 경계 상자 안 공유 식당)가 1개 이상이었는데 기피로 모두 빠졌고, `truncated=false`일 때만. `truncated=true`이면 읽은 범위가 전부 기피여도 `OK` + 빈 후보 + `sharedReadTruncated=true`로 응답한다(뒤쪽에 후보가 있을 수 있음).
- 경계 상자 안에 후보가 없을 뿐이면(멀리 있음) 지금처럼 `OK` + 빈 후보(`nearRoute=0`).
- 꺼 둔 폴더는 처음부터 후보가 아니므로 `coverage.disabledFolders`로만 안내한다.
- 클라이언트 쿼리 파서의 coverage 상한(현재 1,000)은 v2 값에 맞게 넓힌다.

### 7.4 선택 적용과 늦은 결과

- **적용 직전 재검사(V1 R2-1)**: 후보를 일정에 추가하는 버튼을 누르면 클라이언트는 서버에서 다시 읽은 현재 상태로 다음을 모두 확인하고, 하나라도 어긋나면 추가하지 않고 "추천 결과가 바뀌었어요 · 다시 추천 받기"를 보인다.
  1. 출처 행이 존재하고 `revision`이 같다(개인: 내 saved place, 공유: 내가 볼 수 있는 shared place — 내보내짐·폴더 삭제면 RLS로 보이지 않음).
  2. 공유 출처면 그 폴더가 지금 켜져 있다(`place_folder_preferences` 본인 행).
  3. 그 장소가 지금 내 기피 목록과 일치하지 않는다(7.2 규칙: POI id, 지도 지점 30 m).
  통과하면 그 행의 원래 place(서명 포함)를 쓴다. 이 재검사는 서버 읽기 1~3회이며 provider 호출·예산을 쓰지 않는다. 회귀 시나리오: 추천 → 기피 추가/폴더 끄기/내보내짐 → 같은 revision 후보 적용 시도 → 거부.
- 요청 시작 때 클라이언트는 "추천 입력 세대"(켜 둔 폴더 집합, 기피 목록 버전, 내가 속한 폴더 집합)를 기록한다. 결과 도착·표시 중에 세대가 바뀌면 결과를 SRC02b처럼 "설정이 바뀌었어요 · 다시 추천 받기" 상태로 표시하고 자동 재요청하지 않는다. 그 상태에서도 위 재검사를 통과한 후보만 일정에 추가할 수 있다.

## 8. 클라이언트 (웹·Android 같은 계약)

- 화면·문구·상태는 Figma 섹션 `367:10933`이 정본이다. 확인 팝업은 UI-001(0.13.0 FP29~FP39) 규칙을 따른다.
- 초대 링크 형식: `https://<웹 호스트>/folder-invite#t=<token>` (V1 #5).
  - 웹: 페이지 첫 실행에서 **외부 코드·resolver 실행 전에 동기적으로** fragment를 읽어 컴포넌트 메모리로 옮기고 `history.replaceState`로 주소에서 지운다. 지우기 실패 시 아무 요청도 하지 않고 오류 화면. 토큰은 query·OAuth `return_to`·로그·분석 이벤트에 넣지 않는다.
  - 로그인 왕복(V1 R2-2, 사용자 승인·위험 수용 2026-10-09 — Issue #124): 로그인하지 않았으면 G23 "로그인하고 계속"을 누를 때만 토큰을 `sessionStorage`의 고정 키 하나에 `{token, savedAt}`로 두고 기존 고정 callback으로 로그인한다.
    - 30분은 앱이 복귀를 허용하는 시간일 뿐 토큰 수명이 아니다(서버 토큰은 회수 전까지 최대 7일 유효). 저장된 값을 읽은 사람은 그 기간 안에 토큰을 쓸 수 있다는 잔여 위험을 문서와 Issue에 남긴다.
    - 지우는 시점: 로그인 완료 후 읽자마자, 30분 초과·형식 오류를 본 즉시, 로그인 취소·실패 화면, 로그아웃, 다른 계정 로그인 감지, 그리고 앱의 모든 페이지 첫 실행 때 30분 초과분. 저장소 접근이 예외를 내면 저장하지 않고 "로그인한 뒤 링크를 다시 열어 주세요"(요청 없음).
    - `window.open`으로 새 창을 열어 저장소가 복제되는 경로를 만들지 않는다(로그인은 같은 탭 이동).
  - Android: App Link `android:path="/folder-invite"`. 토큰은 프로세스 메모리에만 두고 로그인 후 같은 메모리 토큰으로 수락 화면을 연다. 프로세스가 종료되면 "링크를 다시 열어 주세요". 로그에 토큰·URL 전체를 남기지 않는다.
- 폴더 켜기/끄기는 서버 설정을 읽고 `set_place_folders_enabled`로 저장한다(기기 저장 금지). 다른 기기에서 바꾼 값은 화면 진입·새로고침 때 반영.
- 합쳐 보기 중복 제거·출처 표시 규칙은 웹·Android 공용 테스트 픽스처(같은 입력 → 같은 출력)로 증명한다. 픽스처 정본: `contracts/android/shared-folders/merge-fixtures.json`(설명 `README.md`, 웹 실행기 `lib/places/place-merge.test.ts`). 합쳐 보기 대표·`otherFolderIds`·출처 줄과 7.2절 기피 일치(POI id, 지도 지점 30 m)를 함께 담는다.
- Android는 기존 `SavedPlaceClient` 계층을 확장한다. 구버전(0.13.0) Android는 공유 폴더를 모르며, 서버 변경 후에도 기존 기능이 그대로 동작해야 한다(v1 추천 계약, saved_places·place_stars 읽기, 기존 별표 RPC — 단 3절의 합계 한도 차이).

## 9. 제품 정본 갱신 (같은 PR)

`docs/product/MOTOCAST_SOT.md`의 PLAN-004(저장 장소)·PLAN-005(식당 추천)·DATA-001(회원 데이터 격리)·SHARE-002(초대 토큰 예외)를 이 계약으로 갱신하고, Issue #99 제외 범위 "사용자 간 스팟 공유"가 공유 폴더 한정으로 바뀌었음을 기록한다.

## 10. 검증 계획 (필수 시나리오)

DB(pgTAP, 로컬 일회용 DB):
- migration: 기존 개인 별표·slot·mirror·revision·place 서명 보존, 재실행 무변화, 대기 중 구버전 RPC 본문과의 공존, `SET CONSTRAINTS ALL IMMEDIATE`에서도 불변식 유지, 중간 실패 시 전체 롤백.
- 역할 행렬(owner/editor/viewer/비회원/해지 회원/익명) × 모든 표·view·RPC. 직접 DML 거부. 다른 회원 `place_folder_preferences` 직접 조회 0행. 존재/부재 id의 동일 오류(folder·shared_place·invite). 회원 명단·RPC에서 profiles 비노출. 초대 원문·해시 비노출. service_role 허용 함수 목록 정확 비교.
- 한도 경계(20/30/1,000/10 링크/200/별표 10) 각각 허용 값·초과 거부. 별표 10에서 개인/공유 혼합, 구버전 RPC가 공유 별표를 세어 거부하는지. 초대 7일 경계·회수·재사용·중복 수락 멱등·이름 중복·수락 우선순위(5절). 주인 삭제·회원 나가기·내보내기·계정 삭제 시 별표·설정·회원 정리. revision stale 각 RPC. `set_place_folders_enabled` 부분 갱신과 비회원 폴더 섞임 거부.
동시성(2-connection, 로컬 supabase_admin):
- 같은 폴더에 서로 다른 초대 링크로 동시 가입 → 30 초과 불가. 서로 다른 폴더 동시 가입·생성↔가입 → 20 초과 불가. 동시 장소 추가·가져오기 → 1,000 초과 불가. 동시 별표(개인↔공유) → 10 초과 불가. 회수·권한 강등·내보내기 ↔ 수락·장소 변경·별표 경쟁에서 결과 일관. 서로 다른 폴더를 반대 순서로 건드리는 두 트랜잭션에서 교착 없음.
Edge:
- v1 요청 응답 형태 불변(기존 테스트 그대로 통과) + 기피 제외. v2 후보 합성·중복 제거·기피 제외(POI id, 지도 지점 30 m 경계 안·밖)·꺼진 폴더 제외·2,000행 잘림 표시. 기피·폴더 읽기 실패 시 `RECOMMENDATION_STORAGE_FAILED`. provider 호출 수 상한 불변, 예산 소진·provider 오류 후 추가 호출 없음, 모두 제외 시 호출 0회. `NO_SAVED_RESTAURANTS`/`ALL_EXCLUDED` 구분.
웹·Android:
- 공유 장소를 출발·경유·도착으로 선택·재계산, 이후 원본 삭제·나가기에도 기존 일정·코스·공유 결과 보존.
- 두 기기(웹·Android) 설정 동기화. 결과 있음/없음 모두 "꺼 둔 공유 폴더 n개 제외" + 설정 링크, 설정 변경 후 SRC02b.
- 확인 팝업 처리 중 X·뒤로·바깥 잠금, 응답 유실 후 재조회, 재진입.
- 초대: fragment 동기 제거, 제거 실패 시 요청 0회, 로그인 전 폴더 정보 숨김, 로그인 왕복 후 수락, 취소·만료·이미 읽힘, 이미 회원·만료·한도 화면.
- 웹 Playwright 320/390/820/1440, Android 에뮬레이터 384×832·320·1.3배 화면을 Figma와 나란히 비교.
Preview: 두 테스트 계정으로 생성→초대→수락→권한 변경→장소 추가/삭제→별표→기피→추천 제외→나가기/내보내기/삭제 실제 흐름.
