-- New shares expose the selected route's computed returnAt instead of removed
-- user-entered desired/hard return fields. Existing snapshots remain immutable.
create or replace function public.build_trip_share_snapshot(target_trip_id uuid, target_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  trip_record public.trips%rowtype;
  snapshot jsonb;
begin
  select * into trip_record from public.trips
  where id = target_trip_id and user_id = target_owner_id;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;

  select jsonb_build_object(
    'schemaVersion', 2,
    'trip', jsonb_build_object(
      'title', trip_record.title,
      'serviceDate', trip_record.service_date,
      'departureAt', trip_record.departure_at,
      'origin', public.share_place(trip_record.origin),
      'destination', public.share_place(trip_record.destination),
      'lunchStop', public.share_place(trip_record.lunch_stop),
      'dinnerStop', case when trip_record.dinner_stop is null then null else public.share_place(trip_record.dinner_stop) end,
      'selectedProfile', trip_record.selected_profile
    ),
    'waypoints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'waypoint-' || w.position::text,
        'position', w.position,
        'kind', replace(w.kind::text, '_', '-'),
        'label', w.label,
        'longitude', extensions.st_x(w.point::extensions.geometry),
        'latitude', extensions.st_y(w.point::extensions.geometry),
        'dwellMinutes', w.dwell_minutes,
        'selected', w.is_selected,
        'winding', w.is_winding
      ) order by w.position)
      from public.trip_waypoints w where w.trip_id = trip_record.id
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile', r.profile,
        'route', public.share_route(r.summary)
      ) order by case r.profile when 'balanced' then 1 when 'winding' then 2 else 3 end)
      from public.route_cache r where r.trip_id = trip_record.id
    ), '[]'::jsonb),
    'weather', (
      select jsonb_build_object(
        'source', w.source,
        'issuedAt', w.issued_at,
        'retrievedAt', w.created_at,
        'validUntil', w.valid_until,
        'stale', w.stale_observed_at is not null,
        'staleObservedAt', w.stale_observed_at,
        'staleReason', w.stale_reason,
        'failureKind', w.stale_failure_kind,
        'candidateProfile', w.candidate_profile,
        'segments', public.share_weather_segments(w.segments)
      )
      from public.weather_snapshots w
      join public.route_cache r on r.trip_id = w.trip_id and r.profile = w.candidate_profile
      where w.trip_id = trip_record.id
        and w.candidate_profile = trip_record.selected_profile
        and (
          select jsonb_agg(jsonb_build_object(
            'id', r.profile || '-' || (position - 1)::text,
            'longitude', leg -> 'to' -> 'longitude',
            'latitude', leg -> 'to' -> 'latitude',
            'eta', leg ->> 'arrivalAt'
          ) order by position)
          from jsonb_array_elements(r.summary -> 'legs') with ordinality as route_leg(leg, position)
        ) = (
          select jsonb_agg(jsonb_build_object(
            'id', segment ->> 'id',
            'longitude', segment -> 'longitude',
            'latitude', segment -> 'latitude',
            'eta', segment ->> 'eta'
          ) order by position)
          from jsonb_array_elements(w.segments) with ordinality as weather_segment(segment, position)
        )
      order by w.created_at desc limit 1
    )
  ) into snapshot;
  return snapshot;
end;
$$;

revoke all on function public.build_trip_share_snapshot(uuid, uuid) from public, anon, authenticated, service_role;
