# Supabase Auth 운영 절차

이 문서는 `AUTH-001`부터 `AUTH-007`까지의 운영 절차다. 실제 UUID, OAuth/OIDC credential, ID/access token, handoff, invite token은 문서·Issue·명령 인자·로그에 남기지 않는다.

## 이메일 없는 Kakao OIDC 설정

Supabase의 기본 Kakao `signInWithOAuth()` 경로는 `account_email`을 고정 요청하므로 사용하지 않는다. 각 환경의 Kakao 앱과 Supabase 프로젝트를 다음처럼 별도로 설정한다.

1. Kakao Developers의 [카카오 로그인] > [동의항목]에서 닉네임과 프로필 사진을 각각 `선택 동의`로 설정한다. 동의 목적은 실제 앱 내 표시 용도로만 적는다. `account_email`은 설정하거나 요청하지 않는다.
2. Kakao 앱의 OpenID Connect를 활성화한다.
3. REST API 키의 Kakao 로그인 Redirect URI에 환경별 Edge callback을 등록한다. Preview는 `https://lehjmbgfpoemqcwxowbx.supabase.co/functions/v1/kakao-oidc/callback`이다. Production은 `OPS-008`에서 확정한 기존 프로젝트를 사용하며, URI 등록은 Preview 게이트 완료와 별도 Production 구성 승인 뒤 수행한다.
4. Supabase [Authentication] > [Providers] > [Kakao]에서 provider와 Client Secret을 유지하고 `Allow users without an email`을 활성화한다. Supabase provider의 기존 callback은 `AUTH-004` 앱 경로가 사용하지 않지만 provider의 ID-token 검증 설정은 계속 필요하다.
5. Supabase Edge Function secrets에 기존 `KAKAO_REST_API_KEY`와 별도로 `KAKAO_LOGIN_CLIENT_SECRET`, `KAKAO_OIDC_STATE_SECRET`을 등록한다. 로그인 Client Secret은 Kakao REST API 키에 활성화된 값을 사용하고, state secret은 비밀번호 관리 도구로 만든 독립적인 32바이트 이상 난수로 한다. 값을 CLI 인자나 셸 기록에 넣지 않는다.
6. 앱의 `/api/auth/kakao/start`가 앱-origin HttpOnly `__Host-` 브라우저 결합값을 먼저 발급한다. `kakao-oidc`만 인증 전 로그인을 받아야 하므로 `verify_jwt=false`로 배포한다. Edge `/start`는 고정 allowlist callback과 브라우저 결합 해시만 허용하고, provider callback URI는 Edge 내부 `request.url`이 아니라 플랫폼이 제공하는 `SUPABASE_URL`의 검증된 origin에서만 만든다. 인가와 토큰 교환은 반드시 이 동일한 HTTPS URI를 사용한다. `/callback`은 HttpOnly state cookie·nonce·결합 해시를 검증하며, `/consume`은 같은 결합 해시를 제시한 브라우저에만 암호화된 2분짜리 handoff를 한 번 반환한다. `KAKAO_OIDC_STATE_SECRET`·`ALLOWED_ORIGINS`의 검증 환경은 Kakao REST 키·로그인 Client Secret의 공급자 환경과 코드에서 분리한다. Provider 거부·설정 누락·교환·handoff 저장 오류는 서명된 attempt에서 복구한 실제 시작 origin의 앱 callback으로만 돌아가고 `/api/auth/kakao/cancel`을 거쳐 생성 때와 동일한 `Secure; HttpOnly; SameSite=Lax; Path=/` 속성으로 결합 쿠키를 만료시킨다. 서명 검증 전에는 허용 origin 목록의 첫 항목을 임의로 선택하지 않는다. 잘못된 fragment도 같은 app-origin 정리 endpoint를 사용한다. 다른 네 Edge Function은 `verify_jwt=true`를 유지한다.

배포 후 브라우저의 Kakao authorize URL에서 scope 이름만 확인한다. 정확히 `openid`, `profile_nickname`, `profile_image`가 있고 `account_email`은 없어야 한다. client ID, state, nonce, code, token 값은 출력하거나 기록하지 않는다.

## 최초 관리자 bootstrap

1. 고정 SHA 독립 리뷰를 통과한 전체 migration, OIDC Edge Function, Auth completion endpoint를 먼저 배포하고 위 Kakao/Supabase 설정을 완료한다.
2. 운영 `/login`에서 서비스 소유자의 Kakao 로그인을 한 번 수행한다. 초대가 없으므로 callback은 이용을 거부하고 로컬 세션을 제거하지만, Supabase `auth.users`에는 최소 Auth 사용자만 남는다.
3. Supabase Dashboard의 Authentication 사용자 화면과 `auth.identities`의 `provider = 'kakao'` 정보를 사용해 본인 계정의 정확한 UUID를 확인한다. 닉네임만으로 선택하지 않는다.
4. SQL Editor에서 아래 transaction의 `TARGET-UUID`를 확인한 UUID로 바꿔 실행한다. 실행 전후 대상이 한 행인지 확인한다.

```sql
begin;

do $$
declare
  target_user uuid := 'TARGET-UUID';
begin
  if not exists (
    select 1
    from auth.identities
    where user_id = target_user
      and provider = 'kakao'
  ) then
    raise exception 'BOOTSTRAP_KAKAO_IDENTITY_NOT_FOUND';
  end if;

  insert into public.memberships(user_id, role)
  values (target_user, 'admin')
  on conflict (user_id) do update
    set role = 'admin', revoked_at = null;

  insert into public.profiles(id, nickname, avatar_url)
  select
    id,
    left(coalesce(nullif(btrim(raw_user_meta_data ->> 'name'), ''), '관리자'), 80),
    nullif(left(coalesce(
      nullif(raw_user_meta_data ->> 'avatar_url', ''),
      raw_user_meta_data ->> 'picture'
    ), 2048), '')
  from auth.users
  where id = target_user
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.memberships
    where user_id = target_user and role = 'admin' and revoked_at is null
  ) then
    raise exception 'BOOTSTRAP_ADMIN_FAILED';
  end if;
end;
$$;

commit;
```

5. `/login`에서 다시 Kakao 로그인한다. 기존 active member는 초대 링크 없이 로그인할 수 있어야 한다.
6. `/admin/invites`에서 첫 초대를 생성한 뒤 원문 token이 DB, 로그, 브라우저 분석 도구에 남지 않는지 확인한다.

초대 fragment는 고정 `/api/invites/accept`로만 보내며, 이 endpoint는 동일 출처 `application/json` POST만 허용한다. 브라우저 개발자 도구에서 cross-site·`text/plain` 요청이 generic `400`과 `no-store`로 거부되고 `motocast_invite` cookie를 만들지 않는지 확인한다.

`/login?bootstrap=1`은 로컬 개발 편의만을 위한 표시 조건이며 Production bootstrap 경로가 아니다.

## 거부된 OAuth 사용자 정리

초대와 유효한 Play 검증 없이 OAuth를 완료한 사용자는 `auth.users`에만 남고 `profiles`나 `memberships`가 없어야 한다. 관리자가 삭제하기 전에 정확한 UUID에 대해 다음 조건을 모두 확인한다.

- `public.memberships` 행이 없다.
- `public.profiles` 행이 없다.
- `public.invitations.consumed_by`로 참조되지 않는다.
- 삭제 대상의 Kakao identity가 정리하려는 본인/지인의 계정과 일치한다.

조건을 만족한 한 사용자만 Supabase Dashboard의 Authentication 사용자 화면에서 삭제한다. 일괄 삭제하지 않는다. 삭제 후 같은 UUID의 profile/membership이 0행이고 기존 초대의 `consumed_at` 감사정보가 유지되는지 확인한다.

## 회수와 재초대

- 이용 회수는 `memberships.revoked_at`을 설정한다. Auth 사용자 삭제와 동일한 작업이 아니다.
- 회수된 사용자는 소비된 과거 초대로 재활성화할 수 없다.
- 재가입은 관리자가 새 초대를 발행한 경우에만 허용한다.
- 초대를 소비한 Auth 사용자가 삭제돼 `consumed_by`가 비어도 `consumed_at`이 one-time tombstone으로 남으므로 링크는 재사용할 수 없다.


## Play 설치 검증 가입 (AUTH-007)

Preview `lehjmbgfpoemqcwxowbx`와 Play `dev.motocast.android` 전용이다. Cloud 프로젝트는 `MOTOCAST Play` / `motocast-play-2026` / `710070840912`, 조직 없음이다. 신규 Play 회원만 설치 증명 확인 후 일반 rider로 등록하며 기존 active 회원의 역할·profile을 바꾸지 않는다. revoked 회원은 자동 복원하지 않는다. 웹/개발 앱과 기존 code3의 초대 로그인은 유지한다.

서버가 Kakao 사용자 확인 → 3분 challenge 발급 → 증명 예약 및 예산 차감 → Google decode → LICENSED / PLAY_RECOGNIZED / 패키지 / SHA256 인증서 / versionCode / 요청 hash / 시각 확인 → 원자적 회원·profile 생성 순서로 처리한다. 동일 proof 예약의 동시 요청은 하나만 Google에 전달된다. 설치자 이름·클라이언트 boolean·토큰 내용의 자체 해석은 가입 권한이 아니다. LICENSED는 Play 취득 자격이며 현재 내부 테스터 이메일 목록 조회가 아니다.

- 새 migration: `20260926040355_play_verified_membership.sql`. challenge는 사용자당 한 행, 검증 예산은 전체 한 행이며 RLS와 직접 DML 거부를 유지한다. 새 service_role 전용 함수는 begin/take/complete 3개다. live Preview에 별도 날씨 함수가 있으므로 전체 기존 ACL과 새 3개를 모두 읽어 확인한다.
- `play-admission`은 JWT 검증을 켜서 배포하고 함수 내부에서도 사용자 및 Kakao identity를 확인한다. Preview 이외의 프로젝트 URL은 거부한다.
- 서버 secret: `PLAY_ADMISSION_PROJECT_ID=motocast-play-2026`, `PLAY_ADMISSION_SERVICE_ACCOUNT`(검증 전용 계정 JSON), `PLAY_ADMISSION_CERTIFICATES`(Play 앱 서명 SHA256의 base64url, 쉼표 구분), `PLAY_ADMISSION_VERSIONS`(검증할 versionCode allowlist, 최초4). 업로드 인증서를 앱 서명 인증서로 대신하지 않는다.
- 키는 승인된 Preview secret store와 저장소 밖 사용자 전용 경로에만 보관한다. 프로젝트 IAM 관리자·Play 출시 역할을 부여하지 않는다. Android에는 공개 Cloud 프로젝트 번호만 포함하며 서비스 계정 키를 넣지 않는다.
- 2026-09-26 Preview 비밀값4개 저장 및 digest 대조 완료. 검증 전용 계정의 로컬 생성 RSA2048 공개 인증서를 Google에 등록했고 OAuth 연결을 확인했다. 다운로드에 실패한 키2개는 승인 후 삭제했다. 현재 인증서 만료일2027-09-26 전에 교체해야 한다. 실제 Play 증명 성공은 별도 기기 확인이다.
- 시간당 사용자5회, 서울 날짜당 전체 Google decode500회. 실패한 decode도 예산을 소모한다. 원본 proof/Google OAuth/Kakao/session token은 기록하지 않는다. Google 요청은 고정 HTTPS 목적지·각5초·64KiB 한도, 자동 재전송·redirect 없음이다.
- 배포 전 정확한 후보 SHA CI-only PR 및 zero-deployment gate를 지킨다. 실제 Google proof와 신규 Play 사용자 가입은 로컬 합성 응답·CI로 대체하지 않는다.
- 복구: `PLAY_ADMISSION_VERSIONS`를 비워 신규 Play 가입만 닫고, 검증한 이전 함수 소스로 복구한다. 이미 가입한 회원과 새 테이블은 삭제하지 않는다. 기존 로그인·초대 API를 유지하며 Android는 이전 정상 소스를 더 높은 versionCode로 배포한다. 서비스 키 분실/노출 시 새 키 전달 확인 후 해당 키만 폐기하는 별도 승인 절차를 따른다.
