# Preview 접근 경계와 정확한 예보 만료 표시 — 실행 기록

2026-09-05 12:38 UTC. **국소 표시 수정의 Preview 배포는 완료했으며 전체 Preview/Production Goal은 미완료다.** 현재 [gate 표](2026-09-05-preview-gates-plan.md)의 부족분과 [Production 준비안](2026-09-05-production-promotion-packet.md)을 함께 적용한다.

## 고정 제품과 배포

- 제품 SHA `4f324854874181b9e139c5d163d7368bf3861fa5`, 기준 `0b23aeabe48e25f1f52b8e00109d49f0c18761d2`. 계획·공유 renderer의 두 `<`를 `<=`로 맞추고 경계 테스트와 준비 문서만 추가했다. 공유 허용, DB/Edge, KMA HH00/:45/정확한 요청응답 발표/목표 예보, 인증·예산·리전은 불변이다.
- 독립 read-only 정확성·명세·운영 검토 APPROVE **BLOCKER0/HIGH0/MEDIUM0/LOW0**. 리뷰어는 exact diff, 문서와528 PASS JSON을 확인했으며 전체 실행을 독립 반복하지 않았다.
- slash-free `review-weather-expiry-4f32485`, [PR #23](https://github.com/tocomboy/motocast/pull/23), exact-head [CI33966249264](https://github.com/tocomboy/motocast/actions/runs/33966249264) success. 초기/정착 후 GitHub Deployments0/Vercel checks0/status contexts0. 실제 Vercel 프로젝트 전체28개 배포 목록에도 후보0, 이전 페이지 없음.
- fetch 후 origin/develop=`0b23aea` 불변과 조상관계 확인, merge/squash/rebase/force 없이 exact4f32485로 fast-forward. GitHub가 PR23을 자동 MERGED로 인식했다. 별도 PR merge 명령은 사용하지 않았다.
- develop [CI33966431080](https://github.com/tocomboy/motocast/actions/runs/33966431080) exact SHA success. Preview Deployment6281022189/status17867409520 success. Vercel `dpl_7KPdHQbCddRPsKWbK9hA1TKhFTWj` READY, `motocast-kr4mmhiha-tocomboys-projects.vercel.app`와 실제 develop 고정 alias가 exact4f32485다.
- HTTP200 및 nosniff/referrer-policy/permissions-policy/HSTS 확인. CSP 헤더는 없음, 이번 수정에서 추가하지 않았다. 함수의 version/ID/updated_at/JWT 불변: weather12, plan11, search/save/OIDC8. JWT false는 OIDC뿐이다.

## 검증 분류

| 구분 | PASS | FAIL | ERROR | SKIP | DESELECTED | XFAIL | SETUP_OR_IMPORT_FAILURE | NOT_RUN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 최초 formatter 회귀 재현 | 6 | 1 | 0 | 0 | 0 | 0 | 0 | — |
| 수정 후 focused formatter | 7 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| 전체 Vitest59파일 | 528 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| keyless local Chromium | 20 | 0 | 0 | 2 | 0 | 0 | 0 | 실제 Preview 두 테스트는 기존 조건부 SKIP |
| 실제 Preview 접근 경계 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 전체 로그인/A-B/타인자원은 범위 밖 |
| Preview ACL 읽기 전용 부분집합 | 103 | 0 | 0 | 0 | 0 | 0 | 0 | future-object probe 및 실제6역할 행동은 범위 밖 |
| 배포된 UI + 합성 share 응답 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 현재 파일의 다른 두 테스트는 grep 제외 |
| local DB 재실행·실제 실패/예산/역할 gate·Production | — | — | — | — | — | — | — | 미실행; gate 표의 구체적 부족분 참조 |

설치npm ci407, lint/typecheck, Deno5, 별도 build13 routes, diff/6파일 비밀 패턴/문서 상대링크 PASS. 원본·환경파일 없는 검증 복사본의 비Markdown/사용자gitignore 제외191파일 바이트 동일. 두 CI의 실패 증거 업로드 단계 SKIP은 성공 실행에서 조건이 false였기 때문이며, 제품 테스트 SKIP과 구별한다.

배포된 UI 검사는 12:37:26.817 UTC 시작, 4.872초, retry/flaky0, screenshot/trace/video OFF였다. 실제 Preview JS의 shared renderer를 사용했지만 resolver 응답과 시계는 시험에서 주입했다. 따라서 실제 공급자 실패, 실제 stale 저장, DB 공유 차단을 입증하지 않는다. 해당 시험의 영속 mutation0 및 컨텍스트 정리 완료이며 실제 KMA 정상 흐름은 반복 호출하지 않았다.

접근 검사11개와103 ACL의 상세 범위·시간제한 로그·도구 초기 오류는 gate 표에 있다. 이번 전체 도구 단계의 오류는 최초 fetch 파일권한1, python 명령 부재2, Docker socket 권한1, API403 두 번, Vercel link파일 부재1이며 해당 조회의 안전한 수정/재실행으로 해소했다. 이들7건을 제품 테스트 FAIL에 합산하지 않지만 감추지 않는다. 테스트 최초 RED1과 운영 조회 오류7은 최종 성공 수치와 별도로 유지한다.

## 남은 범위와 Production 계보

Preview active admin1/rider1을 건수만 조회했으며 기존 rider의 테스트 소유권과 사용 가능 세션은 확인하지 못했다. 사용자에게 A/B 테스트 Kakao 신원 준비/직접 로그인과 현재 Preview 이용 범위를 요청했다. 기존 사용자 권한·계정을 바꾸지 않았다.

공급자 실패와 예산 실패를 시험계정별로 주입하는 active 함수 경계가 없고 예산은 공용이다. 공용 quota 소진, 비밀/한도 교체 또는 기존 사용자 자원 조작 없이 실행할 수 있는 active-provider 실패 증거는 아직 없다. 합성·hosted-control을 연결 gate 완료로 확대하지 않는다.

Production public alias의 실제 Web은 main SHA와 다르다. `motocast-three.vercel.app` → `dpl_7c5UdGv4VWcs4k1YwHNERhQZVuH8` → 과거 develop `201e1ec12c967da57fb671fad294cf1d05b9d56c`, target production/READY. 원격 main은 `d0134ed93d7e0d8aed1123c5d693c665bbe646e8` 그대로다. 이 확인된 OPS-003 충돌을 정본/운영/승격안에 기록했으며 Production 전환은 나중의 구체적 승인 인터뷰에서 다룬다. 지금 main/Production/운영 비밀/리전은 변경하지 않았다.

문서 전용 후속은 이 실제 상태를 동기화한다. 비Markdown tree 동일성을 확인해 제품 검증을 재사용하고 독립 고정 SHA 문서 검토·exact-head CI·무배포·같은 SHA fast-forward와 Web readback을 별도로 수행한다. 공급자 재호출·Edge 재배포는 필요하지 않다. `.gitignore`와 기존 미추적 인계/조사 파일은 계속 보존한다.
