-- AUTH-001, DATA-001, COST-001: Supabase default function privileges grant
-- execute to API roles. Sensitive SECURITY DEFINER RPCs must explicitly remove
-- anonymous execution, and membership helpers must not enumerate arbitrary IDs.
create or replace function public.is_active_member(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select check_user_id is not distinct from auth.uid()
    and check_user_id is not null
    and exists (
      select 1 from public.memberships
      where user_id = check_user_id and revoked_at is null
    );
$$;

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select check_user_id is not distinct from auth.uid()
    and check_user_id is not null
    and exists (
      select 1 from public.memberships
      where user_id = check_user_id and role = 'admin' and revoked_at is null
    );
$$;

revoke all on function public.claim_invite(text) from public, anon;
revoke all on function public.create_invite(interval) from public, anon;
revoke all on function public.consume_daily_api_budget(text, text, integer) from public, anon;
grant execute on function public.claim_invite(text) to authenticated;
grant execute on function public.create_invite(interval) to authenticated;
grant execute on function public.consume_daily_api_budget(text, text, integer) to authenticated;

revoke all on function public.is_active_member(uuid) from public, anon, authenticated;
revoke all on function public.is_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_active_member(uuid) to anon, authenticated;
grant execute on function public.is_admin(uuid) to anon, authenticated;
