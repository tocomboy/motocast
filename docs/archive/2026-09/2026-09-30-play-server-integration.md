# PR79 운영 서버 의존성 통합 — 2026-09-30

## 범위와 상태

사용자는 운영 DB/함수/웹 승격과 Android Play 내부 테스트 자동 배포를 승인했다. 실제 기기 검증은 사용자가 수행하며, 공개 트랙의 가입 범위·시점과 Play 자격은 별도 gate다. 현재 작업은 AUTH-007, ROUTE-008, 비용·저장 상한과 기존 회원/역할/코스/공유 보존을 유지하면서 PR80의 환경 guard와 PR74의 주행 서버를 하나의 검증 가능한 후보로 통합한다. 웹 버전은 0.5.1을 유지한다.

- 기반 develop: `251638492b4fe61f4de65131f4f8aa1d5ee9f143`.
- PR80 환경 분리: `40b3197c0e0a1bac3c0184b2c9de5d36f2165047`, CI `36694327170` SUCCESS.
- PR74 주행 서버: `ef0234471796cab2838fa2a5116ad8180feca912`.
- 독립 worktree의 slash-free `review-play-production-integration`에서 통합했다. 원래 Windows 작업 트리와 클라우드 인계 원본은 덮어쓰지 않았다.
- 두 충돌은 운영 문서를 양쪽 내용 보존으로 합치고 실제 DB ACL 검사에 baseline 7 + Play 3 + weather 4 RPC, weather 테이블 4개를 포함해 해결했다. CI의 Deno 진입점도 8개로 맞췄다.
- Preview에 이미 적용됐지만 Git에 없던 초대 관리 migration을 원본과 배포 statements 전체 비교 후 포함했다. [별도 근거](2026-09-30-invite-dependency.md).

## 현재 서비스 readback

Production은 여전히 main `259f4866a0cb96c33e84423a048d385aacda65f0` / 웹 0.4.2 / Vercel `dpl_9GuPPNhKsVNeq6xnitwfmKDWS1nJ` READY다. Supabase `obodvbyzptxeehgpcpkd`는 migration 14개와 Edge 5개이며 Play/주행 서버는 아직 없다. Preview `lehjmbgfpoemqcwxowbx`는 migration 20개와 Edge 8개다. journey-route/weather는 둘 다 v13, play-admission은 v3/JWT true다.

Preview journey 함수 각각의 배포 파일 24개를 PR74와 비교했다. 세 파일의 CRLF/LF 차이를 제외하면 모두 같으며, LF 정규화 후 전체 24개가 정확히 일치한다. 원본 바이트 전체 동일이라고 주장하지 않는다. cache/retention/capacity/Play/초대 SQL도 배포 statements와 정규화 비교했다. 적용 timestamp가 로컬 파일명과 다르므로 기존 Preview migration을 다시 실행하거나 registry를 임의 수정하지 않는다.

Preview는 call 2,000/day, byte 500,000,000/day, response 1MiB, cache/attempt 각각 10,000개, payload 64MiB, relation 128MiB, DB 250,000,000bytes 상한과 매 5분 retention active를 readback했다. 기존 승인된 90% Production/10% Preview 배분을 유지하며 Production 활성화 전 실제 제공자 quota와 당일 소비·예약 내역을 대조한다. 사용량을 초기화하거나 paid quota를 확대하지 않는다.

관리 화면에서 각 프로젝트의 `PLAY_ADMISSION_ENVIRONMENT`를 각각 preview/production으로 등록하고 표시 digest를 예상값과 대조했다. 기존 secret 값을 열거나 복사하지 않았다. Production의 다른 Play 설정과 journey 활성화는 아직 완료되지 않았다.

## 통합 후보 자동·로컬 검증

| 검사 | 결과 |
| --- | --- |
| npm ci / lint / typecheck / build | PASS |
| 단위 | 82 files / 788 PASS |
| Deno 함수 진입점 | 8 PASS |
| Chromium | 49 PASS / 기존 connected 2 SKIP |
| 새 고유 DB migration 재현 | 19 PASS |
| DB Auth/RLS·코스/공유·통합 ACL | 35 + 125 + 183 PASS |
| 실제 DB Play 가입·role·회수·동시성·예산 | 9 PASS / FAIL 0 / SKIP 0 |
| 실제 DB weather cache / retention / capacity | 12 + 12 + 11 PASS |
| 기존 ready/fetching/attempt 위 capacity upgrade | 1 PASS |
| 로컬 HTTP + 실제 DB weather runtime | concurrent / timeout 2 PASS |
| 실제 격리 pg_cron | 6 PASS / FAIL 0 / ERROR 0 / SKIP 0 |
| 초대 SQL / race / 추가 role denial | 18 + 2 + 4 PASS |
| 초대 DB 대상 guard | 2 PASS |
| 새 exact-head 원격 CI·zero-deployment | PENDING — PR 게시 후 별도 기록 |
| 새 후보 connected Preview·Production 제품·Play 가입·기기 | NOT_RUN |

Runtime은 10개 동시 요청/130개 표본에 provider 모사 HTTP 1회/예산 1회, timeout 후 durable 소비 1회 및 즉시 재시도 pending을 실제 DB와 함께 확인했다. 실제 KMA/Play 응답이 아니다. 앞선 두 실행은 Deno 결과 파일 write/read 권한 누락으로 SETUP_OR_IMPORT_FAILURE였고, 그 DB 효과와 실패 로그를 보존했다. 권한을 정확한 결과 파일로 제한해 새 합성 grid에서 최종 두 경로를 통과했다. timeout/보호 assertion은 완화하지 않았다.

기존 npm audit의 high 항목은 ESLint 도구의 transitive brace-expansion 경로이며 이번 runtime 변경으로 도입되지 않았다. 서버 runtime dependency와 분리해 추적한다. 이 기록은 취약점 해결 완료를 뜻하지 않는다.

메인은 환경 guard가 외부 인증/DB/Google 호출보다 앞서는지, JWT/회원/회수/role 경계, 주행 정본의 provider 이후 재확인, 예산 선확보와 uncertain no-resend, bounded retention의 사용자 데이터 비대상, ACL 합집합 및 additive migration 호환성을 직접 대조했다. 보조 검수는 독립 승인이나 실제 서비스 gate를 대신하지 않는다.

## 자원·근거 보존

로컬 컨테이너는 project label motocast / Postgres 17.6.1.166의 기존 `supabase_db_motocast`다. weather DB `motocast_weather_ae8c01a8d1`, upgrade DB `motocast_weather_f9f22aa520`, Play DB `motocast_play_20260930_integrated`(18,713,747bytes, 종료 다른 세션 0), 별도 invite DB와 네트워크 없는 cron 컨테이너를 보존했다. 다른 DB를 reset/drop하지 않았다. 시작 전 여유 약99GB와 각 자원 예산을 확인했다. 종료48시간은 처분 검토 시점이며 삭제 승인이 아니다.

실행 로그는 저장소 밖 `CreatorTemp/motocast-server-*.log`, `motocast-play-integrated-db.log`, `motocast-retention-cron-integrated.log`에 있다. `.supabase`와 `verification-logs`에는 로컬 자원·합성 결과만 있으며 일반 PR artifact로 게시하지 않는다.

## 배포 순서와 차단 조건

1. 검수된 fixed SHA를 slash-free review 브랜치/CI-only PR로 게시한다. exact-head CI SUCCESS와 GitHub Deployments/Vercel checks/statuses 0을 확인할 때까지 hosted 코드를 배포하지 않는다.
2. Preview 환경 label 확인은 완료됐다. 정확한 후보 함수/설정 readback, 기존 데이터 보존 확인, 연결 로그인·권한·실제 서비스 gate를 완료하고 기반 develop 불변을 확인해 동일 SHA로 fast-forward한다.
3. Production 관리 인증과 off-platform 백업/복구 확인을 준비하고, 환경 전용 Play decoder·Kakao 설정·앱 서명 인증서·App Links·주행 예산/정리·함수/DB를 호환되게 준비한다. Preview 비밀값/세션을 복사하지 않는다.
4. 필수 Preview gate 후 PR79 develop→main을 승격하고 실제 main Production을 검증한다. 웹 v0.5.1 tag/Release는 그 이후다.
5. Android exact main CI→운영 준비 증명 readback→원본 Production AAB→내부 Play 업로드/readback을 진행한다. 준비 증명은 20개 migration 이름/source hash와 8개 함수/JWT/API 계약, 실제 배포 식별자에 결속한다. Android release 0.3.0/code5는 Console 이력상 아직 보이지 않지만 upload 직전 모든 track/bundle/API readback이 필수다.
6. 사용자의 실제 Play 설치·환경 세션 분리·신규/기존/관리자/회수 회원·App Links·공유/회수·주행 결과를 version/code와 PASS/FAIL/NOT_RUN으로 기록한다. 공개 트랙은 동일 기존 artifact만 승격하며 재빌드하지 않는다. 현재 Play Console은 closed tester 12명/14일 및 production access를 요구하며 참여자는 0명이다.
