\set ON_ERROR_STOP on
begin;

select private.assert_activation_context(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint'
);
select private.verify_activation_vault_scope(:'campaign_id'::uuid);
select set_config('capital_lab.campaign_id', :'campaign_id', true);
select set_config('capital_lab.expected_commit_sha', :'expected_commit_sha', true);
select set_config('capital_lab.config_version', :'config_version', true);
select set_config('capital_lab.correlation_id', :'correlation_id', true);

do $$
declare
  current_state text;
begin
  select state into strict current_state from private.no_ai_shadow_dry_runs
  where id = current_setting('capital_lab.campaign_id')::uuid for update;
  if current_state = 'infra_installed' then
    perform private.transition_no_ai_shadow_dry_run(
      current_setting('capital_lab.campaign_id')::uuid,
      'infra_installed', 'vault_verified', 'owner',
      current_setting('capital_lab.expected_commit_sha'),
      current_setting('capital_lab.config_version'),
      current_setting('capital_lab.correlation_id')::uuid,
      jsonb_build_object('required_name_count', 2, 'exact_url_matched', true,
        'secret_values_returned', false)
    );
  elsif current_state <> 'vault_verified' then
    raise exception 'Vault phase is not retryable from state %', current_state;
  end if;
end;
$$;

select jsonb_build_object('schema_version', 2, 'phase', 'vault-verification',
  'persisted_state', state, 'required_name_count', 2,
  'exact_url_matched', true, 'secret_values_returned', false)
from private.no_ai_shadow_dry_runs where id = :'campaign_id'::uuid;

commit;
