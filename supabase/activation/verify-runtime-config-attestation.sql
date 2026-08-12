\set ON_ERROR_STOP on
begin;

select private.assert_activation_context(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint'
);
select private.capture_activation_runtime_config_response(
  :'campaign_id'::uuid
);

commit;

begin;

select private.verify_activation_runtime_config_attestation(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint', :'correlation_id'::uuid
);

select jsonb_build_object(
  'schema_version', 4, 'phase', 'runtime-config-reconcile',
  'persisted_state', campaign.state, 'request_id', request.request_id,
  'request_status', request.status, 'exact_response_verified', evidence.schema_valid,
  'actual_configuration_observed', true, 'forbidden_effect_count', 0,
  'secret_values_returned', false
)
from private.no_ai_shadow_dry_runs as campaign
join private.activation_runtime_config_requests as request
  on request.campaign_id = campaign.id
join private.activation_runtime_config_evidence as evidence
  on evidence.request_id = request.request_id
where campaign.id = :'campaign_id'::uuid;

commit;
