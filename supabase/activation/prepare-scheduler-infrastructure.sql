\set ON_ERROR_STOP on
begin;

select set_config('capital_lab.expected_project_ref', :'expected_project_ref', true) \gset
select set_config('capital_lab.expected_database_fingerprint', :'expected_database_fingerprint', true) \gset

do $$
declare
  capital_lab_job_exists boolean := false;
begin
  if current_setting('capital_lab.expected_project_ref') <> 'qrnuyibntcxwffrxmrvn'
    or current_setting('capital_lab.expected_database_fingerprint')
      <> current_database() || ':' || current_setting('server_version_num')::integer / 10000
  then
    raise exception 'scheduler infrastructure target fingerprint mismatch';
  end if;
  if (select state from private.no_ai_shadow_dry_runs
      where id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001') <> 'prepared'
  then
    raise exception 'dry run is not prepared';
  end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname like $1)'
      into capital_lab_job_exists using 'capital-lab-%';
  end if;
  if capital_lab_job_exists then
    raise exception 'Capital Lab scheduler jobs already exist before infrastructure preparation';
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
end;
$$;

select private.transition_no_ai_shadow_dry_run(
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001',
  'prepared', 'infra_installed', 'admin_script',
  :'expected_commit_sha', :'config_version', :'correlation_id'::uuid,
  jsonb_build_object('extensions', jsonb_build_array('pg_cron', 'pg_net'), 'jobs_installed', 0)
);

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'scheduler_infrastructure_prepared',
  'project_ref', current_setting('capital_lab.expected_project_ref'),
  'database_fingerprint', current_setting('capital_lab.expected_database_fingerprint'),
  'extensions_present', 2,
  'extension_version_pins', 0,
  'jobs_installed', 0,
  'http_requests_sent', 0
) as evidence;

commit;
