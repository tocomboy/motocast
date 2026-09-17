begin;

create table public.place_favorites (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  place jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, slot)
);

create unique index place_favorites_owner_kakao_place_id_key
  on public.place_favorites(owner_id, (place ->> 'kakaoPlaceId'));

alter table public.place_favorites enable row level security;

create policy "active members read own place favorites"
  on public.place_favorites
  for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.is_active_member());

revoke all on table public.place_favorites from public, anon, authenticated, service_role;
grant select on table public.place_favorites to authenticated;

create or replace function public.add_place_favorite(favorite_place jsonb)
returns table(slot smallint, place jsonb, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_place jsonb;
  target_slot smallint;
begin
  if caller is null or not public.is_active_member(caller) then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED';
  end if;
  if favorite_place is null
     or jsonb_typeof(favorite_place) <> 'object'
     or octet_length(favorite_place::text) > 8192 then
    raise exception using errcode = 'P0001', message = 'INVALID_FAVORITE_PLACE';
  end if;
  if not (favorite_place ?& array['kakaoPlaceId','verificationToken','name','address','roadAddress','longitude','latitude'])
     or favorite_place - array['kakaoPlaceId','verificationToken','name','address','roadAddress','longitude','latitude'] <> '{}'::jsonb
     or jsonb_typeof(favorite_place -> 'kakaoPlaceId') <> 'string'
     or jsonb_typeof(favorite_place -> 'verificationToken') <> 'string'
     or jsonb_typeof(favorite_place -> 'name') <> 'string'
     or jsonb_typeof(favorite_place -> 'address') <> 'string'
     or (favorite_place -> 'roadAddress' <> 'null'::jsonb and jsonb_typeof(favorite_place -> 'roadAddress') <> 'string')
     or btrim(favorite_place ->> 'kakaoPlaceId') <> favorite_place ->> 'kakaoPlaceId'
     or btrim(favorite_place ->> 'verificationToken') <> favorite_place ->> 'verificationToken'
     or btrim(favorite_place ->> 'name') <> favorite_place ->> 'name'
     or btrim(favorite_place ->> 'address') <> favorite_place ->> 'address'
     or (favorite_place -> 'roadAddress' <> 'null'::jsonb and btrim(favorite_place ->> 'roadAddress') <> favorite_place ->> 'roadAddress')
     or public.is_valid_verified_collection_place(favorite_place) is not true then
    raise exception using errcode = 'P0001', message = 'INVALID_FAVORITE_PLACE';
  end if;

  normalized_place := jsonb_build_object(
    'kakaoPlaceId', favorite_place -> 'kakaoPlaceId',
    'verificationToken', favorite_place -> 'verificationToken',
    'name', favorite_place -> 'name',
    'address', favorite_place -> 'address',
    'roadAddress', favorite_place -> 'roadAddress',
    'longitude', favorite_place -> 'longitude',
    'latitude', favorite_place -> 'latitude'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));

  return query
    select favorite.slot, favorite.place, favorite.created_at
    from public.place_favorites favorite
    where favorite.owner_id = caller
      and favorite.place ->> 'kakaoPlaceId' = normalized_place ->> 'kakaoPlaceId';
  if found then return; end if;

  select candidate::smallint into target_slot
  from pg_catalog.generate_series(1, 3) candidate
  where not exists (
    select 1 from public.place_favorites favorite
    where favorite.owner_id = caller and favorite.slot = candidate
  )
  order by candidate
  limit 1;

  if target_slot is null then
    raise exception using errcode = 'P0001', message = 'FAVORITE_LIMIT';
  end if;

  return query
    insert into public.place_favorites(owner_id, slot, place)
    values (caller, target_slot, normalized_place)
    returning place_favorites.slot, place_favorites.place, place_favorites.created_at;
end;
$$;

create or replace function public.remove_place_favorite(favorite_slot smallint, expected_place_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  affected integer;
begin
  if caller is null or not public.is_active_member(caller) then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED';
  end if;
  if favorite_slot is null or favorite_slot not between 1 and 3
     or expected_place_id is null
     or char_length(expected_place_id) not between 1 and 80
     or btrim(expected_place_id) <> expected_place_id then
    raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place-favorites:' || caller::text, 0));
  delete from public.place_favorites favorite
  where favorite.owner_id = caller
    and favorite.slot = favorite_slot
    and favorite.place ->> 'kakaoPlaceId' = expected_place_id;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception using errcode = 'P0001', message = 'FAVORITE_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.add_place_favorite(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.remove_place_favorite(smallint, text) from public, anon, authenticated, service_role;
grant execute on function public.add_place_favorite(jsonb) to authenticated;
grant execute on function public.remove_place_favorite(smallint, text) to authenticated;

commit;
