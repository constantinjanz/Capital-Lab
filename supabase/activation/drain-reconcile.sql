\set ON_ERROR_STOP on
begin;

select private.assert_activation_context(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint'
);
select private.capture_activation_http_responses() as newly_persisted;

select jsonb_build_object('schema_version', 2, 'phase', 'drain-reconcile',
  'persisted_state', campaign.state,
  'submitted_requests', count(event.pg_net_request_id),
  'persisted_responses', count(response.request_id),
  'valid_responses', count(response.request_id) filter (where response.schema_valid))
from private.no_ai_shadow_dry_runs as campaign
left join private.no_ai_shadow_dry_run_events as event on event.dry_run_id = campaign.id
left join private.activation_http_responses as response on response.request_id = event.request_id
where campaign.id = :'campaign_id'::uuid
group by campaign.state;

commit;
