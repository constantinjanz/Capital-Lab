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
select set_config('capital_lab.correlation_id', :'correlation_id', true);

do $$
declare
  current_state text;
  unexpected_jobs integer := 0;
begin
  select state into strict current_state from private.no_ai_shadow_dry_runs
  where id = current_setting('capital_lab.campaign_id')::uuid for update;
  if current_state not in ('prepared', 'infra_installed') then
    raise exception 'scheduler infrastructure phase is not retryable from state %', current_state;
  end if;
  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job where jobname like $1'
      into unexpected_jobs using 'capital-lab-%';
  end if;
  if unexpected_jobs <> 0 then
    raise exception 'scheduler infrastructure phase found an unmanaged Capital Lab job';
  end if;
end;
$$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not exists (select 1 from pg_extension where extname = 'pg_net')
    or exists (select 1 from cron.job where jobname like 'capital-lab-%')
  then
    raise exception 'scheduler infrastructure postflight failed';
  end if;
  if (select state from private.no_ai_shadow_dry_runs
      where id = current_setting('capital_lab.campaign_id')::uuid) = 'prepared' then
    perform private.transition_no_ai_shadow_dry_run(
      current_setting('capital_lab.campaign_id')::uuid,
      'prepared', 'infra_installed', 'admin_script',
      current_setting('capital_lab.expected_commit_sha'),
      current_setting('capital_lab.config_version'),
      current_setting('capital_lab.correlation_id')::uuid,
      jsonb_build_object('extensions_present', 2, 'extension_version_pins', 0,
        'jobs_installed', 0, 'http_requests_sent', 0)
    );
  end if;
end;
$$;

select jsonb_build_object('schema_version', 3,
  'phase', 'scheduler-infrastructure-preparation',
  'persisted_state', state, 'extensions_present', 2,
  'extension_version_pins', 0, 'jobs_installed', 0)
from private.no_ai_shadow_dry_runs where id = :'campaign_id'::uuid;

commit;
