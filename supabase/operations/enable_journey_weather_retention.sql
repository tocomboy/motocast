-- Apply only on the explicitly approved project, AFTER the retention migration and CI gate.
-- Not part of migration replay; running this file enables a recurring deletion job.
-- No provider calls, credentials, quota changes or journey activation.
-- Enable pg_cron through the project's approved Supabase Integrations first.
begin;
do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise exception 'RETENTION_CRON_NOT_INSTALLED';
  end if;
  if not has_function_privilege(current_user,'cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE') then
    raise exception 'RETENTION_CRON_CONTROL_REQUIRED';
  end if;
end;
$$;

-- Only the named job's ended history is disposable. Other jobs and unfinished runs survive.
create or replace function public.run_weather_retention_internal()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  result jsonb;
  history_count integer;
begin
  result:=public.prune_weather_cache_internal(1000);
  with obsolete as (
    select d.runid from cron.job_run_details d
    join cron.job j on j.jobid=d.jobid
    where j.jobname='motocast-weather-retention' and j.username=current_user
      and d.end_time<clock_timestamp()-interval '7 days'
    order by d.end_time,d.runid limit 1000 for update of d skip locked
  )
  delete from cron.job_run_details d using obsolete o where d.runid=o.runid;
  get diagnostics history_count = row_count;
  return result || jsonb_build_object('jobHistoryRows',history_count);
end;
$$;
revoke all on function public.run_weather_retention_internal() from public,anon,authenticated,service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='motocast-weather-retention'
    and (username<>current_user or database<>current_database()
      or command<>'select public.run_weather_retention_internal();')) then
    raise exception 'RETENTION_JOB_IDENTITY_CONFLICT';
  end if;
  perform cron.schedule('motocast-weather-retention','*/5 * * * *',
                        'select public.run_weather_retention_internal();');
end;
$$;
commit;

-- Read back exact identity, schedule and active flag. To stop, use cron.alter_job(jobid, active:=false)
-- for this exact owner/database/name. Retain migrations, policy and all usage ledgers.
select jobname,schedule,command,database,username,active from cron.job
where jobname='motocast-weather-retention' and username=current_user;
