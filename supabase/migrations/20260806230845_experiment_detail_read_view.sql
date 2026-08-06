begin;

create index if not exists experiments_owner_updated_idx
on public.experiments (owner_id, updated_at desc, id);

create view public.experiment_detail_read_view
with (security_invoker = true)
as
select
  experiment.id,
  experiment.owner_id,
  experiment.name,
  experiment.lifecycle_status,
  experiment.execution_mode,
  experiment.base_currency,
  experiment.initial_capital::text as initial_capital,
  experiment.objective,
  experiment.starts_at,
  experiment.ends_at,
  experiment.pause_reason as lifecycle_pause_reason,
  experiment.locked_at,
  experiment.locked_version_id,
  experiment.created_at,
  experiment.updated_at,
  controls.scheduler_enabled,
  controls.agent_enabled,
  controls.emergency_paused,
  controls.pause_reason as control_pause_reason,
  controls.state_version::text as control_state_version,
  controls.created_at as control_created_at,
  controls.updated_at as control_updated_at,
  locked_version.version as locked_version,
  locked_version.initial_capital::text as locked_initial_capital,
  locked_version.base_currency as locked_base_currency,
  locked_version.objective as locked_objective,
  locked_version.content_hash as locked_version_content_hash,
  locked_version.market_universe_id,
  locked_version.simulator_config_version_id,
  locked_version.risk_config_version_id,
  locked_version.model_routing_version_id,
  locked_version.data_source_config_version_id,
  locked_version.agent_prompt_version_id,
  locked_version.knowledge_corpus_version_id,
  locked_version.budget_policy_id,
  locked_version.created_at as locked_version_created_at
from public.experiments as experiment
left join public.experiment_controls as controls
  on controls.experiment_id = experiment.id
  and controls.owner_id = experiment.owner_id
left join public.experiment_versions as locked_version
  on locked_version.id = experiment.locked_version_id
  and locked_version.experiment_id = experiment.id
  and locked_version.owner_id = experiment.owner_id;

revoke all on public.experiment_detail_read_view
from public, anon, authenticated, service_role;

grant select on public.experiment_detail_read_view
to authenticated, service_role;

commit;
