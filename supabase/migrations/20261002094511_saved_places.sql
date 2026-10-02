begin;

-- Preserve the original verified place and creation timestamp in one canonical
-- table. Older clients keep their three-slot read/RPC contract through a view.
do $$
begin
  if pg_catalog.to_regclass('public.saved_places') is null then
    alter table public.place_favorites rename to saved_places;
    alter table public.saved_places rename column slot to star_slot;
  end if;
end;
$$;

alter table public.saved_places
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists alias text,
  add column if not exists kind text not null default 'riding_spot',
  add column if not exists province text,
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();
alter table public.saved_places drop constraint if exists place_favorites_pkey;
alter table public.saved_places drop constraint if exists place_favorites_slot_check;
alter table public.saved_places alter column star_slot drop not null;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.saved_places'::regclass and conname = 'saved_places_pkey') then
    alter table public.saved_places add constraint saved_places_pkey primary key (id);
    alter table public.saved_places add constraint saved_places_star_slot_check check (star_slot between 1 and 5);
    alter table public.saved_places add constraint saved_places_kind_check check (kind in ('riding_spot', 'restaurant'));
    alter table public.saved_places add constraint saved_places_alias_check check (
      alias is null or (char_length(alias) between 1 and 80 and btrim(alias) = alias and alias !~ '[[:cntrl:]]')
    );
    alter table public.saved_places add constraint saved_places_province_check check (
      province in ('서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주')
    );
    alter table public.saved_places add constraint saved_places_revision_check check (revision > 0);
  end if;
end;
$$;

create unique index if not exists saved_places_owner_star_slot_key
  on public.saved_places(owner_id, star_slot) where star_slot is not null;
create index if not exists saved_places_owner_created_key on public.saved_places(owner_id, created_at, id);

create or replace function public.saved_place_province(original_address text)
returns text language sql immutable set search_path = '' as $$
  select case pg_catalog.split_part(pg_catalog.btrim(original_address), ' ', 1)
    when '서울' then '서울' when '서울특별시' then '서울'
    when '부산' then '부산' when '부산광역시' then '부산'
    when '대구' then '대구' when '대구광역시' then '대구'
    when '인천' then '인천' when '인천광역시' then '인천'
    when '광주' then '광주' when '광주광역시' then '광주'
    when '대전' then '대전' when '대전광역시' then '대전'
    when '울산' then '울산' when '울산광역시' then '울산'
    when '세종' then '세종' when '세종특별자치시' then '세종'
    when '경기' then '경기' when '경기도' then '경기'
    when '강원' then '강원' when '강원도' then '강원' when '강원특별자치도' then '강원'
    when '충북' then '충북' when '충청북도' then '충북'
    when '충남' then '충남' when '충청남도' then '충남'
    when '전북' then '전북' when '전라북도' then '전북' when '전북특별자치도' then '전북'
    when '전남' then '전남' when '전라남도' then '전남'
    when '경북' then '경북' when '경상북도' then '경북'
    when '경남' then '경남' when '경상남도' then '경남'
    when '제주' then '제주' when '제주도' then '제주' when '제주특별자치도' then '제주'
    else null end;
$$;

-- Region is derived only from the stored original address. No provider request
-- is made, and an unrecognized legacy address stays explicitly unknown.
update public.saved_places set province = public.saved_place_province(place ->> 'address')
where province is null and public.saved_place_province(place ->> 'address') is not null;

alter table public.saved_places enable row level security;
drop policy if exists "active members read own place favorites" on public.saved_places;
drop policy if exists "active members read own saved places" on public.saved_places;
create policy "active members read own saved places" on public.saved_places
  for select to authenticated
  using (owner_id = (select auth.uid()) and public.is_active_member());
revoke all on table public.saved_places from public, anon, authenticated, service_role;
grant select on table public.saved_places to authenticated;

create or replace view public.place_favorites with (security_invoker = true) as
  select owner_id, star_slot as slot, place, created_at
  from public.saved_places where star_slot between 1 and 3;
revoke all on table public.place_favorites from public, anon, authenticated, service_role;
grant select on table public.place_favorites to authenticated;

-- This checks the existing structural token contract, not its HMAC. Route and
-- collection Edge handlers still verify the untouched original signature.
create or replace function public.is_valid_saved_place(candidate jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' or octet_length(candidate::text) > 8192 then return false; end if;
  if not (candidate ?& array['kakaoPlaceId','verificationToken','name','address','roadAddress','longitude','latitude'])
    or candidate - array['kakaoPlaceId','verificationToken','name','address','roadAddress','longitude','latitude'] <> '{}'::jsonb
    or jsonb_typeof(candidate -> 'kakaoPlaceId') <> 'string'
    or jsonb_typeof(candidate -> 'verificationToken') <> 'string'
    or jsonb_typeof(candidate -> 'name') <> 'string'
    or jsonb_typeof(candidate -> 'address') <> 'string'
    or (candidate -> 'roadAddress' <> 'null'::jsonb and jsonb_typeof(candidate -> 'roadAddress') <> 'string')
    or jsonb_typeof(candidate -> 'longitude') <> 'number'
    or jsonb_typeof(candidate -> 'latitude') <> 'number' then return false; end if;
  if exists (
    select 1 from jsonb_each_text(candidate) entry
    where entry.key in ('kakaoPlaceId','verificationToken','name','address','roadAddress')
      and entry.value is not null and (btrim(entry.value) <> entry.value or entry.value ~ '[[:cntrl:]]')
  ) then return false; end if;
  -- Bound numeric values before the legacy double-precision validator casts.
  if (candidate ->> 'longitude')::numeric not between 124.5 and 132
    or (candidate ->> 'latitude')::numeric not between 32.8 and 38.7 then return false; end if;
  return public.is_valid_verified_collection_place(candidate) is true;
exception when numeric_value_out_of_range or invalid_text_representation then return false;
end;
$$;

create or replace function public.assert_saved_place_metadata(place_alias text, place_kind text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if place_kind is null or place_kind not in ('riding_spot','restaurant')
    or (place_alias is not null and (char_length(place_alias) not between 1 and 80 or btrim(place_alias) <> place_alias or place_alias ~ '[[:cntrl:]]')) then
    raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE_METADATA';
  end if;
end;
$$;

create or replace function public.save_place(saved_place jsonb, place_alias text default null, place_kind text default 'riding_spot', starred boolean default false)
returns setof public.saved_places language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_slot smallint;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if public.is_valid_saved_place(saved_place) is not true or starred is null then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  perform public.assert_saved_place_metadata(place_alias, place_kind);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  return query select saved.* from public.saved_places saved where saved.owner_id = caller and saved.place ->> 'kakaoPlaceId' = saved_place ->> 'kakaoPlaceId';
  if found then return; end if;
  if (select count(*) from public.saved_places saved where saved.owner_id = caller) >= 1000 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_LIMIT'; end if;
  if starred then
    select candidate::smallint into target_slot from pg_catalog.generate_series(1, 5) candidate
    where not exists (select 1 from public.saved_places saved where saved.owner_id = caller and saved.star_slot = candidate) order by candidate limit 1;
    if target_slot is null then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
  end if;
  return query insert into public.saved_places(owner_id, place, alias, kind, province, star_slot)
    values (caller, saved_place, place_alias, place_kind, public.saved_place_province(saved_place ->> 'address'), target_slot)
    returning saved_places.*;
end;
$$;

create or replace function public.update_saved_place(saved_place_id uuid, expected_revision bigint, place_alias text, place_kind text)
returns setof public.saved_places language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_revision bigint;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform public.assert_saved_place_metadata(place_alias, place_kind);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.revision into current_revision from public.saved_places saved where saved.owner_id = caller and saved.id = saved_place_id;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND'; end if;
  if expected_revision is null or current_revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
  return query update public.saved_places saved set alias = place_alias, kind = place_kind, revision = saved.revision + 1, updated_at = clock_timestamp()
    where saved.owner_id = caller and saved.id = saved_place_id and saved.revision = expected_revision returning saved.*;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
end;
$$;

create or replace function public.set_saved_place_star(saved_place_id uuid, expected_revision bigint, starred boolean)
returns setof public.saved_places language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_place public.saved_places; target_slot smallint;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if starred is null then raise exception using errcode = 'P0001', message = 'INVALID_SAVED_PLACE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.* into current_place from public.saved_places saved where saved.owner_id = caller and saved.id = saved_place_id;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND'; end if;
  if expected_revision is null or current_place.revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
  if starred = (current_place.star_slot is not null) then return next current_place; return; end if;
  if starred then
    select candidate::smallint into target_slot from pg_catalog.generate_series(1, 5) candidate
    where not exists (select 1 from public.saved_places saved where saved.owner_id = caller and saved.star_slot = candidate) order by candidate limit 1;
    if target_slot is null then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STAR_LIMIT'; end if;
  end if;
  return query update public.saved_places saved set star_slot = target_slot, revision = saved.revision + 1, updated_at = clock_timestamp()
    where saved.owner_id = caller and saved.id = saved_place_id and saved.revision = expected_revision returning saved.*;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
end;
$$;

create or replace function public.delete_saved_place(saved_place_id uuid, expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_revision bigint; affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.revision into current_revision from public.saved_places saved where saved.owner_id = caller and saved.id = saved_place_id;
  if not found then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_NOT_FOUND'; end if;
  if expected_revision is null or current_revision <> expected_revision then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
  delete from public.saved_places saved where saved.owner_id = caller and saved.id = saved_place_id and saved.revision = expected_revision;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_STALE'; end if;
end;
$$;

-- Legacy calls only allocate slots 1..3. New slots 4/5 are intentionally hidden
-- from clients whose parsers and UI reject more than three favorites.
create or replace function public.add_place_favorite(favorite_place jsonb)
returns table(slot smallint, place jsonb, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); current_place public.saved_places; target_slot smallint;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if public.is_valid_saved_place(favorite_place) is not true then raise exception using errcode = 'P0001', message = 'INVALID_FAVORITE_PLACE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  select saved.* into current_place from public.saved_places saved where saved.owner_id = caller and saved.place ->> 'kakaoPlaceId' = favorite_place ->> 'kakaoPlaceId';
  if found and current_place.star_slot is not null then
    if current_place.star_slot > 3 then raise exception using errcode = 'P0001', message = 'FAVORITE_LIMIT'; end if;
    return query select current_place.star_slot, current_place.place, current_place.created_at; return;
  end if;
  select candidate::smallint into target_slot from pg_catalog.generate_series(1, 3) candidate
  where not exists (select 1 from public.saved_places saved where saved.owner_id = caller and saved.star_slot = candidate) order by candidate limit 1;
  if target_slot is null then raise exception using errcode = 'P0001', message = 'FAVORITE_LIMIT'; end if;
  if current_place.id is null then
    if (select count(*) from public.saved_places saved where saved.owner_id = caller) >= 1000 then raise exception using errcode = 'P0001', message = 'SAVED_PLACE_LIMIT'; end if;
    return query insert into public.saved_places(owner_id, place, province, star_slot)
      values (caller, favorite_place, public.saved_place_province(favorite_place ->> 'address'), target_slot)
      returning saved_places.star_slot, saved_places.place, saved_places.created_at;
  else
    return query update public.saved_places saved set star_slot = target_slot, revision = saved.revision + 1, updated_at = clock_timestamp()
      where saved.id = current_place.id and saved.owner_id = caller and saved.revision = current_place.revision returning saved.star_slot, saved.place, saved.created_at;
    if not found then raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND'; end if;
  end if;
end;
$$;

create or replace function public.remove_place_favorite(favorite_slot smallint, expected_place_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); affected integer;
begin
  if caller is null or not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if favorite_slot is null or favorite_slot not between 1 and 3 or expected_place_id is null
    or char_length(expected_place_id) not between 1 and 80 or btrim(expected_place_id) <> expected_place_id then
    raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  update public.saved_places saved set star_slot = null, revision = saved.revision + 1, updated_at = clock_timestamp()
    where saved.owner_id = caller and saved.star_slot = favorite_slot and saved.place ->> 'kakaoPlaceId' = expected_place_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.saved_place_province(text), public.is_valid_saved_place(jsonb), public.assert_saved_place_metadata(text,text),
  public.save_place(jsonb,text,text,boolean), public.update_saved_place(uuid,bigint,text,text), public.set_saved_place_star(uuid,bigint,boolean),
  public.delete_saved_place(uuid,bigint), public.add_place_favorite(jsonb), public.remove_place_favorite(smallint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_place(jsonb,text,text,boolean), public.update_saved_place(uuid,bigint,text,text),
  public.set_saved_place_star(uuid,bigint,boolean), public.delete_saved_place(uuid,bigint), public.add_place_favorite(jsonb),
  public.remove_place_favorite(smallint,text) to authenticated;

commit;
