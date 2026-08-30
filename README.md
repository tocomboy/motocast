# MOTOCAST

지인 라이더를 위한 국내 당일 오토바이 경로·시간대별 날씨 계획 PWA입니다. 출발/복귀 시각과 식사 정차, 선택 휴식을 반영해 세 가지 경로 후보를 비교하고, 각 구간의 예상 통과 시각에 맞춘 기상청 예보를 보여주는 것을 목표로 합니다.

> 현재 상태: 첫 번째 실행 가능한 기반입니다. 반응형 계획 화면, 초대 기반 카카오 로그인 경계, Supabase 스키마/RLS, 카카오 경로 및 기상청 예보 Edge Function, 일일 API 하드 스톱이 구현되어 있습니다. 장소 검색, 계산 결과의 화면 반영, 컬렉션 저장·버전 공유는 데이터 모델만 있고 UI 연결은 아직 남아 있습니다.

## 고정된 제품 원칙

- 한국 내 24시간 미만 당일 라이딩만 지원합니다.
- 경로 요청은 이륜차(`car_type=7`)와 자동차전용도로 회피(`avoid=motorway`)를 항상 함께 사용합니다. 안전 조건을 완화하거나 자동차 경로로 대체하지 않습니다.
- 점심 정차는 필수, 저녁은 선택입니다. 휴식은 사용자가 선택한 경우에만 기본 30분으로 계산합니다.
- 날씨는 경로 순위를 바꾸지 않고 구간별 참고 정보로 표시합니다.
- 공유는 사용자가 명시적으로 만든 불변 스냅샷만 허용하며, 기본값은 비공개입니다.
- 유료 API 사용은 켜지 않습니다. 내부 일일 한도를 소진하면 새 외부 계산을 거부하고 저장된 계획만 읽습니다.

## 구성

- Next.js 16 + TypeScript + React 19
- 반응형 웹/PWA
- Supabase Auth, Postgres/PostGIS, Row Level Security, Edge Functions
- Kakao Mobility 길찾기 API와 Kakao Maps JavaScript API
- 기상청 API허브 단기·초단기예보
- Vitest, ESLint, TypeScript, GitHub Actions

## 로컬 실행

Node.js 20.9 이상이 필요합니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

`.env.local`에는 실제 키를 입력하되 Git에 추가하지 않습니다. 외부 서비스 없이 화면만 확인하려면 환경변수를 비워 둔 채 실행하면 합성 위치와 합성 예보를 사용하는 데모 모드로 열립니다.

검증 명령은 다음과 같습니다.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Supabase 설정

1. Supabase Free 프로젝트를 만들고 SQL Editor 또는 CLI로 [`supabase/migrations/20260830193000_initial_schema.sql`](supabase/migrations/20260830193000_initial_schema.sql)을 적용합니다.
2. Kakao를 Auth provider로 설정하고 콜백 주소를 Supabase가 안내하는 주소와 일치시킵니다.
3. `plan-route`, `weather-timeline` Edge Function을 배포하고 서버 전용 비밀값을 Supabase secrets에 등록합니다.
4. 첫 관리자만 `/login?bootstrap=1`로 카카오 계정을 만든 뒤, Supabase SQL Editor에서 해당 `auth.users.id`를 직접 확인해 아래처럼 등록합니다. 공개 이슈나 로그에 실제 UUID를 남기지 않습니다.

```sql
insert into public.memberships (user_id, role)
values ('관리자-auth-user-uuid', 'admin');
```

관리자는 로그인 후 `/admin/invites`에서 7일짜리 일회용 초대 링크를 만들 수 있습니다. 데이터베이스에는 링크 원문 대신 SHA-256 해시만 저장됩니다.

Edge Function 배포 예시는 다음과 같습니다. 실제 프로젝트 연결과 비밀값 등록은 Supabase CLI 로그인 후 수행합니다.

```bash
supabase functions deploy plan-route
supabase functions deploy weather-timeline
supabase secrets set KAKAO_REST_API_KEY=... KMA_APIHUB_KEY=...
```

`KAKAO_CURRENT_DAILY_LIMIT`, `KAKAO_FUTURE_DAILY_LIMIT`, `KMA_DAILY_LIMIT`도 반드시 양의 정수로 설정합니다. 이 값은 비용을 보장하는 공급자 설정의 대체물이 아니므로 Kakao·기상청 콘솔에서도 유료 사용을 비활성화하고 더 낮은 쿼터를 사용해야 합니다.

## 공개 배포 전 체크

- Kakao JavaScript 키는 Vercel의 정확한 운영/미리보기 도메인으로 제한합니다.
- 서버 키와 Supabase service-role 키는 브라우저 변수에 넣지 않습니다.
- Supabase Free의 비활성 프로젝트 일시정지를 감안해 출발 전에 프로젝트 상태를 확인합니다.
- 지인 위치, 실제 초대 링크, 여행 일정은 fixture·스크린샷·Issue에 올리지 않습니다.
- `git diff --cached`와 `git grep`으로 비밀값을 확인한 뒤에만 공개 저장소에 push합니다.
- 데이터베이스 백업은 Supabase 외부에 별도로 보관합니다.

더 자세한 신고·키 관리 기준은 [SECURITY.md](SECURITY.md)를 따릅니다.

## 브랜치와 배포 운영

- `develop`: 기본 개발 브랜치입니다. 개발 변경과 통합은 이 브랜치에서 진행합니다.
- `main`: 운영 배포 브랜치입니다. 같은 저장소의 `develop → main` Pull Request만 허용합니다.
- CI는 `develop`과 `main`의 push 및 두 브랜치를 대상으로 하는 Pull Request에서 lint, TypeScript, 단위 테스트, 프로덕션 빌드를 실행합니다.
- `pull_request_target` 기반의 별도 검사는 `main` 대상 PR의 출발 브랜치와 저장소 소유권을 검사합니다. PR 코드는 checkout하거나 실행하지 않습니다.

`main`의 GitHub 보호 규칙은 Pull Request와 `verify`, `develop-only` 검사를 필수로 요구하며 직접 push, 강제 push, 삭제를 막습니다. 현재 라이선스는 정하지 않았으므로, 저장소가 공개되어 있어도 재사용 권한이 자동으로 부여되지는 않습니다.

### Vercel CD

[`vercel.json`](vercel.json)은 비용과 불필요한 배포를 줄이기 위해 `develop`과 `main`만 자동 배포 대상으로 허용합니다.

- `develop` push: Preview 배포
- `develop → main` 병합: Production 배포
- 그 밖의 브랜치: 자동 배포하지 않음

Vercel CD는 저장소의 비밀값으로 CLI 토큰을 보관하는 방식 대신 Vercel 공식 GitHub 연동을 사용합니다. 최초 한 번 Vercel에서 `tocomboy/motocast`를 가져오고 Production Branch가 `main`인지 확인해야 합니다. Vercel에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`만 환경별로 등록합니다. Kakao REST 키와 기상청 키는 프런트엔드가 아니라 Supabase Edge Function secrets에 둡니다.

커밋 전 확인:

```bash
git status --short
git diff --check
npm run lint && npm run typecheck && npm test && npm run build
```

## 남은 첫 버전 작업

- Kakao 장소 검색과 실제 좌표 입력
- 경로·날씨 Edge Function 응답을 계획 화면에 반영하고 실패 시 마지막 스냅샷 표시
- 사용자별 라이딩 컬렉션 저장, 커스텀 와인딩 경유지 편집
- 공유 미리보기, 불변 버전 발행, 링크 회수·재발행
- 실제 Supabase/Kakao/KMA 환경의 통합 테스트
