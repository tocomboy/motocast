# KMA 공개 고정 격자 — 요청·반환 발표시각 실측

2026-09-05. [제한 실측 계획](2026-09-05-kma-live-probe-plan.md)의 일회 실행을 완료했다. 외부 문의는 없으며 정확한 요청·응답 발표시각 검증은 유지한다.

## 관측 결과

검토된 실행기가 Preview 임시 함수를 한 번 호출했다. HTTP 200, 진단 실행 COMPLETE, provider 호출 3회, 예산 예약 실패 0회다. COMPLETE는 계획 실행 완료이며 날씨 정상 판정이 아니다. 모든 날짜는 2026-09-05, 시각은 한국시간이다.

| 순서 | 모델 | 요청 발표 | 반환 발표 | 차이 | 기존 strict parser 및 필수 값 검증 |
| --- | --- | --- | --- | --- | --- |
| 1 | 초단기 | 19:30 | 19:00 | -30분 | FAIL / KMA_INVALID_RESPONSE / BASE_TIME_MISMATCH |
| 2 | 단기 | 17:00 | 17:00 | 0분 | PASS |
| 3 | 초단기 직전 정규 발표 | 18:30 | 18:00 | -30분 | FAIL / KMA_INVALID_RESPONSE / BASE_TIME_MISMATCH |

세 응답 모두 B1 COMPLETE/VALID/ONE이고 격자가 일치했다. 초단기 두 응답의 알려진 두 항목 그룹은 동일한 이전 중간 발표를 가리켰으며, 단기 두 그룹은 정확 일치했다. 알려지지 않은 항목 그룹은 없었다. COMPLETE는 받은 배열 검사 범위이며 원격 전체 페이지 증명이 아니다. 초단기 값·중복·필수 항목 검증은 발표시각 검사에서 중단돼 통과를 주장하지 않는다. 단기는 실제 조회 시각에서 세 시간 뒤 예측 대상의 필수 값 검증까지 통과했다.

이번에는 실패 모델과 정확한 시각 쌍을 관측했다. 두 초단기 조회에서 공통으로 30분 차이가 난다는 사실만으로 공급자의 일반 선택 규칙이나 모든 시점의 일정 차이를 확정할 수 없다. 반환 정시를 요청으로 역입력하지 않았고, 오프셋을 허용하거나 제품의 시각 선택·저장 계약을 변경하지 않았다. 단기 PASS도 전체 경로 날씨·공유 흐름의 성공을 대신하지 않는다.

## 배포와 정리 증거

- 고정 SHA `0d18a27b578f78ba49e04e327bd9d5f9cff4fca4`, CI 전용 [PR #19](https://github.com/tocomboy/motocast/pull/19), `review-kma-probe-0d18a27`에만 push했다. 원격 develop과 Web은 `f6ec59c`를 유지한다. PR은 병합하지 않았다.
- [CI 33961430841](https://github.com/tocomboy/motocast/actions/runs/33961430841) success, 완료 run의 headSha가 고정 SHA와 같다. webhook 처리 후 해당 SHA GitHub Deployments 0, Vercel check 0, status context 0을 확인했다.
- 완료 CI 로그에서도 Vitest 59 files / 536 PASS, Chromium 20 PASS / connected SKIP 2를 확인했다. CI의 로컬 브라우저 검사는 실제 Preview 연결 성공을 대신하지 않는다.
- 임시 `kma-binding-probe`만 명시적 Preview `lehjmbgfpoemqcwxowbx`에 배포했다. 함수 ID `cc06cf85-a451-4187-a27a-778a7e4e8611`, ACTIVE v1, JWT true, updated_at `1788605196764`였다. 기존 다섯 함수는 배포 전후 버전·시각·JWT·상태 불변이었다.
- 실행기는 POST 전에 DISPATCHED를 배타적으로 기록했고 재전송하지 않았다. 반환은 허용 필드만 검증한 뒤 owner-private 파일에 보존했다. 원문·키·회원·장소·날씨 값은 기록하지 않았다.
- 같은 소유 ID/버전/updated_at을 다시 확인하고 삭제했다. DELETE 200, GET 404, cleanup PASS. 최종 목록은 기존 다섯 함수뿐이며 이전 메타데이터와 일치한다. 예산은 정상 소비 상태로 유지한다.
- 실제 provider 결과 집계: PASS 1 / FAIL 2, 예산 예약 실패 0. 계획 실행·정리 PASS 각각 1. 브라우저 날씨·컬렉션·공유, DB schema, Production은 이번 실측에서 NOT_RUN이다.

## 구현 검증과 독립 검토

최종 집중 검사 21 PASS, 전체 536 PASS / FAIL 0 / pending 0 / todo 0, Deno check PASS. 기존 단계의 lint/typecheck/Deno/build 및 로컬 Chromium 20 PASS / connected SKIP 2는 앞선 계획에 별도로 기록했다. 실제 HTTP의 빈 POST 스트림과 잘못된 발표시각의 추가 호출 차단을 보완했다. 최종 fixed-SHA 독립 검토 APPROVE B0/H0/M0/L0이며 MEDIUM 1건은 RESOLVED, 실제 handler 대조 4 PASS다. 실행기는 변경 없는 SHA-256 `2d40790913910af4ba77b027b4246308f8eb3135419a51d12c81584bb7009dda`에 대한 기존 보안 승인을 유지했다.

다음 단계는 새 시각 쌍을 공식 문서의 초단기 일정·경로와 대조하는 것이다. 공개 조사를 반복한 것만으로 원인 해결이나 Preview GREEN을 선언하지 않는다.
