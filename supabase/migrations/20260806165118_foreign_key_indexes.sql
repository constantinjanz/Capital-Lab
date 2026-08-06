begin;

create index experiment_versions_simulator_config_idx on public.experiment_versions(simulator_config_version_id);
create index experiment_versions_risk_config_idx on public.experiment_versions(risk_config_version_id);
create index experiment_versions_routing_config_idx on public.experiment_versions(model_routing_version_id);
create index experiment_versions_source_config_idx on public.experiment_versions(data_source_config_version_id);
create index experiment_versions_prompt_idx on public.experiment_versions(agent_prompt_version_id);
create index experiment_versions_corpus_idx on public.experiment_versions(knowledge_corpus_version_id);
create index experiment_versions_budget_policy_idx on public.experiment_versions(budget_policy_id);
create index experiment_controls_owner_idx on public.experiment_controls(owner_id);

create index orders_agent_decision_idx on public.orders(agent_decision_id);
create index risk_events_agent_decision_idx on public.risk_events(agent_decision_id);

create index ai_budget_reservations_pricing_idx on private.ai_budget_reservations(pricing_id);
create index ai_budget_reservations_daily_period_idx on private.ai_budget_reservations(daily_period_id);
create index ai_budget_reservations_monthly_period_idx on private.ai_budget_reservations(monthly_period_id);
create index ai_budget_reservations_lifetime_period_idx on private.ai_budget_reservations(lifetime_period_id);

alter table public.agent_runs
  add constraint agent_runs_scheduler_run_fk
  foreign key (scheduler_run_id, owner_id)
  references private.scheduler_runs(id, owner_id) on delete restrict;
create index agent_runs_scheduler_run_idx on public.agent_runs(scheduler_run_id);

create index decision_context_experiment_version_idx on public.decision_context_snapshots(experiment_version_id);
create index decision_context_strategy_idx on public.decision_context_snapshots(strategy_version_id);
create index decision_context_portfolio_idx on public.decision_context_snapshots(portfolio_snapshot_id);
create index agent_decisions_agent_run_idx on public.agent_decisions(agent_run_id);

commit;
