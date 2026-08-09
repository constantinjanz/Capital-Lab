-- REVIEWED MANUAL ACTIVATION ONLY. Do not run during deployment or migration.
-- Prerequisites:
--   1. Vercel Production has SCHEDULER_ENABLED=true and the same 32+ character
--      SCHEDULER_SHARED_SECRET stored server-side.
--   2. Supabase Vault has exactly these two secret names:
--      capital_lab_scheduler_url (full Production /api/internal/scheduler URL)
--      capital_lab_scheduler_shared_secret (same bearer secret as Vercel)
--   3. All AI, Canary, web, Sol, autonomous, and broker flags remain false.

begin;

do $$
declare
  target_owner uuid;
  target_experiment uuid;
begin
  select experiment.owner_id, experiment.id
  into strict target_owner, target_experiment
  from public.experiments as experiment
  join public.experiment_controls as controls
    on controls.experiment_id = experiment.id
   and controls.owner_id = experiment.owner_id
  where experiment.lifecycle_status = 'active'
    and experiment.execution_mode = 'shadow'
    and not controls.agent_enabled
    and not controls.scheduler_enabled
    and not controls.emergency_paused;

  update private.application_settings
  set value = 'false'::jsonb,
      version = version + 1
  where owner_id = target_owner
    and setting_key in (
      'agent_enabled', 'autonomous_paper_execution_enabled',
      'paid_model_calls_enabled', 'openai_canary_enabled',
      'openai_web_search_enabled', 'sol_challenger_enabled',
      'sol_live_execution_enabled', 'real_broker_enabled'
    );

  update private.application_settings
  set value = case setting_key
        when 'scheduler_provider' then '"supabase"'::jsonb
        else 'true'::jsonb
      end,
      version = version + 1
  where owner_id = target_owner
    and setting_key in ('scheduler_provider', 'scheduler_enabled');

  update public.experiment_controls
  set scheduler_enabled = true,
      agent_enabled = false,
      state_version = state_version + 1
  where owner_id = target_owner
    and experiment_id = target_experiment
    and not scheduler_enabled
    and not agent_enabled
    and not emergency_paused;

  if not found then
    raise exception 'eligible no-AI shadow experiment control was not activated';
  end if;
end;
$$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'capital_lab_scheduler_url'
  ) or not exists (
    select 1 from vault.decrypted_secrets
    where name = 'capital_lab_scheduler_shared_secret'
  ) then
    raise exception 'required scheduler Vault entries are unavailable';
  end if;

  if exists (select 1 from cron.job where jobname = 'capital-lab-market-dispatcher') then
    perform cron.unschedule('capital-lab-market-dispatcher');
  end if;
  if exists (select 1 from cron.job where jobname = 'capital-lab-reconciler') then
    perform cron.unschedule('capital-lab-reconciler');
  end if;
end;
$$;

select cron.schedule(
  'capital-lab-market-dispatcher',
  '*/15 13-22 * * 1-5',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'capital_lab_scheduler_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'capital_lab_scheduler_shared_secret'
        )
      ),
      body := '{"job":"market_dispatcher"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

select cron.schedule(
  'capital-lab-reconciler',
  '5,20,35,50 13-22 * * 1-5',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'capital_lab_scheduler_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'capital_lab_scheduler_shared_secret'
        )
      ),
      body := '{"job":"reconciler"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

commit;
