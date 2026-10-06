begin;

-- Fail and roll back instead of queueing: a lock wait of more than 5 s means a long
-- writer or auth transaction is in flight (normal RPCs finish in milliseconds), and a
-- queued exclusive request would stall every later reader and sign-in behind it. No
-- statement here should take more than a second on the current data, so 60 s bounds
-- how long the locks can be held by a runaway statement.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Stars move to their own table so new clients can hold ten while saved_places.star_slot
-- stays a 1..5 mirror for older clients. The lock waits for in-flight saved-place
-- writers and holds new ones until commit. No statement below takes a stronger lock
-- on saved_places, so plain SELECTs are not blocked and an old-body RPC that already
-- resolved its body still reaches its UPDATE after commit, reconciled by the triggers.
lock table public.saved_places in share row exclusive mode;

create unique index if not exists saved_places_owner_id_id_key on public.saved_places(owner_id, id);

create table if not exists public.place_stars (
  owner_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null constraint place_stars_slot_check check (slot between 1 and 10),
  saved_place_id uuid not null,
  created_at timestamptz not null default now(),
  constraint place_stars_pkey primary key (owner_id, slot),
  constraint place_stars_owner_place_key unique (owner_id, saved_place_id),
  -- The composite key keeps every star on a place of the same owner.
  constraint place_stars_saved_place_fkey foreign key (owner_id, saved_place_id)
    references public.saved_places(owner_id, id) on delete cascade
);

alter table public.place_stars enable row level security;
revoke all on table public.place_stars from public, anon, authenticated, service_role;
grant select on table public.place_stars to authenticated;

-- I1/I2 for one owner: at most ten stars, each on an own place, and star_slot equals
-- the star when it is 1..5 and is null otherwise. Definer rights keep the result
-- independent of the role that happens to be active at commit (for example the
-- auth admin deleting a user).
create or replace function public.place_stars_consistent(target_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.place_stars star where star.owner_id = target_owner) <= 10
    and not exists (
      select 1 from public.place_stars star
      left join public.saved_places saved on saved.id = star.saved_place_id
      where star.owner_id = target_owner
        and (saved.id is null or saved.owner_id <> star.owner_id
          or saved.star_slot is distinct from (case when star.slot <= 5 then star.slot end)))
    and not exists (
      select 1 from public.saved_places saved
      where saved.owner_id = target_owner and saved.star_slot is not null
        and not exists (
          select 1 from public.place_stars star
          where star.owner_id = saved.owner_id and star.saved_place_id = saved.id and star.slot = saved.star_slot));
$$;

-- place_stars -> mirror. State based: the mirror of each touched place is set from
-- its current star, so a move, delete or cascade never needs a recursion guard.
create or replace function public.place_stars_sync_mirror()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.saved_places saved
      set star_slot = (select star.slot from public.place_stars star
        where star.owner_id = saved.owner_id and star.saved_place_id = saved.id and star.slot <= 5)
      where saved.owner_id = old.owner_id and saved.id = old.saved_place_id
        and saved.star_slot is distinct from (select star.slot from public.place_stars star
          where star.owner_id = saved.owner_id and star.saved_place_id = saved.id and star.slot <= 5);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.saved_places saved
      set star_slot = case when new.slot <= 5 then new.slot end
      where saved.owner_id = new.owner_id and saved.id = new.saved_place_id
        and saved.star_slot is distinct from (case when new.slot <= 5 then new.slot end);
  end if;
  return null;
end;
$$;

-- mirror -> place_stars, for any writer that still sets star_slot directly (an old
-- RPC body that waited on the migration lock). A mirror write made by the trigger
-- above already matches place_stars and therefore changes nothing here.
create or replace function public.saved_places_sync_stars()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_slot smallint;
begin
  select star.slot into current_slot from public.place_stars star
    where star.owner_id = new.owner_id and star.saved_place_id = new.id;
  if new.star_slot is null then
    -- Only a visible 1..5 star is cleared; a hidden 6..10 star survives.
    if current_slot <= 5 then
      delete from public.place_stars star where star.owner_id = new.owner_id and star.saved_place_id = new.id and star.slot = current_slot;
    end if;
    return null;
  end if;
  if current_slot = new.star_slot then return null; end if;
  if exists (select 1 from public.place_stars star where star.owner_id = new.owner_id and star.slot = new.star_slot) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_CONFLICT';
  end if;
  if current_slot is null then
    insert into public.place_stars(owner_id, slot, saved_place_id) values (new.owner_id, new.star_slot, new.id);
  else
    update public.place_stars star set slot = new.star_slot
      where star.owner_id = new.owner_id and star.saved_place_id = new.id;
  end if;
  return null;
end;
$$;

create or replace function public.assert_place_stars_consistent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and not public.place_stars_consistent(old.owner_id) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_INVARIANT';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not public.place_stars_consistent(new.owner_id) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_INVARIANT';
  end if;
  return null;
end;
$$;

-- Names order the synchronizing triggers before the checks when constraints are
-- switched to IMMEDIATE; by default the checks are deferred to commit. CREATE TRIGGER
-- needs only the SHARE ROW EXCLUSIVE lock already held; a rerun keeps the existing ones.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_stars'::regclass and tgname = 'place_stars_a_sync_mirror') then
    create trigger place_stars_a_sync_mirror after insert or update or delete on public.place_stars
      for each row execute function public.place_stars_sync_mirror();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.saved_places'::regclass and tgname = 'saved_places_a_sync_stars_insert') then
    create trigger saved_places_a_sync_stars_insert after insert on public.saved_places
      for each row when (new.star_slot is not null) execute function public.saved_places_sync_stars();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.saved_places'::regclass and tgname = 'saved_places_a_sync_stars_update') then
    create trigger saved_places_a_sync_stars_update after update of star_slot on public.saved_places
      for each row when (old.star_slot is distinct from new.star_slot) execute function public.saved_places_sync_stars();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.place_stars'::regclass and tgname = 'place_stars_z_check_invariants') then
    create constraint trigger place_stars_z_check_invariants after insert or update or delete on public.place_stars
      deferrable initially deferred for each row execute function public.assert_place_stars_consistent();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.saved_places'::regclass and tgname = 'saved_places_z_check_star_invariants') then
    create constraint trigger saved_places_z_check_star_invariants after insert or update of star_slot, owner_id on public.saved_places
      deferrable initially deferred for each row execute function public.assert_place_stars_consistent();
  end if;
end;
$$;

-- Existing stars keep their slot; a rerun (including one after 6..10 stars exist)
-- inserts nothing because every mirrored star is already present.
insert into public.place_stars(owner_id, slot, saved_place_id, created_at)
  select saved.owner_id, saved.star_slot, saved.id, saved.created_at
  from public.saved_places saved where saved.star_slot is not null
  on conflict do nothing;

-- One statement reads places, stars and revisions from the same snapshot.
create or replace view public.saved_place_entries with (security_invoker = true) as
  select saved.owner_id, saved.star_slot, saved.place, saved.created_at, saved.id, saved.alias, saved.kind,
    saved.province, saved.revision, saved.updated_at, star.slot as star_position
  from public.saved_places saved
  left join public.place_stars star on star.owner_id = saved.owner_id and star.saved_place_id = saved.id;
revoke all on table public.saved_place_entries from public, anon, authenticated, service_role;
grant select on table public.saved_place_entries to authenticated;

-- A map point without an address is identified by its id suffix and must carry the
-- rider's alias, because its generated name only describes the surrounding area.
create or replace function public.is_region_saved_place(candidate jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(candidate ->> 'kakaoPlaceId', '') like '%:region';
$$;

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
    if target_slot is null then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
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
      if target_slot is null then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
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

create or replace function public.update_saved_place(saved_place_id uuid, expected_revision bigint, place_alias text, place_kind text)
returns setof public.saved_places language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_place public.saved_places;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.assert_saved_place_metadata(place_alias, place_kind);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.* into current_place from public.saved_places saved where saved.owner_id = caller and saved.id = update_saved_place.saved_place_id;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND'; end if;
  if expected_revision is null or current_place.revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
  if place_alias is null and public.is_region_saved_place(current_place.place) then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE_METADATA'; end if;
  return query update public.saved_places saved set alias = place_alias, kind = place_kind, revision = saved.revision + 1, updated_at = clock_timestamp()
    where saved.owner_id = caller and saved.id = update_saved_place.saved_place_id and saved.revision = expected_revision returning saved.*;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
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
      if target_slot is null then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
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

-- Older clients see only the 1..5 mirror: a hidden 6..10 star reads as unstarred,
-- starring it moves it into 1..5, and unstarring it is a no-op that keeps it.
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
    if target_slot is null then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
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

-- The three-slot client sees only stars 1..3; 4..5 keep their existing limit error
-- and a hidden 6..10 star is moved into 1..3 like an unstarred place.
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
  if target_slot is null then raise exception using errcode = 'P0001', message = 'FAVORITE_LIMIT'; end if;
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

create or replace function public.remove_place_favorite(favorite_slot smallint, expected_place_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_id uuid; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if favorite_slot is null or favorite_slot not between 1 and 3 or expected_place_id is null
    or char_length(expected_place_id) not between 1 and 80 or btrim(expected_place_id) <> expected_place_id then
    raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.id into target_id from public.place_stars star
    join public.saved_places saved on saved.owner_id = star.owner_id and saved.id = star.saved_place_id
    where star.owner_id = caller and star.slot = favorite_slot and saved.place ->> 'kakaoPlaceId' = expected_place_id;
  if target_id is null then raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND'; end if;
  delete from public.place_stars star where star.owner_id = caller and star.saved_place_id = target_id;
  update public.saved_places saved set revision = saved.revision + 1, updated_at = clock_timestamp()
    where saved.owner_id = caller and saved.id = target_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.place_stars_consistent(uuid), public.place_stars_sync_mirror(), public.saved_places_sync_stars(),
  public.assert_place_stars_consistent(), public.is_region_saved_place(jsonb),
  public.save_place(jsonb,text,text,boolean), public.save_place_v2(jsonb,text,text,boolean), public.update_saved_place(uuid,bigint,text,text),
  public.set_place_star(uuid,bigint,boolean), public.set_saved_place_star(uuid,bigint,boolean),
  public.add_place_favorite(jsonb), public.remove_place_favorite(smallint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_place(jsonb,text,text,boolean), public.save_place_v2(jsonb,text,text,boolean),
  public.update_saved_place(uuid,bigint,text,text), public.set_place_star(uuid,bigint,boolean),
  public.set_saved_place_star(uuid,bigint,boolean), public.add_place_favorite(jsonb), public.remove_place_favorite(smallint,text)
  to authenticated;

-- Whole-table I1/I2 before commit; any violation rolls back the migration.
do $$
begin
  if exists (
    select 1 from (
      select star.owner_id from public.place_stars star
      union select saved.owner_id from public.saved_places saved where saved.star_slot is not null
    ) owners where not public.place_stars_consistent(owners.owner_id)
  ) then
    raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_INVARIANT';
  end if;
end;
$$;

-- Created last and only when absent. On this Postgres image CREATE POLICY holds ACCESS
-- EXCLUSIVE locks on the auth tables until commit (supautils allowlist locking), so
-- nothing but COMMIT follows it; a rerun skips it. DROP POLICY/TRIGGER are never used
-- because they take ACCESS EXCLUSIVE locks as well.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.place_stars'::regclass and polname = 'active members read own place stars') then
    create policy "active members read own place stars" on public.place_stars
      for select to authenticated
      using (owner_id = (select auth.uid()) and public.is_active_member());
  end if;
end;
$$;

commit;
