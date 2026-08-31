-- Keep the trusted database finalization identity aligned with the Edge and
-- browser contracts: every road vertex participates as a half-up rounded
-- integer microdegree. Finalization below re-hashes its locked route JSON, so a
-- draft staged across this deployment can never make an older cached hash
-- authoritative.
begin;

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

revoke all on function public.route_geometry_fingerprint(jsonb) from public, anon, authenticated, service_role;

create or replace function public.finalize_trip_plan(
  target_planning_id uuid,
  target_trip_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  staged_plan jsonb;
  staged_routes jsonb;
  draft_count integer;
  plan_count integer;
  fingerprint_count integer;
  saved_trip_id uuid;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;

  -- Establish the write lock before row locks so any future stronger migration
  -- lock cannot form a table-lock upgrade cycle with finalization.
  lock table public.route_plan_drafts in row exclusive mode;
  perform 1 from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id
  for update;

  select count(*), count(distinct plan::text),
    count(distinct public.route_geometry_fingerprint(route)), min(plan::text)::jsonb
  into draft_count, plan_count, fingerprint_count, staged_plan
  from public.route_plan_drafts
  where owner_id = current_user_id
    and planning_id = target_planning_id
    and created_at >= now() - interval '10 minutes';

  if draft_count <> 3 or plan_count <> 1 or fingerprint_count <> 3 then
    raise exception 'ROUTE_PLAN_NOT_READY';
  end if;

  select jsonb_agg(route order by case candidate_profile
    when 'balanced' then 1 when 'winding' then 2 else 3 end)
  into staged_routes
  from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id;

  staged_plan := case
    when target_trip_id is null then staged_plan - 'tripId'
    else jsonb_set(staged_plan, '{tripId}', to_jsonb(target_trip_id), true)
  end;
  saved_trip_id := public.save_trip_plan(staged_plan, staged_routes);

  delete from public.route_plan_drafts
  where owner_id = current_user_id and planning_id = target_planning_id;
  return saved_trip_id;
end;
$$;

revoke all on function public.finalize_trip_plan(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalize_trip_plan(uuid, uuid) to authenticated;

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
