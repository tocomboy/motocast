# Supabase Auth 운영 절차

이 문서는 `AUTH-001`부터 `AUTH-003`까지의 운영 절차다. 실제 UUID, OAuth credential, invite token은 문서·Issue·명령 인자·로그에 남기지 않는다.

## 최초 관리자 bootstrap

1. 고정 SHA 독립 리뷰를 통과한 전체 migration과 Auth callback을 먼저 배포하고 Kakao provider 및 redirect URL을 설정한다.
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
    nullif(left(raw_user_meta_data ->> 'avatar_url', 2048), '')
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
