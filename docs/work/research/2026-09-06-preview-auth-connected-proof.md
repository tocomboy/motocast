# Preview 시험 신원 연결 검증 — 2026-09-06

2026-09-06 KST / 2026-09-05 UTC. 사용자 `승인`으로 임시 시험 Auth4개·소유 자료·B 회수 상태·정확 정리의 실행 범위가 확정됐다. 기존 승인 질문은 해소됐으며 재요청하지 않는다. 전체 Preview와 Production은 미완료다.

## READY 계약과 실행 계획

AUTH-001~004, COST-001~002, OPS-001~008 및 [분리 설계](2026-09-05-separated-preview-verification-design.md), [고정 도구 준비](2026-09-05-separated-preview-tool-readiness.md)를 따른다. Lead 소유는 외부 launcher와 이 증거 및 최신 정본·운영·계획·인계 상태 갱신이다. core8파일·제품 코드·사용자 .gitignore·기존 미추적 자료는 보존한다. 승인 범위는 서울 Preview의 임시 T/A/B/N, 초대2개, trip/collection/version/share 각2개, profile/membership 각3개와 exact-B 회수 seed다. 성공·실패 모두 정확 정리해야 하며 실사용 계정은 mutation 대상에 넣지 않는다.

| 단계 | 결과 |
| --- | --- |
| Git/고정 도구/Preview preflight | 완료: fetch 후 HEAD/origin98afe02, core8파일 hash 일치, preflight1 PASS |
| 실제 시험 Auth·초대·권한·정리 | 완료: 총149 PASS, 나머지 결과 분류 각0 |
| 정리 후 실제 재조회 | 완료: exact cleanup1 PASS, 보호 지문 일치 |
| 실행 근거 독립 검토 | 완료: APPROVE B0/H0/M0/L0, 결과·journal·launcher·구현 읽기 전용 감사 |
| 최신 문서 반영 | 로컬 갱신; 새 문서 commit/CI/배포는 미실행 |
| 실제 Kakao·추가 실패 조건 | 미완료, 아래 부족분 참조 |
| Production 승인·승격·검증 | NOT_RUN; 이번 승인은 Preview 시험 실행에 한정 |

## 실제 실행과 결과 분류

`/tmp/motocast-separated-auth-20260905/approved_run.py`의 preflight → execute → inspect-cleanup을 실행했다. 기존 management credential/API key는 메모리에서만 읽었고 신규 credential 파일은 만들지 않았다. 네트워크 요청과 정리 동작은 기존 검토 core를 그대로 호출했다.

- 사전 점검 **PASS1**: 서울 ACTIVE_HEALTHY Preview, Auth v2.196.0, 고정 hook·trigger·스키마·FK·시험 UUID 사전 부재. core8파일 hash 일치.
- 연결 실행 **PASS149 / FAIL0 / ERROR0 / SKIP0 / DESELECTED0 / XFAIL0 / SETUP_OR_IMPORT_FAILURE0 / NOT_RUN0**, exit0.
- 149 구성: 회수 전 역할70, 회수 후 역할73, 실제 시험 인증 세션 준비1, A/B 초대 수락2, 같은 사용자 초대 재시도2, 정확 정리1. 모든149개가 역할 요청이라는 뜻은 아니다.
- 후속 읽기 전용 **exact_cleanup_readback PASS1 / protected_data UNCHANGED**, exit0. 위149에 중복 합산하지 않는다.
- 결과 파일 SHA-256: `6cfb158628bcaa8207f5dd137cf63ffa7ac0d1708980b850ef647c9f793460b4`.
- launcher SHA-256: `59917c70ab3614ab9df6488145e5d6461a36c48fc460e5d81351391ea5ad1135`.

비공개 journal은 신원 생성 intent4/confirmed4, 작업 intent9/confirmed9, cleanup intent1, Auth delete intent4와 마지막 cleanup_complete1을 기록했다. journal/result/lock은 저장소 밖 owner-only 디렉터리의0600 파일이다. 비밀번호·세션 token은 메모리에서만 사용했고 프로세스 종료로 해제됐다. 복구 소유권 기록은 비공개로 보존하며 플랫폼 감사 로그를 지우지 않았다.

정리는 fixture public 자료 및 auth.users/identities/sessions/refresh_tokens 잔존0을 확인한다. 전후 보호 지문의 범위는 **fixture를 제외한 public16개 테이블과 auth.users**이다. 기존 Auth sessions/identities 전체나 모든 외부 설정을 지문 비교했다는 주장은 하지 않는다. 기존 실제 계정에는 변경 요청을 보내지 않았다.

## 인정 가능한 증거 범위

분류는 **CONNECTED_AUTH_FIXTURE_AND_SEEDED_CONTROL**이다. 실제 Supabase Auth가 발급·검증한 시험 JWT로 실제 Preview PostgREST/RPC를 호출했다. 특권 준비/정리는 사용자 권한 요청 프로세스와 분리했다.

| 항목 | 닫힌 증거 | 남는 범위 |
| --- | --- | --- |
| 초대 수락 | 시험 T의 실제 초대 생성, A/B claim 및 동일 사용자 재시도 | 실제 Kakao 최초 가입, 만료/회수/타 사용자 재사용 초대 전체 흐름 |
| A/B·관리자·비회원·익명 | 실제 존재하는 소유 trip/collection/version/share 조회, 타인 조회·삭제·회수 거절 | 제품 UI/전체 endpoint 및 실제 Kakao 세션 발급 |
| 회원 회수 | exact-B seed 뒤 이미 발급된 B JWT로 접근 거절, A 접근 유지 | 관리자 제품 회수 UI/RPC 기능은 확인되지 않았으며 PASS로 세지 않음 |
| 저장·공유 | permission-only 합성 자료의 소유권 경계 | 유효한 경로·날씨·컬렉션 저장/복원·공개 발행의 새 실행 아님. 기존 정상 연결1 PASS 별도 재사용 |
| 정리·실사용 보존 | 시험 자료/Auth 잔존0, 보호 지문 일치 | 외부 시스템 전체를 포함한 무변경 감사로 확대하지 않음 |

독립 read-only correctness reviewer는 결과 hash, core8파일, launcher, journal과 cleanup 조건을 대조하고 APPROVE B0/H0/M0/L0를 반환했다. reviewer는 네트워크 재실행이나 문서/코드 변경을 하지 않았다. 후속 cleanup readback은 lead 실제 실행 증거로 분리했다.

## Git·CI·배포 조회

- fetch 후 HEAD/origin develop = `98afe0231faf5b718c8812be7bc3e0b784b6eae3`. 기존 review CI33966896416와 develop CI33967071715는 이번 GitHub API 조회에서도 동일 SHA completed/success다. 새 변경의 CI를 실행했다는 뜻은 아니다.
- Preview Edge readback: weather-timeline12, plan-route11, search-places/save-collection/kakao-oidc8 모두 ACTIVE. JWT false는 kakao-oidc뿐이다. 공급자 호출 없이 기존 KMA 정상 연결 증거를 재사용한다.
- Vercel 최초 live alias 재조회 이력: 첫 시도는 로컬 `.vercel/project.json` 부재로 **SETUP_OR_IMPORT_FAILURE1**, 별칭 slug 조회와 팀 목록 조회는 각각 HTTP403(**ERROR2**, 마지막 safe code forbidden)이다. 자동 실행 승인 거절이 아니라 외부 API의 접근 거절이다. 인증/설정을 바꾸거나 값을 출력하지 않았다. 당시 Web alias SHA는 검증하지 못했다. 후속에서 만료된 접근 token과 갱신 token 존재를 비공개 확인하고, 기존 캐시의 공식 Vercel CLI59.11.7 `whoami`로 정상 갱신했다(exit0). 갱신 후 팀ID로 실제 별칭을 재조회해 `dpl_HiueyMFkC1vL2NRfJncJNEst8ECm`, READY, exact98afe02 일치 PASS를 확보했다. 초기 SETUP1/ERROR2 이력은 유지하고 현재 접근 차단은 해소됐다. credential 파일을 직접 편집하거나 설치·배포·프로젝트 설정을 변경하지 않았다.
- main/Production/운영 비밀/리전/일일 quota/공급자 설정 변경0. 새 commit/push/배포0. Vercel 읽기 권한은 후속 갱신으로 복구됐으며 새 릴리스의 고정 SHA 검토·CI·무배포 gate는 별도 수행해야 한다.

## 남은 필수 검증

후속 [날씨 상태별 실제 공유 차단11 PASS](2026-09-06-negative-share-connected-proof.md)와 정확 정리 재조회가 완료됐다. 아래 공유 fixture 준비 필요 기록은 당시 이력이며, 공급자·예산·Kakao 및 전체 UI 범위는 여전히 미완료다.

실제 Kakao 최초 가입에는 아직 가입하지 않은 Kakao 신원과 사용자의 직접 로그인이 필요하다. 사용자는 현재 두 실사용 계정만 이용할 수 있다고 답했다. 신규 신원 부족으로 최초 가입 전 과정은 NOT_RUN/BLOCKED이며 과거 가입 기록이나 시험 Auth claim으로 대체하지 않는다. 실제 두 이용 계정만으로 새 가입을 재현하려고 탈퇴·권한 회수·자료 삭제하지 않는다.

저장본 없음·stale·만료의 실제 negative 공유 RPC에는 유효한 시험 route/weather/grant와 확장된 exact cleanup 도구 검토가 필요하다. 기본149개 permission fixture에 임의 추가하지 않는다. [분리 설계의 후속 소스 대조](2026-09-05-separated-preview-verification-design.md#공유-차단-연결-검증--고정-소스-대조-후속)를 따른다.

active weather v12의 공급자 실패·공용 예산 부족/소진 후 저장 자료 조회에는 실제 이용에 영향을 주지 않는 실패 조건이 아직 없다. 기존 격리 handler16 PASS는 유지하되 연결 PASS로 바꾸지 않는다. 공용 quota 고갈·limit/비밀 임의 변경·모델 fallback은 금지한다. 모든 Preview gate가 닫히기 전 Production 최종 승격안을 승인 대상으로 제출하지 않는다.
