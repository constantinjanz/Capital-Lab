\set ON_ERROR_STOP on
begin;

select
  :'campaign_manifest_json'::jsonb #>> '{phase_operations,runtime-config-request,request_id}' as runtime_request_id,
  :'campaign_manifest_json'::jsonb #>> '{phase_operations,runtime-config-request,nonce}' as runtime_nonce
\gset

select private.claim_activation_runtime_config_attestation(
  :'campaign_id'::uuid, :'runtime_request_id'::uuid, :'runtime_nonce'::uuid,
  :'operation_id'::uuid, :'correlation_id'::uuid,
  :'expected_commit_sha', :'config_version', :'manifest_sha256',
  :'phase_contract_sha256', :'expected_database_fingerprint'
);
select private.submit_activation_runtime_config_attestation(
  :'campaign_id'::uuid
) as pg_net_request_id;

select jsonb_build_object(
  'schema_version', 4, 'phase', 'runtime-config-request',
  'campaign_id', campaign_id, 'request_id', request_id,
  'correlation_id', correlation_id, 'status', status,
  'immutable_deployment_url_used', true,
  'secret_values_returned', false
)
from private.activation_runtime_config_requests
where campaign_id = :'campaign_id'::uuid;

commit;
