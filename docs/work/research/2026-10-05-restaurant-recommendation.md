# 저장 식당 기반 음식점 추천 — 설계·구현·검증 기록

- 작업 브랜치: `review-restaurant-recommend-20261005` (기반 `origin/develop` `70d3bf3`, 0.11.0)
- 작업 공간: `C:/Users/User/Desktop/worktrees/motocast-restaurant-recommend-20261005`
- Android: `tocomboy/motocast-android` 별도 작업 브랜치(아래 진행 상태에 기록)
- 관련: [#33](https://github.com/tocomboy/motocast/issues/33) 음식점 추천, [#34](https://github.com/tocomboy/motocast/issues/34) 성능·무료 예산, [#99](https://github.com/tocomboy/motocast/issues/99) 저장 장소
- 제품 정본: `PLAN-005`(신규), `PLAN-002/003/004`, `ROUTE-001/004/006/007`, `COST-001/002`, `OPS-001`, `SCOPE-002/003`

## 1. 사용자 확정 요구사항 (2026-10-05)

1. 현재 입력에 맞는 경로 계산이 끝난 뒤에만 `음식점 추천 받기`를 쓸 수 있다.
2. 방문할 식당 수 1곳/2곳을 고른다. 추천 후보 개수가 아니라 실제 방문할 식당 수다.
3. 식사마다 희망 시각을 정하고 추천을 요청한다.
4. 후보를 보고 사용자가 고른 식당만 확정해 일정에 추가한다. 추천만으로 경유지를 추가하지 않는다.
5. 추천 대상은 사용자가 저장한 장소 중 `식당`(`saved_places.kind = 'restaurant'`)뿐이다. 외부 검색으로 새 음식점을 추가하지 않는다.
6. 추가 주행 시간 = 식당을 포함한 경로의 주행 시간 − 기존 경로의 주행 시간. 식사 체류는 제외한다. 기본 한도 30분, 사용자가 변경할 수 있다.
7. 2곳이면 두 곳을 모두 포함한 추가 주행 합계가 한도 이내여야 한다. 식당별로 한도를 따로 적용하지 않는다.
8. 희망 시각 도착 허용 범위는 기본 ±30분, 사용자가 변경할 수 있다.
9. 두 번째 식당 도착 예정 시각에는 첫 번째 식당 방문에 따른 추가 주행과 식사 체류를 반영한다.
10. 기존 방문 순서와 이륜차 경로 제약을 유지한다.
11. 조건을 만족하는 후보를 추가 주행 시간이 짧은 순으로 추천한다.
12. 후보가 없으면 `조건에 맞는 음식점이 없습니다`라고 안내한다. 시간 범위나 한도를 자동으로 넓히지 않는다.
13. 2곳 요청에서 한 식사에만 후보가 있으면 그 식사는 추천하고 나머지는 없다고 안내한다. 사용자는 가능한 1곳만 추가할 수 있다.
14. 조회·계산 실패와 정상 조회 결과 후보 없음을 구분한다.
15. 경로를 수정해 결과가 오래되면 이전 결과로 추천하거나 선택을 적용하지 않는다.
16. 실제 경로 계산 근거를 사용하고 추가 API 사용량과 기존 예산 제한을 지킨다.

## 2. 유지하는 기존 규칙과 해석

| 기존 규칙 | 이번 기능에서의 적용 |
| --- | --- |
| 식사 기본 체류 60분, 수정 가능, 별도 개수 제한 없음, 전체 경유지 30개(`PLAN-003`) | 추천 입력의 식사 시간 기본 60분(1–1440). 추가 결과는 `meal` 역할·입력한 체류 시간의 새 occurrence. 현재 경유지 + 추가 수가 30을 넘으면 요청 전에 막는다. |
| 경유지 추가는 자동 재계산하지 않고 `경로 업데이트 필요`를 표시(`PLAN-004`) | 확정 추가 후 경로·날씨·공유 상태를 무효화하고 편집 화면에서 `경로 다시 계산`을 요구한다. 추천 화면은 경로를 저장·재계산하지 않는다. |
| 영업정보: 카카오 공개 장소 검색은 영업시간·브레이크·라스트오더를 제공하지 않으며(#33 데이터원 미확정), 확보하지 않은 정보는 `정보 없음`으로 표시하고 경고가 없다는 이유로 영업 가능하다고 단정하지 않는다. 브레이크 타임은 표시만 하고 경로를 거부·수정하지 않는다(`PLAN-002`). | 추천 후보마다 `영업정보 없음 · 방문 전 확인`을 표시한다. 영업시간으로 후보를 거르거나 경고를 만들지 않는다. 영업정보 데이터원·경고는 #33 후속 범위로 남는다. |
| 출발 후 24시간 미만 복귀(`SCOPE-001`, `PLAN-002`) | 식당 추가 후 예상 복귀가 24시간 이상이면 그 후보/조합을 제외한다. |
| 이륜차 조건 `car_type=7`, `avoid=motorway`, 대체 경로 없음(`ROUTE-001/006`) | 모든 추천 계산 호출은 기존 `requestKakaoRoute`·`applyMotorcycleRoutePolicy`를 그대로 사용한다. |
| 호출 직전 원자적 예산 차감, 실패 호출도 차감, 소진 시 중단(`COST-001/002`) | 추천 호출도 기존 `directions`/`future_directions` 예산을 같은 방식으로 차감한다. 별도 예산·환급 없음. 치명적 실패 후 새 호출을 시작하지 않는다. |
| 오류 응답에 좌표·이름·공급자 메시지·키를 남기지 않음(`OPS-001`) | 로그는 고정 코드와 개수만 남긴다. |

#33의 점심 11–15시·저녁 17–20시 초기값은 이번 확정 요구(희망 시각 ± 허용 범위)로 대체한다. 화면 기본 희망 시각은 식사 1 `12:00`, 식사 2 `18:00`이며 사용자가 바꾼다.

## 3. 서버 계약 — Edge Function `recommend-restaurants`

새 DB 테이블·마이그레이션은 없다. 소유자 RLS로 이미 읽을 수 있는 `trips`, `route_cache`(profile `recommended`), `saved_places`만 사용자 JWT 클라이언트로 읽는다. 예산 차감만 기존 `consume_daily_api_budget_internal`(service role)을 사용한다. JWT 검증 함수(`verify_jwt` 기본값 유지).

### 3.1 요청

```json
{
  "tripId": "uuid",
  "basis": { "departureAt": "ISO-8601", "returnAt": "ISO-8601", "pointIds": ["origin-id", "occurrence-id", "destination-id"], "arrivalAts": ["ISO-8601", "ISO-8601"] },
  "mealCount": 1,
  "meals": [{ "desiredTime": "12:00", "dwellMinutes": 60 }],
  "toleranceMinutes": 30,
  "detourLimitMinutes": 30
}
```

- 정확히 위 키만 허용한다(추가 키, 경로 정책 키는 거부).
- `tripId` UUID. `basis.pointIds`는 화면에 표시한 경로의 `[legs[0].from.id, ...legs.map(to.id)]`, 2–32개, 각 1–100자. `basis.arrivalAts`는 같은 경로의 구간별 `arrivalAt`(구간 수 = `pointIds.length − 1`). 중간 체류만 바뀐 재계산도 기준 불일치로 잡기 위해 포함한다(Codex V2 지적 1, 2026-10-05).
- `mealCount ∈ {1,2}`이고 `meals.length === mealCount`. `desiredTime`은 `HH:MM`(00–23, 00–59). `dwellMinutes` 정수 1–1440.
- `toleranceMinutes` 정수 5–180, `detourLimitMinutes` 정수 5–180.
- 식사 목표 시각: 서울 시각 `HH:MM`이 `departureAt − toleranceMinutes` 이후 처음 나오는 순간. 식사 2 목표는 식사 1 목표보다 늦어야 한다.

### 3.2 처리

1. 회원 확인(`requireMember`). 입력 검증 실패는 공급자·예산 작업 전에 거부한다.
2. 소유자 RLS로 `trips`(id)와 `route_cache.summary`(profile `recommended`)를 읽는다. 없거나 형식이 잘못되면 `RECOMMENDATION_ROUTE_STALE`.
3. 저장 경로와 `basis`를 대조한다: 첫 구간 출발 시각, `returnAt`, 순서 있는 지점 ID, 구간별 도착 시각이 정확히 같아야 한다. 저장 경로의 인접 구간은 공유 지점의 ID·좌표·시각이 이어져야 한다. 다르면 `RECOMMENDATION_ROUTE_STALE`(다른 기기 재계산, 화면의 오래된 결과 포함).
4. 현재 중간 지점 수 + `mealCount`가 30을 넘으면 `RECOMMENDATION_WAYPOINT_LIMIT`.
5. 소유자의 `kind='restaurant'` 저장 장소를 읽는다(최대 1,000). 좌표·이름이 유효하지 않은 행은 제외하고 개수를 `coverage.invalidSaved`와 로그에 남긴다. 0개면 공급자 호출 없이 `status: "NO_SAVED_RESTAURANTS"`.
6. 경로 지점과 같은 좌표(±0.000001°)의 식당은 이미 일정에 있으므로 제외한다.
7. **사전 선별(공급자 호출 없음)**
   - 구간 i(지점 Pᵢ→Pᵢ₊₁, 출발 depᵢ, 도착 arrᵢ)에 식당 R을 넣으면 도착 시각 ETA ∈ [depᵢ, arrᵢ + 한도]이므로 이 범위가 허용 창과 겹치는 구간만 본다(정확한 경계).
   - 저장된 도로 꼭짓점의 시각을 도로별 소요 시간으로 보간하고, R에서 가장 가까운 꼭짓점의 거리 d와 통과 시각 t를 구한다.
   - 왕복 우회를 60km/h로 가정해도 한도를 넘는 식당(`d > 한도(분)/2 km`)은 제외한다. 추정 도착 `t + d/40km/h`가 허용 창 ±15분 밖이면 제외한다. 식사 2는 식사 1을 함께 넣는 경우의 지연(`식사 1 체류 + 0…한도`)도 허용한다.
   - 식당마다 추정 추가 주행(`2d / 40km/h`)이 가장 작은 구간 하나를 고르고, 추정값 오름차순(동률은 목표 시각과의 차이)으로 정렬한다.
8. **실제 경로 계산(상한 고정)**: 1곳 요청은 상위 6곳, 2곳 요청은 식사별 상위 5곳(같은 식당·구간은 1회만)을 계산한다. 같은 구간에 두 식당이 들어가는 조합은 추가로 최대 4회 계산한다. 요청당 최대 6회 / 14회. 동시 실행 4개.
   - 단일 후보: `Pᵢ → R → Pᵢ₊₁`(R은 경유지) 1회, 출발 시각 depᵢ. 5분 넘게 미래면 `future/directions`, 아니면 `directions`(기존 orchestrator와 같은 기준). 구간 응답 두 개로 `ETA = depᵢ + s₁`, `추가 = s₁ + s₂ − durationᵢ`.
   - 같은 구간 조합: `Pᵢ → R₁ → R₂ → Pᵢ₊₁` 1회. `ETA₁ = depᵢ + s₁`, `ETA₂ = ETA₁ + 체류₁ + s₂`, `추가 = s₁ + s₂ + s₃ − durationᵢ`.
   - 다른 구간 조합(구간₁ < 구간₂)은 단일 결과로 계산한다: `ETA₂ = ETA₂(단독) + 추가₁ + 체류₁`, `추가 = 추가₁ + 추가₂`. 구간₁ > 구간₂ 조합과 같은 식당 두 번은 만들지 않는다(방문 순서 유지).
   - 복귀 = 기존 복귀 + Σ(추가 + 체류). 출발 후 24시간 이상이면 제외.
   - 판정은 초 단위, 경계 포함: `|ETA − 목표| ≤ 허용 범위`, `추가 ≤ 한도`.
9. **실패 분류**: 후보 계산이 `SAFE_ROUTE_NOT_FOUND` 또는 지점 도로 오류(공급자 결과 코드 101–107)이면 그 후보만 `coverage.unreachable`로 제외한다. 예산 소진·미설정, 공급자 인증·일시 오류, 응답 검증 실패는 요청 전체 실패이며 새 호출을 시작하지 않는다. 부분 결과를 `후보 없음`으로 바꾸지 않는다.

### 3.3 정상 응답 200

```json
{
  "status": "OK",
  "basis": { "tripId": "…", "departureAt": "…", "returnAt": "…", "pointIds": ["…"], "arrivalAts": ["…"] },
  "settings": { "mealCount": 2, "toleranceMinutes": 30, "detourLimitMinutes": 30 },
  "meals": [
    {
      "index": 1, "targetAt": "…", "windowStartAt": "…", "windowEndAt": "…", "dwellMinutes": 60,
      "candidates": [
        {
          "savedPlaceId": "uuid", "savedPlaceRevision": 3, "displayName": "별명 또는 원래 이름",
          "placeName": "원래 장소명", "address": "주소", "longitude": 127.1, "latitude": 37.5,
          "insertion": { "legIndex": 1, "afterPointId": "…", "beforePointId": "…" },
          "single": { "feasible": true, "arrivalAt": "…", "extraDriveSeconds": 540, "returnAt": "…", "reason": null }
        }
      ]
    }
  ],
  "pairs": [
    { "firstSavedPlaceId": "…", "secondSavedPlaceId": "…", "firstArrivalAt": "…", "secondArrivalAt": "…", "extraDriveSeconds": 1320, "returnAt": "…" }
  ],
  "coverage": { "savedRestaurants": 12, "invalidSaved": 0, "alreadyInRoute": 1, "nearRoute": 5, "evaluated": 5, "unreachable": 0, "notEvaluated": 0, "providerRequests": 5 }
}
```

- `meals[m].candidates`: 실제 계산한 도달 가능 후보 중 단독으로 조건을 만족하거나(`single.feasible`) 만족하는 조합에 그 식사로 포함된 후보만. 정렬은 `single.extraDriveSeconds`, 목표와의 차이, 이름, ID 순.
- `single.reason`: 단독 불가 이유 `WINDOW` | `DETOUR` | `RETURN_24H` | `null`.
- `pairs`: 2곳 요청에서 조건을 모두 만족하는 조합만, 합계 추가 주행 오름차순. 1곳 요청은 `[]`.
- `status: "NO_SAVED_RESTAURANTS"`이면 `meals[].candidates`는 비어 있고 `providerRequests = 0`.
- 결과 없음은 오류가 아니다: 정상 200과 빈 `candidates`.

### 3.4 오류 응답

`{ "error": "안전한 한국어 안내", "code": "…" }`, 좌표·이름·공급자 메시지 없음.

| code | HTTP | 의미 |
| --- | --- | --- |
| `RECOMMENDATION_INPUT_INVALID` | 400 | 입력 형식·범위·식사 순서 |
| `AUTH_REQUIRED` 계열 | 401/403 | 기존 회원 경계 |
| `RECOMMENDATION_ROUTE_STALE` | 409 | 저장 경로 없음·형식 오류·화면 기준과 다름 → 경로 다시 계산 |
| `RECOMMENDATION_WAYPOINT_LIMIT` | 422 | 경유지 30개 초과 |
| `RECOMMENDATION_BUDGET_OR_CONFIG` | 429/503 | 일일 한도 소진·미설정·공급자 인증 설정 |
| `RECOMMENDATION_PROVIDER_TEMPORARY` | 503 | 공급자 일시 오류·시간 초과 |
| `RECOMMENDATION_RESPONSE_INVALID` | 502 | 공급자 응답 검증 실패 |
| `RECOMMENDATION_FAILED` | 500/502 | 그 밖의 실패 |

## 4. 화면 계약 (웹·Android 공통)

### 4.1 진입과 상태

- 진입: 라이딩 요약(웹 `summary`, Android `SUMMARY`)의 `음식점 추천 받기`. 실제 계산·저장된 최신 경로(웹: `liveRoute && !liveResultStale && calculatedGeneration === routeGeneration && liveTripId`, Android: `RideController.currentCourse() != null`)이고 계산·저장 중이 아닐 때만 활성화.
- 상태: 입력 → 계산 중 → 결과(전체/일부) · 결과 없음 · 저장 식당 없음 · 오류(재시도) · 경로 변경됨(재계산 안내).
- 입력: 방문할 식당 수(1곳/2곳, 기본 1곳, "추천 후보 수가 아니라 실제로 들를 식당 수"), 식사별 희망 시각(5분 단위)·식사 시간(기본 60분), 도착 허용 범위(기본 ±30분), 추가 주행 한도(기본 30분, "두 곳 합계, 식사 시간 제외"), 경로 출발·예상 도착 안내, "저장한 식당만 추천" 안내.
- 후보 행: 이름(별명 우선)·주소, `12:10 도착 · 추가 주행 +12분`, `영업정보 없음 · 방문 전 확인`, 선택 표시. 정렬은 추가 주행 오름차순.
- 2곳: 식사별 목록에서 각각 하나를 고른다(선택 해제 가능). 다른 식사가 선택되면 이 목록은 조합 기준 도착·합계 추가 주행으로 다시 표시하고, 조합이 안 되는 행은 `식사 1과 함께 가면 조건을 벗어나요` 같은 이유와 함께 선택할 수 없다. 다른 식사가 선택되지 않았을 때 단독으로 불가한 행은 `식사 1 식당을 함께 골라야 가능해요`로 선택할 수 없다.
- 일부 결과: 후보 없는 식사 칸에 `식사 2 시간에는 조건에 맞는 음식점이 없습니다.` 두 목록이 모두 있지만 가능한 조합이 없으면 `두 곳을 함께 가는 조합은 조건을 벗어나요. 한 곳만 선택해 추가할 수 있어요.`
- 결과 없음: `조건에 맞는 음식점이 없습니다` + `시간 범위나 추가 주행 한도를 자동으로 넓히지 않아요.` + `조건 바꾸기`. 확인 범위 `저장한 식당 12곳 중 경로 근처 5곳을 실제 도로 경로로 확인했어요.`
- 저장 식당 없음: `저장한 식당이 없습니다` + 즐겨찾기 식당 등록 진입.
- 오류: `추천을 계산하지 못했습니다` + 원인 + `다시 시도`. 결과 없음과 다른 제목·아이콘·역할(`alert`)을 사용한다.
- 확정: `선택한 식당 일정에 추가`(선택 수 표시). 성공하면 편집 화면으로 이동해 `식당 n곳을 식사로 추가했어요. 경로 업데이트 필요: 경로 다시 계산을 눌러 주세요.`

### 4.2 오래된 결과 차단

- 요청 시점의 경로 세대(웹 `routeGenerationRef`, Android draft identity + ride generation)와 tripId를 결과에 묶는다. 경로 입력·일정 변경, 새 계산, 계정 변경, 화면 이탈 후 늦게 도착한 응답은 버린다. 입력 변경 시 열린 결과는 즉시 폐기하고 `경로가 바뀌어 이전 추천을 사용할 수 없습니다`를 표시한다.
- 확정 직전 다시 확인: 같은 세대·최신 경로, `[출발지 ID, …경유지 ID, 도착지 ID][legIndex] === afterPointId`이고 `[legIndex+1] === beforePointId`, 저장 장소가 아직 있고 ID·revision·좌표가 같음, 역할·전체 30개 한도. 하나라도 다르면 아무것도 추가하지 않는다.
- 삽입: 구간 i 뒤(경유지 배열 index i). 같은 구간 2곳은 식사 1, 식사 2 순으로 연속 삽입. 새 occurrence ID, 역할 `meal`, 입력한 식사 시간.

## 5. API 사용량

| 행동 | 길찾기 호출 |
| --- | --- |
| 추천 화면 열기·조건 입력·후보 선택·확정 추가 | 0 |
| 저장 식당 0곳, 경로 근처 후보 0곳, 입력/경로 기준 오류 | 0 |
| 1곳 추천 | 실제 계산 후보 수(최대 6) |
| 2곳 추천 | 식사별 후보(최대 5+5, 중복 제외) + 같은 구간 조합(최대 4) ≤ 14 |
| 추가 후 `경로 다시 계산` | 기존 경로 계산과 동일(분할 수) |

미래 출발이면 `future_directions`, 5분 이내면 `directions` 예산을 쓴다. 실측 쿼터 차감·응답 시간(#34의 3초 목표)은 연결 환경에서 별도로 측정한다.

## 6. 근사와 한계 (사용자 고지 대상)

- 식당 이후 구간의 주행 시간은 기존 계산값을 사용한다. 출발 시각이 바뀌어 생기는 교통 예측 차이와 식사 체류 뒤 출발의 교통 예측은 `경로 다시 계산` 때 반영된다. 추천 결과의 도착·추가 주행은 추정값이다.
- 사전 선별은 직선거리 추정이다. 경로에서 먼 식당과 상한 밖 후보는 실제 계산하지 않으며 `coverage`로 개수를 공개한다.
- 영업정보 데이터원은 없다.

### 3.5 구현 세부 판단 (`00e3aaf`)

- 같은 구간 조합 후보 선택: 두 단독 결과가 모두 도달 가능하고, 식사 1 단독 도착 ≤ 식사 2 단독 도착, max(단독 추가) ≤ 한도, 식사 1 도착이 창 ±15분, 식사 2 단독 도착 + 체류₁ ≤ 창₂ 끝 + 15분, 최소 복귀 < 24시간인 조합을 단독 추가 합계 순으로 최대 4개.
- `coverage.savedRestaurants`는 유효한 식당 수, `unreachable`은 계산한 단독 결과가 모두 도달 불가였던 식당 수, `notEvaluated = nearRoute − evaluated`. 같은 구간 조합의 도달 불가는 그 조합만 제외.
- `address`는 도로명 주소가 있으면 도로명, 없으면 지번. 서버는 기본값을 채우지 않으며 허용 범위·한도도 필수(화면이 기본 30/30을 보냄).
- `KAKAO_REST_API_KEY`는 첫 공급자 호출 직전에 확인하므로 저장 식당 없음·근처 후보 없음 요청은 키 없이도 200이다.
- `basis` 시각은 순간으로 비교하고 응답은 UTC로 정규화. 저장 경로 형식(구간 연결, 도착 = 출발 + 소요, 다음 출발 = 도착 + 체류, 복귀, 꼭짓점 범위)이 어긋나면 STALE.
- 오류: `PROVIDER_REQUEST_REJECTED`는 `RECOMMENDATION_PROVIDER_TEMPORARY`(503), 공급자 인증·설정·예산 회계 실패는 `RECOMMENDATION_BUDGET_OR_CONFIG`(503), 저장 데이터 조회 실패는 `RECOMMENDATION_FAILED`(500).

## 7. 디자인

Figma 파일 `wVNriNWb1OlF21DVq8rqlJ`, v2 디자인 체계 페이지 `284:2253`. 화면/상태와 노드 대응은 디자인 완료 후 아래 표에 기록한다.

섹션 `음식점 추천 · 2026-10-05` [`345:6663`](https://www.figma.com/design/wVNriNWb1OlF21DVq8rqlJ?node-id=345-6663), 51 프레임. 예시: 10/10 09:00 출발·17:40 도착·저장 식당 12곳(합성 예시이며 실제 결과 아님).

| 화면/상태 | Android 384 | 웹 1440 | 웹 390 | 320/1.3배 |
| --- | --- | --- | --- | --- |
| 1 진입(라이딩 요약) | `345:6666` · 비활성 `345:6743` | `345:6830` | `345:6752` | — |
| 2a 입력 · 1곳 | `346:6919` | `350:9075` | `349:7947` | — |
| 2b 입력 · 2곳 | `346:7115` | `350:9264` | `349:8172` | `352:10322` |
| 3 계산 중 | `346:7221` | `350:9358` | `349:8417` | — |
| 4 결과 1곳 · 선택 | `346:7367` | `350:9495` | `349:8595` | — |
| 5a 결과 2곳 · 선택 전 | `347:7211` | `350:9658` | `349:8812` | — |
| 5b 식사 1만 선택(식사 2 조합 기준) | `347:7389` | `350:9827` | `349:9056` | — |
| 5c 두 곳 선택 | `347:7574` | `350:10002` | `349:9303` | `352:10068` |
| 6a 일부 결과 · 식사 2 없음 | `347:7730` | `351:9547` | `349:9554` | — |
| 6b 일부 결과 · 조합 없음 | `347:7907` | `351:9715` | `349:9778` | — |
| 7 결과 없음 | `348:7485` | `351:9815` | `349:10021` | — |
| 8 저장한 식당 없음 | `348:7590` | `351:9909` | `349:10199` | — |
| 9a 오류 · 일시 오류 | `348:7697` | `351:10005` | `349:10373` | — |
| 9b 오류 · 사용 한도·설정 | `348:7804` | `351:10101` | `349:10551` | — |
| 10 경로 변경됨 | `348:7910` | `351:10196` | `349:10729` | — |
| 11 확정 후 경로 편집 | `348:8001` | `351:13271` | `349:10903` | — |

디자인 검수(메인, 2026-10-05): `347:7389`·`346:7115` 렌더링 직접 확인. 디자이너는 22개 프레임 렌더링 확인과 47개 시트/대화상자 넘침 계산 0건을 보고했다. 남은 시각 위험: 기존 S01 상단 도착 시각·총 소요 간격 4px(범위 밖), 한국어 글자 단위 줄바꿈 → 웹 `word-break: keep-all`, Android 단어 단위 줄바꿈.

구현 규격(디자인 메모 요약):
- 시트(Android·모바일 웹): 위 모서리 24, 손잡이 40×4, 제목+닫기 48, 내용 스크롤 여백 4/20/24/20·간격 16, 하단 고정 바(위 1px `border/card`, 14/20/24 + 시스템 바). 입력·결과는 화면 높이까지, 나머지 상태는 내용 높이.
- PC 대화상자: 모서리 24, 여백 24/28, 너비 입력 720·상태 560·1곳 결과 640·2곳 결과 960(두 칸), 최대 높이 `100vh − 96`, 내용만 스크롤, 하단 왼쪽 선택 요약·오른쪽 버튼.
- 후보 행: 모서리 16, 여백 14/16, 간격 12, 행 사이 8. 선택 = `signal/tint` + `border/strong` 2px + 체크. 비활성 = `surface/ground` + 점선 원 + `선택 불가 · {이유}`. 비활성 행도 정렬 위치 유지.
- 입력: 희망 시각은 기존 시·분 선택(5분 단위), 허용 범위·한도는 −/+ 48(5분, 5–180). 식사 시간은 기존 체류 입력과 같이 1–1440분(직접 입력 허용). 2곳→1곳 전환 시 식사 2 값 보존.
- 접근성: 후보 행 `button[aria-pressed]`/Compose `toggleable`, 이름 "{이름}, {주소}, {시}시 {분}분 도착, 추가 주행 {n}분, 영업정보 없음, 선택됨". 비활성은 `aria-disabled`이되 포커스 가능. 계산 중·결과 없음·경로 변경됨 `status`, 오류 `alert`. 열면 제목 포커스, 닫으면 진입 버튼으로 복귀, 상태 바뀌면 새 제목 포커스.
- 뒤로/Esc: 결과·결과 없음·오류 → 입력(값 보존). 입력·계산 중 → 닫기(진행 중 결과 폐기). `조건 바꾸기` → 입력.
- 진입: Android는 라이딩 요약 `방문 순서` 카드 아래 보조 카드(주 버튼 `경로 실행` 유지), PC는 제목 줄 `공유 · 저장` 왼쪽 보조 버튼.

디자인 미결 사항 결정(메인, 2026-10-05):
1. 하단 선택 요약의 `예상 복귀 HH:MM`(서버 `returnAt`/조합 `returnAt`) 유지.
2. 추가 문구 채택: 진입 카드 설명, 계산 중 안내, 오류의 `음식점이 없다는 뜻이 아닙니다.`, 경로 변경됨의 `선택한 식당은 일정에 추가하지 않았어요.`, `선택 불가 ·`, `추천 조건` 요약, 추정값 고지.
3. 오류 주 버튼: `API_DAILY_BUDGET_EXHAUSTED`(HTTP 429)만 주 `닫기`·보조 `다시 시도`. 설정·일시·응답 오류는 주 `다시 시도`.
4. 요청 전 입력 오류 문구 채택: `식사 2 희망 시각은 식사 1보다 늦어야 해요.`, `경유지가 30개를 넘어 식당을 추가할 수 없어요.` 이때 `추천 받기` 비활성.
5. 식사 시간은 기존 체류 입력 규칙(1–1440, 직접 입력)과 같게 구현.
6. PC 시안 1440×1024 유지(최대 높이 규칙으로 900에서도 맞음).
7. 배경 맥락 프레임의 v2 S01/W05/W02/E01 복제 사용 허용(새 시트·행·상태는 v2 부품으로 새로 구성).
8. 추천으로 추가된 경유지의 별도 표시는 하지 않음.

## 8. 진행 상태와 검증 기록

| 단위 | 상태 | 근거 |
| --- | --- | --- |
| 설계·계약 | 작성 | 이 문서 |
| Figma 디자인 | 완료(디자인만, 앱 적용 전) | 섹션 `345:6663`, §7 |
| 서버 `recommend-restaurants` | 인수 (`849fbae`, Codex V2 PASS) — 최초 `00e3aaf` V2 FAIL 후 수정 | 작성자 검사: 대상 3개 파일 113 PASS, `supabase/functions` 38 파일 677 PASS / FAIL 0 / SKIP 0, deno check 9개 함수 PASS, lint·typecheck·diff-check PASS. 메인 재실행: `supabase/functions` 677 PASS. 메인 검수 LOW 1: 식당 좌표가 도로 스냅 허용(0.005°) 밖이면 후보 제외가 아니라 요청 전체 `RECOMMENDATION_RESPONSE_INVALID`(기존 경로 계산과 같은 보수적 실패, 미수정). 실제 RLS·예산 RPC·Kakao 호출·응답 시간은 NOT_RUN. |
| 웹 화면 | 인수 (`921c9a0`, Codex V2 PASS) — 최초 `5aef2e7` V2 FAIL 후 `dd1185b`·`921c9a0` 수정. 수정 후 작성자: lint·typecheck PASS, `npm test` 95 파일 1158 PASS, build PASS, e2e 63 PASS / 2 SKIP. | 작성자: lint·typecheck PASS, `npm test` 95 파일 1125 PASS, build PASS, e2e 63 PASS / 2 SKIP(기존 Preview 전용), LOCAL_UI 임시 하네스 4폭×16상태 64장 클리핑 0(합성 응답). 로컬 Playwright는 데모 모드라 추천 흐름 spec 없음(메인 결정 B, 연결 흐름은 Preview에서 검증). 큰 글자는 CSS zoom 근사만. |
| Android 화면 | 디자인 후 | |
| Codex 검증(V2/V3) | 진행 중 | 누락 정정: 서버 `00e3aaf`를 메인 검수만으로 인수했다(사용자 지적 2026-10-05). 원인과 재발 방지는 MOTOCAST `bbce8f6`(검증 규칙 §5의 대체된 lead 단독 검수 문구 정리, 인수 gate)와 dev-environment `8175a7c`(전역 인수 단계 V2 연결, 역할 변경 시 프로젝트 문서 대조) — [점검 기록](https://github.com/tocomboy/dev-environment/blob/main/docs/reviews/2026-10-05-verifier-acceptance-gate.md). V2 결과: 서버 `00e3aaf` FAIL(MEDIUM 3: basis가 중간 도착 변경을 못 잡음→`arrivalAts` 추가, 저장 구간 좌표 연결 미검사, 치명 오류 직후 새 호출 경합), 웹 `5aef2e7` FAIL(MEDIUM 2: 응답 목표 시각 미대조, 조건 위반 후보·조합 수용; LOW 1: 결과 없음 상태 포커스). 재검증(HEAD `586c4bd`, 서버 = `849fbae`, 웹 = `921c9a0`): **PASS**, 6건 모두 RESOLVED, 새 지적 LOW 1(§3.3 응답 예시 `arrivalAts` 누락 → 문서 수정). Codex 실행: vitest 40 파일 773 PASS(`--pool threads --configLoader native --no-cache`), typecheck(`--incremental false`)·lint·deno check 2 PASS. Android V2와 병합 전 V3는 남음. 그 전까지 Preview·출시 보류. |
| 연결 Preview·실기기 | 승인됨, 미실행 | 2026-10-05 사용자 승인: 검수한 고정 SHA의 `review-*` CI 전용 PR → Preview `recommend-restaurants` 배포·readback → `develop` fast-forward(Vercel Preview) → 웹·Android(previewDebug) 연결 E2E, 응답 시간·API 사용량 측정, 시험 자원 정확한 ID 정리. (Production·Play는 아래 출시 승인 행). |
| 공동 출시 | 승인됨, 미실행 | 2026-10-05 사용자 확장 승인("play 게시 까지가 허용 범위" → 선택 "웹·앱 함께 내부 출시"): Preview 검증 통과 후 서비스 버전 0.12.0으로 웹 `develop → main` Production 배포, Production Supabase `recommend-restaurants` 배포·readback, Android `develop → main` 및 Play **내부 테스트 트랙** 게시. Play 정식 트랙 승격은 제외. 각 저장소 gate(검증·CI·Preview·Production·Play readback)와 버전·태그·Release 절차를 따른다. |
