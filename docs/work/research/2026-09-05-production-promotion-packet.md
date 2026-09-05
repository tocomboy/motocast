# Production 승격 준비안 — 아직 승인 요청 단계 아님

2026-09-05. Preview의 계정별 인증·실패·예산 연결 gate가 남아 있다. 이 문서는 미리 준비 가능한 배포 범위와 운영 절차이며 Production 변경 승인을 받은 문서가 아니다. 전체 완료 상태는 [Preview 계획과 증거](2026-09-05-preview-gates-plan.md)를 따른다.

## 후보와 사용자 영향

- 현재 배포 기준 `0b23aeabe48e25f1f52b8e00109d49f0c18761d2`, KMA 제품 `8bd887802a9578de5469e70ac1495440559f2682`. 정확한 만료 표시 수정의 고정 SHA 검토/CI/Preview 배포 이후 후보를 교체한다. 최종 승격 SHA는 모든 Preview gate를 충족한 develop로 고정하며 현재는 미확정이다.
- 현재 main `d0134ed93d7e0d8aed1123c5d693c665bbe646e8`과 비교하면 단일 이륜차 안전 경로, 혼합 경유·정차 순서, 완전한 컬렉션, 승인 후 불변 공유/회수, 이메일 없는 Kakao OIDC, 신뢰된 저장 RPC와 KMA 교정이 포함된다. KMA 교정 하나만 배포하는 승격이 아니다.
- 라이더는 초대로 가입하고 선택한 모든 지점을 지나는 한 경로와 구간 날씨를 저장·공유한다. 예보가 없거나 오래되거나 만료되면 새 공유는 거절한다. 기존 schemaVersion1/2/3 불변 공유와 과거 경로의 읽기 호환성을 유지한다.
- Web·Edge·DB가 결합된 변경이므로 운영 점검 시간 동안 신규 계산·저장·공유 발행을 멈추고 백업과 순차 배포를 진행해야 한다. 점검 방식/시간과 해당 구간 사용자 영향은 승인안에 함께 확정한다.

## 현재 운영 대상 — 읽기 전용 실측

| 대상 | 현재 상태 | 승격 대상 |
| --- | --- | --- |
| Preview Supabase | `lehjmbgfpoemqcwxowbx`, Seoul, ACTIVE_HEALTHY, migration11개, 함수5개 | 유지 |
| Production Supabase | `obodvbyzptxeehgpcpkd`, Tokyo, ACTIVE_HEALTHY | 같은 프로젝트 유지, reset 금지 |
| Production migration | `20260830193000`, `20260830204000`, `20260830212000` | 미적용8개를 순서대로 검증·적용 |
| Production Edge | search-places/plan-route/weather-timeline 각 ACTIVE v3/JWT true | 고정 후보의5함수, 새 save-collection/kakao-oidc 포함 |
| Vercel | motocast, Node20.x, main Production, 보호 Preview만 | Node/리전/보호 유지, Production public 설정 귀속 확인 |
| GitHub | 기본develop, main 필수verify/develop-only, 관리자 강제·대화해결, force/delete금지 | 같은 저장소 develop→main PR |

Production에는 현재 public table11개가 있다. 이를 빈 DB로 취급하지 않으며 실제 사용자 자료를 Preview로 복사하지 않는다. 최초 migration 파일의 초대 check는 과거 변경됐으므로 이미 적용된 버전을 재실행하지 않고 현재 physical constraint와 후속 hardening의 보정 결과를 dry-run/복구 시험에서 확인한다.

## 설정 이름과 소유권

| 소유 위치 | 설정 이름 | 확정·검증할 값의 의미 |
| --- | --- | --- |
| Vercel Production | NEXT_PUBLIC_SUPABASE_URL | Production `obodvbyzptxeehgpcpkd` origin만 |
| Vercel Production | NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 동일 Production 프로젝트 공개키 |
| Vercel Production | NEXT_PUBLIC_KAKAO_MAP_JS_KEY | Production Kakao 앱 JS 키, 실제 Production origin 허용 |
| Supabase Production | KAKAO_REST_API_KEY, KAKAO_LOGIN_CLIENT_SECRET | Production 앱의 REST/로그인 소유권 |
| Supabase Production | KAKAO_OIDC_STATE_SECRET, PLACE_VERIFICATION_SECRET | 환경별 독립 난수, Preview 값 복사 금지 |
| Supabase Production | KMA_APIHUB_KEY | Production에서 사용할 공급자 자격의 소유권·무료 사용 확인 |
| Supabase Production | ALLOWED_ORIGINS | 실제 Production origin의 정확 allowlist |
| Supabase Production | KAKAO_LOCAL_DAILY_LIMIT, KAKAO_CURRENT_DAILY_LIMIT, KAKAO_FUTURE_DAILY_LIMIT, KMA_DAILY_LIMIT | 승인된 양의 정수, 공급자 무료 한도 이하 |
| Supabase/Kakao 콘솔 | Kakao provider, email optional, OIDC, scope/redirect | openid/profile_nickname/profile_image만, account_email 없음 |

현재 Vercel에는 세 public 이름만 존재한다. develop 전용 override와 기존 공통 preview/production 항목이 함께 있으며 이름 조회는 실제 값 귀속 검증이 아니다. 운영 설정은 승인 후 값의 비공개 비교와 배포 bundle 점검을 완료한다. Production Kakao callback은 `https://obodvbyzptxeehgpcpkd.supabase.co/functions/v1/kakao-oidc/callback`으로 고정한다. 실제 Web origin은 배포 프로젝트의 Production alias를 읽어 확정하며 새 도메인을 추정하지 않는다.

## 비용과 접근 경계

- 유료 API·Biz Wallet·자동결제·유료 플랜을 활성화하지 않는다. 공급자 콘솔의 무료 사용·차단 설정을 확인하지 못하면 공급자 활성화를 멈춘다.
- 예산은 서울 날짜/provider/operation 공용이며 외부 시도 직전 원자 예약한다. 실패 시 환불하지 않고 missing/non-positive/exhausted는 fail-closed이다. 기존 저장 자료 조회는 외부 호출을 필요로 하지 않는다.
- `.env.example`의 local1000/current1000/future500/KMA1000은 개발 예시이며 운영 무료 한도를 검증한 수치가 아니다. 실제 공급자 앱의 무료 quota와 예상 사용량에 맞춘 초기 숫자를 최종 승인안에 기록해야 한다. 실제 quota 고갈로 시험하지 않는다.
- Production 공개 접속에는 Vercel 로그인 보호를 걸지 않고 MOTOCAST 초대·Kakao·회원/RLS 경계를 적용한다. 관리자가 타인의 계획·컬렉션·공유 소유권을 우회할 수 있다는 뜻이 아니다.

## 승인 후 실행 순서

1. 모든 Preview gate와 exact-head CI/독립 검토 B0/H0를 닫고 최종 develop SHA·전체 changed set을 고정한다. 중간 변경이 있으면 영향받는 검증/검토를 다시 수행한다.
2. 사용자가 후보SHA, 점검시간/영향, 아래 backup·migration·함수·설정·main 승격·검증·롤백 범위를 승인한다. 현재 단계에서는 이 승인을 요청하지 않는다.
3. Production의 정확한 프로젝트와 migration/head/함수/설정 이름을 다시 읽고 pre-cutover backup을 저장소 밖 보호된 위치에 보존한다. timestamp·source ref·hash·restore 대상과 증거를 기록한다. 운영 자료를 Preview로 복사하지 않고 별도 승인된 폐기 가능한 복구 환경에서 검증한다.
4. 현재3개 migration 이후 8개(`20260830223000` → `20260830224500` → `20260831213000` → `20260901000000` → `20260901010000` → `20260901020000` → `20260901140000` → `20260902123000`)만 dry-run하고 정확한 diff를 확인한다. DROP/reset이나 예상 밖 자료 변형은 중단 조건이다.
5. 같은 저장소 develop→main PR을 열고 verify/develop-only, 안정된 실제 Vercel Preview context, 독립 검토 및 비밀검사를 완료한다. 안정된 main-target Vercel context를 실제 관측한 뒤에만 보호 설정 추가를 검토한다.
6. 승인된 점검 구간에 migration을 적용하고 RLS/ACL/constraint를 읽어 확인한다. 후보SHA의 search-places/plan-route/weather-timeline/save-collection은 JWT true, kakao-oidc만 JWT false로 배포한다. Production 전용 설정과 Kakao/Supabase 연결을 완료하고 버전/설정을 기록한다.
7. PR head가 검증 후보와 동일한지 확인 후 main PR을 merge한다. 생성된 main merge SHA를 별도로 기록하고 GitHub CI/Deployment 및 Vercel Production READY/alias가 정확히 이 SHA인지 대조한다. Web만 이전 계약으로 먼저 배포하지 않는다.
8. 실제 테스트 초대 라이더의 Kakao 로그인·admin/A/B/revoked/nonmember/anon, 타인 자원 거절, 최소 안전 경로·날씨·저장·컬렉션·발행·회수·예산 hard stop·기존 자료 조회와 로그를 검증한다. A/B 실제 신원과 안전한 비용 차단 시험 방식이 준비되지 않으면 Production gate는 NOT_RUN으로 남는다.
9. exact test owner/ID만 정리하고 부재와 초대/공유 감사 상태를 확인한다. 예상 밖 오류와 정리 실패0, 실제 서비스/정본/운영 문서/인계 일치까지 완료한 뒤 Goal 완료를 판정한다.

## 롤백과 중단

- 미리 검토된 reader 번들 `1d1b07a51ae36e62d84bf5a0a9169fbf35b65c21`은 이미 migration된 DB에서 컬렉션 기능을 닫고 과거 불변 공유를 읽는 복구 후보이다. 사용자 승격 범위에 포함할 때 그 원격 ref·번들·DB 호환성을 다시 확인하고 exact target/사용자 영향/복구 검증을 승인안에 명시한다.
- 기존 main `d0134ed`만 단순 재배포하는 것은 새 DB와의 호환성을 보장하지 않는다. DB downgrade/reset은 하지 않는다. 데이터 손상 징후가 있으면 쓰기를 중지하고 보호된 backup/복구 계획으로 전환하며 별도 승인 없이 운영 DB를 덮어쓰지 않는다.
- 잘못된 프로젝트/리전/키 소유권, paid setup 필요, quota 검증 부재, 후보 drift, 필수 검사 실패, 예상 밖 migration/DML, 사용자 자료 접근/노출, 테스트 정리 실패는 해당 단계 중단 조건이다.

## 미확정 항목

최종 후보SHA, 모든 Preview 계정·실패·예산 gate, Production 변수 값 귀속, 실제 무료 quota와 초기 숫자, Production alias/콘솔 설정, 백업·복구 검증 및 점검시간이 아직 확정되지 않았다. 이 항목이 남은 문서를 배포 가능한 최종 승인안으로 표현하지 않는다. Production 구성/배포/승격/실제 사용자 검증은 모두 NOT_RUN이다.
