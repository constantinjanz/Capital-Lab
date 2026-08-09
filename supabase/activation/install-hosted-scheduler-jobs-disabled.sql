\set ON_ERROR_STOP on
begin;

do $do$
declare
  dispatcher_id bigint;
  reconciler_id bigint;
begin
  if (select state from private.no_ai_shadow_dry_runs
      where id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001') <> 'vault_verified'
  then
    raise exception 'Vault name/shape gate has not passed';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
  then
    raise exception 'required scheduler extension functions are unavailable';
  end if;
  if exists (
    select 1 from cron.job where jobname like 'capital-lab-%'
      and jobname not in (
        'capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler'
      )
  ) then
    raise exception 'unexpected Capital Lab Cron job exists';
  end if;

  select jobid into dispatcher_id from cron.job
  where jobname = 'capital-lab-no-ai-dispatcher';
  if dispatcher_id is null then
    dispatcher_id := cron.schedule(
      'capital-lab-no-ai-dispatcher',
      '*/15 * * * 1-5',
      $job$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$job$
    );
  end if;
  perform cron.alter_job(dispatcher_id, active := false);

  select jobid into reconciler_id from cron.job
  where jobname = 'capital-lab-no-ai-reconciler';
  if reconciler_id is null then
    reconciler_id := cron.schedule(
      'capital-lab-no-ai-reconciler',
      '5,20,35,50 * * * 1-5',
      $job$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp());$job$
    );
  end if;
  perform cron.alter_job(reconciler_id, active := false);

  if (select count(*) from cron.job
      where jobname in ('capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler')) <> 2
    or exists (
      select 1 from cron.job
      where jobname in ('capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler')
        and active
    )
  then
    raise exception 'disabled scheduler job postflight failed';
  end if;
end;
$do$;

select private.transition_no_ai_shadow_dry_run(
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001',
  'vault_verified', 'jobs_installed_disabled', 'admin_script',
  :'expected_commit_sha', :'config_version', :'correlation_id'::uuid,
  jsonb_build_object('expected_jobs', 2, 'active_jobs', 0, 'http_requests_sent', 0)
);

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'jobs_installed_disabled',
  'expected_jobs', 2,
  'active_jobs', 0,
  'http_requests_sent', 0
) as evidence;

commit;
