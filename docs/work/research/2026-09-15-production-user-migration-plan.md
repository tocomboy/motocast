# Production 배포와 기존 두 사용자 데이터 이전

상태: **준비 진행 중 / Production 변경·데이터 이전 NOT_RUN**.

## 사용자 결정과 범위

2026-09-15 사용자가 Production 배포를 승인하고 신규 사용자 가입과 기존 사용자 접속이 가능하다고 확인했다. 관리자 포함 기존 두 사용자의 데이터를 그대로 이전하도록 요청했다. 가입·재접속은 사용자 확인 근거이며 이번 에이전트가 새로 실행한 브라우저 시험으로 집계하지 않는다.

이번 요청은 `OPS-007`의 환경 간 사용자 데이터 복사 금지에 대한 **이 두 사용자 및 소유 데이터의 일회성 Preview → Production 이전 예외**다. 상시 동기화, Production → Preview 복사, 원본 삭제, 다른 사용자 데이터, 인증 세션·공급자 키·예산 장부의 무조건 복사를 허용하지 않는다. 기존 지역(Preview 서울, Production 도쿄), 초대제, 소유권 보호, 무료 운영과 develop → main PR 경로는 유지한다. 새 배포는 과거 develop에서 생성된 Production 별칭의 계보를 검증된 main 배포로 교정한다.

## 계획과 진행

1. **진행 중:** 현재 두 환경, 이전 대상, 인증 공급자 연결, 설정 소유권과 무료 한도 확인.
2. **로컬 검증 완료:** 최신 develop의 임시 복구 기능 제거9파일. 단위528 PASS, 브라우저20 PASS/연결 전용2 SKIP, lint/typecheck/Deno5/build PASS. 기존 사용자 작업 트리는 보존. 고정 커밋·외부CI·최종Preview는 대기.
3. **대기:** 계정 연결 방식 확정, 백업 없이 메모리 내 데이터 이전·원자 반영·소유권 검증. 이 단계 전에는 Production DML/DDL을 시작하지 않는다.
4. **대기:** 최종 후보 검수·CI·Preview 확인, 검증된 migration/함수/설정 적용 후 같은 저장소 develop → main PR로 Production 배포.
5. **대기:** main 배포 SHA·별칭, Vercel 무로그인 접근, 두 계정 및 역할·데이터, 신규 초대, 경로·날씨·공유·차단 경계의 실제 검증과 최종 기록.

## 현재 확인한 근거

- 원격 develop `abcb1e92aae7cfd5c07f74e856cfb166472b94f6`, main `d0134ed93d7e0d8aed1123c5d693c665bbe646e8`.
- 실제 Preview 별칭은 `dpl_BUS4KfBbMi2BHDUAcKTir8rwwTrb`, develop/abcb1e9, READY.
- 실제 Production 별칭은 `dpl_7c5UdGv4VWcs4k1YwHNERhQZVuH8`, develop/201e1ec, READY. 기존 main과 다름.
- Vercel Production branch main, Node20.x, Vercel Authentication preview only를 실조회했다. 기존 CLI59.11.7의 공식 whoami 인증 갱신 후 조회 가능했다.
- Preview `lehjmbgfpoemqcwxowbx`: ACTIVE_HEALTHY와 DB 연결 PASS. Auth users2/identities2/profiles2/memberships2, 활성 admin1/rider1. trips7/collections1/collection_versions3/share_links14. 목록 도구의 추정 rows0은 실제 COUNT를 대신하지 않는다.
- Production `obodvbyzptxeehgpcpkd`: 위 계정·제품 항목의 실제 COUNT0. 다른 테이블·설정까지 비어 있다고 확대하지 않는다.
- Preview migrations11개, Production3개. Production에는 이후8개 migration이 필요하다.
- Production Auth site_url은 localhost, Kakao provider 비활성·client ID 없음. 공급자 REST/KMA 키·origin·예산 설정도 없다. 기존 OIDC state와 login secret 이름은 존재하므로 덮어쓰기하지 않는다.
- Preview는 Kakao provider 활성·email optional이며 정확 Preview callback으로 구성되어 있다.
- 격리 후보는 최신 develop에서 생성했다. 기존 fefb67d의 임시 복구 제거9파일만 writer가 적용·검증한다. 기존 root dirty 파일과 과거 WSL worktree, 고정 복구 자료는 보존한다.

## 계정·데이터 이전 설계 조건

- Kakao 회원번호는 앱별로 다르다. Production에서 사용할 앱이 확정되고 기존 두 신원과 연결되는 증거를 확보해야 한다. 닉네임·이메일 추정 매칭으로 관리자 또는 라이더 권한을 이전하지 않는다.
- 같은 공급자 신원을 사용하는 경우에도 auth.users UUID와 auth.identities의 일관성, 가입 트리거, 회원 역할, 외래키를 실제 복구 리허설에서 확인한다. 별도 앱이면 각 계정의 실제 인증으로 안전한 신원 매핑을 먼저 확정한다.
- **사용자 최신 결정: 백업하지 않음.** 제안된 로컬 원문 백업은 자동 승인 심사가 범위·저장 위치의 명시적 승인 부족으로 거절해 실행되지 않았다. 사용자는 이후 "이전 실패해도 상관없어 백업하지마"라고 지시했다. 원문 백업 파일·전체 export·복구용 사본을 로컬이나 별도 원격 위치에 만들지 않는다. 필요한 전송은 메모리에서 처리하고 원본 Preview를 삭제하지 않는다. source/target/project/SHA·시각·해시·행 수 등 비밀 없는 검증 메타데이터만 기록한다. 인증값·개인 위치·일정·원본 JSON을 로그·Notion·Git에 출력하지 않는다.
- 이전 범위는 두 사용자와 그 소유 프로필·회원권한·여행/경유/도로/날씨·컬렉션/버전·공유 및 필요한 감사/재시도 연결이다. 관계를 닫힌 집합으로 산출하고 대상의 사전 충돌0을 확인한다. 새로운 행이 생기거나 원본이 바뀌면 이전 manifest를 무효화하고 변경분을 재검토한다.
- 활성 세션·refresh token·진행 중 OIDC handoff·단기 preview grant는 환경 간 이전하지 않는다. 두 사용자는 Production에서 같은 카카오 계정으로 새 로그인한다.
- 공유 snapshot은 내용·발행시각·회수 상태를 보존한다. 이전만으로 회수된 링크를 되살리거나 만료된 날씨를 새 정보로 바꾸지 않는다. 기존 링크의 Preview 도메인과 Production 도메인은 별개이며 원문 bearer token을 저장하지 않는 구조를 존중한다.
- 원본은 최종 검증까지 그대로 보존한다. 최종 snapshot 이후의 쓰기 유실을 막을 cutover 절차를 확정하고, 대상 DML은 원자 처리·정확 행 수·소유권·내용 digest·외래키 검증을 포함한다.
- Production의 사전 상태·충돌 부재, migration dry-run과 실패 시 원자 rollback, 무료 quota와 초기 예산, 공급자 환경 소유권, 배포 전후 호환 복구 경로를 확인한 뒤 외부 변경을 시작한다. 사용자의 백업 생략 위험 수용은 테스트·신원 검증·원본 보존·데이터 일관성 검증 생략이나 파괴적 명령 허용으로 확대하지 않는다. reset/DROP/무조건 DELETE/DB downgrade는 하지 않는다.

## 현재 남은 외부 조건

카카오 개발자 콘솔 로그인 완료. MOTOCAST Preview와 장기 미사용 바이크 플래너 앱을 확인했다. 별도 운영 앱 사용과 기존 Preview 앱 공동 사용의 신원·키·무료 한도 차이에 대한 사용자 결정을 기다린다. 이후 redirect/domain/OIDC/무료 quota를 확인한다. 앱 공유나 기존 앱의 용도 변경이 필요하면 기존 환경 격리와 사용자 로그인에 미치는 차이만 별도 결정한다. 배포 승인 자체를 다시 묻지 않는다.

## 근거

- [기존 Production 준비안](2026-09-05-production-promotion-packet.md)
- 기존 복구 제거 후보: 로컬 fefb67d05afd729bbf01c70da50572cb1d5d3f5f. 기존 검증은 역사적 근거이며 이번 후보의 필수 로컬 검사는 다시 실행했다.
- [Supabase Auth 사용자 이전](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Kakao 앱별 사용자 식별자](https://developers.kakao.com/docs/ko/kakaologin/group-app)

이 문서는 준비 및 결정 기록이며 배포·데이터 이전 성공 증거가 아니다.
