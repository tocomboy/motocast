-- PLAN-003: limits follow waypoint meaning, never the client-controlled legacy
-- `winding` marker. Public Edge writers canonicalize that marker, while these
-- validators keep the PostgreSQL trust boundary safe for direct internal calls.

create or replace function public.is_valid_verified_collection_course(course jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(course) = 'object'
    and public.is_valid_verified_collection_place(course -> 'origin')
    and public.is_valid_verified_collection_place(course -> 'destination')
    and public.is_valid_verified_collection_points(course -> 'points')
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where (item ->> 'selected')::boolean is distinct from true
    )
    and (
      select count(*) = count(distinct (item ->> 'id'))
      from jsonb_array_elements(course -> 'points') item
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where case
        when item ->> 'kind' = 'pass-through' then
          (item ->> 'dwellMinutes')::integer <> 0
          or (item ? 'stopRole' and item -> 'stopRole' <> 'null'::jsonb)
        when item ->> 'stopRole' = 'rest' then
          item ->> 'kind' <> 'optional' or (item ->> 'dwellMinutes')::integer <= 0
        when item ->> 'stopRole' in ('lunch', 'dinner') then
          item ->> 'kind' <> 'stop' or (item ->> 'dwellMinutes')::integer <= 0
        else true
      end
      or (coalesce((item ->> 'winding')::boolean, false) and item ->> 'kind' <> 'pass-through')
    )
    and (
      select count(*) <= 1
      from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'lunch' and item ->> 'kind' = 'stop'
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'lunch' and item ->> 'kind' <> 'stop'
    )
    and (
      select count(*) <= 1
      from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'dinner'
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'dinner' and item ->> 'kind' <> 'stop'
    )
    and (
      select count(*) <= 5
      from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'rest'
    )
    and not exists (
      select 1 from jsonb_array_elements(course -> 'points') item
      where item ->> 'stopRole' = 'rest' and item ->> 'kind' <> 'optional'
    )
    and (
      select count(*) <= 20
      from jsonb_array_elements(course -> 'points') item
      where item ->> 'kind' = 'pass-through'
        and coalesce(item ->> 'stopRole', '') = ''
    ),
    false
  );
$$;

create or replace function public.is_valid_current_plan_stops(plan jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with stop_counts as (
    select
      count(*) filter (where item ->> 'stopRole' = 'lunch') as lunches,
      count(*) filter (
        where item ->> 'stopRole' = 'lunch'
          and item ->> 'id' = plan -> 'lunchStop' ->> 'id'
          and item -> 'longitude' = plan -> 'lunchStop' -> 'longitude'
          and item -> 'latitude' = plan -> 'lunchStop' -> 'latitude'
      ) as matching_lunches,
      count(*) filter (where item ->> 'stopRole' = 'dinner') as dinners,
      count(*) filter (
        where item ->> 'stopRole' = 'dinner'
          and item ->> 'id' = plan -> 'dinnerStop' ->> 'id'
          and item -> 'longitude' = plan -> 'dinnerStop' -> 'longitude'
          and item -> 'latitude' = plan -> 'dinnerStop' -> 'latitude'
      ) as matching_dinners,
      count(*) filter (where item ->> 'stopRole' = 'rest') as rests,
      count(*) filter (
        where item ->> 'kind' = 'pass-through'
          and coalesce(item ->> 'stopRole', '') = ''
      ) as mandatory_waypoints,
      count(*) as point_count,
      count(distinct item ->> 'id') as distinct_ids
    from jsonb_array_elements(plan -> 'waypoints') item
  )
  select coalesce(
    jsonb_typeof(plan) = 'object'
    and plan ? 'lunchStop'
    and (plan -> 'lunchStop' = 'null'::jsonb or public.is_valid_plan_place(plan -> 'lunchStop'))
    and plan ? 'dinnerStop'
    and (plan -> 'dinnerStop' = 'null'::jsonb or public.is_valid_plan_place(plan -> 'dinnerStop'))
    and public.is_valid_collection_points(plan -> 'waypoints')
    and not exists (
      select 1 from jsonb_array_elements(plan -> 'waypoints') item
      where (item ->> 'selected')::boolean is distinct from true
        or case
          when item ->> 'kind' = 'pass-through' then
            (item ->> 'dwellMinutes')::integer <> 0
            or (item ? 'stopRole' and item -> 'stopRole' <> 'null'::jsonb)
          when item ->> 'stopRole' in ('lunch', 'dinner') then
            item ->> 'kind' <> 'stop' or (item ->> 'dwellMinutes')::integer <= 0
          when item ->> 'stopRole' = 'rest' then
            item ->> 'kind' <> 'optional' or (item ->> 'dwellMinutes')::integer <= 0
          else true
        end
        or (coalesce((item ->> 'winding')::boolean, false) and item ->> 'kind' <> 'pass-through')
    )
    and (select point_count = distinct_ids from stop_counts)
    and (select lunches <= 1 and dinners <= 1 and rests <= 5 and mandatory_waypoints <= 20 from stop_counts)
    and (
      (plan -> 'lunchStop' = 'null'::jsonb and (select lunches = 0 from stop_counts))
      or (plan -> 'lunchStop' <> 'null'::jsonb and (select lunches = 1 and matching_lunches = 1 from stop_counts))
    )
    and (
      (plan -> 'dinnerStop' = 'null'::jsonb and (select dinners = 0 from stop_counts))
      or (plan -> 'dinnerStop' <> 'null'::jsonb and (select dinners = 1 and matching_dinners = 1 from stop_counts))
    ),
    false
  );
$$;

revoke all on function public.is_valid_verified_collection_course(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.is_valid_current_plan_stops(jsonb) from public, anon, authenticated, service_role;
