-- Orderly-stop database phase. The runbook requires the independently verified
-- Vercel drain/deactivation gate to finish before this file is invoked.
\set ON_ERROR_STOP on
begin;

select private.emergency_kill_activation_controls(:'campaign_id'::uuid);

select jsonb_build_object('schema_version', 2, 'phase', 'orderly-stop',
  'persisted_state', state, 'scheduler_control_enabled', scheduler_control_enabled,
  'database_kill_committed_by_this_transaction', true,
  'cron_change_attempted', false)
from private.no_ai_shadow_dry_runs where id = :'campaign_id'::uuid;

commit;
