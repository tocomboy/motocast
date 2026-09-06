# Preview KMA 암호화 복원본 준비

2026-09-06. 구현·로컬 검증 **READY**, 원격 실행은 고정 SHA 검토·필수 CI·실제 무배포 확인 전 **NOT_RUN**이다. 최초 Kakao 가입은 사용자 지시에 따라 나머지 Preview 검증 뒤로 옮긴다. 이 작업은 공급자 실패·예산 차단의 원상복구 준비이며 두 gate 자체를 통과시키지 않는다.

## 확인한 근거와 선택

Exa 공식 조사에서 [KMA 이용안내](https://apihub.kma.go.kr/apiInfo.do)는 기존 인증키를 소유자가 로그인 후 마이페이지에서 확인할 수 있다고 설명한다. 공개 검색은 개인 키를 제공하지 않는다. 일반회원의 안내 한도는 일 20,000건/5GB이며 변동 가능하므로 현재 계정의 실제 quota로 단정하지 않는다. KMA 공급자 안내 숫자와 MOTOCAST의 `KMA_DAILY_LIMIT` 원본은 서로 다른 값이다.

[Supabase 환경변수 문서](https://supabase.com/docs/guides/functions/secrets)는 함수 런타임의 `Deno.env.get`과 프로젝트 비밀 설정을 설명한다. 목록의 다이제스트는 원문 복원이 아니지만, 런타임이 읽은 원문과의 동일성 검증에는 사용할 수 있다. [공식 Vault 문서](https://supabase.com/docs/guides/database/vault)는 별도의 DB 비밀 보관소를 설명하며 Edge 설정과 자동으로 같다고 보장하지 않는다. 이번 Preview 조회에서 Vault의 정확한 두 이름은 없었고 값 조회는 하지 않았다. 공식 기본 로컬 경로 `supabase/functions/.env`도 존재하지 않았다.

따라서 lead는 **기존 값을 변경하지 않는 임시 함수의 암호화 회수**를 준비 방향으로 채택했다. 이는 공개 문서에서 그대로 제공하는 복구 명령이 아니라 문서화된 런타임 접근과 암호화 API를 결합한 설계 판단이다. 독립 architect는 조건부 PROPOSED를 반환했으며 구현 승인은 lead가 아래 범위로 제한한다. 이 판단은 공용 설정 변경이나 날씨 장애 시험의 실행 승인을 뜻하지 않는다.

## 목표 계약과 소유권

- 관련 정본: `SCOPE-002` 검증 범위의 정직한 표시, `OPS-001/002/004` 로그·서버 비밀 경계, `COST-001/002` 예산·실패 예약, `OPS-003` 배포 계보, `OPS-007/008` 환경 분리와 리전 계약.
- lead 소유: 공개 실행 바인딩 `supabase/functions/preview-secret-recovery/pin.ts`, `supabase/config.toml`의 해당 함수 설정, 이 문서, 비공개 로컬 manifest와 배포·회수 절차. `package.json`의 기존 test 명령 뒤 신규 실행기 Node 테스트를 연결하고 `.github/workflows/ci.yml`의 기존 Deno 검사에 임시 함수 진입점만 추가한다. 기존 필수 검사와 배포 차단 방식은 유지한다.
- writer 소유: 같은 디렉터리의 `handler.ts`·`index.ts`, 보안 계약 테스트, `scripts/preview-secret-recovery.mjs`와 해당 로컬 테스트. writer는 로컬 파일·검증만 담당한다.
- `weather-timeline`과 공용 인증·DB·Web 코드는 변경하지 않는다. Preview Seoul만 명시적으로 대상으로 삼으며 Production Tokyo/main/운영 비밀은 변경하지 않는다. 실제 두 계정·권한·자료, KMA 요청·응답 정확 일치, HH00/:45/목표 예보 계약은 그대로 보존한다.

서버는 고정 프로젝트·함수·공개키·build ID·6시간 이하 유효기간·challenge 해시에 결속된다. `verify_jwt=true`에 더해 정확한 legacy service-role Bearer를 검증한다. 일반 회원/익명/타 프로젝트 JWT, Origin 헤더, query string, 잘못된 메서드·본문·challenge, 만료 정각 이후는 거절한다. 요청이 변수 이름·공개키·목적지·만료를 지정할 수 없다.

인증과 환경 결속에는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`만 읽는다. 인증 뒤 내보낼 원문은 `KMA_APIHUB_KEY`, `KMA_DAILY_LIMIT` 두 문자열뿐이다. 환경 전체 열거, DB/provider/fetch, 로그 출력은 금지한다. 원문·다이제스트·인증 헤더·challenge를 응답에 노출하지 않는다. 새 AES-GCM 키와 IV로 암호화하고 고정 RSA-OAEP 공개키로 AES 키를 감싼다. 암호문은 고정 실행 메타데이터와 인증 결합하며 응답은 no-store다. 오류는 고정 코드만 반환한다.

무상태 함수는 모든 isolate에 걸친 1회성을 보장하지 않는다. 같은 challenge의 재호출도 유효기간 안에서 같은 수신자 공개키에만 암호화할 수 있다. 클라이언트는 자동 재시도하지 않으며 응답 유실은 정리 의무를 남긴다. 암호문·개인키·복호화 자료는 저장소 밖 Linux 소유자 전용 디렉터리0700/파일0600에 배타적으로 보관한다. symlink·덮어쓰기·리디렉션은 거절하고 정확한 원문 바이트를 trim/숫자 변환 없이 대조한다.

## 검증·배포·정리 순서

1. 합성 값으로 실제 handler 인증/시간/요청 경계와 암호화 왕복·변조·다른 개인키·오류 무노출·외부 호출0을 검증한다. 로컬 실행기의 파일 권한·symlink·덮어쓰기·설정 drift 거절을 검증하고 저장소 필수 baseline을 수행한다. 신규 함수 Deno 검사는 기존 필수5개와 별도로 추가한다.
2. 공개 바인딩이 들어간 고정 commit SHA와 정확한 changed set을 독립 보안·운영 검토한다. 비배포 `review-*`의 exact-head CI와 실제 무배포를 확인하기 전 원격 함수를 만들지 않는다. 유효기간을 넘기면 pin을 조용히 바꾸지 않고 새 SHA로 다시 검토한다.
3. Preview 프로젝트·리전·기존 함수 버전/JWT·정확한 임시 함수명 부재·두 설정 메타데이터를 확인한다. 배포 전에 저장소 밖 정리 journal을 배타 생성한다. 검토 SHA→소스/번들 hash→실제 함수 ID/버전은 외부 manifest로 연결한다. commit 자신의 SHA를 소스 안에 넣는 순환은 만들지 않는다.
4. 지정 임시 함수 하나만 JWT true로 배포하고 ID/버전/소스를 대조한다. 기준 develop 불변을 다시 확인한 후 같은 SHA로 fast-forward하고 Preview 배포 상태를 검증한다. 기존5개 Edge 함수는 배포하지 않는다.
5. hosted 인증 거절과 암호화 회수를 수행한다. 로컬 복호화된 두 원문 hash가 전후 관리 API 다이제스트와 모두 일치하고 설정 메타데이터·함수 ID/버전이 불변일 때만 회수 성공이다. 실제 비밀값·응답 원문을 도구 출력에 넣지 않는다.
6. 성공·실패·유실 모두 journal의 정확한 함수 ID/배포물 소유권을 재확인하고 해당 함수만 삭제한다. 별도 부재 조회, 기존 함수·설정 불변을 확인한다. 삭제 실패는 FAIL이며 만료를 정리 성공으로 대신하지 않는다.
7. 임시 함수·공개 pin·배포 설정은 Production 승격 전에 제거하고 검토/CI/Preview 문서를 동기화한다. 실제 공용 설정 시험 전에 복원 원본을 재부팅에도 보존되는 승인된 소유자 전용 로컬 보관처에 확보하고 재검증해야 한다. 임시 `/tmp` 파일의 존재만으로 그 후의 원상복구 가능성을 보장하지 않는다.

## 그다음 두 실패 검증의 준비 방향

필요한 공급자 실패 사례(저장본 없음, 오래된 저장본)를 원래 양의 한도 아래서 제한 횟수로 실행하면 실패 시도 예약은 정상 계약대로 남는다. 그 관측 사용량이 양수일 때 같은 provider/operation/서울 날짜에서 임시 한도를 사용량과 같게 두면 예산 함수가 UPDATE 전에 거절하여 장부의 calls/hard_limit/updated_at을 유지할 수 있다. 이는 SQL상 가능한 후보이며 아직 실행 증거가 아니다.

실행 전에 원래 한도의 충분한 여유, 같은 KMA operation·날짜, 신선한 캐시 우회 조건, 시험 소유 snapshot만 stale 표시되는 조건, 설정 전파·이전 isolate·동시 호출·실사용 영향과 즉시 복구를 확정해야 한다. 설정0/누락은 소진과 별개로 기록한다. 실제 일일 quota를 채우거나 장부를 조작해 조건을 만들지 않는다. 공용 날씨 설정의 장애 구간은 구체적인 검토 가능한 실행안과 필요한 운영 변경 승인 전 NOT_RUN이다.

## 현재 증거 범위

공개 조사·Vault 이름 조회·기본 로컬 환경 경로 확인·독립 설계는 완료했다. 새로운 실제 비밀 회수, 함수 배포, 공급자 호출, 예산 상태 변경은 NOT_RUN이다. 기존 정상 KMA 연결1 PASS, 임시 Auth149 PASS 및 공유 차단11 PASS와 정리 증거는 재사용하며 이 준비로 확대하지 않는다.

## 고정 후보 전 로컬 검증

2026-09-06 최종 소스 동결 후 필수 baseline: `npm ci`(동일 lockfile, 407 packages), lint, typecheck, Deno 2.9.6 기존5개+임시1개, `npm test`, Chromium 설치, `npm run test:e2e`, build, diff check 모두 PASS. Vitest 60파일/550 PASS, Node 7 PASS, Chromium 20 PASS/기존 연결 전용 2 SKIP. 최종 실행의 FAIL/ERROR/DESELECTED/XFAIL/SETUP_OR_IMPORT_FAILURE=0이며 소스 전후 동일성을 확인했다. 실제 연결 회수·원격 배포·공급자 호출은 NOT_RUN이다. Deno 2.9.6은 저장소 밖 임시 개발 도구 경로에 설치했으며 제품 의존성이나 lockfile을 변경하지 않았다.

초기 개발 검증의 Vitest 1 FAIL(헤더 공백의 Request 정규화), Node 실행 설정 오류, Deno 네트워크 설치 오류는 최종 PASS와 별개 이력으로 남긴다. 실제 헤더에 보존되는 틀린 바이트를 검증하여 거절 계약을 유지했고, CLI 진입점과 정확한 저장소 경계 검사를 바로잡았다. lead 대조에서 발견한 관리 API의 `value` 해시 필드, 내부 HTTP ingress, 불완전 파일 정리 오류 보고, 고유 함수 이름 결속도 수정 후 위 최종 baseline으로 재검증했다. assertion 완화나 신규 skip/xfail은 없다.

다음 상태는 **고정 SHA 독립 검토 대기**다. 이 문서와 임시 도구의 리뷰/CI PASS는 두 개의 남은 실제 장애 gate나 Production 승인을 대신하지 않는다.
