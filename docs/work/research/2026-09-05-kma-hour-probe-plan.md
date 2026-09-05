# KMA 정시 요청 — 승인된 후속 실측

2026-09-05. **READY: 진단 구현·검토·CI·한정 Preview 실측. 제품 교정 후보는 대기.** 사용자는 공식 설명 대신 제한 실측을 근거로 요청 선택을 평가·채택하도록 승인했다. 정확 일치와 외부 문의 제외는 유지한다.

1. **완료:** origin/develop f6ec59c 재확인, 기존 일회 probe의 삭제 증거와 보존 자료를 읽었다. 새 owner-private 디렉터리와 capability·인증 state를 생성하고 Preview 페이지 HTTP 200/활성 회원을 확인했다. 이전 DISPATCHED·결과·정리 파일은 보존한다.
2. **진행:** writer는 기존 임시 함수·테스트 두 파일만 수정한다. lead는 정본·계획·실행기·운영 증거를 소유하며, 별도 설계자는 시간/예측 범위를 읽기 전용으로 검토한다. 다른 작업자의 dirty 파일은 되돌리지 않는다.
3. **완료:** 고정 SHA b2d1e3d와 실행기 독립 APPROVE B0/H0/M0/L0, PR #20 CI success와 비배포 조건 확인 후 임시 함수만 배포·한 번 호출했다. 삭제 200/부재 404 및 기존 다섯 함수 불변을 확인했다.
4. **진행:** [정시 실측](2026-09-05-kma-hour-observation.md)은 19:00→19:00, 18:00→18:00, strict·정확 target 필수 값 PASS 2다. 후보 설계 가능 근거로 사용하며 선택·공개 지연·여섯 시간 끝의 기준 확정 뒤 제품 READY로 전환한다.

## 변경되는 진단 계약

- 동일한 capturedNow에서 기존 latestForecastBase("ultra")가 선택한 시간의 정시를 첫 후보로, 그보다 한 시간 이른 정시를 둘째 후보로 만든다. 반환 응답의 시각을 요청으로 복사하지 않는다. 예: 한국시간 00:20에는 전날 23:00/22:00, 20:05에는 19:00/18:00이다.
- 두 요청 모두 기존 ultra operation과 실제 KMA_DAILY_LIMIT 예산을 사용하며, 최대 provider 호출·예약은 각각 2회다. 어떤 parser/필수 값 오류라도 즉시 중단한다. 예전의 mismatch 비교 재시도는 없다.
- 실측 target은 capturedNow+1시간을 기존 forecastTarget으로 계산한다. 원본 strict parser가 통과한 항목 중 **정확한 대상 예측일자·시각**만 기존 validatedForecastValues로 검증한다. 현재 제품의 closestForecast는 가까운 다른 시각도 선택하므로 그 함수의 PASS를 정확 대상 지원 증거로 오인하지 않도록 진단만 강화한다. 제품 helper는 이 진단에서 변경하지 않는다.
- 기존 고정 Preview·회원·capability·만료, JWT true, no Origin/query/nonempty body, no CORS, 실제 예산, 8초 timeout, no redirect/retry, 2MiB/1,000항목, 안전한 제한 응답과 무비밀 로그를 유지한다. 새 capability 해시와 만료 2026-09-05T12:59:00.382Z를 고정한다.
- 실행기는 새 owner-private 경로를 사용하고 결과의 providerCalls/results 상한을 2로 낮춘다. 이 외 이전 독립 검토된 호출·redaction·정리 논리는 동일하다. client는 DISPATCHED를 생성한 뒤 POST 한 번만 실행하고 성공/실패 모두 동일 소유 함수만 삭제한다. 전역 exactly-once 주장은 하지 않는다.

## 완료와 중단

실행기 후속 갱신: 인증 만료가 CI와 겹쳐 기존 state를 보존하고 정상 Preview 갱신 결과를 새 probe-state-active.json으로 저장한다. 실행기의 읽기 파일명만 변경했고 재컴파일한 가짜 I/O 회귀는 8 PASS/FAIL 0이다. 최종 실행기 해시는 5ad3f7e49710802d77d28e1e57ed47b09763979bc199275022379671a3949965이며, 아래 c093636은 최초 준비본의 역사적 검사 해시다. 서버 고정 SHA는 변경하지 않았다.

작성자의 최초 21 PASS 보고는 이전 복사본을 검사한 증거여서 후속 코드 검증으로 채택하지 않았다. lead가 절대 원본을 복사한 첫 실행은 20 PASS/3 FAIL(테스트의 정시·오류 종류·자정 날짜 기대값)이었고 기대값 정정 후 집중 23 PASS/FAIL 0/SKIP 0이다. 원본과 복사본 두 파일의 SHA-256 일치를 확인했다. 최종 전체 538 PASS/FAIL 0/pending 0/todo 0, Deno check PASS. 새 실행기 타입 검사와 가짜 I/O 회귀 8 PASS/FAIL 0, SHA-256 c093636218452f9b0c697184180a500bb31ccdfe6fe54effb6ff3ac2c76e756f다. 실제 후속 KMA 요청은 아직 NOT_RUN이다.

집중 회귀는 초단기 정시 두 개·날짜 경계·첫/둘째 실패 중단·정확 target 누락을 포함한다. 인증·예산·크기·스트림·비밀 제거 회귀를 유지한다. 실측 실패나 불명확 결과는 그 자체로 기록하며 예약은 환불하지 않는다. 실패한 후보를 고정 오프셋·모델 대체·검증 완화로 구제하지 않는다. 사용자 승인 없이 Production을 변경하지 않는다.
