\set ON_ERROR_STOP on
begin;

select private.record_activation_deployment_binding(
  :'campaign_id'::uuid, 'auth_disabled', :'deployment_proof_json'::jsonb,
  :'deployment_proof_sha256', :'operation_id'::uuid, :'correlation_id'::uuid,
  :'expected_commit_sha', :'config_version', :'manifest_sha256',
  :'phase_contract_sha256', :'expected_database_fingerprint'
);

select jsonb_build_object(
  'schema_version', 3, 'phase', 'auth-endpoint-verify',
  'persisted_state', campaign.state, 'deployment_role', binding.deployment_role,
  'deployment_id', binding.deployment_id, 'evidence_hash', binding.evidence_hash,
  'scheduler_enabled', binding.scheduler_enabled, 'secret_values_returned', false
)
from private.no_ai_shadow_dry_runs as campaign
join private.activation_deployment_bindings as binding
  on binding.campaign_id = campaign.id and binding.deployment_role = 'auth_disabled'
where campaign.id = :'campaign_id'::uuid;

commit;
