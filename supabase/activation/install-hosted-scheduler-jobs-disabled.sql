\set ON_ERROR_STOP on
begin;

select private.assert_activation_context(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint'
);
select set_config('capital_lab.campaign_id', :'campaign_id', true);
select set_config('capital_lab.expected_commit_sha', :'expected_commit_sha', true);
select set_config('capital_lab.config_version', :'config_version', true);
select set_config('capital_lab.operation_id', :'operation_id', true);
select set_config('capital_lab.correlation_id', :'correlation_id', true);

do $install$
declare
  current_state text;
  dispatcher_id bigint;
  reconciler_id bigint;
  dispatcher_active boolean;
  reconciler_active boolean;
begin
  select state into strict current_state from private.no_ai_shadow_dry_runs
  where id = current_setting('capital_lab.campaign_id')::uuid for update;
  if current_state = 'jobs_installed_disabled' then
    perform private.assert_activation_job_specs(current_setting('capital_lab.campaign_id')::uuid, false);
    return;
  elsif current_state <> 'vault_verified' then
    raise exception 'job installation is not retryable from state %', current_state;
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null
    or to_regprocedure('cron.unschedule(bigint)') is null
  then
    raise exception 'documented pg_cron APIs are unavailable';
  end if;
  perform private.assert_unmanaged_activation_jobs_safe();
  select jobid, active into dispatcher_id, dispatcher_active from cron.job
  where jobname = 'capital-lab-no-ai-dispatcher';
  if dispatcher_id is null then
    dispatcher_id := cron.schedule(
      'capital-lab-no-ai-dispatcher', '*/15 * * * 1-5',
      $job$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$job$
    );
    select active into strict dispatcher_active from cron.job where jobid = dispatcher_id;
  end if;
  select jobid, active into reconciler_id, reconciler_active from cron.job
  where jobname = 'capital-lab-no-ai-reconciler';
  if reconciler_id is null then
    reconciler_id := cron.schedule(
      'capital-lab-no-ai-reconciler', '5,20,35,50 * * * 1-5',
      $job$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp());$job$
    );
    select active into strict reconciler_active from cron.job where jobid = reconciler_id;
  end if;
  perform private.assert_unmanaged_activation_jobs_safe();
  perform private.register_activation_job_spec(
    current_setting('capital_lab.campaign_id')::uuid,
    'dispatcher', dispatcher_id, dispatcher_active,
    current_setting('capital_lab.operation_id')::uuid,
    current_setting('capital_lab.correlation_id')::uuid
  );
  perform private.register_activation_job_spec(
    current_setting('capital_lab.campaign_id')::uuid,
    'reconciler', reconciler_id, reconciler_active,
    current_setting('capital_lab.operation_id')::uuid,
    current_setting('capital_lab.correlation_id')::uuid
  );
  perform private.set_activation_jobs_active(
    current_setting('capital_lab.campaign_id')::uuid, false,
    current_setting('capital_lab.operation_id')::uuid,
    current_setting('capital_lab.correlation_id')::uuid
  );
  perform private.transition_no_ai_shadow_dry_run(
    current_setting('capital_lab.campaign_id')::uuid,
    'vault_verified', 'jobs_installed_disabled', 'admin_script',
    current_setting('capital_lab.expected_commit_sha'),
    current_setting('capital_lab.config_version'),
    current_setting('capital_lab.correlation_id')::uuid,
    jsonb_build_object('persisted_job_ids', 2, 'active_jobs', 0,
      'full_definitions_verified', true)
  );
end;
$install$;

select private.assert_activation_job_specs(:'campaign_id'::uuid, false);
select jsonb_build_object('schema_version', 3, 'phase', 'install-jobs-disabled',
  'persisted_state', state, 'persisted_job_ids', 2, 'active_jobs', 0,
  'full_definitions_verified', true)
from private.no_ai_shadow_dry_runs where id = :'campaign_id'::uuid;

commit;
