# KMA 정시 요청 교정 — Preview 완료 기록

2026-09-05. **승인된 KMA 교정의 Preview 연결 검증 완료.** 외부 문의 없이 Exa 공식 조사와 제한 실측으로 정시 요청을 채택했다. 공급자 내부 규칙 전체를 확정한 것은 아니다. 요청·응답 발표시각의 정확 일치 검증은 유지하며 초단기의 정확한 도착 목표 예보가 없으면 기존 실패·stale 경로로 처리한다. Production 전체 Goal은 이 기록으로 완료 처리하지 않는다.

## 변경과 검토

- 제품 고정 SHA `8bd887802a9578de5469e70ac1495440559f2682`; 이전 Preview `f6ec59cee100147406f6582ded1caa568369e886` 대비 제품 런타임 변경은 `_shared/weather-forecast.ts` 한 파일이다. 초단기 요청만 HH00, 기존 :45 경계 유지, ultra exact target 강제, short 3시간 자료의 최근접 선택 보존이다. URL·strict parser·세그먼트·snapshot은 같은 발표시각을 사용한다.
- 실제 handler 회귀는 성공 URL/검증/저장 일치와 발표 불일치·목표 누락 시 HTTP502/신규 성공 저장0/예산예약1을 검증한다. `parseKmaItems`, B1, 인증, DB/schema, 예산 한도·예약, route/UI 계약은 변경하지 않았다. 두 일회용 실측 함수는 원격 삭제200/부재404 확인 후 소스·테스트도 제거했다.
- 독립 read-only 정확성·데이터·회귀·운영 검토: **APPROVE B0/H0/M0/L1**. LOW는 정본의 구현 pending 표현이며 이 문서 동기화에서 해결한다. 리뷰어 테스트 재실행은 NOT_RUN이며 전달된 작성자 실행 증거와 구분한다.

## 검증 수치

| 구분 | 실제 결과 |
| --- | --- |
| 집중 회귀 | 3 files / 28 PASS; FAIL/ERROR/SKIP 0 |
| 전체 Vitest | 59 files / 525 PASS; FAIL/pending/todo 0 |
| 정적·빌드 | lint/typecheck/Deno 5/build PASS |
| 로컬 Chromium | 20 PASS / connected SKIP 2; FAIL 0 |
| 실제 Preview 연결 | **1 PASS / FAIL 0 / ERROR 0 / SKIP 0 / DESELECTED 0 / XFAIL 0 / SETUP_OR_IMPORT_FAILURE 0; retry 0** |
| 연결 실행 시간 | 2026-09-05T11:35:23.052Z 시작, reporter 36.107초 |

초기 Deno DNS EAI_AGAIN 1건은 SETUP_OR_IMPORT_FAILURE이며 승인된 네트워크 재실행에서 5개 모두 PASS다. Edge 직접 ESLint 3파일은 ignore 경고여서 검사 증거로 계산하지 않는다. 동일 lockfile과 설치 dependencies를 재사용했다. source/copy 관련 187파일 바이트 동일, 배포 직전 함수 tracked 53파일은 고정 SHA와 동일했다. 기존 probe 23개 제거와 제품 회귀 10개 추가로 전체 수가 538에서 525가 됐으며 skip/xfail로 실패를 숨기지 않았다. 이 slice의 DB migration/RLS/Production 검증은 NOT_RUN(변경 범위 밖)이다.

## 배포 계보

1. slash-free `review-kma-fix-8bd8878`, CI-only [PR #21](https://github.com/tocomboy/motocast/pull/21), [run 33963499094](https://github.com/tocomboy/motocast/actions/runs/33963499094): exact head SHA success. Webhook 정착 후 GitHub Deployments0/Vercel checks0/status contexts0을 확인했다. PR merge 명령은 사용하지 않았다.
2. 명시적 Preview `lehjmbgfpoemqcwxowbx` = `MOTOCAST_Preview`, Seoul을 Management API로 확인했다. weather-timeline만 ACTIVE v12/JWT true/updated_at1788608001663으로 배포했다. plan-route v11, search-places/save-collection/kakao-oidc v8은 버전·ID·updated_at 불변이고 JWT false는 kakao-oidc뿐이다.
3. 직전 fetch에서 origin/develop=f6ec59c 불변과 조상 관계를 확인한 뒤 같은 8bd8878로 fast-forward했다. [develop CI 33963674030](https://github.com/tocomboy/motocast/actions/runs/33963674030)도 exact SHA success다.
4. GitHub Preview Deployment `6280478531` / status `17866058512` success. Vercel `dpl_2xWMSHiTArk75Hxt8qdAtKG7HEpt` READY, develop/8bd8878, `motocast-hh1ae1su2-tocomboys-projects.vercel.app` 및 고정 develop 별칭 일치다. 인증 HTTP200, nosniff/referrer-policy/permissions-policy/HSTS를 확인했다. CSP는 응답에 없으며 이 교정에서 추가하지 않았다.

자동 승인 심사는 커밋·Preview 배포의 범위 증거가 부족하다며 각 최초 요청을 거절했다. 저장소 필수 workflow와 사용자 승인, 실제 프로젝트 이름/ID/리전 매핑을 추가 확인해 동일 명령 재심사에서 승인됐다. 우회 실행은 없었으며 현재 차단 사항은 아니다.

## 실제 사용자 흐름과 정리

기존 실패 때와 같은 공개 장소 입력과 미래 서울 출발시각을 사용했다. 실제 도로 경로 계산/원자적 저장/지도/날씨를 통과한 뒤 컬렉션 저장·복원 및 lunch→waypoint→rest 순서, 저장한 체류시간 복원, 명시 계산 후 정확히 한 번의 route/finalization/weather/preview, 별도 명시 공유 발행을 검증했다. 공유 회수·재발행·재회수, 320/390/820/1440 표시와 모바일 역할·이동·휴식 경계도 통과했다. 발행된 두 링크의 회수와 정확한 테스트 소유 컬렉션·trip 삭제를 완료했고 afterEach 정리 오류0이다. Provider/search 예산 예약은 환불하지 않았다.

해당 실행 구간 11:35–11:37 UTC의 읽기 전용 운영 로그: Supabase 함수32건은 모두 runtime lifecycle이고 KMA/error/failure0; Vercel16건은 HTTP200 12/204 2/404 2다. 404 두 건은 테스트가 회수한 링크의 `/api/shares/resolve` 거절이며 예상 동작이다. 예상 밖 HTTP오류/브라우저오류/포함 로그 오류0, 조회 상한100 미도달이다. 전체 서비스의 모든 시각·사용자 무오류 보장을 뜻하지 않는다.

인증/장소 입력/공유 bearer를 출력하지 않았다. 원본 연결 JSON과 운영 로그는 repository 밖 `/tmp/motocast-kma-hour-correction`의 owner-private 디렉터리0700/파일0600에만 보존한다. Screenshot/trace/video는 꺼져 있다. `.gitignore`와 기존 무관한 인계/조사 파일은 커밋에 포함하지 않는다.

## 완료 범위와 후속

이 결과는 현재 공개 경로에서 KMA 불일치로 막혔던 Preview 날씨·컬렉션·공유 흐름을 닫는다. 두 실측과 한 실제 흐름은 모든 제공 시각이나 6시간 끝점 가용성을 보장하지 않는다. 새로운 불일치는 계속 거절하며 단기 날짜 숫자 거리 계산의 기존 한계는 별도 과제다. Production/main, DB, 비밀, 리전, 유료 API는 변경하지 않았다. Production 승격과 초대 라이더의 전체 Production gate는 별도 승인·검증 대상이다.

이후 문서 전용 동기화는 제품 SHA8bd8878과 모든 비문서 tracked 파일의 바이트 동일성을 확인해 같은 런타임임을 증명한다. 새 코드·설정·테스트 변경 없이 이 기록과 정본 상태만 반영하며, 문서 커밋의 고정 SHA review/CI/무배포 조건과 Preview Web readback을 별도 확인한다. 이미 통과한 연결 테스트를 문서 변경만으로 다시 호출하지 않는다.
