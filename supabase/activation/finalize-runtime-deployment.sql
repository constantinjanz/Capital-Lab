\set ON_ERROR_STOP on
begin;

select private.finalize_activation_runtime_deployment(
  :'campaign_id'::uuid, :'operation_id'::uuid, :'correlation_id'::uuid,
  :'expected_commit_sha', :'config_version', :'manifest_sha256',
  :'phase_contract_sha256', :'expected_database_fingerprint'
);

select jsonb_build_object(
  'schema_version', 4, 'phase', 'runtime-deployment-finalize',
  'persisted_state', campaign.state,
  'deployment_id', binding.deployment_id,
  'runtime_request_id', request.request_id,
  'runtime_configuration_verified', evidence.schema_valid,
  'secret_values_returned', false
)
from private.no_ai_shadow_dry_runs as campaign
join private.activation_deployment_bindings as binding
  on binding.campaign_id = campaign.id
  and binding.deployment_role = 'no_ai_runtime_enabled'
join private.activation_runtime_config_requests as request
  on request.campaign_id = campaign.id
join private.activation_runtime_config_evidence as evidence
  on evidence.request_id = request.request_id
where campaign.id = :'campaign_id'::uuid;

commit;
