-- Phase 2 only: runs after the phase-1 transaction has committed.
\set ON_ERROR_STOP on
begin;
select private.disable_activation_jobs_after_emergency(
  :'campaign_id'::uuid, :'operation_id'::uuid, :'correlation_id'::uuid
);
select private.assert_activation_job_specs(:'campaign_id'::uuid, false);
select jsonb_build_object('schema_version', 3,
  'phase', 'emergency-disable-jobs', 'persisted_job_ids', 2,
  'active_jobs', 0, 'phase_one_remains_committed_on_failure', true);
commit;
