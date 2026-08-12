\set ON_ERROR_STOP on
begin;

select private.prepare_no_ai_shadow_dry_run_v2(
  :'campaign_id'::uuid,
  :'expected_commit_sha',
  :'config_version',
  :'manifest_sha256',
  :'phase_contract_sha256',
  :'relation_contract_sha256',
  :'campaign_manifest_json'::jsonb,
  :'operation_id'::uuid,
  :'correlation_id'::uuid
) as result \gset

select jsonb_build_object(
  'schema_version', 4,
  'phase', 'prepare',
  'campaign_id', campaign.id,
  'persisted_state', campaign.state,
  'derived_commit_sha', campaign.prepared_commit_sha,
  'database_fingerprint', campaign.database_fingerprint,
  'manifest_sha256', campaign.manifest_sha256
) as evidence
from private.no_ai_shadow_dry_runs as campaign
where campaign.id = :'campaign_id'::uuid;

commit;
