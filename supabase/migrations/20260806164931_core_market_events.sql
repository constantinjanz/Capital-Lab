begin;

create table public.app_users (
  user_id uuid primary key references auth.users(id) on delete restrict,
  email extensions.citext not null unique,
  role text not null default 'owner' check (role = 'owner'),
  is_active boolean not null default true,
  bootstrapped_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function private.set_updated_at();

create table public.configuration_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  config_kind text not null check (config_kind in (
    'simulator', 'risk', 'model_routing', 'data_sources', 'experiment_defaults'
  )),
  version integer not null check (version > 0),
  schema_version integer not null default 1 check (schema_version > 0),
  name text not null check (length(btrim(name)) > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, config_kind, version),
  unique (owner_id, config_kind, content_hash),
  unique (id, owner_id)
);

create table public.exchanges (
  id uuid primary key default gen_random_uuid(),
  mic text not null unique check (mic ~ '^[A-Z0-9]{4}$'),
  name text not null,
  timezone text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create trigger exchanges_set_updated_at
before update on public.exchanges
for each row execute function private.set_updated_at();

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  primary_exchange_id uuid not null references public.exchanges(id) on delete restrict,
  symbol text not null check (symbol = upper(symbol) and length(symbol) between 1 and 32),
  name text not null,
  asset_class text not null check (asset_class in ('equity', 'etf', 'option', 'future', 'crypto', 'fx')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  price_increment numeric(28,12) not null check (price_increment > 0),
  quantity_increment numeric(28,12) not null check (quantity_increment > 0),
  is_tradable boolean not null default false,
  is_shortable boolean not null default false,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (primary_exchange_id, symbol),
  check (active_to is null or active_from is null or active_to > active_from)
);

create index instruments_exchange_idx on public.instruments(primary_exchange_id);
create trigger instruments_set_updated_at
before update on public.instruments
for each row execute function private.set_updated_at();

create table public.instrument_aliases (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  provider text not null,
  alias text not null,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (provider, alias, valid_from),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create index instrument_aliases_instrument_idx on public.instrument_aliases(instrument_id);

create table public.market_universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  name text not null,
  version integer not null check (version > 0),
  description text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  locked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, name, version),
  unique (id, owner_id)
);

create table public.market_universe_members (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid not null,
  owner_id uuid not null,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  valid_from timestamptz not null,
  valid_to timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (universe_id, owner_id) references public.market_universes(id, owner_id) on delete cascade,
  unique (universe_id, instrument_id, valid_from),
  check (valid_to is null or valid_to > valid_from)
);

create index market_universe_members_owner_idx on public.market_universe_members(owner_id);
create index market_universe_members_instrument_idx on public.market_universe_members(instrument_id);
create index market_universe_members_pit_idx on public.market_universe_members(universe_id, valid_from, valid_to);

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft', 'starting', 'active', 'paused', 'completed', 'failed')),
  execution_mode text check (execution_mode in ('replay', 'shadow', 'live_paper')),
  base_currency text not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  initial_capital numeric(24,8) not null check (initial_capital > 0),
  objective text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  pause_reason text,
  locked_at timestamptz,
  locked_version_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, owner_id),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (
    (lifecycle_status = 'draft' and locked_at is null and locked_version_id is null and execution_mode is null)
    or
    (lifecycle_status <> 'draft' and locked_at is not null and locked_version_id is not null and execution_mode is not null)
  )
);

create index experiments_owner_status_idx on public.experiments(owner_id, lifecycle_status);
create trigger experiments_set_updated_at
before update on public.experiments
for each row execute function private.set_updated_at();

create table public.experiment_versions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  version integer not null check (version > 0),
  market_universe_id uuid not null,
  simulator_config_version_id uuid not null,
  risk_config_version_id uuid not null,
  model_routing_version_id uuid not null,
  data_source_config_version_id uuid not null,
  agent_prompt_version_id uuid,
  knowledge_corpus_version_id uuid,
  budget_policy_id uuid,
  initial_capital numeric(24,8) not null check (initial_capital > 0),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  objective text not null,
  resolved_rules jsonb not null check (jsonb_typeof(resolved_rules) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (market_universe_id, owner_id) references public.market_universes(id, owner_id) on delete restrict,
  foreign key (simulator_config_version_id, owner_id) references public.configuration_versions(id, owner_id) on delete restrict,
  foreign key (risk_config_version_id, owner_id) references public.configuration_versions(id, owner_id) on delete restrict,
  foreign key (model_routing_version_id, owner_id) references public.configuration_versions(id, owner_id) on delete restrict,
  foreign key (data_source_config_version_id, owner_id) references public.configuration_versions(id, owner_id) on delete restrict,
  unique (experiment_id, version),
  unique (id, owner_id)
);

alter table public.experiments
  add constraint experiments_locked_version_fk
  foreign key (locked_version_id, owner_id) references public.experiment_versions(id, owner_id) on delete restrict;

create index experiment_versions_owner_idx on public.experiment_versions(owner_id);
create index experiment_versions_universe_idx on public.experiment_versions(market_universe_id);

create table public.experiment_controls (
  experiment_id uuid primary key,
  owner_id uuid not null,
  scheduler_enabled boolean not null default false,
  agent_enabled boolean not null default false,
  emergency_paused boolean not null default false,
  pause_reason text,
  state_version bigint not null default 0 check (state_version >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (experiment_id, owner_id)
);

create unique index one_scheduled_experiment_per_owner_idx
on public.experiment_controls(owner_id) where scheduler_enabled;
create trigger experiment_controls_set_updated_at
before update on public.experiment_controls
for each row execute function private.set_updated_at();

create table public.experiment_benchmarks (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  weight numeric(18,12) not null default 1 check (weight > 0 and weight <= 1),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (experiment_id, instrument_id)
);

create index experiment_benchmarks_owner_idx on public.experiment_benchmarks(owner_id);
create index experiment_benchmarks_instrument_idx on public.experiment_benchmarks(instrument_id);

create table public.experiment_status_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  from_status text,
  to_status text not null check (to_status in ('draft', 'starting', 'active', 'paused', 'completed', 'failed')),
  reason_code text,
  reason text,
  actor_type text not null check (actor_type in ('owner', 'scheduler', 'system')),
  correlation_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (experiment_id, correlation_id, to_status)
);

create index experiment_status_events_timeline_idx on public.experiment_status_events(experiment_id, occurred_at desc);
create index experiment_status_events_owner_idx on public.experiment_status_events(owner_id);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  source_type text not null check (source_type in ('market_data', 'news', 'filing', 'government', 'rss', 'web', 'research', 'mock')),
  provider text not null,
  base_url text,
  is_mock boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create trigger sources_set_updated_at
before update on public.sources
for each row execute function private.set_updated_at();

create table public.source_policies (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  version integer not null check (version > 0),
  allowed_use text not null,
  licensing_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(licensing_metadata) = 'object'),
  retention_days integer check (retention_days is null or retention_days > 0),
  requires_authentication boolean not null default false,
  enabled boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (source_id, version),
  check (effective_to is null or effective_to > effective_from)
);

create index source_policies_effective_idx on public.source_policies(source_id, effective_from desc);

create table public.market_sessions (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.exchanges(id) on delete restrict,
  session_date date not null,
  opens_at timestamptz,
  closes_at timestamptz,
  session_type text not null check (session_type in ('regular', 'early_close', 'closed')),
  calendar_source_id uuid references public.sources(id) on delete restrict,
  source_identifier text not null,
  available_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (exchange_id, session_date),
  check ((session_type = 'closed' and opens_at is null and closes_at is null) or
         (session_type <> 'closed' and opens_at is not null and closes_at > opens_at))
);

create index market_sessions_source_idx on public.market_sessions(calendar_source_id);
create index market_sessions_window_idx on public.market_sessions(exchange_id, opens_at, closes_at);

create table private.raw_source_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  storage_bucket text,
  storage_path text,
  normalized_payload jsonb,
  provider_event_at timestamptz,
  provider_received_at timestamptz,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  ingested_at timestamptz not null default statement_timestamp(),
  correlation_id uuid not null,
  unique (owner_id, source_id, external_id, content_hash),
  unique (id, owner_id),
  check ((storage_bucket is null) = (storage_path is null)),
  check (available_at >= first_seen_at)
);

create index raw_source_events_source_idx on private.raw_source_events(source_id);
create index raw_source_events_pit_idx on private.raw_source_events(owner_id, available_at desc);

create table public.market_quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  provider_record_key text not null,
  revision_no integer not null default 1 check (revision_no > 0),
  correction_state text not null default 'original' check (correction_state in ('original', 'corrected', 'cancelled')),
  bid_price numeric(28,12) check (bid_price is null or bid_price >= 0),
  ask_price numeric(28,12) check (ask_price is null or ask_price >= 0),
  bid_size numeric(28,12) check (bid_size is null or bid_size >= 0),
  ask_size numeric(28,12) check (ask_size is null or ask_size >= 0),
  provider_event_at timestamptz not null,
  provider_received_at timestamptz,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  ingested_at timestamptz not null default statement_timestamp(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  supersedes_id uuid references public.market_quotes(id) on delete restrict,
  unique (owner_id, source_id, instrument_id, provider_record_key, revision_no),
  unique (id, owner_id),
  check (ask_price is null or bid_price is null or ask_price >= bid_price),
  check (available_at >= first_seen_at)
);

create index market_quotes_source_idx on public.market_quotes(source_id);
create index market_quotes_supersedes_idx on public.market_quotes(supersedes_id);
create index market_quotes_pit_idx on public.market_quotes(owner_id, instrument_id, available_at desc, provider_event_at desc);

create table public.market_bars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  provider_record_key text not null,
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '1h', '1d')),
  bar_start timestamptz not null,
  bar_end timestamptz not null,
  open_price numeric(28,12) not null check (open_price >= 0),
  high_price numeric(28,12) not null check (high_price >= 0),
  low_price numeric(28,12) not null check (low_price >= 0),
  close_price numeric(28,12) not null check (close_price >= 0),
  volume numeric(28,12) not null check (volume >= 0),
  revision_no integer not null default 1 check (revision_no > 0),
  correction_state text not null default 'original' check (correction_state in ('original', 'corrected', 'cancelled')),
  provider_event_at timestamptz not null,
  provider_received_at timestamptz,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  ingested_at timestamptz not null default statement_timestamp(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  supersedes_id uuid references public.market_bars(id) on delete restrict,
  unique (owner_id, source_id, instrument_id, timeframe, bar_start, revision_no),
  unique (id, owner_id),
  check (bar_end > bar_start),
  check (high_price >= greatest(open_price, low_price, close_price)),
  check (low_price <= least(open_price, high_price, close_price)),
  check (available_at >= first_seen_at)
);

create index market_bars_source_idx on public.market_bars(source_id);
create index market_bars_supersedes_idx on public.market_bars(supersedes_id);
create index market_bars_pit_idx on public.market_bars(owner_id, instrument_id, timeframe, available_at desc, bar_start desc);

create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(28,12) not null check (rate > 0),
  provider_record_key text not null,
  revision_no integer not null default 1 check (revision_no > 0),
  provider_event_at timestamptz not null,
  provider_received_at timestamptz,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  ingested_at timestamptz not null default statement_timestamp(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  supersedes_id uuid references public.fx_rates(id) on delete restrict,
  unique (owner_id, source_id, base_currency, quote_currency, provider_record_key, revision_no),
  unique (id, owner_id),
  check (base_currency <> quote_currency),
  check (available_at >= first_seen_at)
);

create index fx_rates_source_idx on public.fx_rates(source_id);
create index fx_rates_supersedes_idx on public.fx_rates(supersedes_id);
create index fx_rates_pit_idx on public.fx_rates(owner_id, base_currency, quote_currency, available_at desc, provider_event_at desc);

create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  provider_record_key text not null,
  revision_no integer not null default 1 check (revision_no > 0),
  action_type text not null check (action_type in ('split', 'dividend', 'merger', 'spinoff', 'symbol_change', 'delisting')),
  ex_date date,
  effective_at timestamptz not null,
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  provider_event_at timestamptz not null,
  provider_received_at timestamptz,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  ingested_at timestamptz not null default statement_timestamp(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  supersedes_id uuid references public.corporate_actions(id) on delete restrict,
  unique (owner_id, source_id, instrument_id, provider_record_key, revision_no),
  unique (id, owner_id),
  check (available_at >= first_seen_at)
);

create index corporate_actions_source_idx on public.corporate_actions(source_id);
create index corporate_actions_supersedes_idx on public.corporate_actions(supersedes_id);
create index corporate_actions_pit_idx on public.corporate_actions(owner_id, instrument_id, available_at desc, effective_at);

create table public.source_health (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  status text not null check (status in ('healthy', 'degraded', 'unavailable', 'disabled')),
  checked_at timestamptz not null,
  last_success_at timestamptz,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_class text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, source_id, checked_at),
  unique (id, owner_id)
);

create index source_health_source_idx on public.source_health(source_id);
create index source_health_latest_idx on public.source_health(owner_id, source_id, checked_at desc);

create table public.news_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text not null,
  canonical_url text,
  source_type text not null,
  first_seen_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, source_id, external_id),
  unique (id, owner_id)
);

create index news_events_source_idx on public.news_events(source_id);
create index news_events_owner_seen_idx on public.news_events(owner_id, first_seen_at desc);

create table public.event_revisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  owner_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  revision_of_id uuid references public.event_revisions(id) on delete restrict,
  author text,
  issuing_authority text,
  title text not null,
  sanitized_text text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  language text not null default 'en',
  published_at timestamptz,
  provider_received_at timestamptz,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  source_quality numeric(6,5) check (source_quality is null or source_quality between 0 and 1),
  licensing_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(licensing_metadata) = 'object'),
  retention_until timestamptz,
  correction_state text not null default 'original' check (correction_state in ('original', 'corrected', 'retracted')),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (event_id, owner_id) references public.news_events(id, owner_id) on delete restrict,
  unique (event_id, revision_no),
  unique (event_id, content_hash),
  unique (id, owner_id),
  check (available_at >= first_seen_at)
);

create index event_revisions_owner_pit_idx on public.event_revisions(owner_id, available_at desc);
create index event_revisions_event_pit_idx on public.event_revisions(event_id, available_at desc, revision_no desc);
create index event_revisions_revision_of_idx on public.event_revisions(revision_of_id);

create table public.event_entities (
  id uuid primary key default gen_random_uuid(),
  event_revision_id uuid not null,
  owner_id uuid not null,
  entity_type text not null,
  entity_key text not null,
  display_name text not null,
  confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (event_revision_id, owner_id) references public.event_revisions(id, owner_id) on delete cascade,
  unique (event_revision_id, entity_type, entity_key)
);

create index event_entities_owner_idx on public.event_entities(owner_id);

create table public.event_instrument_links (
  id uuid primary key default gen_random_uuid(),
  event_revision_id uuid not null,
  owner_id uuid not null,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  relation_type text not null,
  confidence numeric(6,5) not null check (confidence between 0 and 1),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (event_revision_id, owner_id) references public.event_revisions(id, owner_id) on delete cascade,
  unique (event_revision_id, instrument_id, relation_type)
);

create index event_instrument_links_owner_idx on public.event_instrument_links(owner_id);
create index event_instrument_links_instrument_idx on public.event_instrument_links(instrument_id);

create table public.event_features (
  id uuid primary key default gen_random_uuid(),
  event_revision_id uuid not null,
  owner_id uuid not null,
  feature_version text not null,
  features jsonb not null check (jsonb_typeof(features) = 'object'),
  computed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (event_revision_id, owner_id) references public.event_revisions(id, owner_id) on delete restrict,
  unique (event_revision_id, feature_version)
);

create index event_features_owner_idx on public.event_features(owner_id);

create table public.event_scores (
  id uuid primary key default gen_random_uuid(),
  event_revision_id uuid not null,
  owner_id uuid not null,
  scoring_version text not null,
  materiality numeric(6,5) check (materiality is null or materiality between 0 and 1),
  novelty numeric(6,5) check (novelty is null or novelty between 0 and 1),
  relevance numeric(6,5) check (relevance is null or relevance between 0 and 1),
  scored_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (event_revision_id, owner_id) references public.event_revisions(id, owner_id) on delete restrict,
  unique (event_revision_id, scoring_version)
);

create index event_scores_owner_idx on public.event_scores(owner_id);

-- Provider observations and immutable rules are never rewritten in place.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'configuration_versions', 'market_universes',
    'experiment_versions', 'experiment_status_events',
    'market_sessions', 'market_quotes', 'market_bars', 'fx_rates',
    'corporate_actions', 'source_health', 'news_events', 'event_revisions',
    'event_entities', 'event_instrument_links', 'event_features', 'event_scores'
  ] loop
    execute format(
      'create trigger %I_reject_mutation before update or delete on public.%I for each row execute function private.reject_mutation()',
      relation_name, relation_name
    );
  end loop;
end;
$$;

create trigger raw_source_events_reject_mutation
before update or delete on private.raw_source_events
for each row execute function private.reject_mutation();

commit;
