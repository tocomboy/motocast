# 장소 검색 계약 1.2.0

웹/서버 정본은 이 디렉터리의 openapi.json, fixtures.json이며 Android는 검증한 동일 바이트를 contracts/place-search에 보존한다. 기존 Android에 게시된 1.0.0 계약과 키워드 예제를 유지하고 좌표 모드를 추가했다. 원래 dirty 웹 작업 트리의 파일은 변경하지 않았다.

`sourceCommit`은 변경 전 기반이며, 실제 구현 후보는 이 파일을 포함하는 Git commit과 배포 기록으로 고정한다. 문서에 Production URL이 있다는 사실은 함수 배포를 의미하지 않는다. 운영 준비 기록에서 정확한 search-places 후보와 좌표 모드 호환 검증을 확인해야 한다.

키워드 검색은 기존 query/page/size와 공백·길이 계약을 유지한다. 좌표 모드는 정확히 mode/latitude/longitude(1.2.0부터 선택 키 fallback 추가)만 허용하며 한국 범위와 소수점7자리 좌표 정규화를 적용한다. 회원 확인 및 기존 Local 예산 차감 후 Kakao 좌표→주소를 호출한다. 결과 없으면 빈 places/isEnd=true, 주소가 있으면 map:위도:경도 ID와 원 좌표·주소에 결속된 기존 서명을 반환한다. 주소에 산번지가 있어도 보존한다. 경로·날씨 성공은 별도 검증한다.

1.2.0(호환 기능 추가)은 좌표 요청의 선택 키 `fallback: "region"`을 추가한다. 이 키가 없으면 1.1.0과 완전히 같고, 다른 값(null 포함)이나 그 밖의 추가 키는 계속 거부한다. opt-in 요청에서 좌표→주소 결과가 0건일 때만 같은 Local 예산을 한 번 더 차감한 뒤 Kakao 좌표→행정구역을 1회 호출한다(최대 2회 차감). 법정동(B) 문서 1건만 쓰고(B/H 순서 무관), B가 없으면 빈 결과, B가 2건 이상이거나 문서가 10건을 넘거나 형식이 잘못되면 502 오류다. 두 번째 차감 거부·응답 유실·timeout·4xx/5xx·잘못된 JSON은 재시도·환급 없이 오류이며 빈 결과로 위장하지 않는다. 지역 장소는 `map:위도:경도:region` ID, B 주소, roadAddress null, `<시군구> <읍면동> 부근` 이름(둘 다 비면 주소), `지도에서 선택 · 상세 주소 없음` 분류, 선택한 원 좌표와 그 식별자에 결속된 서명을 가진다. 저장할 때는 별명이 필수다.

클라이언트 응답 검사: opt-in 없는 요청은 `map:위도:경도`만, opt-in 요청은 정확히 `map:위도:경도` 또는 `map:위도:경도:region`만 받는다. 둘 다 반올림한 선택 좌표 일치, 결과 1건 이하, isEnd=true를 유지하고 다른 좌표나 다른 접미사는 거부한다.

`supabase/functions/_shared/map-place.test.ts`는 공통 coordinateRequests를 실제 parser에, coordinateResponses의 공급자 문서를 실제 정규화·서명(fixture 전용 secret)에 실행한다. `supabase/functions/search-places/index.test.ts`는 같은 coordinateResponses를 실제 handler로 실행해 차감 횟수·호출 순서·오류 상태를 확인하고, `lib/places/search.test.ts`는 coordinateClientChecks를 웹 응답 검사에 실행한다. handler 시험은 실제 handler와 provider 정규화/서명을 실행하되 인증·예산·외부 공급자 I/O만 모사한다. 합성 예제와 자동 검사는 실제 서비스/기기 결과가 아니다.
