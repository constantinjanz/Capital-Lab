\set ON_ERROR_STOP on
begin;

select set_config('capital_lab.expected_project_ref', :'expected_project_ref', true) \gset
select set_config('capital_lab.expected_database_fingerprint', :'expected_database_fingerprint', true) \gset

do $$
begin
  if current_setting('capital_lab.expected_project_ref') <> 'qrnuyibntcxwffrxmrvn'
    or current_setting('capital_lab.expected_database_fingerprint')
      <> current_database() || ':' || current_setting('server_version_num')::integer / 10000
  then
    raise exception 'activation target fingerprint mismatch';
  end if;
  if to_regprocedure('private.prepare_no_ai_shadow_dry_run(text,text,uuid)') is null then
    raise exception 'activation-readiness schema is unavailable';
  end if;
  if exists (
    select 1 from private.application_settings
    where setting_key in (
      'scheduler_enabled', 'agent_enabled',
      'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
      'openai_canary_enabled', 'openai_web_search_enabled',
      'sol_challenger_enabled', 'sol_live_execution_enabled',
      'real_broker_enabled'
    ) and value <> 'false'::jsonb
  ) then
    raise exception 'dangerous application setting is not false';
  end if;
end;
$$;

select private.prepare_no_ai_shadow_dry_run(
  :'expected_commit_sha', :'config_version', :'correlation_id'::uuid
) as dry_run_id \gset

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'app_schema_prepared',
  'project_ref', current_setting('capital_lab.expected_project_ref'),
  'database_fingerprint', current_setting('capital_lab.expected_database_fingerprint'),
  'dry_run_id', :'dry_run_id',
  'state', 'prepared',
  'dangerous_flags_enabled', 0
) as evidence;

commit;
