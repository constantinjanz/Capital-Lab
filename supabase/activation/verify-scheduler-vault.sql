\set ON_ERROR_STOP on
begin;

select set_config('capital_lab.expected_scheduler_url', :'expected_scheduler_url', true) \gset
select set_config('capital_lab.server_consumer_scope_confirmation', :'server_consumer_scope_confirmation', true) \gset
select set_config('capital_lab.scheduler_secret_randomness_confirmation', :'scheduler_secret_randomness_confirmation', true) \gset

do $$
declare
  named_secret_count integer;
  shared_secret_length integer;
  scheduler_url text;
begin
  if (select state from private.no_ai_shadow_dry_runs
      where id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001') <> 'infra_installed'
  then
    raise exception 'scheduler infrastructure is not verified';
  end if;
  select count(*), max(case
      when name = 'capital_lab_scheduler_shared_secret'
      then length(decrypted_secret) end), max(case
      when name = 'capital_lab_scheduler_url'
      then decrypted_secret end)
  into named_secret_count, shared_secret_length, scheduler_url
  from vault.decrypted_secrets
  where name in (
    'capital_lab_scheduler_url',
    'capital_lab_scheduler_shared_secret'
  );
  if named_secret_count <> 2 or shared_secret_length < 32
    or scheduler_url <> current_setting('capital_lab.expected_scheduler_url')
    or scheduler_url !~ '^https://[a-z0-9.-]+/api/internal/scheduler$'
    or current_setting('capital_lab.server_consumer_scope_confirmation')
      <> 'production_server_consumers_only_old_preview_development_removed'
    or current_setting('capital_lab.scheduler_secret_randomness_confirmation')
      <> 'cryptographically_random_32_bytes_or_more'
  then
    raise exception 'required scheduler Vault names or minimum secret length are unavailable';
  end if;
end;
$$;

select private.transition_no_ai_shadow_dry_run(
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001',
  'infra_installed', 'vault_verified', 'owner',
  :'expected_commit_sha', :'config_version', :'correlation_id'::uuid,
  jsonb_build_object(
    'required_names_present', true,
    'secret_values_returned', false,
    'server_consumer_scope_confirmed', true,
    'scheduler_secret_randomness_confirmed', true
  )
);

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'vault_verified',
  'required_name_count', 2,
  'expected_url_matched', true,
  'server_consumer_scope_confirmed', true,
  'scheduler_secret_randomness_confirmed', true,
  'secret_values_returned', false
) as evidence;

commit;
