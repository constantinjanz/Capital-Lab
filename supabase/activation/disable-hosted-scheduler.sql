-- Later emergency/manual shutdown phase. The caller must first set Vercel
-- SCHEDULER_ENABLED=false and prove a new READY Production deployment.
\set ON_ERROR_STOP on
begin;

select set_config('capital_lab.vercel_scheduler_enabled', :'vercel_scheduler_enabled', true) \gset
select set_config('capital_lab.production_deployment_id', :'production_deployment_id', true) \gset
select set_config('capital_lab.production_deployment_ready', :'production_deployment_ready', true) \gset

do $$
begin
  if current_setting('capital_lab.vercel_scheduler_enabled')::boolean
    or current_setting('capital_lab.production_deployment_ready') <> 'READY'
    or length(btrim(current_setting('capital_lab.production_deployment_id'))) = 0
  then
    raise exception 'disabled READY Production deployment evidence is required before database stop';
  end if;
end;
$$;

update private.application_settings
set value = 'false'::jsonb, version = version + 1
where setting_key in (
  'scheduler_enabled', 'agent_enabled',
  'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
  'openai_canary_enabled', 'openai_web_search_enabled',
  'sol_challenger_enabled', 'sol_live_execution_enabled',
  'real_broker_enabled'
) and value <> 'false'::jsonb;

update public.experiment_controls
set scheduler_enabled = false, agent_enabled = false,
    state_version = state_version + 1
where scheduler_enabled or agent_enabled;

update private.no_ai_shadow_dry_runs
set scheduler_control_enabled = false
where scheduler_control_enabled;

do $$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'capital-lab-no-ai-dispatcher') then
      perform cron.unschedule('capital-lab-no-ai-dispatcher');
    end if;
    if exists (select 1 from cron.job where jobname = 'capital-lab-no-ai-reconciler') then
      perform cron.unschedule('capital-lab-no-ai-reconciler');
    end if;
  end if;
end;
$$;

select private.transition_no_ai_shadow_dry_run(
  id, state, 'aborted', 'owner', :'expected_commit_sha',
  :'config_version', :'correlation_id'::uuid,
  jsonb_build_object(
    'reason_code', 'owner_shutdown',
    'production_deployment_id', :'production_deployment_id'
  )
)
from private.no_ai_shadow_dry_runs
where state not in ('passed', 'failed', 'aborted', 'auto_stopped', 'reconciled');

do $$
begin
  if exists (
    select 1 from private.application_settings
    where setting_key in (
      'scheduler_enabled', 'agent_enabled',
      'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
      'openai_canary_enabled', 'openai_web_search_enabled',
      'sol_challenger_enabled', 'sol_live_execution_enabled',
      'real_broker_enabled'
    ) and value <> 'false'::jsonb
  ) or exists (
    select 1 from private.no_ai_shadow_dry_runs where scheduler_control_enabled
  ) or (
    to_regclass('cron.job') is not null and exists (
      select 1 from cron.job where jobname in (
        'capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler'
      )
    )
  ) then
    raise exception 'scheduler shutdown postflight failed';
  end if;
end;
$$;

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'database_stopped',
  'jobs_remaining', 0,
  'dangerous_flags_enabled', 0,
  'drain_required_seconds', 300
) as evidence;

commit;
