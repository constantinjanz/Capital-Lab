\set ON_ERROR_STOP on
begin;

select private.assert_activation_context(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint'
);
select private.verify_activation_auth_failure_probes(:'campaign_id'::uuid);

select jsonb_build_object('schema_version', 2,
  'phase', 'invalid-missing-auth-401', 'verified_probe_count', count(*),
  'http_status', 401, 'forbidden_effect_count', 0,
  'secret_values_returned', false)
from private.activation_auth_failure_requests
where campaign_id = :'campaign_id'::uuid and status = 'verified';

commit;
