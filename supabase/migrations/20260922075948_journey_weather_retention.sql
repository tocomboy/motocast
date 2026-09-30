-- No schedule or budget change is activated by this migration.
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

alter table public.weather_fetch_cache drop constraint weather_fetch_cache_state_check;
alter table public.weather_fetch_cache add constraint weather_fetch_cache_state_check
  check (state in ('claimed','fetching','ready','failed','expired'));
create index weather_cache_expiry_idx on public.weather_fetch_cache(expires_at) where state='ready';
create index weather_cache_retention_idx on public.weather_fetch_cache(base_date);
create index weather_cache_token_idx on public.weather_fetch_cache(token);
create index weather_attempt_retention_idx on public.weather_fetch_attempts(started_at);

-- Owner-only maintenance: SECURITY INVOKER deliberately cannot bypass client ACLs.
-- Three bounded batches, in cache -> attempt order, consistent with finish's locks.
create function public.prune_weather_cache_internal(batch_limit integer default 250)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  moment timestamptz := clock_timestamp();
  today_seoul date := (timezone('Asia/Seoul',moment))::date;
  payload_count integer;
  cache_count integer;
  attempt_count integer;
  unknown_count integer;
  result jsonb;
begin
  if batch_limit is null or batch_limit not between 1 and 1000 then
    raise exception 'INVALID_RETENTION_BATCH';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(724010,2) then
    return jsonb_build_object('status','busy');
  end if;

  with expired as (
    select c.model,c.nx,c.ny,c.base_date,c.base_time
    from public.weather_fetch_cache c
    where c.state='ready' and c.expires_at<=moment
      and c.lease_until<=moment and c.retry_after<=moment
    order by c.expires_at,c.model,c.nx,c.ny,c.base_date,c.base_time
    limit batch_limit for update skip locked
  )
  update public.weather_fetch_cache c set state='expired',items=null
  from expired e
  where (c.model,c.nx,c.ny,c.base_date,c.base_time)=(e.model,e.nx,e.ny,e.base_date,e.base_time);
  get diagnostics payload_count = row_count;

  with obsolete as (
    select c.model,c.nx,c.ny,c.base_date,c.base_time
    from public.weather_fetch_cache c
    where c.base_date < to_char(today_seoul-2,'YYYYMMDD')
      and c.lease_until<=moment and c.retry_after<=moment
      and (c.expires_at is null or c.expires_at<=moment)
    order by c.base_date,c.model,c.nx,c.ny,c.base_time
    limit batch_limit for update skip locked
  )
  delete from public.weather_fetch_cache c using obsolete o
  where (c.model,c.nx,c.ny,c.base_date,c.base_time)=(o.model,o.nx,o.ny,o.base_date,o.base_time);
  get diagnostics cache_count = row_count;

  with obsolete as (
    select a.token from public.weather_fetch_attempts a
    where a.started_at < moment-interval '7 days'
      and a.reserved_day < today_seoul-7
      and (a.completed_at is null or a.completed_at < moment-interval '7 days')
      and not exists(select 1 from public.weather_fetch_cache c where c.token=a.token)
    order by a.started_at,a.token
    limit batch_limit for update skip locked
  ), removed as (
    delete from public.weather_fetch_attempts a using obsolete o
    where a.token=o.token returning a.completed_at
  )
  select count(*),count(*) filter(where completed_at is null)
  into attempt_count,unknown_count from removed;

  result:=jsonb_build_object('status','pruned','payloads',payload_count,'cacheRows',cache_count,
                            'attemptRows',attempt_count,'unknownAttempts',unknown_count);
  raise log 'weather_retention %', result;
  return result;
end;
$$;
revoke all on function public.prune_weather_cache_internal(integer) from public,anon,authenticated,service_role;
