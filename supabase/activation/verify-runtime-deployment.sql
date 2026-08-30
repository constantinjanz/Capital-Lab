\set ON_ERROR_STOP on
begin;

select private.record_activation_deployment_binding(
  :'campaign_id'::uuid, 'no_ai_runtime_enabled', :'deployment_proof_json'::jsonb,
  :'deployment_proof_sha256', :'operation_id'::uuid, :'correlation_id'::uuid,
  :'expected_commit_sha', :'config_version', :'manifest_sha256',
  :'phase_contract_sha256', :'expected_database_fingerprint'
);

select jsonb_build_object(
  'schema_version', 4, 'phase', 'runtime-deployment-verify',
  'persisted_state', campaign.state, 'deployment_role', runtime.deployment_role,
  'deployment_id', runtime.deployment_id,
  'distinct_from_auth', runtime.deployment_id <> auth.deployment_id,
  'evidence_hash', runtime.evidence_hash,
  'configuration_attested', false, 'secret_values_returned', false
)
from private.no_ai_shadow_dry_runs as campaign
join private.activation_deployment_bindings as auth
  on auth.campaign_id = campaign.id and auth.deployment_role = 'auth_disabled'
join private.activation_deployment_bindings as runtime
  on runtime.campaign_id = campaign.id and runtime.deployment_role = 'no_ai_runtime_enabled'
where campaign.id = :'campaign_id'::uuid;

commit;
