\set ON_ERROR_STOP on
begin;

select private.verify_activation_auth_noop(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint', :'correlation_id'::uuid
);

select jsonb_build_object('schema_version', 2, 'phase', 'auth-noop-reconcile',
  'persisted_state', campaign.state, 'request_id', request.request_id,
  'request_status', request.status, 'exact_response_verified', response.schema_valid,
  'forbidden_effect_count', 0, 'secret_values_returned', false)
from private.no_ai_shadow_dry_runs as campaign
join private.activation_auth_noop_requests as request on request.campaign_id = campaign.id
join private.activation_http_responses as response on response.request_id = request.request_id
where campaign.id = :'campaign_id'::uuid;

commit;
