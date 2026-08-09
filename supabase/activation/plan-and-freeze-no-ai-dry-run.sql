\set ON_ERROR_STOP on
begin;

select private.freeze_activation_baseline(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint', :'correlation_id'::uuid
);

select jsonb_build_object('schema_version', 2, 'phase', 'baseline-freeze',
  'persisted_state', state, 'decision_at', decision_at,
  'expected_slots', expected_slot_count, 'expected_events', expected_event_count,
  'planned_start_at', planned_start_at, 'planned_end_at', planned_end_at,
  'time_source', 'database_server')
from private.no_ai_shadow_dry_runs where id = :'campaign_id'::uuid;

commit;
