begin;

create table public.release_announcements (
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null
    check (octet_length(version) <= 64 and version ~ '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$'),
  presentation_id uuid not null
    check (presentation_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  presented_at timestamptz not null default clock_timestamp(),
  primary key (user_id, version)
);

alter table public.release_announcements enable row level security;

revoke all on table public.release_announcements
  from public, anon, authenticated, service_role;

create function public.claim_release_announcement(
  target_version text,
  target_presentation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  inserted boolean := false;
begin
  if target_version is null
    or octet_length(target_version) > 64
    or target_version !~ '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_RELEASE_VERSION';
  end if;

  if target_presentation_id is null
    or target_presentation_id = '00000000-0000-0000-0000-000000000000'::uuid
  then
    raise exception using errcode = 'P0001', message = 'INVALID_PRESENTATION_ID';
  end if;

  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not public.is_active_member(current_user_id) then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED';
  end if;

  insert into public.release_announcements (
    user_id,
    version,
    presentation_id
  )
  values (
    current_user_id,
    target_version,
    target_presentation_id
  )
  on conflict (user_id, version) do nothing
  returning true into inserted;

  if inserted then
    return true;
  end if;

  return exists (
    select 1
    from public.release_announcements announcement
    where announcement.user_id = current_user_id
      and announcement.version = target_version
      and announcement.presentation_id = target_presentation_id
  );
end;
$$;

revoke all on function public.claim_release_announcement(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_release_announcement(text, uuid)
  to authenticated;

commit;
