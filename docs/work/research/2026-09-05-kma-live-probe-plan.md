# KMA 불일치 해결 — 제한 실측 계획

2026-09-05. 사용자가 공개 조사 이후 “전부 해결할때까지 진행”을 지시했다. WEATHER-001/002, COST-001/002, OPS-002/004/007을 적용한다. 외부 문의와 정확 일치 완화는 범위에서 제외한다.

## READY 범위

목표는 실제 제공자의 요청·응답 발표시각 쌍을 공개 고정 격자에서 관측해 원인을 구분하는 것이다. 로컬에는 KMA 자격 증명과 실제 설정 한도가 없으므로, 키를 꺼내는 대신 기존 Preview 비밀을 사용하는 별도 임시 함수 `kma-binding-probe`를 준비한다. 기존 다섯 함수와 제품의 요청·수용·저장 계약은 변경하지 않는다.

1. **완료:** 최신 develop `f6ec59c` fetch, 해당 SHA의 CI 성공 두 건, Preview weather-timeline ACTIVE v11/JWT true를 다시 확인했다. 실제 배포 bundle의 요청 생성·발표시각 계산 부분은 현재 로컬과 같은 흐름이었다. TypeScript 원문과 transpiled bundle 전체의 바이트 동일성을 주장하지 않는다. 검증 복사본의 관련 파일 178개는 현재 작업본과 바이트 동일했다.
2. **완료:** 독립 설계를 토대로 임시 진단 함수와 의미 있는 경계 테스트를 작성했다. 작성자는 새 `supabase/functions/kma-binding-probe/`만 소유했다. lead는 비공개 실행기·계획·최종 검증·배포·정리를 담당한다.
3. **진행:** 작성자 검증을 마쳤다. 고정 SHA 독립 보안/정확성 검토와 비배포 review 브랜치의 exact-head CI를 완료한 뒤, 기존 함수 변경 없이 새 임시 함수만 명시적 Preview 프로젝트에 배포한다.
4. **대기:** client 전송 1회로 최대 세 provider 호출을 실행하고, 성공·실패 모두 임시 함수를 삭제한 후 원격 부재와 기존 다섯 함수 불변을 확인한다. 결과로 수정 계약을 정하고 실제 날씨·컬렉션·공유 검증을 이어간다.

## 진단 계약

- Preview 프로젝트 URL, 고정 활성 테스트 회원 해시, 임의 capability의 SHA-256, 절대 만료시각을 고정한 소스에서만 실행한다. JWT 검증을 끄지 않는다. capability 원문과 갱신된 로그인은 owner-private `/tmp`에만 존재하며 기존 인증 파일을 덮어쓰지 않는다.
- POST만, query/비어 있지 않은 body/Origin 거절, CORS 없음, no-store 응답. 실제 Deno HTTP가 빈 POST도 스트림으로 전달하므로 최대 1초·네 번의 읽기 안에서 데이터 없이 종료된 본문만 허용한다. 초기 회원·capability·프로젝트·만료 검증 실패에는 budget/provider 호출 0회다. 예산 예약 성공 뒤 만료되면 이미 소비한 예약은 유지하고 provider 호출만 차단하며 환불하지 않는다.
- 공개 고정 격자에서 같은 기준 현재 시각의 정규 ultra/short를 각각 1회 요청한다. 유효한 발표시각 불일치가 나온 첫 모델만 직전 정규 발표로 한 번 비교한다. 중간 발표시각을 역으로 넣거나 제품 fallback을 구현하지 않는다.
- 매 fetch 앞에 기존 실제 `consumeBudget`과 현재 `KMA_DAILY_LIMIT`을 사용한다. 새 operation, 가짜 budget, 한도 축소, 예약 환불은 없다. 네트워크 timeout 8초, redirect/자동 retry/추가 페이지 0회, 응답 읽기 상한 2MiB, 진단 배열 최대 1,000개다.
- 기존 strict parser와 필수 항목 검증을 그대로 실행한다. 출력은 고정 상태·모델, 형식/달력을 검증한 요청 및 최대 두 반환 발표시각, 관계, B1, 닫힌 오류 이유로 제한한다. 비밀·전체 URL·원문·날씨 값·위치·회원 정보·임의 오류 문자열을 응답/로그/결과 파일에 기록하지 않는다.
- client는 POST 전에 `DISPATCHED`를 배타적으로 기록하고 재전송하지 않는다. **전역 단 한 번 실행 보장은 아니다.** 실제 계획은 client 1회·함수 호출당 provider 최대 3회이며, 짧은 만료·특정 회원·capability와 삭제가 추가 경계다. RPC나 요청 결과가 불명확하면 재시도 없이 미완료로 기록한다.
- 예산/인증/네트워크/크기/JSON 오류 또는 binding 외 검증 실패는 추가 호출을 중단한다. 실측 성공이 제품 오류 수정이나 전체 Preview 통과를 뜻하지 않는다.

## 보존과 중단 조건

고정 SHA c0d3191 검토의 MEDIUM 1건은 출력용 최대 두 시각 요약을 추가 비교 판정에도 사용한 문제였다. 잘못된 시각이 앞선 날짜 불일치에 가려지거나 요약 밖에 있으면 추가 예약이 가능했다. lead가 원본 최대 1,000개 항목의 모든 발표시각 유효성과 실제 불일치를 별도로 확인하도록 수정했다. 두 경계 회귀를 포함한 집중 검사는 21 PASS이며 기존 exact parser는 변경하지 않았다. 수정 SHA의 delta review 전까지 배포하지 않는다.

기존 dirty `.gitignore`, README/SOT/운영 문서와 과거 조사 기록은 보존한다. Production, schema, 다른 함수, 환경 비밀 설정, 유료 API는 변경하지 않는다. 배포 대상 불일치, 검토/CI 실패, 시간 만료, 비용 제한 실패 또는 삭제 확인 실패는 해당 단계의 중단 조건이다. 원인을 해결하고 영향을 받는 검사만 다시 수행한다.

실측 결과가 정확 일치 유지와 양립하지 않는 새 제품 계약을 요구하면, 임의로 검증을 약화하지 않고 그 구체적인 선택만 사용자에게 제시한다. 공개 조사만으로 공급자 규칙을 확정하거나 같은 진단을 무한 반복하지 않는다.

## 배포 전 실행 증거

- 새 진단 집중 검사 최종 `1 file / 17 PASS`, FAIL/ERROR/SKIP 0. 최초 실행은 14 PASS/1 FAIL 후 기대값 정정, 중간 15 PASS, 추가 경계 검사 후 최종 17 PASS다. 최초 Deno check의 TS2345 진단 2건은 수정했고 최종 타입 검사와 두 파일 Deno format 검사가 통과했다. 기존 ESLint 설정은 Edge 파일을 제외하므로 해당 두 파일 직접 ESLint는 2 warnings/검사 미실행이며 Deno 검사와 구분한다.
- lead 전체 회귀: `59 files / 532 PASS`, FAIL/ERROR/SKIP/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE 0. lint/typecheck, Deno 여섯 entrypoint, production build 모두 PASS. 동일 lockfile과 설치 dependencies는 재사용했다.
- 로컬 Chromium은 최종 `20 PASS / 2 connected SKIP`, FAIL/ERROR/DESELECTED/XFAIL 0. 첫 시도는 웹서버 시작 전 sandbox의 localhost bind `EPERM`으로 실패해 SETUP_OR_IMPORT_FAILURE 1, 테스트는 미실행이었다. 별도 `next start`로 같은 EPERM을 확인하고 서버 실행 권한으로 동일 suite를 재실행해 통과했다. 실제 Preview 테스트는 아니다.
- 비공개 실행기 타입 검사 및 가짜 I/O를 사용한 실행기 회귀 `7 PASS / 0 FAIL`. single dispatch, 스트림 상한, 필드 유출 차단, 잘못된 JWT 설정의 소유 함수 정리, 소유권 변경 시 보존, 재전송 금지, 자격 파일 실패의 안전한 처리를 확인했다.
- 실행기 독립 보안 delta review APPROVE `B0/H0/M0/L0`. 초기 MEDIUM 3건(읽기 상한·요청 필드·정리 순서)과 LOW 1건(오류 처리 밖 자격 파일 읽기)은 해소했다. 실행기 SHA-256 `2d40790913910af4ba77b027b4246308f8eb3135419a51d12c81584bb7009dda`. 서버 함수의 고정 SHA 승인은 별도다.
- 현재까지 실제 KMA 호출·임시 함수 배포·DB/Production 변경은 NOT_RUN이며 이전 날씨 오류가 고쳐졌다고 주장하지 않는다.

### 실제 HTTP 전송 경계 보완

중단 후 재개하면서 lead가 실제 localhost Deno 서버로 빈 POST를 보냈다. 본문은 null이 아닌 스트림이고 0바이트 청크 뒤 종료되므로 기존 `request.body !== null` 조건이 정상 진단 요청도 차단했다. 종료된 writer의 두 파일 책임은 lead가 회수해 데이터 없는 본문만 제한 시간·읽기 횟수 안에서 허용하도록 수정했다. 실제 handler와 가짜 인증/예산/provider를 조합한 native HTTP 검사는 첫 수정에서 FAIL 1(0바이트 청크 처리 누락), 최종 PASS 1이었다. 최종 결과는 실제 빈 POST 스트림에서 합성 예약/조회 각각 2회, 실제 KMA 호출 0회다. 추가 회귀를 포함한 집중 테스트는 최종 19 PASS이고 Deno check도 PASS다. 기존 예산 예약 후 만료 설명 LOW는 예약 유지/provider 0으로 정정했다.
