-- AUTH-001/003/006/007: enrollment is Play-verified only; web signs in active members.
-- Keep the legacy signatures so old clients fail closed, and retain invitation history.
-- Disable the bodies as well as their ACLs: even a privileged internal call cannot enroll.
create or replace function public.create_invite(valid_for interval default interval '7 days')
returns table(invite_token text, expires_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'INVITATIONS_DISABLED';
end;
$$;

create or replace function public.claim_invite(invite_token text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'INVITATIONS_DISABLED';
end;
$$;

create or replace function public.revoke_invite(target_invite_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'INVITATIONS_DISABLED';
end;
$$;

revoke all on function public.create_invite(interval), public.claim_invite(text), public.revoke_invite(uuid)
  from public, anon, authenticated, service_role;
revoke all on public.invitations from public, anon, authenticated, service_role;

-- Existing memberships/profiles, their roles/revocations, and all fourteen reviewed
-- service-role RPCs (including the three AUTH-007 admission functions) are unchanged.
