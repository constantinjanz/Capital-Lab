\set ON_ERROR_STOP on
begin;

select private.assert_activation_context(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint'
);
select private.submit_activation_auth_failure_probes(
  :'campaign_id'::uuid, :'operation_id'::uuid
) as newly_submitted;

select jsonb_build_object('schema_version', 2,
  'phase', 'auth-failure-request', 'persisted_probe_count', count(*),
  'missing_auth_probe_count', count(*) filter (where probe_kind = 'missing'),
  'invalid_auth_probe_count', count(*) filter (where probe_kind = 'invalid'),
  'secret_values_returned', false)
from private.activation_auth_failure_requests
where campaign_id = :'campaign_id'::uuid;

commit;
