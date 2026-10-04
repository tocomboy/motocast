# KMA 초단기 정시 요청 교정

2026-09-05. **완료: 승인된 한정 교정의 Preview 배포와 실제 연결 검증 PASS.** [실측](2026-09-05-kma-hour-observation.md)에서 초단기 19:00/18:00 요청·응답과 정확 목표 예보의 필수 값 검증이 통과했다. 사용자 승인과 독립 설계를 토대로 lead가 다음 계약을 채택했다. 공식 공급자 내부 구현을 확정한 것은 아니며 운영 중 불일치는 계속 거절한다.

## 목표 계약

- `latestForecastBase("ultra", now)`: KST :45 이전에는 직전 시간의 :00, :45부터는 현재 시간의 :00이다. 기존 선택 시간·제공 대기 기준을 보존하고 분만 정시로 바꾼다. 날짜/월/연도 이월은 같은 KST 계산을 사용한다. 이 :45 경계의 합성 검사는 선택 식 검증이며 공급자 무중단 가용성 보장이 아니다.
- URL의 base, strict parser 기대값, 성공 세그먼트와 snapshot의 issuedAt은 같은 요청 정시를 사용한다. 응답에 30분을 더하거나 다르게 저장하지 않는다. `parseKmaItems`의 발표·격자·값·중복 검증은 유지한다.
- 초단기 `validatedForecastValues`만 반올림된 정확한 fcstDate/fcstTime 그룹을 요구한다. 없으면 기존 KMA_FORECAST_NOT_FOUND, 그룹의 필수 항목이 없으면 기존 MISSING_*로 실패한다. 모델 선택은 ETA<=6시간 ultra, 그 뒤 5일까지 short로 유지한다. 제공되지 않는 초단기 목표를 다른 모델이나 멀리 떨어진 시각 값으로 대신하지 않는다.
- 하나의 목표라도 실패하면 새 성공 snapshot을 저장하지 않는다. 일치하는 이전 snapshot은 기존 stale 경로로 보여 주고 없으면 기존 안전한 오류를 반환한다. 전체 여섯 시간 구간의 새 예보 가용성을 보장한다는 뜻은 아니다.
- 단기는 기존 최근접 선택을 유지한다. 공식 260623 가이드는 연장 구간의 3시간 간격을 설명하므로 모든 모델에 exact target을 강제하면 정상 단기 자료도 거절할 수 있다. 단기 날짜 문자열 거리 계산의 기존 한계는 이번 국소 교정과 분리한다.
- B1은 진단 전용의 기존 공식 :30 일정 분류를 유지한다. 실측에서 정시가 INVALID/INTERSTITIAL로 분류된 것은 그 역사적 일정 기준이며 수용 판정이 아니다. B1 출력을 근거로 guard를 우회하지 않는다.

## 소유권과 진행

1. **완료:** writer는 _shared/weather-forecast.ts와 그 테스트, 새 weather-timeline/issuance-selection.test.ts만 수정했고 책임을 종료했다. lead는 임시 진단 소스를 제거하고 정본·README·운영·실측 기록을 동기화했다. 기존 사용자 .gitignore와 다른 handoff/조사 파일은 보존한다. 현재 작업에 해당하는 이전 미커밋 날씨 상태 문서의 변경은 검토할 후보에 포함한다.
2. **완료:** 집중 3 files / 28 PASS, FAIL/ERROR/SKIP 0. :45·월/연도 이월·+6h±1ms·exact 목표/누락/필수 값·단기 3시간 최근접 보존과 실제 handler의 URL/파서/저장 발표 일치 및 실패 시 신규 성공 쓰기 0을 확인했다.
3. **완료:** 소유 3파일의 source-copy SHA-256 동일, 전체 59 files / 525 PASS, FAIL/pending/todo 0, lint/typecheck/Deno 5/build PASS, Chromium 20 PASS / connected SKIP 2. 임시 probe 23개 테스트를 제거하고 제품 회귀 10개를 추가해 이전 538에서 525가 됐다. 실패 테스트 skip/xfail로 수치를 줄이지 않았다. 최초 Deno 실행은 DNS EAI_AGAIN으로 SETUP_OR_IMPORT_FAILURE 1, 명시적 네트워크 재실행은 PASS다. Edge 파일 직접 ESLint는 ignore 경고 3개로 미검사이며 Deno 검증과 구분한다. 전체 필수 검사에 동일 lockfile/설치 dependencies를 재사용했다. 고정 SHA8bd8878 독립 검토 APPROVE B0/H0/M0/L1이며 LOW 문서 상태 표현은 후속 문서 동기화에서 해결했다.
4. **완료:** PR #21/run33963499094 exact-head CI와 정착 후 무배포0을 확인했다. Preview weather-timeline v12 배포 뒤 unchanged f6ec59c에서 8bd8878로 fast-forward했고 develop CI33963674030와 Preview READY를 확인했다. 동일 공개 입력 실제 연결은 1 PASS/실패·오류·skip·retry0으로 날씨·컬렉션·공유·회수·재발행 및 정확 소유 정리를 완료했다. [배포 기록](2026-09-05-kma-hour-correction-release.md)의 한계를 포함해 읽는다.
5. **진행:** 문서 전용 동기화의 비문서 tree 동일성, 고정 SHA delta review, CI와 Preview Web readback을 마친다. 새 제품 변경이나 공급자 재호출은 없다.

Production, DB schema, 비밀 설정, 예산 한도·예약 환불, 유료 API, 모델 자동 대체, 오프셋 허용은 범위 밖이다. 새 실측이 계약을 반박하거나 필수 검증/소유권/정리가 실패하면 해당 단계의 원인을 해결하기 전 배포를 진행하지 않는다. Production은 별도 구체적인 승인과 검증이 필요하다.
