begin;

create table public.simulation_accounts (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active', 'paused', 'closed', 'insolvent')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (experiment_id),
  unique (id, owner_id),
  unique (id, experiment_id, owner_id),
  check (closed_at is null or closed_at >= opened_at)
);

create index simulation_accounts_owner_idx on public.simulation_accounts(owner_id);
create trigger simulation_accounts_set_updated_at
before update on public.simulation_accounts
for each row execute function private.set_updated_at();

create table private.cash_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  idempotency_key text not null,
  entry_type text not null check (entry_type in (
    'opening_cash', 'principal', 'fee', 'regulatory_fee', 'dividend',
    'cash_in_lieu', 'borrow_charge', 'interest', 'fx_conversion', 'adjustment'
  )),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(24,8) not null check (amount <> 0),
  effective_at timestamptz not null,
  source_type text not null,
  source_id uuid not null,
  source_component text not null,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  unique (simulation_account_id, idempotency_key),
  unique (simulation_account_id, source_type, source_id, source_component),
  unique (id, owner_id)
);

create index cash_ledger_entries_experiment_idx on private.cash_ledger_entries(experiment_id, effective_at, id);
create index cash_ledger_entries_owner_idx on private.cash_ledger_entries(owner_id);
create trigger cash_ledger_entries_reject_mutation
before update or delete on private.cash_ledger_entries
for each row execute function private.reject_mutation();

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  experiment_version_id uuid not null,
  agent_decision_id uuid,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  idempotency_key text not null,
  side text not null check (side in ('buy', 'sell', 'sell_short', 'buy_to_cover')),
  order_type text not null check (order_type in ('market', 'limit', 'stop', 'stop_limit')),
  time_in_force text not null check (time_in_force in ('day', 'gtc')),
  quantity numeric(28,12) not null check (quantity > 0),
  filled_quantity numeric(28,12) not null default 0 check (filled_quantity >= 0 and filled_quantity <= quantity),
  limit_price numeric(28,12) check (limit_price is null or limit_price > 0),
  stop_price numeric(28,12) check (stop_price is null or stop_price > 0),
  decision_at timestamptz not null,
  submitted_at timestamptz not null,
  eligible_at timestamptz not null,
  expires_at timestamptz,
  trigger_at timestamptz,
  current_status text not null default 'accepted' check (current_status in (
    'accepted', 'pending', 'triggered', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired'
  )),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  foreign key (experiment_version_id, owner_id)
    references public.experiment_versions(id, owner_id) on delete restrict,
  unique (experiment_id, idempotency_key),
  unique (id, owner_id),
  unique (id, experiment_id, owner_id),
  check (submitted_at >= decision_at),
  check (eligible_at >= submitted_at),
  check (expires_at is null or expires_at > submitted_at),
  check ((order_type in ('limit', 'stop_limit')) = (limit_price is not null)),
  check ((order_type in ('stop', 'stop_limit')) = (stop_price is not null))
);

create index orders_account_idx on public.orders(simulation_account_id);
create index orders_owner_idx on public.orders(owner_id);
create index orders_experiment_version_idx on public.orders(experiment_version_id);
create index orders_instrument_idx on public.orders(instrument_id);
create index orders_pending_idx on public.orders(experiment_id, eligible_at)
where current_status in ('accepted', 'pending', 'triggered', 'partially_filled');

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  idempotency_key text not null,
  from_status text,
  to_status text not null check (to_status in (
    'accepted', 'pending', 'triggered', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired'
  )),
  reason_code text,
  reason_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(reason_detail) = 'object'),
  occurred_at timestamptz not null,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (order_id, experiment_id, owner_id)
    references public.orders(id, experiment_id, owner_id) on delete restrict,
  unique (order_id, idempotency_key),
  unique (id, owner_id)
);

create index order_status_events_experiment_idx on public.order_status_events(experiment_id, occurred_at, id);
create index order_status_events_owner_idx on public.order_status_events(owner_id);

create table public.fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  idempotency_key text not null,
  quantity numeric(28,12) not null check (quantity > 0),
  base_market_price numeric(28,12) not null check (base_market_price > 0),
  execution_price numeric(28,12) not null check (execution_price > 0),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  notional numeric(28,12) not null check (notional > 0),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  base_notional numeric(28,12) not null check (base_notional > 0),
  commission numeric(24,8) not null default 0 check (commission >= 0),
  regulatory_fee numeric(24,8) not null default 0 check (regulatory_fee >= 0),
  slippage_amount numeric(24,8) not null default 0 check (slippage_amount >= 0),
  opportunity_at timestamptz not null,
  observed_at timestamptz not null,
  filled_at timestamptz not null,
  market_quote_id uuid references public.market_quotes(id) on delete restrict,
  market_bar_id uuid references public.market_bars(id) on delete restrict,
  fx_rate_id uuid references public.fx_rates(id) on delete restrict,
  simulator_config_version_id uuid not null,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (order_id, experiment_id, owner_id)
    references public.orders(id, experiment_id, owner_id) on delete restrict,
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  foreign key (simulator_config_version_id, owner_id)
    references public.configuration_versions(id, owner_id) on delete restrict,
  unique (order_id, idempotency_key),
  unique (id, owner_id),
  check (num_nonnulls(market_quote_id, market_bar_id) >= 1),
  check (observed_at >= opportunity_at),
  check (filled_at >= observed_at)
);

create index fills_account_idx on public.fills(simulation_account_id, filled_at, id);
create index fills_experiment_idx on public.fills(experiment_id, filled_at, id);
create index fills_owner_idx on public.fills(owner_id);
create index fills_instrument_idx on public.fills(instrument_id);
create index fills_quote_idx on public.fills(market_quote_id);
create index fills_bar_idx on public.fills(market_bar_id);
create index fills_fx_idx on public.fills(fx_rate_id);
create index fills_config_idx on public.fills(simulator_config_version_id);

create table public.fill_market_data_refs (
  id uuid primary key default gen_random_uuid(),
  fill_id uuid not null,
  owner_id uuid not null,
  quote_id uuid references public.market_quotes(id) on delete restrict,
  bar_id uuid references public.market_bars(id) on delete restrict,
  fx_rate_id uuid references public.fx_rates(id) on delete restrict,
  role text not null check (role in ('execution', 'spread', 'liquidity', 'fx', 'validation')),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (fill_id, owner_id) references public.fills(id, owner_id) on delete restrict,
  check (num_nonnulls(quote_id, bar_id, fx_rate_id) = 1),
  unique nulls not distinct (fill_id, quote_id, bar_id, fx_rate_id, role)
);

create index fill_market_data_refs_owner_idx on public.fill_market_data_refs(owner_id);
create index fill_market_data_refs_quote_idx on public.fill_market_data_refs(quote_id);
create index fill_market_data_refs_bar_idx on public.fill_market_data_refs(bar_id);
create index fill_market_data_refs_fx_idx on public.fill_market_data_refs(fx_rate_id);

create table public.position_lots (
  id uuid primary key default gen_random_uuid(),
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  opening_fill_id uuid not null,
  side text not null check (side in ('long', 'short')),
  original_quantity numeric(28,12) not null check (original_quantity > 0),
  remaining_quantity numeric(28,12) not null check (remaining_quantity >= 0 and remaining_quantity <= original_quantity),
  open_price numeric(28,12) not null check (open_price > 0),
  base_notional numeric(28,12) not null check (base_notional > 0),
  open_fee_remaining numeric(24,8) not null default 0 check (open_fee_remaining >= 0),
  opened_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  foreign key (opening_fill_id, owner_id) references public.fills(id, owner_id) on delete restrict,
  unique (opening_fill_id),
  unique (id, owner_id),
  check ((remaining_quantity = 0) = (closed_at is not null))
);

create index position_lots_account_instrument_idx on public.position_lots(simulation_account_id, instrument_id, opened_at);
create index position_lots_owner_idx on public.position_lots(owner_id);
create trigger position_lots_set_updated_at
before update on public.position_lots
for each row execute function private.set_updated_at();

create table public.lot_allocations (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null,
  closing_fill_id uuid not null,
  owner_id uuid not null,
  idempotency_key text not null,
  quantity numeric(28,12) not null check (quantity > 0),
  realized_pnl_base numeric(24,8) not null,
  allocated_open_fee numeric(24,8) not null default 0 check (allocated_open_fee >= 0),
  allocated_close_fee numeric(24,8) not null default 0 check (allocated_close_fee >= 0),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (lot_id, owner_id) references public.position_lots(id, owner_id) on delete restrict,
  foreign key (closing_fill_id, owner_id) references public.fills(id, owner_id) on delete restrict,
  unique (closing_fill_id, idempotency_key),
  unique (lot_id, closing_fill_id)
);

create index lot_allocations_owner_idx on public.lot_allocations(owner_id);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  quantity numeric(28,12) not null,
  average_open_price numeric(28,12) check (average_open_price is null or average_open_price > 0),
  realized_pnl_base numeric(24,8) not null default 0,
  projection_version bigint not null default 0 check (projection_version >= 0),
  as_of timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  unique (simulation_account_id, instrument_id),
  unique (id, owner_id)
);

create index positions_experiment_idx on public.positions(experiment_id);
create index positions_owner_idx on public.positions(owner_id);
create index positions_instrument_idx on public.positions(instrument_id);
create trigger positions_set_updated_at
before update on public.positions
for each row execute function private.set_updated_at();

create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  as_of timestamptz not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  cash_value numeric(24,8) not null,
  long_market_value numeric(24,8) not null check (long_market_value >= 0),
  short_market_value numeric(24,8) not null check (short_market_value >= 0),
  net_liquidation_value numeric(24,8) not null,
  gross_exposure numeric(24,8) not null check (gross_exposure >= 0),
  net_exposure numeric(24,8) not null,
  realized_pnl numeric(24,8) not null,
  unrealized_pnl numeric(24,8) not null,
  buying_power numeric(24,8) not null,
  high_water_mark numeric(24,8) not null,
  drawdown_fraction numeric(18,12) not null check (drawdown_fraction between 0 and 1),
  valuation_inputs jsonb not null check (jsonb_typeof(valuation_inputs) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  unique (simulation_account_id, as_of),
  unique (id, owner_id)
);

create index portfolio_snapshots_experiment_idx on public.portfolio_snapshots(experiment_id, as_of desc);
create index portfolio_snapshots_owner_idx on public.portfolio_snapshots(owner_id);

create table public.risk_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  order_id uuid,
  agent_decision_id uuid,
  event_type text not null,
  severity text not null check (severity in ('info', 'warning', 'breach', 'critical')),
  reason_code text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  unique (experiment_id, correlation_id, reason_code),
  unique (id, owner_id)
);

create index risk_events_owner_idx on public.risk_events(owner_id);
create index risk_events_order_idx on public.risk_events(order_id);
create index risk_events_experiment_timeline_idx on public.risk_events(experiment_id, occurred_at desc);

create table public.margin_snapshots (
  id uuid primary key default gen_random_uuid(),
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  as_of timestamptz not null,
  equity numeric(24,8) not null,
  initial_requirement numeric(24,8) not null check (initial_requirement >= 0),
  maintenance_requirement numeric(24,8) not null check (maintenance_requirement >= 0),
  excess_equity numeric(24,8) not null,
  buying_power numeric(24,8) not null,
  margin_call boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  unique (simulation_account_id, as_of),
  unique (id, owner_id)
);

create index margin_snapshots_experiment_idx on public.margin_snapshots(experiment_id, as_of desc);
create index margin_snapshots_owner_idx on public.margin_snapshots(owner_id);

create table public.borrow_availability (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  available_quantity numeric(28,12) check (available_quantity is null or available_quantity >= 0),
  is_available boolean not null,
  provider_record_key text not null,
  provider_event_at timestamptz not null,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, source_id, instrument_id, provider_record_key),
  unique (id, owner_id),
  check (available_at >= first_seen_at)
);

create index borrow_availability_source_idx on public.borrow_availability(source_id);
create index borrow_availability_pit_idx on public.borrow_availability(owner_id, instrument_id, available_at desc);

create table public.borrow_costs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  annualized_rate numeric(18,12) not null check (annualized_rate >= 0),
  provider_record_key text not null,
  provider_event_at timestamptz not null,
  first_seen_at timestamptz not null,
  available_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, source_id, instrument_id, provider_record_key),
  unique (id, owner_id),
  check (available_at >= first_seen_at)
);

create index borrow_costs_source_idx on public.borrow_costs(source_id);
create index borrow_costs_pit_idx on public.borrow_costs(owner_id, instrument_id, available_at desc);

create table public.simulator_runs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null,
  owner_id uuid not null,
  slot_key text not null,
  simulator_config_version_id uuid not null,
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  started_at timestamptz not null,
  finished_at timestamptz,
  correlation_id uuid not null,
  error_class text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id) references public.experiments(id, owner_id) on delete restrict,
  foreign key (simulator_config_version_id, owner_id) references public.configuration_versions(id, owner_id) on delete restrict,
  unique (experiment_id, slot_key),
  unique (id, owner_id),
  check (finished_at is null or finished_at >= started_at)
);

create index simulator_runs_owner_idx on public.simulator_runs(owner_id);
create index simulator_runs_config_idx on public.simulator_runs(simulator_config_version_id);
create index simulator_runs_timeline_idx on public.simulator_runs(experiment_id, started_at desc);

create table public.corporate_action_applications (
  id uuid primary key default gen_random_uuid(),
  simulation_account_id uuid not null,
  experiment_id uuid not null,
  owner_id uuid not null,
  corporate_action_id uuid not null,
  idempotency_key text not null,
  effective_at timestamptz not null,
  applied_at timestamptz not null,
  adjustment jsonb not null check (jsonb_typeof(adjustment) = 'object'),
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (simulation_account_id, experiment_id, owner_id)
    references public.simulation_accounts(id, experiment_id, owner_id) on delete restrict,
  foreign key (corporate_action_id, owner_id)
    references public.corporate_actions(id, owner_id) on delete restrict,
  unique (simulation_account_id, corporate_action_id),
  unique (simulation_account_id, idempotency_key),
  unique (id, owner_id),
  check (applied_at >= effective_at)
);

create index corporate_action_applications_experiment_idx on public.corporate_action_applications(experiment_id);
create index corporate_action_applications_owner_idx on public.corporate_action_applications(owner_id);

create function private.guard_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['current_status', 'filled_quantity', 'trigger_at', 'updated_at'])
     <> (to_jsonb(old) - array['current_status', 'filled_quantity', 'trigger_at', 'updated_at']) then
    raise exception using errcode = '55000', message = 'immutable order fields cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_order_update() from public, anon, authenticated;
create trigger orders_guard_update
before update on public.orders
for each row execute function private.guard_order_update();
create trigger orders_set_updated_at
before update on public.orders
for each row execute function private.set_updated_at();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'order_status_events', 'fills', 'fill_market_data_refs', 'lot_allocations',
    'portfolio_snapshots', 'risk_events', 'margin_snapshots', 'borrow_availability',
    'borrow_costs', 'corporate_action_applications'
  ] loop
    execute format(
      'create trigger %I_reject_mutation before update or delete on public.%I for each row execute function private.reject_mutation()',
      relation_name, relation_name
    );
  end loop;
end;
$$;

commit;
