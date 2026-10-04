# 저장 식당 기반 음식점 추천 계약 1.1.0

웹/서버 정본은 이 디렉터리의 `fixtures.json`이며 Android는 검증한 동일 바이트를 보존한다. 설계 정본은 `docs/work/research/2026-10-05-restaurant-recommendation.md` §3(요청·처리·응답·오류)·§5·§6이다. `sourceCommit`은 변경 전 기반이며, 실제 구현 후보는 이 파일을 포함하는 Git commit과 배포 기록으로 고정한다. 함수 배포 여부는 이 계약으로 증명되지 않는다.

## 요청 — `POST /functions/v1/recommend-restaurants` (JWT 필요)

- 정확히 `tripId`, `basis{departureAt, returnAt, pointIds, arrivalAts}`, `mealCount`, `meals[{desiredTime, dwellMinutes}]`, `toleranceMinutes`, `detourLimitMinutes`만 허용한다. 키 추가·누락, 경로 정책 키(`car_type` 등)는 거부한다. 서버는 기본값을 채우지 않으므로 화면 기본값(식사 1 `12:00`, 식사 2 `18:00`, 체류 60, 허용 ±30, 한도 30)은 클라이언트가 보낸다.
- `tripId` UUID. `basis`는 화면에 표시한 계산 결과 그대로: 첫 구간 출발, 예상 복귀, `[legs[0].from.id, ...legs.map(to.id)]`(2–32개, 각 1–100자), 구간별 `legs[i].arrivalAt`(`arrivalAts`, 길이 = `pointIds.length − 1`, 필수). 서버는 저장 경로와 출발·복귀·ID 순서·모든 구간 도착이 같아야 받아들이므로 출발·복귀·ID가 같고 중간 체류만 바뀐 재계산도 409로 거부한다. 저장 경로의 인접 구간이 공유 지점의 ID·좌표·시각으로 이어지지 않아도 409다. 시각은 RFC 3339이며 서버는 순간(instant)으로 비교하고 응답 `basis`(`arrivalAts` 포함)에는 저장값을 UTC `Z` 표기로 돌려준다. 복귀는 출발보다 늦어야 한다.
- `mealCount` 1|2, `meals.length === mealCount`. `desiredTime` `HH:MM`(00–23:00–59, 두 자리). `dwellMinutes` 정수 1–1440. `toleranceMinutes`·`detourLimitMinutes` 정수 5–180.
- 식사 목표 시각: 서울 시각 `HH:MM`이 `departureAt − toleranceMinutes` **이후(같은 순간 포함)** 처음 나오는 순간. 허용 창은 목표 ± 허용 범위(경계 포함). 식사 2 목표는 식사 1 목표보다 엄격히 늦어야 한다.

`requests[]`는 정상(`expected.request` 정규화 결과, `expected.targets` 목표·창)과 거부(`error`) 사례다. `supabase/functions/_shared/restaurant-recommendation-request.test.ts`가 모든 사례를 실제 파서에 실행한다.

## 응답 200

`status`는 `OK` 또는 `NO_SAVED_RESTAURANTS`. 결과 없음은 오류가 아니라 `OK` + 빈 `candidates`다. `responses[]`의 본문은 `supabase/functions/_shared/restaurant-recommendation.test.ts`의 합성 시나리오(직선 도로·고정 공급자 소요시간)를 실제 계산 모듈에 실행한 출력과 JSON 값이 같은지 검사한다. 실제 서비스·기기 결과가 아니다.

- `meals[m].candidates`: 실제 도로 경로로 계산한 도달 가능 후보 중 단독으로 조건을 만족하거나(`single.feasible`) 만족하는 조합에 그 식사로 포함된 후보만. 정렬은 `single.extraDriveSeconds`, 목표와의 차이, `displayName`(코드포인트 순), `savedPlaceId`.
- `displayName`은 별명이 있으면 별명, 없으면 원래 장소명. `placeName`은 원래 장소명. `address`는 도로명 주소가 있으면 도로명, 없으면 지번 주소.
- `insertion.legIndex` i는 `basis.pointIds[i] → [i+1]` 구간이며 확정 시 경유지 배열 index i에 삽입한다. 같은 구간 2곳 조합은 식사 1, 식사 2 순으로 연속 삽입한다.
- `single.reason`: `WINDOW` | `DETOUR` | `RETURN_24H` | `null`(우선순위도 이 순서). `single.returnAt` = 기존 복귀 + 추가 주행 + 그 식사 체류.
- `pairs`: 2곳 요청에서 조건을 모두 만족하는 조합만, `extraDriveSeconds` 오름차순(동률: 목표와의 차이 합, 식사 1 ID, 식사 2 ID). 구간₁ < 구간₂는 `secondArrivalAt = 식사 2 단독 도착 + 식사 1 추가 주행 + 식사 1 체류`, 같은 구간은 `A → R₁ → R₂ → B` 1회 실제 계산값. 역순 구간·같은 식당 조합은 만들지 않는다. 1곳 요청은 `[]`.
- 추가 주행은 음수일 수 있다(공급자 교통 예측 차이). 판정은 초 단위·경계 포함: `|도착 − 목표| ≤ 허용`, `추가 ≤ 한도`, 출발 후 24시간 **미만** 복귀.
- `coverage`(모두 식당 수, 마지막만 호출 수): `savedRestaurants` 좌표·이름이 유효한 저장 식당, `invalidSaved` 형식 오류로 제외한 행, `alreadyInRoute` 경로 지점과 같은 좌표(±0.000001°), `nearRoute` 사전 선별 통과, `evaluated` 실제 계산한 식당, `unreachable` 계산했지만 모든 계산이 도달 불가(안전 경로 없음·공급자 결과 코드 101–107)였던 식당, `notEvaluated` = `nearRoute − evaluated`(호출 상한 밖), `providerRequests` 예산을 차감한 길찾기 호출 수. 같은 구간 조합 호출의 도달 불가는 해당 조합만 제외하고 식당 수에는 넣지 않는다.

## 오류

본문은 `{ "error": "안전한 한국어 안내", "code": "…" }`이며 좌표·이름·공급자 메시지를 포함하지 않는다. `errors[]`가 코드와 HTTP 상태 목록이다. 출처 거부(403 `ORIGIN_NOT_ALLOWED`)와 메서드 거부(405 `METHOD_NOT_ALLOWED`)도 같은 형태다. 클라이언트는 409 `RECOMMENDATION_ROUTE_STALE`이면 이전 결과를 버리고 경로 다시 계산을 안내한다.

## 호출량

입력·기준 오류, 경유지 한도, 저장 식당 0곳, 경로 근처 후보 0곳은 길찾기 0회다. 1곳 요청은 최대 6회, 2곳 요청은 식사별 상위 5곳(같은 식당·구간은 1회) + 같은 구간 조합 최대 4회로 최대 14회, 동시 4개다. 구간 출발이 현재+5분을 넘으면 `future_directions`, 아니면 `directions` 예산을 쓴다.

## 변경 이력

- 1.1.0 (2026-10-05): 요청·응답 `basis.arrivalAts` 필수 추가, 저장 경로 인접 구간 좌표 연결 검사(Codex V2 지적 반영). 1.0.0 요청은 400으로 거부된다.
