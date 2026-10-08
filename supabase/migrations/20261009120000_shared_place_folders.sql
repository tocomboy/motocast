begin;

-- Same bounds as 20261007093000: fail and roll back instead of queueing behind a long
-- writer or auth transaction. Every statement below is quick on the current data.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Issue #124 shared folders, avoided places and shared stars. Contract:
-- docs/work/2026-10-09-issue124-shared-folders-contract.md. #123 place_stars, its
-- mirror, triggers and invariants are kept; personal star writers only widen their
-- limit to count shared stars. This lock waits for in-flight personal star writers
-- and holds new ones until commit, so every star counted afterwards sees both tables.
lock table public.place_stars in share row exclusive mode;

create table if not exists public.place_folders (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  revision bigint not null default 1,
  -- The creating request (create_place_folder.request_id); members read it back to confirm a lost reply.
  create_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_folders_pkey primary key (id),
  constraint place_folders_name_check check (char_length(name) between 1 and 40 and btrim(name) = name and name !~ '[[:cntrl:]]'),
  constraint place_folders_revision_check check (revision > 0)
);
create index if not exists place_folders_owner_key on public.place_folders(owner_id);
create unique index if not exists place_folders_create_request_key on public.place_folders(owner_id, create_request_id)
  where create_request_id is not null;

-- One create per (owner, request_id): a replay of the same input returns the stored result
-- (no new folder, no limit re-check); another input under the same id is refused. Private.
create table if not exists public.place_folder_create_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint place_folder_create_requests_pkey primary key (owner_id, request_id),
  constraint place_folder_create_requests_hash_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.place_folder_members (
  folder_id uuid not null references public.place_folders(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  display_name text not null,
  revision bigint not null default 1,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_folder_members_pkey primary key (folder_id, member_id),
  constraint place_folder_members_role_check check (role in ('owner', 'editor', 'viewer')),
  constraint place_folder_members_display_name_check check (
    char_length(display_name) between 1 and 20 and btrim(display_name) = display_name and display_name !~ '[[:cntrl:]]'),
  constraint place_folder_members_revision_check check (revision > 0)
);
create unique index if not exists place_folder_members_one_owner_key on public.place_folder_members(folder_id) where role = 'owner';
create unique index if not exists place_folder_members_display_name_key on public.place_folder_members(folder_id, lower(display_name));
create index if not exists place_folder_members_member_key on public.place_folder_members(member_id, folder_id);

create table if not exists public.place_folder_preferences (
  member_id uuid not null,
  folder_id uuid not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint place_folder_preferences_pkey primary key (member_id, folder_id),
  constraint place_folder_preferences_member_fkey foreign key (folder_id, member_id)
    references public.place_folder_members(folder_id, member_id) on delete cascade
);

create table if not exists public.shared_places (
  id uuid not null default gen_random_uuid(),
  folder_id uuid not null references public.place_folders(id) on delete cascade,
  place jsonb not null,
  alias text,
  kind text not null default 'riding_spot',
  province text,
  revision bigint not null default 1,
  -- No FK: a former member's id stays as plain history ("나간 회원").
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_places_pkey primary key (id),
  constraint shared_places_place_check check (public.is_valid_saved_place(place)),
  constraint shared_places_alias_check check (
    alias is null or (char_length(alias) between 1 and 80 and btrim(alias) = alias and alias !~ '[[:cntrl:]]')),
  constraint shared_places_region_alias_check check (alias is not null or not public.is_region_saved_place(place)),
  constraint shared_places_kind_check check (kind in ('riding_spot', 'restaurant')),
  constraint shared_places_province_check check (
    province in ('서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주')),
  constraint shared_places_revision_check check (revision > 0)
);
create unique index if not exists shared_places_folder_place_key on public.shared_places(folder_id, (place ->> 'kakaoPlaceId'));
create index if not exists shared_places_folder_created_key on public.shared_places(folder_id, created_at, id);

create table if not exists public.place_folder_invites (
  id uuid not null default gen_random_uuid(),
  folder_id uuid not null references public.place_folders(id) on delete cascade,
  token_hash text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint place_folder_invites_pkey primary key (id),
  constraint place_folder_invites_token_hash_key unique (token_hash),
  constraint place_folder_invites_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint place_folder_invites_expiry_check check (expires_at = created_at + interval '7 days')
);
create index if not exists place_folder_invites_folder_key on public.place_folder_invites(folder_id, created_at, id);

create table if not exists public.avoided_places (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  place jsonb not null,
  -- Reference only: the shared place may later be deleted or become invisible.
  source_shared_place_id uuid,
  created_at timestamptz not null default now(),
  constraint avoided_places_pkey primary key (id),
  constraint avoided_places_place_check check (public.is_valid_saved_place(place))
);
create unique index if not exists avoided_places_owner_place_key on public.avoided_places(owner_id, (place ->> 'kakaoPlaceId'));

create table if not exists public.shared_place_stars (
  owner_id uuid not null references auth.users(id) on delete cascade,
  shared_place_id uuid not null references public.shared_places(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint shared_place_stars_pkey primary key (owner_id, shared_place_id)
);
create index if not exists shared_place_stars_place_key on public.shared_place_stars(shared_place_id);

alter table public.place_folders enable row level security;
alter table public.place_folder_members enable row level security;
alter table public.place_folder_preferences enable row level security;
alter table public.shared_places enable row level security;
alter table public.place_folder_invites enable row level security;
alter table public.avoided_places enable row level security;
alter table public.shared_place_stars enable row level security;
alter table public.place_folder_create_requests enable row level security;
revoke all on table public.place_folders, public.place_folder_members, public.place_folder_preferences, public.shared_places,
  public.place_folder_invites, public.avoided_places, public.shared_place_stars, public.place_folder_create_requests
  from public, anon, authenticated, service_role;
grant select on table public.place_folders, public.place_folder_preferences, public.shared_places, public.avoided_places,
  public.shared_place_stars to authenticated;
grant select (folder_id, member_id, role, display_name, joined_at, revision) on table public.place_folder_members to authenticated;

-- RLS helper. Definer rights read place_folder_members without the policy on that
-- same table, so its policy does not refer to itself.
create or replace function public.is_place_folder_member(target_folder uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and public.is_active_member()
    and exists (select 1 from public.place_folder_members member
      where member.folder_id = target_folder and member.member_id = (select auth.uid()));
$$;

-- Lock order (contract 5): every folder lock, ascending folder_id, then every user
-- lock, ascending user_id. The user lock name is the #123 one.
create or replace function public.lock_place_folder(target_folder uuid, shared_mode boolean)
returns void language plpgsql set search_path = '' as $$
begin
  if shared_mode then
    perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('place-folder:' || target_folder::text, 0));
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-folder:' || target_folder::text, 0));
  end if;
end;
$$;

create or replace function public.lock_place_user(target_user uuid)
returns void language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || target_user::text, 0));
$$;

create or replace function public.place_folder_role(target_folder uuid, target_user uuid)
returns text language sql stable set search_path = '' as $$
  select member.role from public.place_folder_members member where member.folder_id = target_folder and member.member_id = target_user;
$$;

create or replace function public.place_star_total(target_owner uuid)
returns bigint language sql stable set search_path = '' as $$
  select (select count(*) from public.place_stars star where star.owner_id = target_owner)
    + (select count(*) from public.shared_place_stars star where star.owner_id = target_owner);
$$;

create or replace function public.assert_place_folder_name(candidate text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if candidate is null or char_length(candidate) not between 1 and 40 or btrim(candidate) <> candidate or candidate ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_FOLDER';
  end if;
end;
$$;

create or replace function public.assert_folder_display_name(candidate text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if candidate is null or char_length(candidate) not between 1 and 20 or btrim(candidate) <> candidate or candidate ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'INVALID_FOLDER_DISPLAY_NAME';
  end if;
end;
$$;

-- Ids, at most 1,000 and without nulls or duplicates.
create or replace function public.assert_place_id_list(ids uuid[])
returns void language plpgsql immutable set search_path = '' as $$
begin
  if ids is null or pg_catalog.array_position(ids, null) is not null
    or (select count(distinct item) from pg_catalog.unnest(ids) item) <> coalesce(pg_catalog.cardinality(ids), 0) then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_FOLDER';
  end if;
  if pg_catalog.cardinality(ids) > 1000 then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_PLACE_LIMIT'; end if;
end;
$$;

create or replace function public.place_folder_member_json(member public.place_folder_members)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('folder_id', member.folder_id, 'member_id', member.member_id, 'role', member.role,
    'display_name', member.display_name, 'joined_at', member.joined_at, 'revision', member.revision);
$$;

-- A shared star leaves with its member: removal, leaving, folder or account deletion.
create or replace function public.place_folder_members_clear_stars()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.shared_place_stars star using public.shared_places shared
    where star.owner_id = old.member_id and star.shared_place_id = shared.id and shared.folder_id = old.folder_id;
  return null;
end;
$$;

-- Commit-time invariants. Definer rights keep them independent of the committing role.
-- S1: personal + shared stars <= 10, and every shared star belongs to a current member.
create or replace function public.place_star_total_consistent(target_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.place_star_total(target_owner) <= 10
    and not exists (
      select 1 from public.shared_place_stars star
      join public.shared_places shared on shared.id = star.shared_place_id
      where star.owner_id = target_owner
        and not exists (select 1 from public.place_folder_members member
          where member.folder_id = shared.folder_id and member.member_id = star.owner_id));
$$;

-- F1: a live folder has exactly one owner row, that row is the folder owner, and every
-- member row has its preference row.
create or replace function public.place_folder_consistent(target_folder uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.place_folders folder where folder.id = target_folder)
    or ((select count(*) from public.place_folder_members member
          join public.place_folders folder on folder.id = member.folder_id
          where member.folder_id = target_folder and member.role = 'owner' and member.member_id = folder.owner_id) = 1
      and not exists (select 1 from public.place_folder_members member
          where member.folder_id = target_folder and member.role = 'owner'
            and member.member_id <> (select folder.owner_id from public.place_folders folder where folder.id = target_folder))
      and not exists (select 1 from public.place_folder_members member
          where member.folder_id = target_folder
            and not exists (select 1 from public.place_folder_preferences preference
              where preference.folder_id = member.folder_id and preference.member_id = member.member_id)));
$$;

create or replace function public.assert_place_star_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_owner uuid;
begin
  if tg_table_name = 'place_folder_members' then target_owner := old.member_id; else target_owner := new.owner_id; end if;
  if not public.place_star_total_consistent(target_owner) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_INVARIANT';
  end if;
  return null;
end;
$$;

create or replace function public.assert_place_folder_consistent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'place_folders' then
    if not public.place_folder_consistent(new.id) then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVARIANT'; end if;
  else
    if tg_op in ('UPDATE', 'DELETE') and not public.place_folder_consistent(old.folder_id) then
      raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVARIANT';
    end if;
    if tg_op in ('INSERT', 'UPDATE') and not public.place_folder_consistent(new.folder_id) then
      raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVARIANT';
    end if;
  end if;
  return null;
end;
$$;

-- A rerun keeps the existing triggers (CREATE TRIGGER needs no stronger lock than the
-- one already held on place_stars; the other tables are new).
do $$
begin
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_folder_members'::regclass and tgname = 'place_folder_members_a_clear_stars') then
    create trigger place_folder_members_a_clear_stars after delete on public.place_folder_members
      for each row execute function public.place_folder_members_clear_stars();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_stars'::regclass and tgname = 'place_stars_z_check_star_total') then
    create constraint trigger place_stars_z_check_star_total after insert on public.place_stars
      deferrable initially deferred for each row execute function public.assert_place_star_total();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.shared_place_stars'::regclass and tgname = 'shared_place_stars_z_check_star_total') then
    create constraint trigger shared_place_stars_z_check_star_total after insert on public.shared_place_stars
      deferrable initially deferred for each row execute function public.assert_place_star_total();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_folder_members'::regclass and tgname = 'place_folder_members_z_check_star_total') then
    create constraint trigger place_folder_members_z_check_star_total after delete on public.place_folder_members
      deferrable initially deferred for each row execute function public.assert_place_star_total();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_folders'::regclass and tgname = 'place_folders_z_check_invariants') then
    create constraint trigger place_folders_z_check_invariants after insert or update of owner_id on public.place_folders
      deferrable initially deferred for each row execute function public.assert_place_folder_consistent();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_folder_members'::regclass and tgname = 'place_folder_members_z_check_invariants') then
    create constraint trigger place_folder_members_z_check_invariants after insert or update or delete on public.place_folder_members
      deferrable initially deferred for each row execute function public.assert_place_folder_consistent();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_folder_preferences'::regclass and tgname = 'place_folder_preferences_z_check_invariants') then
    create constraint trigger place_folder_preferences_z_check_invariants after delete on public.place_folder_preferences
      deferrable initially deferred for each row execute function public.assert_place_folder_consistent();
  end if;
end;
$$;

-- Folder places with the last editor's folder name; a former member has none.
create or replace view public.shared_place_entries with (security_invoker = true) as
  select shared.id, shared.folder_id, shared.place, shared.alias, shared.kind, shared.province, shared.revision,
    shared.created_by, shared.updated_by, shared.created_at, shared.updated_at,
    editor.display_name as updated_by_display_name, editor.member_id is null as updated_by_left,
    exists (select 1 from public.shared_place_stars star
      where star.shared_place_id = shared.id and star.owner_id = (select auth.uid())) as starred
  from public.shared_places shared
  left join public.place_folder_members editor on editor.folder_id = shared.folder_id and editor.member_id = shared.updated_by;
revoke all on table public.shared_place_entries from public, anon, authenticated, service_role;
grant select on table public.shared_place_entries to authenticated;

-- Personal and shared stars in one read; clients order by (starred_at, id).
create or replace view public.my_star_entries with (security_invoker = true) as
  select star.owner_id, 'saved'::text as source, saved.id, null::uuid as folder_id, saved.place, saved.alias, saved.kind,
    saved.province, saved.revision, star.created_at as starred_at, star.slot as star_slot
  from public.place_stars star
  join public.saved_places saved on saved.owner_id = star.owner_id and saved.id = star.saved_place_id
  union all
  select star.owner_id, 'shared'::text, shared.id, shared.folder_id, shared.place, shared.alias, shared.kind,
    shared.province, shared.revision, star.created_at, null::smallint
  from public.shared_place_stars star
  join public.shared_places shared on shared.id = star.shared_place_id;
revoke all on table public.my_star_entries from public, anon, authenticated, service_role;
grant select on table public.my_star_entries to authenticated;

create or replace function public.create_place_folder(folder_name text, display_name text, saved_place_ids uuid[], request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); new_folder public.place_folders; new_member public.place_folder_members;
  new_preference public.place_folder_preferences; copied integer; request_hash text; stored public.place_folder_create_requests;
  outcome jsonb;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if create_place_folder.request_id is null then raise exception using errcode = 'P0001', message = 'INVALID_PLACE_FOLDER'; end if;
  perform public.assert_place_folder_name(folder_name);
  perform public.assert_folder_display_name(create_place_folder.display_name);
  perform public.assert_place_id_list(saved_place_ids);
  -- Same input = same name, folder name and set of ids (order-free).
  request_hash := encode(extensions.digest(jsonb_build_object(
    'name', folder_name, 'displayName', create_place_folder.display_name,
    'savedPlaceIds', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from unnest(saved_place_ids) id)
  )::text, 'sha256'), 'hex');
  -- Serializes this rider's creates, so a concurrent replay waits and then reads the stored result.
  perform public.lock_place_user(caller);
  select * into stored from public.place_folder_create_requests request
    where request.owner_id = caller and request.request_id = create_place_folder.request_id;
  if found then
    if stored.payload_hash <> request_hash then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_REQUEST_MISMATCH'; end if;
    return stored.result;
  end if;
  if (select count(*) from public.place_folder_members member where member.member_id = caller) >= 20 then
    raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_LIMIT';
  end if;
  if (select count(*) from public.saved_places saved where saved.owner_id = caller and saved.id = any(saved_place_ids)) <> cardinality(saved_place_ids) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND';
  end if;
  insert into public.place_folders(owner_id, name, create_request_id) values (caller, folder_name, create_place_folder.request_id) returning * into new_folder;
  insert into public.place_folder_members(folder_id, member_id, role, display_name)
    values (new_folder.id, caller, 'owner', create_place_folder.display_name) returning * into new_member;
  insert into public.place_folder_preferences(member_id, folder_id) values (caller, new_folder.id) returning * into new_preference;
  -- The original place, including its signature, is copied unchanged.
  insert into public.shared_places(folder_id, place, alias, kind, province, created_by, updated_by)
    select new_folder.id, saved.place, saved.alias, saved.kind, saved.province, caller, caller
    from public.saved_places saved where saved.owner_id = caller and saved.id = any(saved_place_ids);
  get diagnostics copied = row_count;
  if copied <> cardinality(saved_place_ids) then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND'; end if;
  outcome := jsonb_build_object('folder', to_jsonb(new_folder), 'member', public.place_folder_member_json(new_member),
    'preference', to_jsonb(new_preference));
  insert into public.place_folder_create_requests(owner_id, request_id, payload_hash, result)
    values (caller, create_place_folder.request_id, request_hash, outcome);
  return outcome;
end;
$$;

create or replace function public.rename_place_folder(folder_id uuid, expected_revision bigint, folder_name text)
returns setof public.place_folders language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; current_revision bigint;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.assert_place_folder_name(folder_name);
  perform public.lock_place_folder(rename_place_folder.folder_id, false);
  caller_role := public.place_folder_role(rename_place_folder.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role <> 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  select folder.revision into current_revision from public.place_folders folder where folder.id = rename_place_folder.folder_id;
  if expected_revision is null or current_revision <> expected_revision then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_STALE'; end if;
  return query update public.place_folders folder set name = folder_name, revision = folder.revision + 1, updated_at = clock_timestamp()
    where folder.id = rename_place_folder.folder_id and folder.revision = expected_revision returning folder.*;
  if not found then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_STALE'; end if;
end;
$$;

-- Cascades members, preferences, places, invites and every member's shared stars.
-- Only the folder lock is taken: the delete can only lower other users' counts.
create or replace function public.delete_place_folder(folder_id uuid, expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; current_revision bigint; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.lock_place_folder(delete_place_folder.folder_id, false);
  caller_role := public.place_folder_role(delete_place_folder.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role <> 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  select folder.revision into current_revision from public.place_folders folder where folder.id = delete_place_folder.folder_id;
  if expected_revision is null or current_revision <> expected_revision then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_STALE'; end if;
  delete from public.place_folders folder where folder.id = delete_place_folder.folder_id and folder.revision = expected_revision;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_STALE'; end if;
end;
$$;

-- The raw token exists only in this response (SHARE-002 generation and hashing).
create or replace function public.create_place_folder_invite(folder_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; raw_token text; issued_at timestamptz; created public.place_folder_invites;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.lock_place_folder(create_place_folder_invite.folder_id, false);
  caller_role := public.place_folder_role(create_place_folder_invite.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role <> 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  issued_at := clock_timestamp();
  if (select count(*) from public.place_folder_invites invite where invite.folder_id = create_place_folder_invite.folder_id
      and invite.revoked_at is null and invite.expires_at > issued_at) >= 10 then
    raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_LIMIT';
  end if;
  raw_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.place_folder_invites(folder_id, token_hash, created_by, created_at, expires_at)
    values (create_place_folder_invite.folder_id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), caller, issued_at, issued_at + interval '7 days')
    returning * into created;
  return jsonb_build_object('id', created.id, 'token', raw_token, 'expires_at', created.expires_at);
end;
$$;

create or replace function public.list_place_folder_invites(folder_id uuid)
returns table(id uuid, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  caller_role := public.place_folder_role(list_place_folder_invites.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role <> 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  return query select invite.id, invite.created_at, invite.expires_at, invite.revoked_at
    from public.place_folder_invites invite
    where invite.folder_id = list_place_folder_invites.folder_id and invite.revoked_at is null and invite.expires_at > clock_timestamp()
    order by invite.created_at, invite.id;
end;
$$;

create or replace function public.revoke_place_folder_invite(invite_id uuid)
returns table(id uuid, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_folder uuid;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  select invite.folder_id into target_folder from public.place_folder_invites invite where invite.id = invite_id;
  if target_folder is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_NOT_FOUND'; end if;
  perform public.lock_place_folder(target_folder, false);
  -- A member who is not the owner gets the same answer as an unknown id.
  if public.place_folder_role(target_folder, caller) is distinct from 'owner'
    or not exists (select 1 from public.place_folder_invites invite where invite.id = invite_id) then
    raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_NOT_FOUND';
  end if;
  update public.place_folder_invites invite set revoked_at = clock_timestamp() where invite.id = invite_id and invite.revoked_at is null;
  return query select invite.id, invite.created_at, invite.expires_at, invite.revoked_at
    from public.place_folder_invites invite where invite.id = invite_id;
end;
$$;

create or replace function public.place_folder_invite_hash(token text)
returns text language sql immutable set search_path = '' as $$
  select case when token ~ '^[A-Za-z0-9_-]{43}$' then encode(extensions.digest(token, 'sha256'), 'hex') end;
$$;

create or replace function public.preview_place_folder_invite(token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); invite public.place_folder_invites; folder public.place_folders; is_member boolean;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  select stored.* into invite from public.place_folder_invites stored where stored.token_hash = public.place_folder_invite_hash(token);
  if invite.id is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_INVALID'; end if;
  is_member := public.place_folder_role(invite.folder_id, caller) is not null;
  if not is_member and (invite.revoked_at is not null or invite.expires_at <= clock_timestamp()) then
    raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_INVALID';
  end if;
  select stored.* into folder from public.place_folders stored where stored.id = invite.folder_id;
  return jsonb_build_object('status', case when is_member then 'already_member' else 'joinable' end)
    || case when is_member then jsonb_build_object('folder_id', folder.id) else '{}'::jsonb end
    || jsonb_build_object('folder_name', folder.name,
      'owner_display_name', (select member.display_name from public.place_folder_members member
        where member.folder_id = folder.id and member.role = 'owner'),
      'member_count', (select count(*) from public.place_folder_members member where member.folder_id = folder.id),
      'place_count', (select count(*) from public.shared_places shared where shared.folder_id = folder.id));
end;
$$;

create or replace function public.accept_place_folder_invite(token text, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); token_digest text; target_folder uuid; invite public.place_folder_invites;
  member public.place_folder_members; preference public.place_folder_preferences; folder public.place_folders; joined boolean := false;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  token_digest := public.place_folder_invite_hash(token);
  select stored.folder_id into target_folder from public.place_folder_invites stored where stored.token_hash = token_digest;
  if target_folder is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_INVALID'; end if;
  perform public.lock_place_folder(target_folder, false);
  perform public.lock_place_user(caller);
  -- Re-read under the locks: the folder may have been deleted meanwhile.
  select stored.* into invite from public.place_folder_invites stored where stored.token_hash = token_digest;
  if invite.id is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_INVALID'; end if;
  select stored.* into member from public.place_folder_members stored where stored.folder_id = target_folder and stored.member_id = caller;
  if member.member_id is null then
    if invite.revoked_at is not null or invite.expires_at <= clock_timestamp() then
      raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVITE_INVALID';
    end if;
    if (select count(*) from public.place_folder_members stored where stored.folder_id = target_folder) >= 30 then
      raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_LIMIT';
    end if;
    if (select count(*) from public.place_folder_members stored where stored.member_id = caller) >= 20 then
      raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_LIMIT';
    end if;
    perform public.assert_folder_display_name(accept_place_folder_invite.display_name);
    if exists (select 1 from public.place_folder_members stored
        where stored.folder_id = target_folder and lower(stored.display_name) = lower(accept_place_folder_invite.display_name)) then
      raise exception using errcode = 'P0001', message = 'FOLDER_DISPLAY_NAME_TAKEN';
    end if;
    insert into public.place_folder_members(folder_id, member_id, role, display_name)
      values (target_folder, caller, 'editor', accept_place_folder_invite.display_name) returning * into member;
    insert into public.place_folder_preferences(member_id, folder_id) values (caller, target_folder);
    joined := true;
  end if;
  select stored.* into preference from public.place_folder_preferences stored where stored.member_id = caller and stored.folder_id = target_folder;
  select stored.* into folder from public.place_folders stored where stored.id = target_folder;
  return jsonb_build_object('status', case when joined then 'joined' else 'already_member' end, 'folder', to_jsonb(folder),
    'member', public.place_folder_member_json(member), 'preference', to_jsonb(preference));
end;
$$;

create or replace function public.set_place_folder_display_name(folder_id uuid, expected_revision bigint, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); member public.place_folder_members;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.assert_folder_display_name(set_place_folder_display_name.display_name);
  perform public.lock_place_folder(set_place_folder_display_name.folder_id, false);
  select stored.* into member from public.place_folder_members stored
    where stored.folder_id = set_place_folder_display_name.folder_id and stored.member_id = caller;
  if member.member_id is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if expected_revision is null or member.revision <> expected_revision then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_STALE'; end if;
  if exists (select 1 from public.place_folder_members stored
      where stored.folder_id = set_place_folder_display_name.folder_id and stored.member_id <> caller
        and lower(stored.display_name) = lower(set_place_folder_display_name.display_name)) then
    raise exception using errcode = 'P0001', message = 'FOLDER_DISPLAY_NAME_TAKEN';
  end if;
  update public.place_folder_members stored set display_name = set_place_folder_display_name.display_name,
      revision = stored.revision + 1, updated_at = clock_timestamp()
    where stored.folder_id = set_place_folder_display_name.folder_id and stored.member_id = caller and stored.revision = expected_revision
    returning stored.* into member;
  if not found then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_STALE'; end if;
  return public.place_folder_member_json(member);
end;
$$;

create or replace function public.set_place_folder_member_role(folder_id uuid, member_id uuid, expected_revision bigint, role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; target public.place_folder_members;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if set_place_folder_member_role.role is null or set_place_folder_member_role.role not in ('editor', 'viewer') then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_FOLDER_ROLE';
  end if;
  perform public.lock_place_folder(set_place_folder_member_role.folder_id, false);
  caller_role := public.place_folder_role(set_place_folder_member_role.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role <> 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  select stored.* into target from public.place_folder_members stored
    where stored.folder_id = set_place_folder_member_role.folder_id and stored.member_id = set_place_folder_member_role.member_id;
  if target.member_id is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_NOT_FOUND'; end if;
  if target.role = 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  if expected_revision is null or target.revision <> expected_revision then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_STALE'; end if;
  if target.role = set_place_folder_member_role.role then return public.place_folder_member_json(target); end if;
  update public.place_folder_members stored set role = set_place_folder_member_role.role, revision = stored.revision + 1, updated_at = clock_timestamp()
    where stored.folder_id = target.folder_id and stored.member_id = target.member_id and stored.revision = expected_revision
    returning stored.* into target;
  if not found then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_STALE'; end if;
  return public.place_folder_member_json(target);
end;
$$;

create or replace function public.remove_place_folder_member(folder_id uuid, member_id uuid, expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; target public.place_folder_members; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.lock_place_folder(remove_place_folder_member.folder_id, false);
  caller_role := public.place_folder_role(remove_place_folder_member.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role <> 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  select stored.* into target from public.place_folder_members stored
    where stored.folder_id = remove_place_folder_member.folder_id and stored.member_id = remove_place_folder_member.member_id;
  if target.member_id is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_NOT_FOUND'; end if;
  if target.role = 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  if expected_revision is null or target.revision <> expected_revision then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_STALE'; end if;
  delete from public.place_folder_members stored
    where stored.folder_id = target.folder_id and stored.member_id = target.member_id and stored.revision = expected_revision;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_MEMBER_STALE'; end if;
end;
$$;

create or replace function public.leave_place_folder(folder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.lock_place_folder(leave_place_folder.folder_id, false);
  caller_role := public.place_folder_role(leave_place_folder.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role = 'owner' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_OWNER_CANNOT_LEAVE'; end if;
  delete from public.place_folder_members stored where stored.folder_id = leave_place_folder.folder_id and stored.member_id = caller;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
end;
$$;

-- Desired state for only the folders the rider changed; last write wins per folder.
create or replace function public.set_place_folders_enabled(changes jsonb)
returns setof public.place_folder_preferences language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target uuid; requested integer; matched integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  -- Sequential checks: the uuid cast below runs only after the format check passed.
  if changes is null or jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_FOLDER_PREFERENCES';
  end if;
  if exists (select 1 from jsonb_array_elements(changes) item
      where jsonb_typeof(item) <> 'object' or item - array['folderId', 'enabled'] <> '{}'::jsonb
        or jsonb_typeof(item -> 'folderId') is distinct from 'string' or jsonb_typeof(item -> 'enabled') is distinct from 'boolean'
        or (item ->> 'folderId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_FOLDER_PREFERENCES';
  end if;
  requested := jsonb_array_length(changes);
  if (select count(distinct (item ->> 'folderId')::uuid) from jsonb_array_elements(changes) item) <> requested then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_FOLDER_PREFERENCES';
  end if;
  for target in select (item ->> 'folderId')::uuid from jsonb_array_elements(changes) item order by 1 loop
    perform public.lock_place_folder(target, true);
  end loop;
  select count(*) into matched from public.place_folder_preferences preference
    where preference.member_id = caller and preference.folder_id in (select (item ->> 'folderId')::uuid from jsonb_array_elements(changes) item);
  if matched <> requested then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  update public.place_folder_preferences preference set enabled = (item ->> 'enabled')::boolean, updated_at = clock_timestamp()
    from jsonb_array_elements(changes) item
    where preference.member_id = caller and preference.folder_id = (item ->> 'folderId')::uuid
      and preference.enabled is distinct from (item ->> 'enabled')::boolean;
  return query select preference.* from public.place_folder_preferences preference where preference.member_id = caller
    order by preference.folder_id;
end;
$$;

create or replace function public.add_shared_place(folder_id uuid, place jsonb, place_alias text default null, place_kind text default 'riding_spot')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; target_id uuid; added boolean := false;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if public.is_valid_saved_place(add_shared_place.place) is not true then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  perform public.assert_saved_place_metadata(place_alias, place_kind);
  if place_alias is null and public.is_region_saved_place(add_shared_place.place) then
    raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE_METADATA';
  end if;
  perform public.lock_place_folder(add_shared_place.folder_id, false);
  caller_role := public.place_folder_role(add_shared_place.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role = 'viewer' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  select shared.id into target_id from public.shared_places shared
    where shared.folder_id = add_shared_place.folder_id and shared.place ->> 'kakaoPlaceId' = add_shared_place.place ->> 'kakaoPlaceId';
  if target_id is null then
    if (select count(*) from public.shared_places shared where shared.folder_id = add_shared_place.folder_id) >= 1000 then
      raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_PLACE_LIMIT';
    end if;
    insert into public.shared_places(folder_id, place, alias, kind, province, created_by, updated_by)
      values (add_shared_place.folder_id, add_shared_place.place, place_alias, place_kind,
        public.saved_place_province(add_shared_place.place ->> 'address'), caller, caller)
      returning shared_places.id into target_id;
    added := true;
  end if;
  return jsonb_build_object('status', case when added then 'added' else 'already_exists' end,
    'shared_place', (select to_jsonb(entry) from public.shared_place_entries entry where entry.id = target_id));
end;
$$;

create or replace function public.import_saved_places_to_folder(folder_id uuid, saved_place_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_role text; to_add integer; inserted integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.assert_place_id_list(saved_place_ids);
  perform public.lock_place_folder(import_saved_places_to_folder.folder_id, false);
  perform public.lock_place_user(caller);
  caller_role := public.place_folder_role(import_saved_places_to_folder.folder_id, caller);
  if caller_role is null then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_NOT_FOUND'; end if;
  if caller_role = 'viewer' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  if (select count(*) from public.saved_places saved where saved.owner_id = caller and saved.id = any(saved_place_ids)) <> cardinality(saved_place_ids) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND';
  end if;
  select count(*) into to_add from public.saved_places saved
    where saved.owner_id = caller and saved.id = any(saved_place_ids)
      and not exists (select 1 from public.shared_places shared
        where shared.folder_id = import_saved_places_to_folder.folder_id and shared.place ->> 'kakaoPlaceId' = saved.place ->> 'kakaoPlaceId');
  -- All or nothing: no partial import when the remaining room is too small.
  if (select count(*) from public.shared_places shared where shared.folder_id = import_saved_places_to_folder.folder_id) + to_add > 1000 then
    raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_PLACE_LIMIT';
  end if;
  insert into public.shared_places(folder_id, place, alias, kind, province, created_by, updated_by)
    select import_saved_places_to_folder.folder_id, saved.place, saved.alias, saved.kind, saved.province, caller, caller
    from public.saved_places saved
    where saved.owner_id = caller and saved.id = any(saved_place_ids)
      and not exists (select 1 from public.shared_places shared
        where shared.folder_id = import_saved_places_to_folder.folder_id and shared.place ->> 'kakaoPlaceId' = saved.place ->> 'kakaoPlaceId');
  get diagnostics inserted = row_count;
  if inserted <> to_add then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_WRITE_CONFLICT'; end if;
  return jsonb_build_object('added', inserted, 'skipped_existing', cardinality(saved_place_ids) - inserted);
end;
$$;

-- Shared place id -> folder, hidden as not found unless the caller is a member.
create or replace function public.shared_place_folder(target_place uuid)
returns uuid language sql stable set search_path = '' as $$
  select shared.folder_id from public.shared_places shared where shared.id = target_place;
$$;

create or replace function public.update_shared_place(shared_place_id uuid, expected_revision bigint, place_alias text, place_kind text)
returns setof public.shared_place_entries language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_folder uuid; caller_role text; current_place public.shared_places;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.assert_saved_place_metadata(place_alias, place_kind);
  target_folder := public.shared_place_folder(update_shared_place.shared_place_id);
  if target_folder is null then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND'; end if;
  perform public.lock_place_folder(target_folder, false);
  caller_role := public.place_folder_role(target_folder, caller);
  select shared.* into current_place from public.shared_places shared where shared.id = update_shared_place.shared_place_id;
  if caller_role is null or current_place.id is null then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND'; end if;
  if caller_role = 'viewer' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  if expected_revision is null or current_place.revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_STALE'; end if;
  if place_alias is null and public.is_region_saved_place(current_place.place) then
    raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE_METADATA';
  end if;
  update public.shared_places shared set alias = place_alias, kind = place_kind, revision = shared.revision + 1,
      updated_by = caller, updated_at = clock_timestamp()
    where shared.id = current_place.id and shared.revision = expected_revision;
  if not found then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_STALE'; end if;
  return query select entry.* from public.shared_place_entries entry where entry.id = current_place.id;
end;
$$;

-- Every member's star on the place cascades; no other user lock is needed.
create or replace function public.delete_shared_place(shared_place_id uuid, expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_folder uuid; caller_role text; current_revision bigint; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  target_folder := public.shared_place_folder(delete_shared_place.shared_place_id);
  if target_folder is null then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND'; end if;
  perform public.lock_place_folder(target_folder, false);
  caller_role := public.place_folder_role(target_folder, caller);
  select shared.revision into current_revision from public.shared_places shared where shared.id = delete_shared_place.shared_place_id;
  if caller_role is null or current_revision is null then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND'; end if;
  if caller_role = 'viewer' then raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_FORBIDDEN'; end if;
  if expected_revision is null or current_revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_STALE'; end if;
  delete from public.shared_places shared where shared.id = delete_shared_place.shared_place_id and shared.revision = expected_revision;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_STALE'; end if;
end;
$$;

-- Desired state, any member including viewers. The shared place revision is unchanged.
create or replace function public.set_shared_place_star(shared_place_id uuid, starred boolean)
returns setof public.shared_place_entries language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_folder uuid; current_starred boolean; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if starred is null then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  target_folder := public.shared_place_folder(set_shared_place_star.shared_place_id);
  if target_folder is null then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND'; end if;
  perform public.lock_place_folder(target_folder, true);
  perform public.lock_place_user(caller);
  if public.place_folder_role(target_folder, caller) is null
    or not exists (select 1 from public.shared_places shared where shared.id = set_shared_place_star.shared_place_id) then
    raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND';
  end if;
  current_starred := exists (select 1 from public.shared_place_stars star
    where star.owner_id = caller and star.shared_place_id = set_shared_place_star.shared_place_id);
  if starred and not current_starred then
    if public.place_star_total(caller) >= 10 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
    insert into public.shared_place_stars(owner_id, shared_place_id) values (caller, set_shared_place_star.shared_place_id);
  elsif not starred and current_starred then
    delete from public.shared_place_stars star where star.owner_id = caller and star.shared_place_id = set_shared_place_star.shared_place_id;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND'; end if;
  end if;
  return query select entry.* from public.shared_place_entries entry where entry.id = set_shared_place_star.shared_place_id;
end;
$$;

create or replace function public.add_avoided_place(place jsonb, source_shared_place_id uuid default null)
returns setof public.avoided_places language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); source_folder uuid;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if public.is_valid_saved_place(add_avoided_place.place) is not true then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  if add_avoided_place.source_shared_place_id is not null then
    source_folder := public.shared_place_folder(add_avoided_place.source_shared_place_id);
    if source_folder is null or public.place_folder_role(source_folder, caller) is null then
      raise exception using errcode = 'P0001', message = 'SHARED_PLACE_NOT_FOUND';
    end if;
  end if;
  perform public.lock_place_user(caller);
  return query select avoided.* from public.avoided_places avoided
    where avoided.owner_id = caller and avoided.place ->> 'kakaoPlaceId' = add_avoided_place.place ->> 'kakaoPlaceId';
  if found then return; end if;
  if (select count(*) from public.avoided_places avoided where avoided.owner_id = caller) >= 200 then
    raise exception using errcode = 'P0001', message = 'AVOIDED_PLACE_LIMIT';
  end if;
  return query insert into public.avoided_places(owner_id, place, source_shared_place_id)
    values (caller, add_avoided_place.place, add_avoided_place.source_shared_place_id) returning avoided_places.*;
end;
$$;

create or replace function public.remove_avoided_place(avoided_place_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.lock_place_user(caller);
  delete from public.avoided_places avoided where avoided.owner_id = caller and avoided.id = avoided_place_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'AVOIDED_PLACE_NOT_FOUND'; end if;
end;
$$;

-- Caller rights: the member's RLS scope decides which folders are read. One JSON
-- value (not a row set) so the PostgREST max_rows limit cannot cut it silently.
create or replace function public.recommendation_shared_restaurants(min_lat double precision, max_lat double precision,
  min_lng double precision, max_lng double precision)
returns jsonb language plpgsql stable set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not public.is_active_member() then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if min_lat is null or max_lat is null or min_lng is null or max_lng is null
    or 'NaN'::double precision in (min_lat, max_lat, min_lng, max_lng)
    or 'Infinity'::double precision in (abs(min_lat), abs(max_lat), abs(min_lng), abs(max_lng))
    or min_lat > max_lat or min_lng > max_lng then
    raise exception using errcode = 'P0001', message = 'INVALID_RECOMMENDATION_REQUEST';
  end if;
  with enabled_restaurants as (
    select shared.id, shared.folder_id, shared.place, shared.alias, shared.revision, shared.created_at
    from public.shared_places shared
    where shared.kind = 'restaurant'
      and shared.folder_id in (select preference.folder_id from public.place_folder_preferences preference
        where preference.member_id = (select auth.uid()) and preference.enabled)
  ), in_bounds as (
    select candidate.* from enabled_restaurants candidate
    where (candidate.place ->> 'latitude')::double precision between min_lat and max_lat
      and (candidate.place ->> 'longitude')::double precision between min_lng and max_lng
    order by candidate.created_at, candidate.id
    limit 2001
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', bounded.id, 'folder_id', bounded.folder_id, 'place', bounded.place,
        'alias', bounded.alias, 'revision', bounded.revision, 'created_at', bounded.created_at) order by bounded.created_at, bounded.id)
      from (select * from in_bounds order by in_bounds.created_at, in_bounds.id limit 2000) bounded), '[]'::jsonb),
    'truncated', (select count(*) > 2000 from in_bounds),
    'enabledTotal', (select count(*) from enabled_restaurants),
    'disabledFolders', (select count(*) from public.place_folder_preferences preference
      where preference.member_id = (select auth.uid()) and not preference.enabled))
  into result;
  return result;
end;
$$;

-- Personal star writers (#123 bodies) now also count shared stars toward ten. Only a
-- new star raises the total; moving a hidden 6..10 star into a legacy slot does not.
-- Signatures, return shapes and error codes are unchanged.
create or replace function public.save_place(saved_place jsonb, place_alias text default null, place_kind text default 'riding_spot', starred boolean default false)
returns setof public.saved_places language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_slot smallint; created_id uuid;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if public.is_valid_saved_place(saved_place) is not true or starred is null then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  perform public.assert_saved_place_metadata(place_alias, place_kind);
  if place_alias is null and public.is_region_saved_place(saved_place) then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE_METADATA'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  return query select saved.* from public.saved_places saved where saved.owner_id = caller and saved.place ->> 'kakaoPlaceId' = saved_place ->> 'kakaoPlaceId';
  if found then return; end if;
  if (select count(*) from public.saved_places saved where saved.owner_id = caller) >= 1000 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_LIMIT'; end if;
  if starred then
    -- Older clients only understand 1..5.
    select candidate::smallint into target_slot from pg_catalog.generate_series(1, 5) candidate
    where not exists (select 1 from public.place_stars star where star.owner_id = caller and star.slot = candidate) order by candidate limit 1;
    if target_slot is null or public.place_star_total(caller) >= 10 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
  end if;
  insert into public.saved_places(owner_id, place, alias, kind, province)
    values (caller, saved_place, place_alias, place_kind, public.saved_place_province(saved_place ->> 'address'))
    returning saved_places.id into created_id;
  if target_slot is not null then
    insert into public.place_stars(owner_id, slot, saved_place_id) values (caller, target_slot, created_id);
  end if;
  return query select saved.* from public.saved_places saved where saved.owner_id = caller and saved.id = created_id;
end;
$$;

create or replace function public.save_place_v2(saved_place jsonb, place_alias text default null, place_kind text default 'riding_spot', starred boolean default false)
returns setof public.saved_place_entries language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_slot smallint; target_id uuid;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if public.is_valid_saved_place(saved_place) is not true or starred is null then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  perform public.assert_saved_place_metadata(place_alias, place_kind);
  if place_alias is null and public.is_region_saved_place(saved_place) then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE_METADATA'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.id into target_id from public.saved_places saved where saved.owner_id = caller and saved.place ->> 'kakaoPlaceId' = saved_place ->> 'kakaoPlaceId';
  if target_id is null then
    if (select count(*) from public.saved_places saved where saved.owner_id = caller) >= 1000 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_LIMIT'; end if;
    if starred then
      select candidate::smallint into target_slot from pg_catalog.generate_series(1, 10) candidate
      where not exists (select 1 from public.place_stars star where star.owner_id = caller and star.slot = candidate) order by candidate limit 1;
      if target_slot is null or public.place_star_total(caller) >= 10 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
    end if;
    insert into public.saved_places(owner_id, place, alias, kind, province)
      values (caller, saved_place, place_alias, place_kind, public.saved_place_province(saved_place ->> 'address'))
      returning saved_places.id into target_id;
    if target_slot is not null then
      insert into public.place_stars(owner_id, slot, saved_place_id) values (caller, target_slot, target_id);
    end if;
  end if;
  return query select entry.* from public.saved_place_entries entry where entry.owner_id = caller and entry.id = target_id;
end;
$$;

create or replace function public.set_place_star(saved_place_id uuid, expected_revision bigint, starred boolean)
returns setof public.saved_place_entries language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_revision bigint; current_slot smallint; target_slot smallint; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if starred is null then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.revision into current_revision from public.saved_places saved where saved.owner_id = caller and saved.id = set_place_star.saved_place_id;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND'; end if;
  if expected_revision is null or current_revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
  select star.slot into current_slot from public.place_stars star where star.owner_id = caller and star.saved_place_id = set_place_star.saved_place_id;
  if starred <> (current_slot is not null) then
    if starred then
      select candidate::smallint into target_slot from pg_catalog.generate_series(1, 10) candidate
      where not exists (select 1 from public.place_stars star where star.owner_id = caller and star.slot = candidate) order by candidate limit 1;
      if target_slot is null or public.place_star_total(caller) >= 10 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
      insert into public.place_stars(owner_id, slot, saved_place_id) values (caller, target_slot, set_place_star.saved_place_id);
    else
      delete from public.place_stars star where star.owner_id = caller and star.saved_place_id = set_place_star.saved_place_id;
    end if;
    update public.saved_places saved set revision = saved.revision + 1, updated_at = clock_timestamp()
      where saved.owner_id = caller and saved.id = set_place_star.saved_place_id and saved.revision = expected_revision;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
  end if;
  return query select entry.* from public.saved_place_entries entry where entry.owner_id = caller and entry.id = set_place_star.saved_place_id;
end;
$$;

create or replace function public.set_saved_place_star(saved_place_id uuid, expected_revision bigint, starred boolean)
returns setof public.saved_places language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_place public.saved_places; current_slot smallint; target_slot smallint;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if starred is null then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.* into current_place from public.saved_places saved where saved.owner_id = caller and saved.id = set_saved_place_star.saved_place_id;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND'; end if;
  if expected_revision is null or current_place.revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
  select star.slot into current_slot from public.place_stars star where star.owner_id = caller and star.saved_place_id = current_place.id;
  if starred = (current_slot is not null and current_slot <= 5) then return next current_place; return; end if;
  if starred then
    select candidate::smallint into target_slot from pg_catalog.generate_series(1, 5) candidate
    where not exists (select 1 from public.place_stars star where star.owner_id = caller and star.slot = candidate) order by candidate limit 1;
    if target_slot is null or (current_slot is null and public.place_star_total(caller) >= 10) then
      raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT';
    end if;
    if current_slot is null then
      insert into public.place_stars(owner_id, slot, saved_place_id) values (caller, target_slot, current_place.id);
    else
      update public.place_stars star set slot = target_slot where star.owner_id = caller and star.saved_place_id = current_place.id;
    end if;
  else
    delete from public.place_stars star where star.owner_id = caller and star.saved_place_id = current_place.id;
  end if;
  return query update public.saved_places saved set revision = saved.revision + 1, updated_at = clock_timestamp()
    where saved.owner_id = caller and saved.id = current_place.id and saved.revision = expected_revision returning saved.*;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
end;
$$;

create or replace function public.add_place_favorite(favorite_place jsonb)
returns table(slot smallint, place jsonb, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_place public.saved_places; current_slot smallint; target_slot smallint;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if public.is_valid_saved_place(favorite_place) is not true then raise exception using errcode = 'P0001', message = 'INVALID_FAVORITE_PLACE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.* into current_place from public.saved_places saved where saved.owner_id = caller and saved.place ->> 'kakaoPlaceId' = favorite_place ->> 'kakaoPlaceId';
  if current_place.id is not null then
    select star.slot into current_slot from public.place_stars star where star.owner_id = caller and star.saved_place_id = current_place.id;
    if current_slot between 1 and 3 then return query select current_slot, current_place.place, current_place.created_at; return; end if;
    if current_slot between 4 and 5 then raise exception using errcode = 'P0001', message = 'FAVORITE_LIMIT'; end if;
  elsif public.is_region_saved_place(favorite_place) then
    -- A new row from this RPC would have no alias.
    raise exception using errcode = 'P0001', message = 'INVALID_FAVORITE_PLACE';
  end if;
  select candidate::smallint into target_slot from pg_catalog.generate_series(1, 3) candidate
  where not exists (select 1 from public.place_stars star where star.owner_id = caller and star.slot = candidate) order by candidate limit 1;
  if target_slot is null or (current_slot is null and public.place_star_total(caller) >= 10) then
    raise exception using errcode = 'P0001', message = 'FAVORITE_LIMIT';
  end if;
  if current_place.id is null then
    if (select count(*) from public.saved_places saved where saved.owner_id = caller) >= 1000 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_LIMIT'; end if;
    insert into public.saved_places(owner_id, place, province)
      values (caller, favorite_place, public.saved_place_province(favorite_place ->> 'address'))
      returning saved_places.id into current_place.id;
    insert into public.place_stars(owner_id, slot, saved_place_id) values (caller, target_slot, current_place.id);
    return query select saved.star_slot, saved.place, saved.created_at from public.saved_places saved where saved.owner_id = caller and saved.id = current_place.id;
  else
    if current_slot is null then
      insert into public.place_stars(owner_id, slot, saved_place_id) values (caller, target_slot, current_place.id);
    else
      update public.place_stars star set slot = target_slot where star.owner_id = caller and star.saved_place_id = current_place.id;
    end if;
    return query update public.saved_places saved set revision = saved.revision + 1, updated_at = clock_timestamp()
      where saved.id = current_place.id and saved.owner_id = caller and saved.revision = current_place.revision returning saved.star_slot, saved.place, saved.created_at;
    if not found then raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND'; end if;
  end if;
end;
$$;

revoke all on function public.is_place_folder_member(uuid), public.lock_place_folder(uuid,boolean), public.lock_place_user(uuid),
  public.place_folder_role(uuid,uuid), public.place_star_total(uuid), public.assert_place_folder_name(text),
  public.assert_folder_display_name(text), public.assert_place_id_list(uuid[]), public.place_folder_member_json(public.place_folder_members),
  public.place_folder_members_clear_stars(), public.place_star_total_consistent(uuid), public.place_folder_consistent(uuid),
  public.assert_place_star_total(), public.assert_place_folder_consistent(), public.place_folder_invite_hash(text),
  public.shared_place_folder(uuid),
  public.create_place_folder(text,text,uuid[],uuid), public.rename_place_folder(uuid,bigint,text), public.delete_place_folder(uuid,bigint),
  public.create_place_folder_invite(uuid), public.list_place_folder_invites(uuid), public.revoke_place_folder_invite(uuid),
  public.preview_place_folder_invite(text), public.accept_place_folder_invite(text,text),
  public.set_place_folder_display_name(uuid,bigint,text), public.set_place_folder_member_role(uuid,uuid,bigint,text),
  public.remove_place_folder_member(uuid,uuid,bigint), public.leave_place_folder(uuid), public.set_place_folders_enabled(jsonb),
  public.add_shared_place(uuid,jsonb,text,text), public.import_saved_places_to_folder(uuid,uuid[]),
  public.update_shared_place(uuid,bigint,text,text), public.delete_shared_place(uuid,bigint), public.set_shared_place_star(uuid,boolean),
  public.add_avoided_place(jsonb,uuid), public.remove_avoided_place(uuid),
  public.recommendation_shared_restaurants(double precision,double precision,double precision,double precision),
  public.save_place(jsonb,text,text,boolean), public.save_place_v2(jsonb,text,text,boolean), public.set_place_star(uuid,bigint,boolean),
  public.set_saved_place_star(uuid,bigint,boolean), public.add_place_favorite(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.is_place_folder_member(uuid),
  public.create_place_folder(text,text,uuid[],uuid), public.rename_place_folder(uuid,bigint,text), public.delete_place_folder(uuid,bigint),
  public.create_place_folder_invite(uuid), public.list_place_folder_invites(uuid), public.revoke_place_folder_invite(uuid),
  public.preview_place_folder_invite(text), public.accept_place_folder_invite(text,text),
  public.set_place_folder_display_name(uuid,bigint,text), public.set_place_folder_member_role(uuid,uuid,bigint,text),
  public.remove_place_folder_member(uuid,uuid,bigint), public.leave_place_folder(uuid), public.set_place_folders_enabled(jsonb),
  public.add_shared_place(uuid,jsonb,text,text), public.import_saved_places_to_folder(uuid,uuid[]),
  public.update_shared_place(uuid,bigint,text,text), public.delete_shared_place(uuid,bigint), public.set_shared_place_star(uuid,boolean),
  public.add_avoided_place(jsonb,uuid), public.remove_avoided_place(uuid),
  public.recommendation_shared_restaurants(double precision,double precision,double precision,double precision),
  public.save_place(jsonb,text,text,boolean), public.save_place_v2(jsonb,text,text,boolean), public.set_place_star(uuid,bigint,boolean),
  public.set_saved_place_star(uuid,bigint,boolean), public.add_place_favorite(jsonb)
  to authenticated;

-- Whole-table S1/F1 before commit; any violation rolls back the migration.
do $$
begin
  if exists (
    select 1 from (
      select star.owner_id from public.place_stars star union select star.owner_id from public.shared_place_stars star
    ) owners where not public.place_star_total_consistent(owners.owner_id)
  ) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_INVARIANT';
  end if;
  if exists (select 1 from public.place_folders folder where not public.place_folder_consistent(folder.id)) then
    raise exception using errcode = 'P0001', message = 'PLACE_FOLDER_INVARIANT';
  end if;
end;
$$;

-- Policies last and only when absent (CREATE POLICY locks auth tables until commit on
-- this image; see 20261007093000). place_folder_invites has no policy: no direct read.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.place_folders'::regclass and polname = 'members read their place folders') then
    create policy "members read their place folders" on public.place_folders
      for select to authenticated using ((select public.is_active_member()) and public.is_place_folder_member(id));
  end if;
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.place_folder_members'::regclass and polname = 'members read their folder members') then
    create policy "members read their folder members" on public.place_folder_members
      for select to authenticated using ((select public.is_active_member()) and public.is_place_folder_member(folder_id));
  end if;
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.shared_places'::regclass and polname = 'members read their shared places') then
    create policy "members read their shared places" on public.shared_places
      for select to authenticated using ((select public.is_active_member()) and public.is_place_folder_member(folder_id));
  end if;
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.place_folder_preferences'::regclass and polname = 'members read own folder preferences') then
    create policy "members read own folder preferences" on public.place_folder_preferences
      for select to authenticated using (member_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.avoided_places'::regclass and polname = 'active members read own avoided places') then
    create policy "active members read own avoided places" on public.avoided_places
      for select to authenticated using (owner_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.shared_place_stars'::regclass and polname = 'active members read own shared stars') then
    create policy "active members read own shared stars" on public.shared_place_stars
      for select to authenticated using (owner_id = (select auth.uid()) and (select public.is_active_member()));
  end if;
end;
$$;

commit;
