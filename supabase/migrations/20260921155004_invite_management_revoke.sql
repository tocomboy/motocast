-- AUTH-001/002: exact invitation revocation without exposing or storing raw codes.
create or replace function public.revoke_invite(target_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation public.invitations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if target_invite_id is null then
    raise exception 'INVALID_INVITE_ID';
  end if;

  -- claim_invite locks this same row, so claiming and revoking cannot both win.
  select * into invitation from public.invitations
  where id = target_invite_id for update;
  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;
  if invitation.revoked_at is not null then return 'revoked'; end if;
  if invitation.consumed_at is not null then return 'used'; end if;
  if invitation.expires_at <= clock_timestamp() then return 'expired'; end if;

  update public.invitations set revoked_at = clock_timestamp()
  where id = target_invite_id;
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  return 'revoked';
end;
$$;

revoke all on function public.revoke_invite(uuid) from public, anon, service_role;
grant execute on function public.revoke_invite(uuid) to authenticated;
