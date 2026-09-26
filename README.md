# MOTOCAST

지인 라이더를 위한 국내 24시간 미만 오토바이 경로·시간대별 날씨 계획 PWA입니다. 사용자가 순서대로 정한 경유지를 지나는 오토바이 안전 추천 경로 1개의 실제 도로 형상, 예상 복귀 시각, 구간별 통과 시각과 기상청 예보를 보여줍니다.

> KMA 정시 요청 교정을 `8bd8878`로 Preview에 반영했고, 앞서 막혔던 실제 날씨·컬렉션 저장/복원·공유 발행/회수/재발행 검증이 통과했습니다(연결 1 PASS, 실패·오류·skip·재시도 0). 정확한 테스트 소유 데이터 정리도 완료했습니다. Production 승격은 별도 승인·검증 대상입니다.

교정은 초단기 요청에 기존 :45 선택 기준과 정시를 사용하고, 요청·응답 발표시각의 정확 일치는 계속 검증합니다. 초단기는 도착 목표 시각의 예보가 없으면 다른 시각을 대신 쓰지 않고 기존 오류·오래된 저장본 표시 경로로 처리합니다. 단기의 3시간 간격 자료 선택은 유지합니다. 두 임시 실측 함수는 사용 후 삭제했으며, 비밀·원문·실제 사용자 위치를 기록하지 않았습니다. [실측과 구현 계약](docs/work/research/2026-09-05-kma-hour-correction-plan.md), [배포·연결 검증 기록](docs/work/research/2026-09-05-kma-hour-correction-release.md)을 참조하세요.

최신 실제 연결 검사는 `PASS 1 / FAIL 0 / ERROR 0 / SKIP 0 / DESELECTED 0 / XFAIL 0 / SETUP_OR_IMPORT_FAILURE 0`입니다. 컬렉션·공유 발행·회수·재발행과 정확한 테스트 소유 데이터 정리가 완료됐고 예상 밖 운영 오류는 없었습니다. Production·DB·비밀값·유료 API·자동 결제는 변경하지 않았습니다.

## 고정된 제품 원칙

배포된 B1 진단은 이미 거절된 응답의 관계를 제한된 범주로만 기록합니다. `COMPLETE`는 받은 배열 전체 검사이며 원격 모든 페이지 증명이 아닙니다. 일정 분류는 기존 공식 :30 기준이므로 실측 정시는 INVALID/INTERSTITIAL로 표시될 수 있지만, B1은 정상 수용 판정에 사용하지 않습니다.

- 한국 내 출발 후 24시간 미만 라이딩만 지원하며, 추천 경로가 자정을 넘어 복귀해도 표시합니다. 숙박 일정은 지원하지 않습니다.
- 사용자는 출발 시각만 입력하고, 복귀는 실제 추천 경로 주행시간과 정차를 합산한 예상 시각으로 확인합니다. 이미 지난 출발 시각은 외부 API나 비용 한도를 사용하기 전에 서버의 신뢰 시각으로 거부합니다.
- 경로 요청은 이륜차(`car_type=7`)와 자동차전용도로 회피(`avoid=motorway`)를 항상 함께 사용합니다. 안전 조건을 완화하거나 자동차 경로로 대체하지 않습니다.
- `경유지`는 Kakao가 자동으로 찾는 와인딩 속성이 아니라 사용자가 정한 필수 통과점입니다. Kakao 대안 경로를 탐색하지 않으며 안전 추천 경로를 만들 수 없으면 명시적으로 실패합니다.
- 출발지와 복귀지 사이에는 하나의 방문 순서 목록을 사용합니다. 항목을 추가할 때 일반 경유지·점심·저녁·휴식을 선택하고, 종류를 바꾸거나 모든 종류를 서로 가로질러 위아래로 이동할 수 있습니다. 점심과 저녁은 각각 선택이며 기본 60분, 휴식은 0~5개이고 기본 30분입니다. 식사와 휴식의 정차 시간은 각각 조정할 수 있고 같은 장소를 여러 번 넣어도 서로 다른 방문으로 유지합니다.
- 날씨는 경로 순위를 바꾸지 않고 구간별 참고 정보로 표시합니다.
- 컬렉션은 출발지·도착지와 순서가 있는 모든 정차를 포함한 완전한 코스를 불변 버전으로 저장합니다. 응답을 잃은 동일 저장 요청은 같은 결과를 돌려주며 중복 버전을 만들지 않습니다. 경유지만 저장한 기존 Preview 컬렉션은 완전한 코스로 표시하지 않습니다.
- 공유는 사용자가 명시적으로 만든 불변 스냅샷만 허용하며, 기본값은 비공개입니다. 컬렉션의 `공유 준비`는 완전한 코스를 적용한 뒤 새 안전 경로와 아직 유효한 최신 날씨가 저장되어야 간결한 여행 루트·날씨 미리보기를 한 번 열며 자동 게시하지 않습니다.
- 유료 API 사용은 켜지 않습니다. 내부 일일 한도를 소진하면 새 외부 계산을 거부하고 저장된 계획만 읽습니다.

## 버전과 업데이트 소식

0.2.3은 카카오 전체 소요시간을 유지하면서 구간 도착 시각을 비례 배분하는 수정입니다. 도착 시각은 추정값으로 안내하며, 정차·날씨 조회·저장에도 같은 시간을 사용합니다. 거리·경유지·도로 연결성과 이륜차 안전 조건 검증은 유지합니다. [수정 범위와 실제 배포·검증 상태](docs/work/research/2026-09-16-route-duration-diagnostic.md)를 참조하세요.

화면 아래의 현재 버전 링크와 `/updates`에서 사용자가 체감할 주요 변화만 확인할 수 있습니다. 새 버전은 로그인한 사용자마다 첫 접속에 한 번 안내하며, 팝업을 닫은 뒤에도 업데이트 페이지에서 다시 읽을 수 있습니다. 같은 계정의 다른 기기·브라우저도 확인 기록을 공유합니다.

공유받은 링크는 라이딩 요약으로 열립니다. 0.3.0 이후 발행한 링크는 로그인한 활성 회원이 `내 경로로 저장`을 눌러 자신의 컬렉션으로 복사하거나 `새 일정으로 출발`로 바로 계획할 수 있습니다. 장소·경유 순서·휴식 시간은 유지하고 날짜·출발 시각·당시 경로 결과와 날씨는 저장하지 않습니다. 저장 경로를 적용하면 새 출발 일정을 선택합니다. 이번 기능의 검증·배포 및 사용자가 요청한 이전 기록 정리 상태는 [실행 기록](docs/work/research/2026-09-16-shared-course-copy.md)을 확인하세요.

0.3.0의 화면 개편은 홈·경로 편집·라이딩 요약·저장한 경로 모음을 구분하고, 모바일의 전체 화면 장소 검색과 PC의 지도·편집 병렬 배치를 제공합니다. 사용자별 즐겨찾기는 최대 3개이며 출발지·경유지·도착지에서 같은 목록을 사용합니다. 날짜·시·분 선택과 경유지 순서·휴식 설정도 새 흐름에 맞춥니다. 구현 범위와 진행 중 검증은 [Figma 앱 반영 기록](docs/work/research/2026-09-17-figma-app-redesign.md)을 참조하세요.

버전 번호와 공개 기록은 [버전·업데이트 규약](docs/rules/versioning-and-release-notes.md)을 따릅니다. 버전·기록·페이지·팝업 및 사용자별 확인 상태를 함께 검증한 뒤 기존 `develop -> main` 절차로 배포합니다.

## 0.4.1: 카카오맵 실행 안내 개선

0.4.0에서 소유자 라이딩 요약의 중복 수정 버튼을 `경로 실행`으로 바꾸고, 뒤로가기는 경로·시간 편집으로 유지하는 동작을 구현했습니다. 실제 배포 상태와 검증 결과는 상세 계획 및 릴리스 기록을 참조하세요. PC는 카카오맵 웹을, 모바일은 카카오맵 앱을 열며 미설치·실행 불가 시 설치 후 복귀·재실행을 안내합니다. 모바일 웹 길찾기 대체는 사용하지 않습니다. 경유지 5개 초과와 소유자 입력 수정 후 미계산 결과는 실행을 막습니다.

공유받은 요약에서도 `경로 실행`을 주요 버튼으로 제공하며 저장·새 일정 생성 없이 장소와 방문 순서를 전달합니다. 공유 당시 시간·날씨는 현재 주행 기준이 아님을 안내합니다. `새 일정으로 출발`은 내 날짜·시간으로 경로·날씨를 다시 계산하고, `내 경로로 저장`은 나중을 위해 컬렉션에 저장하는 보조 동작입니다. 상단은 `홈으로`로 구분합니다. 공유 경유지가 5개를 넘으면 실행을 막고 새 일정에서 사용자가 직접 줄여 재계산하도록 안내합니다. 소유자 요약의 수정 후 재계산 조건은 그대로 유지합니다.

**0.4.1**은 Figma 댓글을 반영해 안전 안내를 두 항목으로 줄이고 별도 설치 화면을 제거했습니다. Android Intent와 iPhone의 제한적 자동 이동으로 공식 스토어 연결을 시도하고, 실행 후 복구 링크를 제공합니다. 기존 휴대폰 앱 실행은 사용자 확인 PASS이며 새 미설치/스토어 이동은 NOT_RUN입니다. [배포·검증 결과](https://github.com/tocomboy/motocast/releases/tag/v0.4.1), [카카오맵 실행 계획](docs/work/research/2026-09-18-kakaomap-handoff-plan.md), [Issue #59](https://github.com/tocomboy/motocast/issues/59)를 참조하세요.

2026-09-18 사용자 결정에 따라 남은 카카오맵 실기기 검증은 버그 발생 시 대응하며, 다음 순서는 **공유 발행 상태 문구 #66 수정·검증 → Android API 기반 #30 준비**입니다. [현재 수정·검증 기록](docs/work/research/2026-09-18-share-publication-status.md)과 [Android 요구사항](docs/work/research/2026-09-08-android-ride-requirements.md)을 참조하세요. 로컬 수정과 실제 배포 상태는 구분합니다.

## 구성

- Next.js 16 + TypeScript + React 19
- 반응형 웹/PWA
- Supabase Auth, Postgres/PostGIS, Row Level Security, Edge Functions
- Kakao Mobility 길찾기 API와 Kakao Maps JavaScript API
- 기상청 API허브 단기·초단기예보
- Vitest, ESLint, TypeScript, GitHub Actions

## 로컬 실행

Node.js 20.x가 필요합니다. 로컬, GitHub CI, Vercel 런타임을 같은 major로 고정합니다.

```bash
npm ci
npm run dev
```

실제 연결이 필요하면 `.env.local`을 직접 만들고 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`만 넣습니다. 파일이나 값을 Git에 추가하지 않습니다. 외부 서비스 없이 화면만 확인하려면 환경변수를 비워 둔 채 실행하면 합성 위치와 합성 예보를 사용하는 데모 모드로 열립니다. 연결 환경에서도 실제 경로 계산 전에는 결과 영역에 `예시 데이터`가 표시되지만 지도 위에 지점 간 직선을 그리지 않습니다. 추천 경로가 안전하게 계산된 뒤에만 Kakao Mobility 도로 좌표를 사용한 선과 `실제 경로` 표시로 전환됩니다.

검증 명령은 다음과 같습니다.

```bash
npm run lint
npm run typecheck
npx --yes deno check supabase/functions/search-places/index.ts supabase/functions/plan-route/index.ts supabase/functions/weather-timeline/index.ts supabase/functions/save-collection/index.ts supabase/functions/kakao-oidc/index.ts
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright는 Chromium을 headless, worker 1개, 재시도 0회로 실행합니다. 기본 `npm run test:e2e`는 외부 API 키를 비운 프로덕션 빌드(`next start`)를 새 포트 서버로 띄워 PWA/service worker까지 확인하며, 기존 서버를 재사용하지 않습니다. 인증이 없는 로컬 실패 증거만 `/tmp` 아래에 남고 CI에서는 3일 동안 보존됩니다. `npm run test:e2e:preview`와 `npm run test:e2e:auth`는 정확한 develop Preview origin과 Preview Supabase project ref에만 결속되며, 다른 HTTPS 주소나 Production 주소를 거부합니다. 로그인 상태는 WSL/Linux의 저장소 밖 전용 `0700` 디렉터리와 `0600` 일반 파일에 원자적으로 저장하고 origin/project metadata와 함께 검증합니다. NTFS owner-only ACL을 이 도구로 증명할 수 없는 native Windows 인증 실행은 fail-closed입니다. 인증된 Preview 실행은 cookie·token 유출을 막기 위해 screenshot/trace/video를 저장하지 않습니다.

DB migration과 RLS/RPC는 실제 프로젝트와 분리된 로컬 Supabase PostgreSQL 17에서 검증합니다.
로컬 DB 초기화는 `127.0.0.1:54322`의 폐기 가능한 테스트 데이터만 삭제하므로, 대상을 확인하고 명시적으로 승인한 경우에만 수행합니다.

```bash
npx --yes supabase@2.116.0 start --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
npx --yes supabase@2.116.0 test db --local supabase/tests/database/auth_rls_budget.test.sql supabase/tests/database/live_acl_readback.test.sql supabase/tests/database/plan_collection_share.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/collection_version_concurrency.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/invite_budget_concurrency.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/route_finalization_concurrency.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/recommended_route_concurrency.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/kakao_oidc_handoff.test.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/database/optional_meal_route.test.sql
```

## Supabase 설정

1. Production과 Preview에 서로 다른 Supabase Free 프로젝트를 사용하고 CLI로 `supabase/migrations/`의 migration을 순서대로 적용합니다.
2. Kakao를 Auth provider로 설정하되 `Allow users without an email`을 켭니다. Kakao 앱에는 이메일을 등록하지 않고 OpenID Connect, 선택 동의 닉네임·프로필 사진, 프로젝트별 `kakao-oidc/callback` URI만 등록합니다.
3. `search-places`, `plan-route`, `weather-timeline`, `save-collection`, `kakao-oidc` Edge Function을 배포하고 서버 전용 비밀값을 Supabase Dashboard secret store에 등록합니다. `kakao-oidc`만 로그인 시작 전 공개 진입점이므로 `verify_jwt=false`이며 나머지 네 함수는 JWT 검증을 유지합니다.
4. 최초 관리자 등록과 거부된 OAuth 사용자 정리는 [Supabase Auth 운영 절차](docs/operations/supabase-auth.md)를 따릅니다.

AUTH-007의 Preview 전용 `play-admission`은 Google Play 설치 증명을 서버에서 검증한 신규 Kakao 사용자만 초대 없이 일반 회원으로 등록합니다. 기존 회원 권한과 회수 상태를 보존하고 웹·개발 앱의 초대 정책은 유지합니다. 구성·복구·검증 한계는 [Play 가입 운영 절차](docs/operations/supabase-auth.md#play-설치-검증-가입-auth-007)를 따릅니다.

프로젝트별 데이터·비밀값·배포 경계와 현재 상태는 [Preview/Production 운영 절차](docs/operations/preview-production.md)를 따릅니다.

관리자는 로그인 후 `/admin/invites`에서 7일짜리 일회용 초대 링크를 만들 수 있습니다. 데이터베이스에는 링크 원문 대신 SHA-256 해시만 저장되고, 링크는 `/invite#<token>` 형식이라 최초 HTTP 요청 경로와 호스팅 로그에 토큰을 넣지 않습니다. 고정 accept API는 동일 출처 `application/json` 요청만 처리하고 cross-site 요청에는 claim cookie를 설정하지 않습니다.

Edge Function 배포 예시는 다음과 같습니다. 실제 프로젝트 연결과 비밀값 등록은 Supabase CLI 로그인 후 수행합니다.

```bash
supabase functions deploy search-places
supabase functions deploy plan-route
supabase functions deploy weather-timeline
supabase functions deploy save-collection
supabase functions deploy kakao-oidc --no-verify-jwt
```

`KAKAO_LOCAL_DAILY_LIMIT`, `KAKAO_CURRENT_DAILY_LIMIT`, `KAKAO_FUTURE_DAILY_LIMIT`, `KMA_DAILY_LIMIT`도 반드시 양의 정수로 설정합니다. 비밀값이나 key는 명령 인자에 넣지 않습니다. 이 값은 비용을 보장하는 공급자 설정의 대체물이 아니므로 Kakao·기상청 콘솔에서도 유료 사용을 비활성화하고 더 낮은 쿼터를 사용해야 합니다.

## 공개 배포 전 체크

- Kakao 지도 제품을 활성화하기 전에 해당 앱이 무료 할당 대상이고 Biz Wallet이나 유료 API 설정을 요구하지 않는지 확인합니다. 무료 조건이 아니면 활성화하지 않고 `COST-001` 사용자 인터뷰를 다시 수행합니다.
- Kakao JavaScript 키는 Vercel의 정확한 운영/미리보기 도메인으로 제한합니다. 자세한 확인 순서는 [Preview/Production 운영 절차](docs/operations/preview-production.md)를 따릅니다.
- 서버 키와 Supabase service-role 키는 브라우저 변수에 넣지 않습니다.
- Supabase Free의 비활성 프로젝트 일시정지를 감안해 출발 전에 프로젝트 상태를 확인합니다.
- 지인 위치, 실제 초대 링크, 여행 일정은 fixture·스크린샷·Issue에 올리지 않습니다.
- `git diff --cached`와 `git grep`으로 비밀값을 확인한 뒤에만 공개 저장소에 push합니다.
- 데이터베이스 백업은 Supabase 외부에 별도로 보관합니다.

더 자세한 신고·키 관리 기준은 [SECURITY.md](SECURITY.md)를 따릅니다.

## 브랜치와 배포 운영

- `develop`: 기본 개발 브랜치입니다. 개발 변경과 통합은 이 브랜치에서 진행합니다.
- `main`: 운영 배포 브랜치입니다. 같은 저장소의 `develop → main` Pull Request만 허용합니다.
- CI는 `develop`과 `main`의 push 및 두 브랜치를 대상으로 하는 Pull Request에서 lint, TypeScript, Deno, 단위 테스트, 동일한 `npm run test:e2e` Chromium 검증, 프로덕션 빌드를 실행합니다.
- `pull_request_target` 기반의 별도 검사는 `main` 대상 PR의 출발 브랜치와 저장소 소유권을 검사합니다. PR 코드는 checkout하거나 실행하지 않습니다.

`main`의 GitHub 보호 규칙은 Pull Request와 `verify`, `develop-only` 검사를 필수로 요구하며 직접 push, 강제 push, 삭제를 막습니다. 현재 라이선스는 정하지 않았으므로, 저장소가 공개되어 있어도 재사용 권한이 자동으로 부여되지는 않습니다.

### Vercel CD

[`vercel.json`](vercel.json)은 비용과 불필요한 배포를 줄이기 위해 `develop`과 `main`만 자동 배포 대상으로 허용합니다.

- `develop` push: Vercel Authentication으로 보호된 Preview 배포, Preview 전용 Supabase 사용
- `develop → main` 병합: Production 배포
- 그 밖의 브랜치: 자동 배포하지 않음

Vercel CD는 저장소의 비밀값으로 CLI 토큰을 보관하는 방식 대신 Vercel 공식 GitHub 연동을 사용합니다. 최초 한 번 Vercel에서 `tocomboy/motocast`를 가져오고 Production Branch가 `main`인지 확인해야 합니다. Vercel에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`만 환경별로 등록합니다. Kakao REST 키와 기상청 키는 프런트엔드가 아니라 Supabase Edge Function secrets에 둡니다.

커밋 전 확인:

```bash
git status --short
git diff --check
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build
```

## 남은 첫 버전 작업

- Preview의 초대 로그인과 관리자/다른 라이더/회원 자격 회수 경계 검증 (정상 경로·날씨·컬렉션·공유 흐름은 통과)
- Preview의 공급자 실패·오래된 저장본 표시·비용 한도 소진 시나리오 검증
- Preview 게이트 후 확정된 기존 리전을 유지하며 Production 구성·승격 승인, `develop → main` PR, Production 사용자 관점 검증
