-- Keep the trusted database finalization identity aligned with the Edge and
-- browser contracts: every road vertex participates as a half-up rounded
-- integer microdegree. Drain and exclude concurrent stage/finalize writers
-- until the replacement function and backfill commit together.
begin;

lock table public.route_plan_drafts in share row exclusive mode;

create or replace function public.route_geometry_fingerprint(route jsonb)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  with vertices as (
    select leg_position, section_position, road_position, vertex_position,
      (road -> 'vertexes' ->> vertex_position)::numeric as longitude,
      (road -> 'vertexes' ->> (vertex_position + 1))::numeric as latitude
    from jsonb_array_elements(route -> 'legs') with ordinality as legs(leg, leg_position)
    cross join lateral jsonb_array_elements(leg -> 'sections') with ordinality as sections(section, section_position)
    cross join lateral jsonb_array_elements(section -> 'roads') with ordinality as roads(road, road_position)
    cross join lateral generate_series(0, jsonb_array_length(road -> 'vertexes') - 2, 2) as vertex_position
  ), ordered as (
    select *,
      lag(longitude) over (order by leg_position, section_position, road_position, vertex_position) as previous_longitude,
      lag(latitude) over (order by leg_position, section_position, road_position, vertex_position) as previous_latitude
    from vertices
  )
  select encode(extensions.digest(coalesce(string_agg(
    round(longitude * 1000000)::bigint::text || ',' || round(latitude * 1000000)::bigint::text,
    '|' order by leg_position, section_position, road_position, vertex_position
  ) filter (where previous_longitude is distinct from longitude or previous_latitude is distinct from latitude), 'empty'), 'sha256'), 'hex')
  from ordered;
$$;

update public.route_plan_drafts
set geometry_fingerprint = public.route_geometry_fingerprint(route);

revoke all on function public.route_geometry_fingerprint(jsonb) from public, anon, authenticated, service_role;

create or replace function public.delete_owned_trip(target_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_count integer;
begin
  if current_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not public.is_active_member(current_user_id) then raise exception 'MEMBERSHIP_REQUIRED'; end if;

  delete from public.trips
  where id = target_trip_id and user_id = current_user_id;
  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then raise exception 'TRIP_NOT_FOUND'; end if;
  return true;
end;
$$;

revoke all on function public.delete_owned_trip(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_owned_trip(uuid) to authenticated;

commit;
