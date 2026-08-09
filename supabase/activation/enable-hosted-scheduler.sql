-- REVIEWED LATER ACTIVATION ONLY. Never run during migration or deployment.
-- Preconditions include verified auth/no-op evidence, frozen baseline, a future
-- two-session plan, Production READY with SCHEDULER_ENABLED still false, and
-- every AI/provider/broker flag false. This file does not change Vercel.
\set ON_ERROR_STOP on
begin;

select set_config('capital_lab.vercel_scheduler_enabled', :'vercel_scheduler_enabled', true) \gset
select set_config('capital_lab.production_deployment_id', :'production_deployment_id', true) \gset
select set_config('capital_lab.production_deployment_ready', :'production_deployment_ready', true) \gset

do $$
begin
  if current_setting('capital_lab.vercel_scheduler_enabled')::boolean then
    raise exception 'Vercel scheduler must remain false while database arming commits';
  end if;
  if length(btrim(current_setting('capital_lab.production_deployment_id'))) = 0
    or current_setting('capital_lab.production_deployment_ready') <> 'READY'
  then
    raise exception 'exact disabled Production deployment evidence is required';
  end if;
  if (select state from private.no_ai_shadow_dry_runs
      where id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001') <> 'baseline_frozen'
  then
    raise exception 'baseline is not frozen';
  end if;
  if (select count(*) from cron.job where jobname in (
      'capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler'
    ) and not active) <> 2
  then
    raise exception 'exactly two disabled expected jobs are required';
  end if;
end;
$$;

select private.arm_no_ai_shadow_dry_run(
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001',
  :'expected_commit_sha', :'config_version', :'correlation_id'::uuid
);

select cron.alter_job(jobid, active := true)
from cron.job
where jobname in ('capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler');

do $$
begin
  if (select count(*) from cron.job where jobname in (
      'capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler'
    ) and active) <> 2
  then
    raise exception 'scheduler arming postflight failed';
  end if;
end;
$$;

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'armed',
  'active_jobs', 2,
  'vercel_scheduler_enabled', false,
  'dangerous_ai_flags_enabled', 0
) as evidence;

commit;
