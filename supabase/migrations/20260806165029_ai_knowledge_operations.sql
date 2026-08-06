begin;

create table public.model_pricing (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'openai',
  model text not null,
  pricing_mode text not null check (pricing_mode in ('tokens', 'tool_call')),
  context_tier text not null default 'standard',
  input_per_million numeric(20,8) not null default 0 check (input_per_million >= 0),
  cached_input_per_million numeric(20,8) not null default 0 check (cached_input_per_million >= 0),
  cache_write_per_million numeric(20,8) not null default 0 check (cache_write_per_million >= 0),
  output_per_million numeric(20,8) not null default 0 check (output_per_million >= 0),
  tool_call_price numeric(20,8) not null default 0 check (tool_call_price >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  source_url text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_verified boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  unique (provider, model, pricing_mode, context_tier, effective_from),
  unique (id, currency),
  check (effective_to is null or effective_to > effective_from)
);

create index model_pricing_effective_idx on public.model_pricing(provider, model, effective_from desc);

create table public.ai_budget_policies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  version integer not null check (version > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  timezone text not null default 'America/New_York',
  trading_day_hard_limit numeric(20,8) not null check (trading_day_hard_limit > 0),
  monthly_soft_limit numeric(20,8) not null check (monthly_soft_limit >= 0),
  monthly_hard_limit numeric(20,8) not null check (monthly_hard_limit > 0),
  lifetime_hard_limit numeric(20,8) not null check (lifetime_hard_limit > 0),
  quota_config jsonb not null check (jsonb_typeof(quota_config) = 'object'),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, version),
  unique (id, owner_id),
  check (monthly_soft_limit <= monthly_hard_limit),
  check (monthly_hard_limit <= lifetime_hard_limit),
  check (effective_to is null or effective_to > effective_from)
);

create index ai_budget_policies_effective_idx on public.ai_budget_policies(owner_id, effective_from desc);

alter table public.experiment_versions
  add constraint experiment_versions_budget_policy_fk
  foreign key (budget_policy_id, owner_id) references public.ai_budget_policies(id, owner_id) on delete restrict;

create table private.ai_budget_periods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  budget_policy_id uuid not null,
  period_kind text not null check (period_kind in ('trading_day', 'month', 'lifetime')),
  period_start timestamptz not null,
  period_end timestamptz,
  hard_limit numeric(20,8) not null check (hard_limit > 0),
  soft_limit numeric(20,8) check (soft_limit is null or soft_limit >= 0),
  settled_amount numeric(20,8) not null default 0 check (settled_amount >= 0),
  reserved_amount numeric(20,8) not null default 0 check (reserved_amount >= 0),
  unknown_amount numeric(20,8) not null default 0 check (unknown_amount >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (budget_policy_id, owner_id) references public.ai_budget_policies(id, owner_id) on delete restrict,
  unique (owner_id, period_kind, period_start),
  unique (id, owner_id),
  check (period_end is null or period_end > period_start),
  check (soft_limit is null or soft_limit <= hard_limit)
);

create index ai_budget_periods_policy_idx on private.ai_budget_periods(budget_policy_id, period_start desc);
create trigger ai_budget_periods_set_updated_at
before update on private.ai_budget_periods
for each row execute function private.set_updated_at();

create table private.ai_quota_periods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  budget_policy_id uuid not null,
  quota_key text not null check (quota_key in ('luna', 'terra', 'sol', 'web_search')),
  period_kind text not null check (period_kind in ('slot', 'trading_day', 'month')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  hard_limit integer not null check (hard_limit > 0),
  settled_count integer not null default 0 check (settled_count >= 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  unknown_count integer not null default 0 check (unknown_count >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (budget_policy_id, owner_id) references public.ai_budget_policies(id, owner_id) on delete restrict,
  unique (owner_id, quota_key, period_kind, period_start),
  unique (id, owner_id),
  check (period_end > period_start)
);

create index ai_quota_periods_policy_idx on private.ai_quota_periods(budget_policy_id, period_start desc);
create trigger ai_quota_periods_set_updated_at
before update on private.ai_quota_periods
for each row execute function private.set_updated_at();

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  agent_role text not null check (agent_role in ('luna', 'terra', 'sol')),
  version integer not null check (version > 0),
  system_prompt text not null,
  output_schema jsonb not null check (jsonb_typeof(output_schema) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, agent_role, version),
  unique (owner_id, agent_role, content_hash),
  unique (id, owner_id)
);

alter table public.experiment_versions
  add constraint experiment_versions_prompt_fk
  foreign key (agent_prompt_version_id, owner_id) references public.prompt_versions(id, owner_id) on delete restrict;

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  scheduler_run_id uuid,
  role text not null check (role in ('luna', 'terra', 'sol', 'code_review')),
  run_type text not null,
  model text not null,
  prompt_version_id uuid,
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'skipped', 'unknown')),
  routing_reason text not null,
  decision_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (prompt_version_id, owner_id) references public.prompt_versions(id, owner_id) on delete restrict,
  unique (experiment_id, correlation_id, role),
  unique (id, owner_id),
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create index agent_runs_owner_idx on public.agent_runs(owner_id);
create index agent_runs_prompt_idx on public.agent_runs(prompt_version_id);
create index agent_runs_timeline_idx on public.agent_runs(experiment_id, decision_at desc);

create table private.ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  experiment_id uuid,
  agent_run_id uuid,
  budget_policy_id uuid not null,
  pricing_id uuid not null references public.model_pricing(id) on delete restrict,
  daily_period_id uuid not null,
  monthly_period_id uuid not null,
  lifetime_period_id uuid not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  call_kind text not null check (call_kind in ('luna', 'terra', 'sol', 'web_search')),
  max_input_tokens integer not null check (max_input_tokens >= 0),
  max_output_tokens integer not null check (max_output_tokens >= 0),
  max_tool_calls integer not null default 0 check (max_tool_calls >= 0),
  reserved_amount numeric(20,8) not null check (reserved_amount >= 0),
  settled_amount numeric(20,8) check (settled_amount is null or settled_amount >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'unknown', 'reconciled')),
  reserved_at timestamptz not null default statement_timestamp(),
  settled_at timestamptz,
  provider_response_id text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (agent_run_id, owner_id) references public.agent_runs(id, owner_id) on delete restrict,
  foreign key (budget_policy_id, owner_id) references public.ai_budget_policies(id, owner_id) on delete restrict,
  foreign key (daily_period_id, owner_id) references private.ai_budget_periods(id, owner_id) on delete restrict,
  foreign key (monthly_period_id, owner_id) references private.ai_budget_periods(id, owner_id) on delete restrict,
  foreign key (lifetime_period_id, owner_id) references private.ai_budget_periods(id, owner_id) on delete restrict,
  unique (owner_id, idempotency_key),
  unique (id, owner_id)
);

create unique index ai_budget_reservations_provider_response_idx
on private.ai_budget_reservations(provider_response_id) where provider_response_id is not null;
create index ai_budget_reservations_experiment_idx on private.ai_budget_reservations(experiment_id, reserved_at desc);
create index ai_budget_reservations_agent_run_idx on private.ai_budget_reservations(agent_run_id);
create index ai_budget_reservations_policy_idx on private.ai_budget_reservations(budget_policy_id);
create index ai_budget_reservations_status_idx on private.ai_budget_reservations(owner_id, status, reserved_at);
create trigger ai_budget_reservations_set_updated_at
before update on private.ai_budget_reservations
for each row execute function private.set_updated_at();

create table private.ai_reservation_quotas (
  reservation_id uuid not null,
  quota_period_id uuid not null,
  owner_id uuid not null,
  reserved_count integer not null default 1 check (reserved_count > 0),
  primary key (reservation_id, quota_period_id),
  foreign key (reservation_id, owner_id) references private.ai_budget_reservations(id, owner_id) on delete restrict,
  foreign key (quota_period_id, owner_id) references private.ai_quota_periods(id, owner_id) on delete restrict
);

create index ai_reservation_quotas_owner_idx on private.ai_reservation_quotas(owner_id);
create index ai_reservation_quotas_period_idx on private.ai_reservation_quotas(quota_period_id);

create table private.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  owner_id uuid not null,
  experiment_id uuid,
  agent_run_id uuid,
  provider_response_id text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  tool_calls integer not null default 0 check (tool_calls >= 0),
  web_search_calls integer not null default 0 check (web_search_calls >= 0),
  actual_cost numeric(20,8) not null check (actual_cost >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  finish_state text not null,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (reservation_id, owner_id) references private.ai_budget_reservations(id, owner_id) on delete restrict,
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (agent_run_id, owner_id) references public.agent_runs(id, owner_id) on delete restrict,
  unique (reservation_id),
  unique (id, owner_id)
);

create unique index ai_usage_events_provider_response_idx
on private.ai_usage_events(provider_response_id) where provider_response_id is not null;
create index ai_usage_events_experiment_idx on private.ai_usage_events(experiment_id, occurred_at desc);
create index ai_usage_events_agent_run_idx on private.ai_usage_events(agent_run_id);
create index ai_usage_events_owner_idx on private.ai_usage_events(owner_id, occurred_at desc);
create trigger ai_usage_events_reject_mutation
before update or delete on private.ai_usage_events
for each row execute function private.reject_mutation();

create table public.model_routing_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  agent_run_id uuid,
  from_role text,
  to_role text,
  outcome text not null check (outcome in ('selected', 'skipped', 'denied', 'escalated', 'completed', 'failed')),
  reason_code text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (agent_run_id, owner_id) references public.agent_runs(id, owner_id) on delete restrict,
  unique (experiment_id, correlation_id, reason_code, outcome),
  unique (id, owner_id)
);

create index model_routing_events_owner_idx on public.model_routing_events(owner_id);
create index model_routing_events_agent_run_idx on public.model_routing_events(agent_run_id);
create index model_routing_events_timeline_idx on public.model_routing_events(experiment_id, occurred_at desc);

create table public.budget_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  budget_period_id uuid not null,
  threshold_percent integer not null check (threshold_percent in (70, 90, 100)),
  amount_at_alert numeric(20,8) not null check (amount_at_alert >= 0),
  emitted_at timestamptz not null default statement_timestamp(),
  acknowledged_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (budget_period_id, owner_id) references private.ai_budget_periods(id, owner_id) on delete restrict,
  unique (budget_period_id, threshold_percent),
  unique (id, owner_id)
);

create index budget_alerts_owner_idx on public.budget_alerts(owner_id, emitted_at desc);

create table public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid not null,
  owner_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  tool_name text not null check (tool_name in (
    'get_market_snapshot', 'get_recent_events', 'get_event_details', 'retrieve_research',
    'get_similar_past_decisions', 'get_portfolio_state', 'get_experiment_rules',
    'get_source_provenance', 'request_controlled_web_research', 'submit_trade_proposal'
  )),
  request_summary jsonb not null check (jsonb_typeof(request_summary) = 'object'),
  response_summary jsonb not null check (jsonb_typeof(response_summary) = 'object'),
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('completed', 'failed', 'denied')),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (agent_run_id, owner_id) references public.agent_runs(id, owner_id) on delete restrict,
  unique (agent_run_id, sequence_no),
  unique (id, owner_id),
  check (finished_at is null or finished_at >= started_at)
);

create index agent_tool_calls_owner_idx on public.agent_tool_calls(owner_id);

create table private.scheduler_slots (
  slot_key text primary key,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  experiment_id uuid,
  job_type text not null,
  scheduler_provider text not null check (scheduler_provider in ('vercel', 'supabase', 'manual')),
  exchange_session_id uuid references public.market_sessions(id) on delete restrict,
  slot_at timestamptz not null,
  lease_until timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'skipped')),
  result jsonb,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  check (lease_until > slot_at)
);

create index scheduler_slots_owner_idx on private.scheduler_slots(owner_id, slot_at desc);
create index scheduler_slots_experiment_idx on private.scheduler_slots(experiment_id, slot_at desc);
create index scheduler_slots_session_idx on private.scheduler_slots(exchange_session_id);
create trigger scheduler_slots_set_updated_at
before update on private.scheduler_slots
for each row execute function private.set_updated_at();

create table private.scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null references private.scheduler_slots(slot_key) on delete restrict,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  experiment_id uuid,
  correlation_id uuid not null,
  status text not null check (status in ('running', 'completed', 'failed', 'skipped', 'duplicate')),
  started_at timestamptz not null,
  finished_at timestamptz,
  skipped_reason text,
  error_class text,
  retry_eligible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (slot_key, correlation_id),
  unique (id, owner_id),
  check (finished_at is null or finished_at >= started_at)
);

create index scheduler_runs_owner_idx on private.scheduler_runs(owner_id, started_at desc);
create index scheduler_runs_experiment_idx on private.scheduler_runs(experiment_id, started_at desc);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  source_id uuid references public.sources(id) on delete restrict,
  name text not null,
  source_kind text not null check (source_kind in ('markdown', 'json_strategy', 'csv_registry', 'web', 'filing', 'synthetic')),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  source_quality numeric(6,5) check (source_quality is null or source_quality between 0 and 1),
  is_synthetic boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (owner_id, name),
  unique (id, owner_id)
);

create index knowledge_sources_source_idx on public.knowledge_sources(source_id);
create trigger knowledge_sources_set_updated_at
before update on public.knowledge_sources
for each row execute function private.set_updated_at();

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  knowledge_source_id uuid not null,
  external_key text not null,
  title text not null,
  status text not null default 'active' check (status in ('active', 'superseded', 'retired')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (knowledge_source_id, owner_id) references public.knowledge_sources(id, owner_id) on delete restrict,
  unique (owner_id, knowledge_source_id, external_key),
  unique (id, owner_id)
);

create index knowledge_documents_source_idx on public.knowledge_documents(knowledge_source_id);
create trigger knowledge_documents_set_updated_at
before update on public.knowledge_documents
for each row execute function private.set_updated_at();

create table public.knowledge_document_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  document_id uuid not null,
  version integer not null check (version > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  raw_storage_path text,
  sanitized_text text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  valid_from timestamptz not null,
  valid_to timestamptz,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (document_id, owner_id) references public.knowledge_documents(id, owner_id) on delete restrict,
  unique (document_id, version),
  unique (document_id, content_hash),
  unique (id, owner_id),
  check (valid_to is null or valid_to > valid_from),
  check (available_at >= first_seen_at)
);

create index knowledge_document_versions_pit_idx on public.knowledge_document_versions(owner_id, document_id, available_at desc);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  document_version_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  plain_text text not null,
  token_estimate integer not null check (token_estimate >= 0),
  search_vector tsvector generated always as (to_tsvector('english', plain_text)) stored,
  embedding extensions.vector(384),
  tags text[] not null default '{}',
  entities jsonb not null default '[]'::jsonb check (jsonb_typeof(entities) = 'array'),
  instrument_ids uuid[] not null default '{}',
  source_quality numeric(6,5) check (source_quality is null or source_quality between 0 and 1),
  valid_from timestamptz not null,
  valid_to timestamptz,
  available_at timestamptz not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (document_version_id, owner_id) references public.knowledge_document_versions(id, owner_id) on delete restrict,
  unique (document_version_id, chunk_index),
  unique (document_version_id, content_hash),
  unique (id, owner_id),
  check (valid_to is null or valid_to > valid_from)
);

create index knowledge_chunks_document_idx on public.knowledge_chunks(document_version_id);
create index knowledge_chunks_pit_idx on public.knowledge_chunks(owner_id, available_at desc, valid_from, valid_to);
create index knowledge_chunks_fts_idx on public.knowledge_chunks using gin(search_vector);
create index knowledge_chunks_tags_idx on public.knowledge_chunks using gin(tags);

create table public.knowledge_corpus_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  version integer not null check (version > 0),
  name text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  available_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, version),
  unique (owner_id, content_hash),
  unique (id, owner_id)
);

create table public.knowledge_corpus_members (
  corpus_version_id uuid not null,
  document_version_id uuid not null,
  owner_id uuid not null,
  primary key (corpus_version_id, document_version_id),
  foreign key (corpus_version_id, owner_id) references public.knowledge_corpus_versions(id, owner_id) on delete restrict,
  foreign key (document_version_id, owner_id) references public.knowledge_document_versions(id, owner_id) on delete restrict
);

create index knowledge_corpus_members_owner_idx on public.knowledge_corpus_members(owner_id);
create index knowledge_corpus_members_document_idx on public.knowledge_corpus_members(document_version_id);

alter table public.experiment_versions
  add constraint experiment_versions_corpus_fk
  foreign key (knowledge_corpus_version_id, owner_id) references public.knowledge_corpus_versions(id, owner_id) on delete restrict;

create table public.decision_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  experiment_version_id uuid not null,
  strategy_version_id uuid,
  decision_at timestamptz not null,
  portfolio_snapshot_id uuid,
  context_manifest jsonb not null check (jsonb_typeof(context_manifest) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (agent_run_id, owner_id) references public.agent_runs(id, owner_id) on delete restrict,
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (experiment_version_id, owner_id) references public.experiment_versions(id, owner_id) on delete restrict,
  foreign key (portfolio_snapshot_id, owner_id) references public.portfolio_snapshots(id, owner_id) on delete restrict,
  unique (agent_run_id),
  unique (id, owner_id)
);

create index decision_context_snapshots_owner_idx on public.decision_context_snapshots(owner_id);
create index decision_context_snapshots_experiment_idx on public.decision_context_snapshots(experiment_id, decision_at desc);

create table public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  context_snapshot_id uuid not null,
  agent_run_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  decision_type text not null check (decision_type in (
    'buy', 'sell', 'sell_short', 'buy_to_cover', 'reduce', 'close', 'hold', 'abstain'
  )),
  instrument_id uuid references public.instruments(id) on delete restrict,
  structured_output jsonb not null check (jsonb_typeof(structured_output) = 'object'),
  concise_rationale text not null,
  confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
  proposal_status text not null check (proposal_status in ('proposed', 'accepted', 'rejected', 'shadow', 'abstained')),
  rejection_reason_code text,
  decided_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (context_snapshot_id, owner_id) references public.decision_context_snapshots(id, owner_id) on delete restrict,
  foreign key (agent_run_id, owner_id) references public.agent_runs(id, owner_id) on delete restrict,
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (context_snapshot_id),
  unique (id, owner_id)
);

create index agent_decisions_owner_idx on public.agent_decisions(owner_id);
create index agent_decisions_instrument_idx on public.agent_decisions(instrument_id);
create index agent_decisions_experiment_idx on public.agent_decisions(experiment_id, decided_at desc);

alter table public.orders
  add constraint orders_agent_decision_fk
  foreign key (agent_decision_id, owner_id) references public.agent_decisions(id, owner_id) on delete restrict;
alter table public.risk_events
  add constraint risk_events_agent_decision_fk
  foreign key (agent_decision_id, owner_id) references public.agent_decisions(id, owner_id) on delete restrict;

create table public.decision_evidence (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null,
  owner_id uuid not null,
  evidence_kind text not null check (evidence_kind in ('quote', 'bar', 'event', 'knowledge', 'prior_decision')),
  market_quote_id uuid references public.market_quotes(id) on delete restrict,
  market_bar_id uuid references public.market_bars(id) on delete restrict,
  event_revision_id uuid references public.event_revisions(id) on delete restrict,
  knowledge_chunk_id uuid references public.knowledge_chunks(id) on delete restrict,
  prior_decision_id uuid references public.agent_decisions(id) on delete restrict,
  evidence_available_at timestamptz not null,
  citation_label text not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (decision_id, owner_id) references public.agent_decisions(id, owner_id) on delete restrict,
  check (num_nonnulls(market_quote_id, market_bar_id, event_revision_id, knowledge_chunk_id, prior_decision_id) = 1),
  check (
    (evidence_kind = 'quote' and market_quote_id is not null) or
    (evidence_kind = 'bar' and market_bar_id is not null) or
    (evidence_kind = 'event' and event_revision_id is not null) or
    (evidence_kind = 'knowledge' and knowledge_chunk_id is not null) or
    (evidence_kind = 'prior_decision' and prior_decision_id is not null)
  ),
  unique nulls not distinct (decision_id, market_quote_id, market_bar_id, event_revision_id, knowledge_chunk_id, prior_decision_id),
  unique (id, owner_id)
);

create index decision_evidence_owner_idx on public.decision_evidence(owner_id);
create index decision_evidence_quote_idx on public.decision_evidence(market_quote_id);
create index decision_evidence_bar_idx on public.decision_evidence(market_bar_id);
create index decision_evidence_event_idx on public.decision_evidence(event_revision_id);
create index decision_evidence_chunk_idx on public.decision_evidence(knowledge_chunk_id);
create index decision_evidence_prior_idx on public.decision_evidence(prior_decision_id);

create table public.trade_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null,
  owner_id uuid not null,
  horizon text not null check (horizon in ('15m', '1h', 'eod', '1d', '5d')),
  evaluated_at timestamptz not null,
  forward_return numeric(18,12),
  benchmark_relative_return numeric(18,12),
  maximum_favorable_excursion numeric(18,12),
  maximum_adverse_excursion numeric(18,12),
  thesis_valid boolean,
  execution_outcome jsonb not null default '{}'::jsonb check (jsonb_typeof(execution_outcome) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (decision_id, owner_id) references public.agent_decisions(id, owner_id) on delete restrict,
  unique (decision_id, horizon),
  unique (id, owner_id)
);

create index trade_outcomes_owner_idx on public.trade_outcomes(owner_id);

create table public.pattern_hypotheses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  experiment_id uuid,
  name text not null,
  hypothesis text not null,
  lifecycle_status text not null default 'proposed' check (lifecycle_status in ('proposed', 'shadow', 'eligible', 'active', 'retired', 'rejected')),
  gate_config jsonb not null check (jsonb_typeof(gate_config) = 'object'),
  proposed_at timestamptz not null,
  updated_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (owner_id, name, proposed_at),
  unique (id, owner_id)
);

create index pattern_hypotheses_experiment_idx on public.pattern_hypotheses(experiment_id);
create trigger pattern_hypotheses_set_updated_at
before update on public.pattern_hypotheses
for each row execute function private.set_updated_at();

create table public.pattern_evidence (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null,
  owner_id uuid not null,
  decision_id uuid,
  outcome_id uuid,
  evidence_type text not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  observed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (pattern_id, owner_id) references public.pattern_hypotheses(id, owner_id) on delete restrict,
  foreign key (decision_id, owner_id) references public.agent_decisions(id, owner_id) on delete restrict,
  foreign key (outcome_id, owner_id) references public.trade_outcomes(id, owner_id) on delete restrict,
  check (num_nonnulls(decision_id, outcome_id) >= 1),
  unique (pattern_id, evidence_type, observed_at)
);

create index pattern_evidence_owner_idx on public.pattern_evidence(owner_id);
create index pattern_evidence_decision_idx on public.pattern_evidence(decision_id);
create index pattern_evidence_outcome_idx on public.pattern_evidence(outcome_id);

create table public.strategy_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  name text not null,
  version integer not null check (version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, name, version),
  unique (owner_id, name, content_hash),
  unique (id, owner_id)
);

create table public.strategy_assignments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  strategy_version_id uuid not null,
  assignment_type text not null check (assignment_type in ('champion', 'challenger')),
  allocation_fraction numeric(18,12) not null check (allocation_fraction between 0 and 1),
  valid_from timestamptz not null,
  valid_to timestamptz,
  promotion_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(promotion_evidence) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (strategy_version_id, owner_id) references public.strategy_versions(id, owner_id) on delete restrict,
  unique (experiment_id, strategy_version_id, valid_from),
  unique (id, owner_id),
  check (valid_to is null or valid_to > valid_from)
);

create unique index one_active_champion_per_experiment_idx
on public.strategy_assignments(experiment_id) where assignment_type = 'champion' and valid_to is null;
create index strategy_assignments_owner_idx on public.strategy_assignments(owner_id);
create index strategy_assignments_strategy_idx on public.strategy_assignments(strategy_version_id);

alter table public.decision_context_snapshots
  add constraint decision_context_strategy_fk
  foreign key (strategy_version_id, owner_id) references public.strategy_versions(id, owner_id) on delete restrict;

create table public.memory_summaries (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  summary_type text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  generated_by text not null check (generated_by in ('deterministic', 'luna')),
  agent_run_id uuid,
  available_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (agent_run_id, owner_id) references public.agent_runs(id, owner_id) on delete restrict,
  unique (experiment_id, summary_type, period_start, period_end),
  unique (id, owner_id),
  check (period_end > period_start),
  check (available_at >= period_end)
);

create index memory_summaries_owner_idx on public.memory_summaries(owner_id);
create index memory_summaries_agent_run_idx on public.memory_summaries(agent_run_id);

create table private.audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.app_users(user_id) on delete restrict,
  experiment_id uuid,
  actor_type text not null check (actor_type in ('owner', 'scheduler', 'system', 'provider')),
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id uuid,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (correlation_id, action, target_type, target_id),
  unique (id, owner_id)
);

create index audit_log_owner_idx on private.audit_log(owner_id, occurred_at desc);
create index audit_log_experiment_idx on private.audit_log(experiment_id, occurred_at desc);
create trigger audit_log_reject_mutation
before update or delete on private.audit_log
for each row execute function private.reject_mutation();

create table private.system_health_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.app_users(user_id) on delete restrict,
  component text not null,
  status text not null check (status in ('healthy', 'degraded', 'unavailable')),
  error_class text,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default statement_timestamp(),
  unique (id, owner_id)
);

create index system_health_events_owner_idx on private.system_health_events(owner_id, occurred_at desc);
create trigger system_health_events_reject_mutation
before update or delete on private.system_health_events
for each row execute function private.reject_mutation();

create table private.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  idempotency_key text not null,
  status text not null check (status in ('running', 'completed', 'failed', 'partial')),
  started_at timestamptz not null,
  finished_at timestamptz,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_inserted integer not null default 0 check (records_inserted >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  correlation_id uuid not null,
  error_class text,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, source_id, idempotency_key),
  unique (id, owner_id),
  check (finished_at is null or finished_at >= started_at)
);

create index ingestion_runs_source_idx on private.ingestion_runs(source_id);
create index ingestion_runs_owner_idx on private.ingestion_runs(owner_id, started_at desc);

create table private.dead_letter_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  source_id uuid references public.sources(id) on delete restrict,
  raw_source_event_id uuid,
  error_class text not null,
  reason text not null,
  retry_eligible boolean not null default false,
  retry_count integer not null default 0 check (retry_count >= 0),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  foreign key (raw_source_event_id, owner_id) references private.raw_source_events(id, owner_id) on delete restrict,
  unique (owner_id, correlation_id, error_class),
  unique (id, owner_id)
);

create index dead_letter_events_source_idx on private.dead_letter_events(source_id);
create index dead_letter_events_raw_event_idx on private.dead_letter_events(raw_source_event_id);
create index dead_letter_events_owner_idx on private.dead_letter_events(owner_id, occurred_at desc);

create table private.application_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  setting_key text not null,
  value jsonb not null,
  is_secret boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (owner_id, setting_key),
  unique (id, owner_id)
);

create trigger application_settings_set_updated_at
before update on private.application_settings
for each row execute function private.set_updated_at();

create table private.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  scope text not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('processing', 'completed', 'failed')),
  result_ref_type text,
  result_ref_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (owner_id, scope, idempotency_key),
  unique (id, owner_id)
);

create index idempotency_records_status_idx on private.idempotency_records(owner_id, scope, status);

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'prompt_versions', 'model_routing_events',
    'agent_tool_calls', 'knowledge_document_versions', 'knowledge_chunks',
    'knowledge_corpus_versions', 'knowledge_corpus_members', 'decision_context_snapshots',
    'agent_decisions', 'decision_evidence', 'trade_outcomes', 'pattern_evidence',
    'strategy_versions', 'memory_summaries'
  ] loop
    execute format(
      'create trigger %I_reject_mutation before update or delete on public.%I for each row execute function private.reject_mutation()',
      relation_name, relation_name
    );
  end loop;
end;
$$;

commit;
