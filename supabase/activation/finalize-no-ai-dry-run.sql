\set ON_ERROR_STOP on
begin;

select private.finalize_activation_campaign(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint', :'operation_id'::uuid,
  :'correlation_id'::uuid
);

select jsonb_build_object('schema_version', 2, 'phase', 'manual-finalize',
  'terminal_status', terminal_status, 'expected_slots', expected_slots,
  'actual_slots', actual_slots, 'expected_events', expected_events,
  'actual_events', actual_events, 'complete_responses', complete_response_count,
  'missing_responses', missing_response_count,
  'invalid_responses', invalid_response_count)
from private.activation_terminal_evidence where campaign_id = :'campaign_id'::uuid;

commit;
