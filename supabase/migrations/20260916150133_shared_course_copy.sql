-- A share may expose its immutable public snapshot while keeping a separate,
-- verified course payload available only to authenticated copy workflows.
alter table public.trips add column if not exists reusable_course jsonb;
alter table public.share_links add column if not exists collection_course jsonb;

do $rename_trip_saver$
begin
  if to_regprocedure('public.save_trip_plan_without_reusable_course(jsonb,jsonb)') is null then
    alter function public.save_trip_plan(jsonb, jsonb)
      rename to save_trip_plan_without_reusable_course;
  end if;
end;
$rename_trip_saver$;

create function public.save_trip_plan(plan jsonb, routes jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  saved_trip_id uuid;
  course jsonb;
  affected_rows integer;
begin
  saved_trip_id := public.save_trip_plan_without_reusable_course(plan, routes);
  course := jsonb_build_object(
    'origin', plan -> 'origin',
    'destination', plan -> 'destination',
    'points', plan -> 'waypoints'
  );

  update public.trips
  set reusable_course = case
    when public.is_valid_verified_collection_course(course) then course
    else null
  end
  where id = saved_trip_id and user_id = auth.uid();
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then raise exception 'TRIP_WRITE_DROPPED'; end if;
  return saved_trip_id;
end;
$$;

create function public.get_shared_course(share_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  course jsonb;
begin
  if caller is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  if not public.is_active_member(caller) then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_REQUIRED'; end if;
  if share_token is null or share_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_SHARE_TOKEN';
  end if;

  select link.collection_course into course
  from public.share_links link
  where link.token_hash = encode(extensions.digest(share_token, 'sha256'), 'hex')
    and link.revoked_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'SHARE_NOT_FOUND'; end if;
  if public.is_valid_verified_collection_course(course) is not true then
    raise exception using errcode = 'P0001', message = 'SHARE_COURSE_UNAVAILABLE';
  end if;
  return course;
end;
$$;

do $rename_share_publisher$
begin
  if to_regprocedure('public.publish_trip_share_without_collection_course(uuid,text)') is null then
    alter function public.publish_trip_share(uuid, text)
      rename to publish_trip_share_without_collection_course;
  end if;
end;
$rename_share_publisher$;

create function public.publish_trip_share(target_trip_id uuid, approved_preview_token text)
returns table(share_id uuid, share_token text, published_snapshot jsonb)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  course jsonb;
  published record;
  affected_rows integer;
begin
  if current_user_id is null or not public.is_active_member(current_user_id) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;

  select * into published
  from public.publish_trip_share_without_collection_course(target_trip_id, approved_preview_token);
  if not found then raise exception 'SHARE_WRITE_DROPPED'; end if;

  -- The reviewed publisher has already locked preview grant -> trip in that
  -- order. Read the still-locked trip here; any rejection rolls back its
  -- preview consumption and share insert in this same transaction.
  select reusable_course into course
  from public.trips
  where id = target_trip_id and user_id = current_user_id;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;
  if public.is_valid_verified_collection_course(course) is not true then
    raise exception 'SHARE_COURSE_UNAVAILABLE';
  end if;

  update public.share_links
  set collection_course = course
  where id = published.share_id and owner_id = current_user_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then raise exception 'SHARE_WRITE_DROPPED'; end if;

  return query select published.share_id, published.share_token, published.published_snapshot;
end;
$$;

create function public.save_shared_collection(
  share_token text,
  save_operation_id uuid,
  collection_title text
)
returns table(collection_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  course jsonb;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_active_member(current_user_id) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
  if share_token is null or share_token !~ '^[A-Za-z0-9_-]{43}$'
     or save_operation_id is null
     or collection_title is null
     or char_length(btrim(collection_title)) not between 1 and 120 then
    raise exception 'INVALID_SAVE_REQUEST';
  end if;

  select collection_course into course
  from public.share_links
  where token_hash = encode(extensions.digest(share_token, 'sha256'), 'hex')
    and revoked_at is null
  for share;
  if not found then raise exception 'SHARE_NOT_FOUND'; end if;
  if public.is_valid_verified_collection_course(course) is not true then
    raise exception 'SHARE_COURSE_UNAVAILABLE';
  end if;

  return query
  select * from public.save_collection_version_internal(
    current_user_id,
    save_operation_id,
    null,
    btrim(collection_title),
    '',
    course
  );
end;
$$;

revoke all on function public.save_trip_plan_without_reusable_course(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.save_trip_plan(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_trip_share_without_collection_course(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_trip_share(uuid, text)
  from public, anon, service_role;
grant execute on function public.publish_trip_share(uuid, text) to authenticated;
revoke all on function public.save_shared_collection(text, uuid, text)
  from public, anon, service_role;
grant execute on function public.save_shared_collection(text, uuid, text) to authenticated;
revoke all on function public.get_shared_course(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shared_course(text) to authenticated;
