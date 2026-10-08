# 공유 폴더 합쳐 보기·기피 일치 공용 픽스처

웹·Android가 같은 입력에 같은 결과를 내는지 증명하는 정본은 이 디렉터리의 `merge-fixtures.json`이다. 규칙 정본은 `docs/work/2026-10-09-issue124-shared-folders-contract.md` 1절(합쳐 보기), 7.2절(기피 일치), 8절(클라이언트)이며, Android는 검증한 동일 바이트를 보존한다.

- `mergeCases[]`: 내 장소(`saved`)와 공유 장소(`shared`), 켜 둔 폴더(`enabledFolderIds`)를 넣으면 `expected` 목록이 나와야 한다. 각 원소는 대표 출처(`source`·`id`·`folderId`), 같은 장소를 가진 다른 켜 둔 폴더(`otherFolderIds`), 화면 출처 줄(`label`)이다. 순서는 내 장소 입력 순서, 그다음 공유 대표의 `(createdAt, id)` 순서다.
- `avoidedCases[]`: 장소 하나와 기피 목록을 넣으면 처음 일치하는 기피 장소 id(`expected`, 없으면 `null`)가 나와야 한다. POI 기피는 `kakaoPlaceId`가 같을 때만, 지도 지점(`map:`) 기피는 같은 id 또는 30 m 이내(하버사인, 지구 반지름 6,371,008.8 m, 경계 포함)다. 경계 직전·직후 값은 픽스처에 두지 않고 25 m·35 m로 판정이 갈리는 값만 둔다.
- 웹 실행기: `lib/places/place-merge.test.ts`(구현 `lib/places/place-merge.ts`).
- 추천 서버 실행기: `supabase/functions/_shared/restaurant-candidates.test.ts`의 "shared merged-view fixture"(구현 `buildCandidatePool`, `avoidanceMatcher`). 서버는 켜 둔 폴더의 식당만 `(created_at, id)` 순서로 읽으므로 실행기가 그 읽기를 흉내 내 꺼진 폴더 행을 빼고 정렬한 뒤 넣는다. 현재 모든 `mergeCases`·`avoidedCases`가 서버에서도 같은 결과다(제외 사례 없음).
- 서버만의 차이(픽스처에 넣지 않음): (1) 내 장소끼리 `kakaoPlaceId`가 같으면 서버는 둘 다 후보로 둔다(v1 동작 유지, 화면은 내 장소 목록을 이미 중복 없이 받음). (2) 서버는 경로 경계 상자(30 km 확장) 안의 공유 식당만 읽으므로 상자 밖에 있는 같은 장소의 사본은 `otherFolderIds`에 나타나지 않는다. (3) 서버는 식당(`kind=restaurant`)만 다루고, 화면 출처 줄(`label`)은 만들지 않는다.
