# KMA 정시 직접 요청 결과

2026-09-05. 사용자가 승인한 [실측 근거 평가안](2026-09-05-kma-request-selection-decision.md)과 [후속 진단 계획](2026-09-05-kma-hour-probe-plan.md)을 실행했다. 외부 문의와 제품 수용 검증 완화는 없다.

| 모델 | 요청 날짜·시각(KST) | 반환 날짜·시각(KST) | 결과 |
| --- | --- | --- | --- |
| 초단기 | 2026-09-05 19:00 | 2026-09-05 19:00 | strict 및 정확 target 필수 값 PASS |
| 초단기 | 2026-09-05 18:00 | 2026-09-05 18:00 | strict 및 정확 target 필수 값 PASS |

HTTP 200, run COMPLETE, providerCalls 2, budgetReservationFailures 0, PASS 2/FAIL 0다. strict parser가 전체 받은 배열의 발표일자·발표시각·격자·값·중복을 확인한 뒤 capturedNow+1시간을 반올림한 정확한 예측일자·시각만 대상으로 필수 값 검증을 통과했다. 다른 예측시각의 최근접 값으로 통과하지 않았다. 이는 두 과거 발표의 실제 증거이며 모든 발표·:45 제공 경계·여섯 시간 끝의 가용성 보장은 아니다.

첫 [실측](2026-09-05-kma-fixed-grid-observation.md)의 19:30→19:00, 18:30→18:00과 비교하면, 이번 두 정시 요청은 응답도 정시였다. 모든 요청에서 무조건 30분을 빼서 응답한다는 가설은 이 범위에서 배제된다. 공급자의 내부 반올림·갱신·캐시 구현 원인은 아직 확정하지 않는다.

B1은 두 응답 모두 `COMPLETE INVALID ONE`과 각 알려진 그룹의 `VALID,ONE,EXACT,INTERSTITIAL_TEN_MINUTE,MATCH`를 기록했다. 선두 INVALID는 B1이 사용하는 기존 공식 `:30` 일정과 요청 `:00`이 다르다는 진단 분류다. 받은 발표시각 형식 오류나 실제 strict 거절을 뜻하지 않는다. B1은 수용 판정에 사용하지 않으며, 그 분류 의미를 성공으로 바꿔 읽지 않는다.

## 운영 증거

- 고정 SHA b2d1e3d58f36b1bd56b4b7b867c13733d5ca7efe, [PR #20](https://github.com/tocomboy/motocast/pull/20), 비배포 review-kma-hour-b2d1e3d만 push. [CI 33962475338](https://github.com/tocomboy/motocast/actions/runs/33962475338) success, 완료 run headSha 일치. webhook 처리 후 Deployments 0, Vercel check 0, status context 0.
- 후속 임시 함수만 Preview lehjmbgfpoemqcwxowbx에 배포. ID d7fc6875-a4e7-41ef-b29b-3c7819b8c603, v1 ACTIVE/JWT true, updated_at 1788606675983. 기존 다섯 함수 불변.
- 실행기 hash 5ad3f7e49710802d77d28e1e57ed47b09763979bc199275022379671a3949965, client 전송 1회, provider 2회. 새 capability/state/dispatch 자료만 사용했고 기존 기록은 보존했다. 실제 예산은 소비 상태로 유지한다.
- 동일 소유권 재확인 후 DELETE 200/GET 404, cleanup PASS. 마지막 함수 목록은 기존 다섯 개이며 버전·상태·JWT·updated_at 모두 이전과 일치한다.
- 집중 23 PASS, 전체 538 PASS/FAIL 0/pending 0/todo 0, Deno PASS. 실행기 mock 8 PASS/FAIL 0. 고정 SHA 및 최종 실행기 독립 APPROVE B0/H0/M0/L0. 최초 잘못된 복사본 검사와 3건의 fixture 기대값 정정 이력은 계획에 분리 기록했다.

제품 shared helper와 기존 다섯 함수는 이번 진단에서 변경하지 않았다. origin/develop·Preview Web은 f6ec59c, 두 진단 PR은 미병합이다. 연결된 경로 날씨·컬렉션·공유·Production은 이번 실측에서 NOT_RUN이다. 후속 제품 교정 후보를 설계할 수 있지만 이 실측 자체가 전체 오류 해결이나 Preview GREEN은 아니다.
