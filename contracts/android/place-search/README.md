# 장소 검색 계약 1.1.0

웹/서버 정본은 이 디렉터리의 openapi.json, fixtures.json이며 Android는 검증한 동일 바이트를 contracts/place-search에 보존한다. 기존 Android에 게시된 1.0.0 계약과 키워드 예제를 유지하고 좌표 모드를 추가했다. 원래 dirty 웹 작업 트리의 파일은 변경하지 않았다.

`sourceCommit`은 변경 전 기반이며, 실제 구현 후보는 이 파일을 포함하는 Git commit과 배포 기록으로 고정한다. 문서에 Production URL이 있다는 사실은 함수 배포를 의미하지 않는다. 운영 준비 기록에서 정확한 search-places 후보와 좌표 모드 호환 검증을 확인해야 한다.

키워드 검색은 기존 query/page/size와 공백·길이 계약을 유지한다. 좌표 모드는 정확히 mode/latitude/longitude만 허용하며 한국 범위와 소수점7자리 좌표 정규화를 적용한다. 회원 확인 및 기존 Local 예산 차감 후 Kakao 좌표→주소를 호출한다. 결과 없으면 빈 places/isEnd=true, 주소가 있으면 map:위도:경도 ID와 원 좌표·주소에 결속된 기존 서명을 반환한다. 주소에 산번지가 있어도 보존한다. 경로·날씨 성공은 별도 검증한다.

`supabase/functions/_shared/map-place.test.ts`는 공통 coordinateRequests를 실제 parser에 실행한다. `supabase/functions/search-places/index.test.ts`는 실제 handler와 provider 정규화/서명을 실행하되 인증·예산·외부 공급자 I/O만 모사한다. 합성 예제와 자동 검사는 실제 서비스/기기 결과가 아니다.
