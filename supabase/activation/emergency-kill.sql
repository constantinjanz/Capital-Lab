-- Phase 1 only: unconditional DB-first kill. It deliberately performs no Cron,
-- Vercel, transport, audit-finalization, or unschedule work.
\set ON_ERROR_STOP on
begin;
select private.emergency_kill_activation_controls(:'campaign_id'::uuid);
select jsonb_build_object('schema_version', 2, 'phase', 'emergency-kill',
  'persisted_state', state, 'scheduler_control_enabled', scheduler_control_enabled,
  'stopped_at', stopped_at, 'cron_change_attempted', false)
from private.no_ai_shadow_dry_runs where id = :'campaign_id'::uuid;
commit;
