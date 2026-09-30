-- Public meteorological material only; never store account, route or bearer data here.
-- No policy row is seeded: deployment/configuration remains a separate approval.
create table public.weather_budget_policy (
  singleton boolean primary key default true check (singleton),
  daily_calls integer not null check (daily_calls between 1 and 20000),
  daily_bytes bigint not null check (daily_bytes between 1 and 5000000000),
  response_bytes integer not null check (response_bytes = 1048576)
);
create table public.weather_usage_daily (
  usage_date date primary key,
  calls integer not null check (calls >= 0),
  reserved_bytes bigint not null check (reserved_bytes >= 0),
  hard_calls integer not null check (hard_calls > 0),
  hard_bytes bigint not null check (hard_bytes > 0)
);
create table public.weather_fetch_cache (
  model text not null check (model in ('ultra','short')),
  nx integer not null check (nx between 1 and 149),
  ny integer not null check (ny between 1 and 253),
  base_date text not null check (base_date ~ '^[0-9]{8}$'),
  base_time text not null check (base_time ~ '^([01][0-9]|2[0-3])[0-5][0-9]$'),
  state text not null check (state in ('claimed','fetching','ready','failed')),
  generation bigint not null check (generation > 0),
  token uuid not null,
  lease_until timestamptz not null,
  retry_after timestamptz not null,
  expires_at timestamptz,
  fetched_at timestamptz,
  items jsonb,
  reserved_day date,
  response_bytes integer,
  actual_bytes integer,
  failure_code text check (failure_code in ('provider','timeout','invalid','oversize')),
  primary key (model,nx,ny,base_date,base_time),
  check ((state = 'ready') = (items is not null)),
  check (items is null or jsonb_typeof(items) = 'array')
);
create table public.weather_fetch_attempts (
  token uuid primary key,
  model text not null,
  nx integer not null, ny integer not null, base_date text not null, base_time text not null,
  generation bigint not null,
  reserved_day date not null,
  reserved_bytes integer not null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  outcome text check(outcome in ('ready','provider','timeout','invalid','oversize','late')),
  actual_bytes integer
);
alter table public.weather_fetch_attempts enable row level security;
revoke all on public.weather_fetch_attempts from public,anon,authenticated,service_role;
alter table public.weather_budget_policy enable row level security;
alter table public.weather_usage_daily enable row level security;
alter table public.weather_fetch_cache enable row level security;
revoke all on public.weather_budget_policy, public.weather_usage_daily, public.weather_fetch_cache from public, anon, authenticated, service_role;

-- Keep the existing public RPC and per-operation counters. When an approved policy
-- is present, every KMA caller (including the legacy endpoint) also reserves from
-- one cross-model account allocation. Failed calls/unknown outcomes are not refunded.
create or replace function public.consume_daily_api_budget_internal(
  api_provider text,
  api_operation text,
  configured_limit integer,
  member_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used_calls integer;
  policy public.weather_budget_policy%rowtype;
  account_usage public.weather_usage_daily%rowtype;
  today_seoul date := (timezone('Asia/Seoul', now()))::date;
begin
  if member_id is null or not exists (
    select 1 from public.memberships where user_id = member_id and revoked_at is null
  ) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if api_provider not in ('kakao', 'kma')
     or api_operation not in (
       'local_keyword_search', 'directions', 'future_directions',
       'ultra_forecast', 'short_forecast'
     )
     or configured_limit is null or configured_limit <= 0 then
    raise exception 'API_BUDGET_NOT_CONFIGURED';
  end if;

  if api_provider = 'kma' then
    -- A short transaction lock also serializes legacy and cache budget callers.
    perform pg_catalog.pg_advisory_xact_lock(724010, 1);
    today_seoul := (timezone('Asia/Seoul',clock_timestamp()))::date;
    select * into policy from public.weather_budget_policy where singleton;
    if found then
      if clock_timestamp()+interval '15 seconds' >= ((today_seoul+1)::timestamp at time zone 'Asia/Seoul') then
        raise exception 'API_BUDGET_DAY_ROLLOVER';
      end if;
      if not exists (select 1 from public.weather_usage_daily where usage_date = today_seoul)
         and exists (select 1 from public.api_usage_daily where provider='kma' and usage_date=today_seoul and calls>0) then
        raise exception 'API_BUDGET_BASELINE_REQUIRED';
      end if;
      insert into public.weather_usage_daily(usage_date,calls,reserved_bytes,hard_calls,hard_bytes)
      values(today_seoul,1,policy.response_bytes,policy.daily_calls,policy.daily_bytes)
      on conflict (usage_date) do update
      set calls=public.weather_usage_daily.calls+1,
          reserved_bytes=public.weather_usage_daily.reserved_bytes+policy.response_bytes,
          hard_calls=least(public.weather_usage_daily.hard_calls,policy.daily_calls),
          hard_bytes=least(public.weather_usage_daily.hard_bytes,policy.daily_bytes)
      where public.weather_usage_daily.calls < least(public.weather_usage_daily.hard_calls,policy.daily_calls)
        and public.weather_usage_daily.reserved_bytes+policy.response_bytes <= least(public.weather_usage_daily.hard_bytes,policy.daily_bytes)
      returning * into account_usage;
      if not found or policy.response_bytes > policy.daily_bytes then
        raise exception 'API_DAILY_BUDGET_EXHAUSTED';
      end if;
    end if;
  end if;

  insert into public.api_usage_daily(provider, operation, usage_date, calls, hard_limit)
  values (api_provider, api_operation, today_seoul, 1, configured_limit)
  on conflict (provider, operation, usage_date) do update
  set calls = public.api_usage_daily.calls + 1,
      hard_limit = least(public.api_usage_daily.hard_limit, excluded.hard_limit),
      updated_at = now()
  where public.api_usage_daily.calls < least(public.api_usage_daily.hard_limit, excluded.hard_limit)
  returning calls into used_calls;

  if used_calls is null then
    raise exception 'API_DAILY_BUDGET_EXHAUSTED';
  end if;
  return used_calls;
end;
$$;


create function public.claim_weather_fetch_internal(
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
  if not exists(select 1 from public.weather_budget_policy where singleton) then raise exception 'API_BUDGET_NOT_CONFIGURED'; end if;
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

create function public.start_weather_fetch_internal(
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
  select * into row_data from public.weather_fetch_cache
  where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time) for update;
  moment := clock_timestamp();
  if not found or row_data.state<>'claimed' or row_data.token is distinct from claim_token
    or row_data.generation is distinct from expected_generation or row_data.lease_until<=moment then
    return jsonb_build_object('status','superseded');
  end if;
  -- Lock policy against mid-reservation changes; consume takes the same lock order.
  perform pg_catalog.pg_advisory_xact_lock(724010,1);
  select * into policy from public.weather_budget_policy where singleton for share;
  if not found then raise exception 'API_BUDGET_NOT_CONFIGURED'; end if;
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

create function public.finish_weather_fetch_internal(
  target_model text, target_nx integer, target_ny integer, target_date text, target_time text,
  claim_token uuid, expected_generation bigint, result_items jsonb, received_bytes integer, result_failure text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  row_data public.weather_fetch_cache%rowtype;
  attempt public.weather_fetch_attempts%rowtype;
  moment timestamptz;
  item jsonb;
begin
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
  update public.weather_fetch_attempts set completed_at=moment,outcome='ready',actual_bytes=received_bytes where token=claim_token;
  update public.weather_fetch_cache set state='ready',items=result_items,actual_bytes=received_bytes,
    fetched_at=moment,expires_at=moment+interval '10 minutes',failure_code=null
    where (model,nx,ny,base_date,base_time)=(target_model,target_nx,target_ny,target_date,target_time);
  return true;
end;
$$;

revoke all on function public.claim_weather_fetch_internal(uuid,text,integer,integer,text,text,uuid) from public,anon,authenticated;
revoke all on function public.start_weather_fetch_internal(uuid,text,integer,integer,text,text,uuid,bigint,integer) from public,anon,authenticated;
revoke all on function public.finish_weather_fetch_internal(text,integer,integer,text,text,uuid,bigint,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.claim_weather_fetch_internal(uuid,text,integer,integer,text,text,uuid) to service_role;
grant execute on function public.start_weather_fetch_internal(uuid,text,integer,integer,text,text,uuid,bigint,integer) to service_role;
grant execute on function public.finish_weather_fetch_internal(text,integer,integer,text,text,uuid,bigint,jsonb,integer,text) to service_role;

-- Legacy KMA response guard has no cache token. Its 8s request can cross Seoul midnight.
-- Only server role can conservatively stop the current/prior day's allocation.
create function public.block_weather_transfer_internal()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(724010,1);
  update public.weather_usage_daily set reserved_bytes=hard_bytes
    where usage_date in ((timezone('Asia/Seoul',clock_timestamp()))::date,
                         (timezone('Asia/Seoul',clock_timestamp()))::date-1);
end;
$$;
revoke all on function public.block_weather_transfer_internal() from public,anon,authenticated;
grant execute on function public.block_weather_transfer_internal() to service_role;
