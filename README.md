# MOTOCAST

지인 라이더를 위한 국내 24시간 미만 오토바이 경로·시간대별 날씨 계획 PWA입니다. 사용자가 순서대로 정한 경유지를 지나는 오토바이 안전 추천 경로 1개의 실제 도로 형상, 예상 복귀 시각, 구간별 통과 시각과 기상청 예보를 보여줍니다.

> 현재 상태: 원격 `develop`의 검토된 SHA `0738f76`가 Preview에 배포됐습니다. 모바일 지도 가림과 경로 요약 수정은 독립 리뷰 및 실제 지도 화면 검사를 통과했습니다. 기존 테스트 경로는 점심→경유→휴식 구간에서 카카오 코드 `106`으로 거절됐고, 휴식지만 바꾼 비교에서는 실제 경로 계산·저장·지도 표시가 성공했습니다. 비교 검사는 이후 기상청 응답 검증 실패(`KMA_INVALID_RESPONSE`)로 중단됐으며 생성한 테스트 계획은 정리했습니다. 공유 발행·회수까지 포함한 전체 Preview 검증은 미완료입니다. 같은 SHA의 PR CI는 통과했지만 develop CI의 모바일 버튼 높이 검사 1건은 패널 이동 중 측정 경합으로 실패해 후속 수정 중입니다. Preview `plan-route`는 ACTIVE v11·JWT 검증 유지, 나머지 네 함수는 v8입니다. 필요한 후속 Preview 테스트는 사용자 승인 범위이며, 안전 옵션·DB·Production·유료 API·자동 결제는 변경하지 않았습니다.

## 고정된 제품 원칙

- 한국 내 출발 후 24시간 미만 라이딩만 지원하며, 추천 경로가 자정을 넘어 복귀해도 표시합니다. 숙박 일정은 지원하지 않습니다.
- 사용자는 출발 시각만 입력하고, 복귀는 실제 추천 경로 주행시간과 정차를 합산한 예상 시각으로 확인합니다. 이미 지난 출발 시각은 외부 API나 비용 한도를 사용하기 전에 서버의 신뢰 시각으로 거부합니다.
- 경로 요청은 이륜차(`car_type=7`)와 자동차전용도로 회피(`avoid=motorway`)를 항상 함께 사용합니다. 안전 조건을 완화하거나 자동차 경로로 대체하지 않습니다.
- `경유지`는 Kakao가 자동으로 찾는 와인딩 속성이 아니라 사용자가 정한 필수 통과점입니다. Kakao 대안 경로를 탐색하지 않으며 안전 추천 경로를 만들 수 없으면 명시적으로 실패합니다.
- 출발지와 복귀지 사이에는 하나의 방문 순서 목록을 사용합니다. 항목을 추가할 때 일반 경유지·점심·저녁·휴식을 선택하고, 종류를 바꾸거나 모든 종류를 서로 가로질러 위아래로 이동할 수 있습니다. 점심과 저녁은 각각 선택이며 기본 60분, 휴식은 0~5개이고 기본 30분입니다. 식사와 휴식의 정차 시간은 각각 조정할 수 있고 같은 장소를 여러 번 넣어도 서로 다른 방문으로 유지합니다.
- 날씨는 경로 순위를 바꾸지 않고 구간별 참고 정보로 표시합니다.
- 컬렉션은 출발지·도착지와 순서가 있는 모든 정차를 포함한 완전한 코스를 불변 버전으로 저장합니다. 응답을 잃은 동일 저장 요청은 같은 결과를 돌려주며 중복 버전을 만들지 않습니다. 경유지만 저장한 기존 Preview 컬렉션은 완전한 코스로 표시하지 않습니다.
- 공유는 사용자가 명시적으로 만든 불변 스냅샷만 허용하며, 기본값은 비공개입니다. 컬렉션의 `공유 준비`는 완전한 코스를 적용한 뒤 새 안전 경로와 아직 유효한 최신 날씨가 저장되어야 간결한 여행 루트·날씨 미리보기를 한 번 열며 자동 게시하지 않습니다.
- 유료 API 사용은 켜지 않습니다. 내부 일일 한도를 소진하면 새 외부 계산을 거부하고 저장된 계획만 읽습니다.

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

- Preview 실제 계산의 `INVALID_ROUTE_PROVIDER_RESPONSE` 원인을 안전하게 진단한 뒤 경로·날씨·저장·공유를 재검증 (`840a8eb` UI 리뷰·배포·지도 화면 검증 완료, 전체 Preview 게이트는 미완료)
- Preview의 초대 라이더, 회수 권한, 장소·경로·날씨·컬렉션·공유·budget 전체 브라우저 smoke test
- 실제 Kakao/KMA 최소 호출, stale snapshot, 비용 한도 소진 검증
- Preview 게이트 후 확정된 기존 리전을 유지하며 Production 구성·승격 승인, `develop → main` PR, Production 사용자 관점 검증
