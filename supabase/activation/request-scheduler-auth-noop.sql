-- Explicit later manual gate. This is the only pre-arm script that sends one
-- authenticated request, and it requires both scheduler controls to be false.
\set ON_ERROR_STOP on
begin;

select set_config('capital_lab.vercel_scheduler_enabled', :'vercel_scheduler_enabled', true) \gset

do $$
begin
  if current_setting('capital_lab.vercel_scheduler_enabled')::boolean then
    raise exception 'Vercel scheduler must be false for the auth/no-op gate';
  end if;
  if (select state from private.no_ai_shadow_dry_runs
      where id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001') <> 'jobs_installed_disabled'
  then
    raise exception 'disabled jobs are not installed';
  end if;
  if exists (
    select 1 from cron.job where jobname in (
      'capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler'
    ) and active
  ) or exists (
    select 1 from private.application_settings
    where setting_key = 'scheduler_enabled' and value <> 'false'::jsonb
  ) then
    raise exception 'scheduler controls are not disabled';
  end if;
end;
$$;

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
) as auth_noop_request_id \gset

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'auth_noop_requested',
  'pg_net_request_id', :'auth_noop_request_id',
  'vercel_scheduler_enabled', false,
  'database_scheduler_enabled', false
) as evidence;

commit;
