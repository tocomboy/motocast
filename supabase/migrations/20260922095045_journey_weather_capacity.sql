-- Admission limits only: no provider quota increase, feature enablement or schedule change.
alter table public.weather_budget_policy
  add column max_cache_rows integer not null default 10000 check (max_cache_rows between 1 and 10000),
  add column max_attempt_rows integer not null default 10000 check (max_attempt_rows between 1 and 10000),
  add column max_payload_bytes bigint not null default 67108864 check (max_payload_bytes between 1 and 67108864),
  add column max_relation_bytes bigint not null default 134217728 check (max_relation_bytes between 1 and 134217728),
  add column max_database_bytes bigint not null default 250000000 check (max_database_bytes between 1 and 250000000);

-- Stored size avoids repeatedly decompressing every cached forecast during admission.
alter table public.weather_fetch_cache add column storage_bytes bigint generated always as (
  case when state='ready' then octet_length(items::text)::bigint
       when state='fetching' then coalesce(response_bytes,0)::bigint else 0::bigint end
) stored;

-- Owner-only helper, called inside service RPCs. Global lock precedes all row locks.
-- Physical sizes are conservative admission cutoffs, not a global disk/WAL ceiling.
create function public.assert_weather_capacity_internal(cache_rows integer, attempt_rows integer, payload_bytes bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  policy public.weather_budget_policy%rowtype;
  cache_count bigint;
  payload_count bigint;
begin
  if cache_rows is null or attempt_rows is null or payload_bytes is null
    or cache_rows < 0 or attempt_rows < 0 or payload_bytes < 0 then
    raise exception 'INVALID_WEATHER_CAPACITY';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(724010,1);
  select * into policy from public.weather_budget_policy where singleton for share;
  if not found then raise exception 'API_BUDGET_NOT_CONFIGURED'; end if;
  select count(*),coalesce(sum(storage_bytes),0) into cache_count,payload_count from public.weather_fetch_cache;
  if (cache_rows > 0 and cache_count+cache_rows > policy.max_cache_rows)
    or (attempt_rows > 0 and (select count(*) from public.weather_fetch_attempts)+attempt_rows > policy.max_attempt_rows)
    or (payload_bytes > 0 and payload_count+payload_bytes > policy.max_payload_bytes)
    or pg_catalog.pg_total_relation_size('public.weather_fetch_cache'::regclass)
       +pg_catalog.pg_total_relation_size('public.weather_fetch_attempts'::regclass) >= policy.max_relation_bytes
    or pg_catalog.pg_database_size(current_database()) >= policy.max_database_bytes then
    raise exception 'WEATHER_STORAGE_CAPACITY';
  end if;
end;
$$;
revoke all on function public.assert_weather_capacity_internal(integer,integer,bigint) from public,anon,authenticated,service_role;

create or replace function public.claim_weather_fetch_internal(
  member_id uuid, target_model text, target_nx integer, target_ny integer,
  target_date text, target_time text, claim_token uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  row_data public.weather_fetch_cache%rowtype;
  moment timestamptz;
begin
  if member_id is null or not exists(select 1 from public.memberships where user_id=member_id and revoked_at is null) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
  if claim_token is null or target_model is null or target_model not in ('ultra','short')
    or target_nx is null or target_nx not between 1 and 149 or target_ny is null or target_ny not between 1 and 253
    or target_date is null or target_date !~ '^[0-9]{8}$'
    or target_time is null or target_time !~ '^([01][0-9]|2[0-3])[0-5][0-9]$' then
    raise exception 'INVALID_WEATHER_KEY';
  end if;
  if to_char(to_date(target_date,'YYYYMMDD'),'YYYYMMDD') <> target_date then raise exception 'INVALID_WEATHER_KEY'; end if;
  -- Admission closes before the retention deletion horizon. Never resurrect an old key.
  if target_date < to_char((timezone('Asia/Seoul',clock_timestamp()))::date-1,'YYYYMMDD')
     or target_date > to_char((timezone('Asia/Seoul',clock_timestamp()))::date,'YYYYMMDD') then
    return jsonb_build_object('status','superseded');
  end if;
  if not exists(select 1 from public.weather_budget_policy where singleton) then raise exception 'API_BUDGET_NOT_CONFIGURED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(724010,1);
  if not exists(select 1 from public.weather_fetch_cache
    where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time)) then
    perform public.assert_weather_capacity_internal(1,0,0);
  end if;
  insert into public.weather_fetch_cache(model,nx,ny,base_date,base_time,state,generation,token,lease_until,retry_after)
  values(target_model,target_nx,target_ny,target_date,target_time,'claimed',1,claim_token,clock_timestamp()+interval '30 seconds',clock_timestamp())
  on conflict do nothing;
  select * into row_data from public.weather_fetch_cache
  where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time) for update;
  moment := clock_timestamp();
  if row_data.state='ready' and row_data.expires_at>moment then
    return jsonb_build_object('status','hit','items',row_data.items,'fetchedAt',row_data.fetched_at,'expiresAt',row_data.expires_at);
  end if;
  if row_data.state='claimed' and row_data.token=claim_token and row_data.lease_until>moment then
    return jsonb_build_object('status','owner','generation',row_data.generation,'leaseUntil',row_data.lease_until);
  end if;
  if (row_data.state='claimed' and row_data.lease_until>moment)
    or (row_data.state in ('fetching','failed') and row_data.retry_after>moment) then
    return jsonb_build_object('status','wait','retryAt',case when row_data.state='claimed' then row_data.lease_until else row_data.retry_after end);
  end if;
  -- Same token cannot acquire another generation, including after an uncertain start.
  if row_data.token=claim_token then return jsonb_build_object('status','superseded'); end if;
  update public.weather_fetch_cache set state='claimed',generation=generation+1,token=claim_token,
    lease_until=moment+interval '30 seconds',retry_after=moment,items=null,expires_at=null,fetched_at=null,
    reserved_day=null,response_bytes=null,actual_bytes=null,failure_code=null
  where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time)
  returning * into row_data;
  return jsonb_build_object('status','owner','generation',row_data.generation,'leaseUntil',row_data.lease_until);
end;
$$;

create or replace function public.start_weather_fetch_internal(
  member_id uuid, target_model text, target_nx integer, target_ny integer,
  target_date text, target_time text, claim_token uuid, expected_generation bigint, configured_limit integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  row_data public.weather_fetch_cache%rowtype;
  policy public.weather_budget_policy%rowtype;
  request_number integer;
  moment timestamptz;
begin
  if member_id is null or not exists(select 1 from public.memberships where user_id=member_id and revoked_at is null) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(724010,1);
  select * into row_data from public.weather_fetch_cache
  where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time) for update;
  moment := clock_timestamp();
  if not found or row_data.state<>'claimed' or row_data.token is distinct from claim_token
    or row_data.generation is distinct from expected_generation or row_data.lease_until<=moment then
    return jsonb_build_object('status','superseded');
  end if;
  -- Lock policy against mid-reservation changes; capacity and budget share this order.
  select * into policy from public.weather_budget_policy where singleton for share;
  if not found then raise exception 'API_BUDGET_NOT_CONFIGURED'; end if;
  perform public.assert_weather_capacity_internal(0,1,policy.response_bytes);
  request_number:=public.consume_daily_api_budget_internal('kma',
    case target_model when 'ultra' then 'ultra_forecast' else 'short_forecast' end,configured_limit,member_id);
  moment:=clock_timestamp();
  -- Expiry during lock/budget waiting must roll back both counters.
  if row_data.lease_until<=moment then raise exception 'WEATHER_LEASE_EXPIRED'; end if;
  if moment+interval '15 seconds' >= (((timezone('Asia/Seoul',moment))::date+1)::timestamp at time zone 'Asia/Seoul') then
    raise exception 'API_BUDGET_DAY_ROLLOVER';
  end if;
  insert into public.weather_fetch_attempts(token,model,nx,ny,base_date,base_time,generation,reserved_day,reserved_bytes)
  values(claim_token,target_model,target_nx,target_ny,target_date,target_time,expected_generation,
    (timezone('Asia/Seoul',moment))::date,policy.response_bytes);
  update public.weather_fetch_cache set state='fetching',lease_until=moment+interval '15 seconds',
    retry_after=moment+interval '10 minutes',reserved_day=(timezone('Asia/Seoul',moment))::date,response_bytes=policy.response_bytes
  where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time);
  return jsonb_build_object('status','permit','requestNumber',request_number,'responseBytes',policy.response_bytes,
    'leaseUntil',moment+interval '15 seconds');
end;
$$;

create or replace function public.finish_weather_fetch_internal(
  target_model text, target_nx integer, target_ny integer, target_date text, target_time text,
  claim_token uuid, expected_generation bigint, result_items jsonb, received_bytes integer, result_failure text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  row_data public.weather_fetch_cache%rowtype;
  attempt public.weather_fetch_attempts%rowtype;
  moment timestamptz;
  item jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(724010,1);
  select * into row_data from public.weather_fetch_cache
  where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time) for update;
  if not found then return false; end if;
  select * into attempt from public.weather_fetch_attempts where token=claim_token for update;
  if not found or attempt.completed_at is not null or attempt.generation is distinct from expected_generation
    or (attempt.model,attempt.nx,attempt.ny,attempt.base_date,attempt.base_time) is distinct from
       (target_model,target_nx,target_ny,target_date,target_time) then return false; end if;
  moment:=clock_timestamp();
  if result_failure='oversize' then
    -- A late old owner still closes its own day's allocation; it cannot overwrite the new cache.
    perform pg_catalog.pg_advisory_xact_lock(724010,1);
    update public.weather_usage_daily set reserved_bytes=hard_bytes where usage_date=attempt.reserved_day;
  end if;
  if row_data.state<>'fetching' or row_data.token is distinct from claim_token
    or row_data.generation is distinct from expected_generation or row_data.lease_until<=moment then
    update public.weather_fetch_attempts set completed_at=moment,outcome=case when result_failure='oversize' then 'oversize' else 'late' end where token=claim_token;
    return false;
  end if;
  if result_failure is not null then
    if result_failure not in ('provider','timeout','invalid','oversize') then raise exception 'INVALID_WEATHER_RESULT'; end if;
    if result_items is not null then raise exception 'INVALID_WEATHER_RESULT'; end if;
    update public.weather_fetch_cache set state='failed',failure_code=result_failure
      where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time);
    update public.weather_fetch_attempts set completed_at=moment,outcome=result_failure where token=claim_token;
    return true;
  end if;
  if result_items is null or jsonb_typeof(result_items)<>'array' or jsonb_array_length(result_items) not between 1 and 1000
    or received_bytes is null or received_bytes not between 1 and row_data.response_bytes
    or octet_length(result_items::text)>row_data.response_bytes then raise exception 'INVALID_WEATHER_RESULT'; end if;
  for item in select value from jsonb_array_elements(result_items) loop
    if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>8
      or not item ?& array['baseDate','baseTime','nx','ny','fcstDate','fcstTime','category','fcstValue']
      or item->>'baseDate' is distinct from target_date or item->>'baseTime' is distinct from target_time
      or item->'nx' is distinct from to_jsonb(target_nx) or item->'ny' is distinct from to_jsonb(target_ny)
      or jsonb_typeof(item->'fcstDate')<>'string' or item->>'fcstDate' !~ '^[0-9]{8}$'
      or jsonb_typeof(item->'fcstTime')<>'string' or item->>'fcstTime' !~ '^([01][0-9]|2[0-3])[0-5][0-9]$'
      or jsonb_typeof(item->'category')<>'string' or item->>'category' !~ '^[A-Z0-9]{1,8}$'
      or jsonb_typeof(item->'fcstValue')<>'string' or length(item->>'fcstValue') not between 1 and 64 then
      raise exception 'INVALID_WEATHER_RESULT';
    end if;
  end loop;
  -- Publication consumes the reservation already admitted by start. JSON bytes cannot
  -- exceed it; success/failure completion stays possible even after limits are lowered.
  update public.weather_fetch_attempts set completed_at=moment,outcome='ready',actual_bytes=received_bytes where token=claim_token;
  update public.weather_fetch_cache set state='ready',items=result_items,actual_bytes=received_bytes,
    fetched_at=moment,expires_at=moment+interval '10 minutes',failure_code=null
    where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time);
  return true;
end;
$$;
