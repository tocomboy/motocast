---
name: motocast-web-e2e
description: Run MOTOCAST web user-flow and rendered UI checks after fixes or before release, using existing Playwright and connected browser tools. Separate mocked UI evidence from live Preview and Production results.
---

# MOTOCAST 웹 실제 동작 검증

사용자에게 체크리스트를 넘기기 전에 직접 실행 가능한 검사를 완료한다. 저장소 루트는 이 파일에서 세 단계 위다. 범위·결과 구분은 [검증 정본](../../../docs/rules/verification-and-review.md#agent-owned-e2e)을 따른다.

## 실행 경로 선택

1. 후보 SHA/dirty diff, 변경 동작, 기대 결과, 대상 origin과 실제 배포 SHA를 기록한다. UI 변경이면 기존 Figma 상태와 비교한다. 기존 유효한 증거와 이번에 필요한 재검증을 구분한다.
2. `tests/e2e/`에서 해당 사용자 흐름을 찾는다. 로컬은 `npm run test:e2e -- <관련 spec>`으로 실제 제품 서버·브라우저를 실행한다. 최종 후보는 저장소 필수 전체 검사를 따른다. 실행 전 `playwright.config.ts`의 로컬/연결 분리와 포트·artifact 조건을 읽는다. keyless/intercepted API 결과는 `LOCAL_UI`다.
3. 연결 검사는 기존 연결 브라우저 탭·로그인부터 확인한다. UI 도구로 정상·실패·취소·복귀를 직접 조작하고 표시 결과를 확인한다. 비밀 상태를 추출하지 않는다. 연결 Playwright가 적합하면 `npm run test:e2e:preview`를 사용한다. 이 실행기는 WSL/Linux와 Preview에 결속된 저장소 외부 owner-only storage state를 요구하므로 Windows guard를 제거하지 않는다. 필요한 로그인만 사용자에게 맡기고 이어지는 동작은 직접 수행한다.
4. 실데이터 생성 경로는 `collection-share-live.spec.ts`와 정본의 `MOTOCAST_E2E_LIVE_MUTATIONS`·정리 계약을 읽고 승인된 공개 장소와 테스트 소유 자원만 사용한다. 알 수 없는 mutation 결과를 재전송하거나 사용자 코스를 정리하지 않는다. Production에 Preview 실행기를 돌리지 않는다.

## 관찰과 기록

- UI 영향에 맞게 320/390/820/1440 폭, 큰 글자·스크롤·포커스·로딩·오류·취소를 확인한다. 위치 고정/스크롤 변경은 전후 버튼 위치와 실제 클릭 가능성을 관찰한다. 전체화면·팝업은 가림과 닫힌 뒤 복귀도 확인한다.
- 실패한 assertion과 첫 실패 근거를 보존하고 원인 수정 후 실패·영향 경로를 다시 실행한다. 새 제품 동작을 확정했다면 그 계약으로 검사를 갱신하되 실패를 피하려고 조건을 완화하지 않는다.
- 기존 작업 기록 한곳에 후보/배포, 명령 또는 UI 절차, 환경·데이터 종류, 기대/실제 결과, PASS/FAIL/ERROR/SKIP/NOT_RUN, 안전한 증거 경로, 생성 자원 정리 결과를 남긴다. 캡처·trace에 토큰·공유 bearer·개인 위치를 넣지 않는다. 인증된 Playwright는 기존 screenshot/trace/video 금지를 유지한다.
- 실회원·회수 계정·Play 가입을 가짜 응답으로 통과시키지 않는다. 사용자가 필요한 남은 단계는 구체적 사유와 재개 방법을 적고, 이미 직접 실행한 검사를 다시 사용자에게 전가하지 않는다.
