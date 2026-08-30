# Supabase Auth 운영 절차

이 문서는 `AUTH-001`부터 `AUTH-005`까지의 운영 절차다. 실제 UUID, OAuth/OIDC credential, ID/access token, handoff, invite token은 문서·Issue·명령 인자·로그에 남기지 않는다.

## 이메일 없는 Kakao OIDC 설정

Supabase의 기본 Kakao `signInWithOAuth()` 경로는 `account_email`을 고정 요청하므로 사용하지 않는다. 각 환경의 Kakao 앱과 Supabase 프로젝트를 다음처럼 별도로 설정한다.

1. Kakao Developers의 [카카오 로그인] > [동의항목]에서 닉네임과 프로필 사진을 각각 `선택 동의`로 설정한다. 동의 목적은 실제 앱 내 표시 용도로만 적는다. `account_email`은 설정하거나 요청하지 않는다.
2. Kakao 앱의 OpenID Connect를 활성화한다.
3. REST API 키의 Kakao 로그인 Redirect URI에 환경별 Edge callback을 등록한다. Preview는 `https://lehjmbgfpoemqcwxowbx.supabase.co/functions/v1/kakao-oidc/callback`이다. Production URI는 `OPS-008` 확정 뒤 별도로 등록한다.
4. Supabase [Authentication] > [Providers] > [Kakao]에서 provider와 Client Secret을 유지하고 `Allow users without an email`을 활성화한다. Supabase provider의 기존 callback은 `AUTH-004` 앱 경로가 사용하지 않지만 provider의 ID-token 검증 설정은 계속 필요하다.
5. Supabase Edge Function secrets에 기존 `KAKAO_REST_API_KEY`와 별도로 `KAKAO_LOGIN_CLIENT_SECRET`, `KAKAO_OIDC_STATE_SECRET`을 등록한다. 로그인 Client Secret은 Kakao REST API 키에 활성화된 값을 사용하고, state secret은 비밀번호 관리 도구로 만든 독립적인 32바이트 이상 난수로 한다. 값을 CLI 인자나 셸 기록에 넣지 않는다.
6. 앱의 `/api/auth/kakao/start`가 앱-origin HttpOnly `__Host-` 브라우저 결합값을 먼저 발급한다. `kakao-oidc`만 인증 전 로그인을 받아야 하므로 `verify_jwt=false`로 배포한다. Edge `/start`는 고정 allowlist callback과 브라우저 결합 해시만 허용하고, `/callback`은 HttpOnly state cookie·nonce·결합 해시를 검증하며, `/consume`은 같은 결합 해시를 제시한 브라우저에만 암호화된 2분짜리 handoff를 한 번 반환한다. `KAKAO_OIDC_STATE_SECRET`·`ALLOWED_ORIGINS`의 검증 환경은 Kakao REST 키·로그인 Client Secret의 공급자 환경과 코드에서 분리한다. Provider 거부·설정 누락·교환·handoff 저장 오류는 서명된 attempt에서 복구한 실제 시작 origin의 앱 callback으로만 돌아가고 `/api/auth/kakao/cancel`을 거쳐 생성 때와 동일한 `Secure; HttpOnly; SameSite=Lax; Path=/` 속성으로 결합 쿠키를 만료시킨다. 서명 검증 전에는 허용 origin 목록의 첫 항목을 임의로 선택하지 않는다. 잘못된 fragment도 같은 app-origin 정리 endpoint를 사용한다. 다른 네 Edge Function은 `verify_jwt=true`를 유지한다.

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

초대 없이 OAuth를 완료한 사용자는 `auth.users`에만 남고 `profiles`나 `memberships`가 없어야 한다. 관리자가 삭제하기 전에 정확한 UUID에 대해 다음 조건을 모두 확인한다.

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
