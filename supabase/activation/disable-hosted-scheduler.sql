-- Idempotent emergency/default shutdown. Uses Cron APIs; cron.job is read only.
begin;

do $$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'capital-lab-market-dispatcher') then
      perform cron.unschedule('capital-lab-market-dispatcher');
    end if;
    if exists (select 1 from cron.job where jobname = 'capital-lab-reconciler') then
      perform cron.unschedule('capital-lab-reconciler');
    end if;
  end if;
end;
$$;

update private.application_settings
set value = 'false'::jsonb,
    version = version + 1
where setting_key in (
  'scheduler_enabled', 'agent_enabled', 'autonomous_paper_execution_enabled',
  'paid_model_calls_enabled', 'openai_canary_enabled',
  'openai_web_search_enabled', 'sol_challenger_enabled',
  'sol_live_execution_enabled', 'real_broker_enabled'
);

update private.application_settings
set value = '"supabase"'::jsonb,
    version = version + 1
where setting_key = 'scheduler_provider';

update public.experiment_controls
set scheduler_enabled = false,
    agent_enabled = false,
    state_version = state_version + 1
where scheduler_enabled or agent_enabled;

commit;
