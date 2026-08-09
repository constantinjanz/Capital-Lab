\set ON_ERROR_STOP on
begin;
select private.unschedule_terminal_activation_jobs(:'campaign_id'::uuid);
select jsonb_build_object('schema_version', 2,
  'phase', 'unschedule-terminal-jobs', 'terminal_evidence_preexisted', true,
  'jobs_unscheduled_by_persisted_ids', 2);
commit;
