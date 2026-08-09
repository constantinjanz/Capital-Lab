-- REVIEWED LATER ACTIVATION ONLY. This phase is intentionally not executed by
-- the current hardening run.
\set ON_ERROR_STOP on
begin;

select private.arm_activation_campaign(
  :'campaign_id'::uuid, :'expected_commit_sha', :'config_version',
  :'manifest_sha256', :'phase_contract_sha256',
  :'expected_database_fingerprint', :'operation_id'::uuid,
  :'correlation_id'::uuid
);

select jsonb_build_object('schema_version', 2, 'phase', 'arm',
  'persisted_state', state, 'active_jobs', 2,
  'agent_enabled', false, 'paid_models_enabled', false,
  'provider_mode', 'mock-paper-only')
from private.no_ai_shadow_dry_runs where id = :'campaign_id'::uuid;

commit;
