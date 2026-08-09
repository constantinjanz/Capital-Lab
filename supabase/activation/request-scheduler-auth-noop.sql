\set ON_ERROR_STOP on
begin;

select
  :'campaign_manifest_json'::jsonb #>> '{phase_operations,auth-noop-request,request_id}' as auth_request_id,
  :'campaign_manifest_json'::jsonb #>> '{phase_operations,auth-noop-request,nonce}' as auth_nonce
\gset

select private.claim_activation_auth_noop(
  :'campaign_id'::uuid, :'auth_request_id'::uuid, :'auth_nonce'::uuid,
  :'operation_id'::uuid, :'correlation_id'::uuid,
  :'expected_commit_sha', :'config_version', :'manifest_sha256',
  :'phase_contract_sha256', :'expected_database_fingerprint'
);
select private.submit_activation_auth_noop(:'campaign_id'::uuid) as pg_net_request_id;

select jsonb_build_object('schema_version', 2, 'phase', 'auth-noop-request',
  'campaign_id', campaign_id, 'request_id', request_id,
  'correlation_id', correlation_id, 'status', status,
  'secret_values_returned', false)
from private.activation_auth_noop_requests where campaign_id = :'campaign_id'::uuid;

commit;
