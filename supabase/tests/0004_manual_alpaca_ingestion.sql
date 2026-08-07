begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

-- The public surface is authenticated-only and remains a security-invoker
-- wrapper around a fixed-search-path private security definer.
select ok(
  has_function_privilege(
    'authenticated',
    format('public.%I(%s)', function_name, arguments),
    'EXECUTE'
  ),
  format('authenticated may execute public.%s', function_name)
)
from (values
  ('set_hosted_market_source_enabled', 'uuid,boolean'),
  ('begin_manual_hosted_market_ingestion', 'uuid,timestamp with time zone,timestamp with time zone'),
  ('commit_manual_hosted_market_ingestion', 'uuid,jsonb,jsonb,jsonb,integer'),
  ('fail_manual_hosted_market_ingestion', 'uuid,text,integer'),
  ('manual_hosted_market_ingestion_result', 'uuid')
) as functions(function_name, arguments);

select ok(
  not has_function_privilege(
    denied_role,
    format('public.%I(%s)', function_name, arguments),
    'EXECUTE'
  ),
  format('%s cannot execute public.%s', denied_role, function_name)
)
from (values ('anon'::text), ('service_role'::text)) as roles(denied_role)
cross join (values
  ('set_hosted_market_source_enabled', 'uuid,boolean'),
  ('begin_manual_hosted_market_ingestion', 'uuid,timestamp with time zone,timestamp with time zone'),
  ('commit_manual_hosted_market_ingestion', 'uuid,jsonb,jsonb,jsonb,integer'),
  ('fail_manual_hosted_market_ingestion', 'uuid,text,integer'),
  ('manual_hosted_market_ingestion_result', 'uuid')
) as functions(function_name, arguments);

select ok(
  not procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  format('public.%s is a fixed-search-path security invoker', procedure.proname)
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'set_hosted_market_source_enabled',
    'begin_manual_hosted_market_ingestion',
    'commit_manual_hosted_market_ingestion',
    'fail_manual_hosted_market_ingestion',
    'manual_hosted_market_ingestion_result'
  );

select ok(
  procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  format('private.%s is a fixed-search-path security definer', procedure.proname)
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'private'
  and procedure.proname in (
    'set_hosted_market_source_enabled',
    'begin_manual_hosted_market_ingestion',
    'commit_manual_hosted_market_ingestion',
    'fail_manual_hosted_market_ingestion',
    'manual_hosted_market_ingestion_result'
  );

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as acl
    where namespace.nspname in ('public', 'private')
      and procedure.proname in (
        'set_hosted_market_source_enabled',
        'begin_manual_hosted_market_ingestion',
        'commit_manual_hosted_market_ingestion',
        'fail_manual_hosted_market_ingestion',
        'manual_hosted_market_ingestion_result'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any manual hosted ingestion function'
);

select ok(
  not has_table_privilege(
    'authenticated',
    format('%I.%I', target.schema_name, target.table_name),
    privilege_name
  ),
  format(
    'authenticated cannot %s %I.%I directly',
    lower(privilege_name),
    target.schema_name,
    target.table_name
  )
)
from (values
  ('public', 'sources'),
  ('public', 'source_policies'),
  ('public', 'market_quotes'),
  ('public', 'market_bars'),
  ('public', 'source_health'),
  ('private', 'raw_source_events'),
  ('private', 'ingestion_runs'),
  ('private', 'idempotency_records'),
  ('private', 'audit_log')
) as target(schema_name, table_name)
cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as privilege_name;

set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select * from public.set_hosted_market_source_enabled('91000000-0000-4000-8000-000000000001', true)$$,
  '42501',
  'active owner authentication required',
  'an authenticated caller without an identity fails closed'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.begin_manual_hosted_market_ingestion('91000000-0000-4000-8000-000000000002', statement_timestamp() - interval '2 hours', statement_timestamp() - interval '1 hour')$$,
  '42501',
  'active owner authentication required',
  'a non-owner cannot begin hosted ingestion'
);
select throws_ok(
  $$select * from public.manual_hosted_market_ingestion_result('91000000-0000-4000-8000-000000000002')$$,
  '42501',
  'active owner authentication required',
  'a non-owner cannot reconcile hosted ingestion results'
);
reset role;

-- The reusable local seed predates the fixed reviewed manifest.
update public.instruments as instrument
set is_shortable = false,
    active_from = null
from public.exchanges as exchange
where exchange.id = instrument.primary_exchange_id
  and exchange.mic = 'XNAS'
  and instrument.symbol = 'AAPL';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select result.status = 'configured' and not result.replayed
    from public.configure_hosted_market_manifest(
      '91000000-0000-4000-8000-000000000010'
    ) as result
  ),
  'the fixed reviewed manifest is configured before lifecycle activation'
);

select ok(
  (
    select result.status = 'enabled'
      and result.enabled
      and not result.replayed
      and result.policy_version = 2
    from public.set_hosted_market_source_enabled(
      '91000000-0000-4000-8000-000000000011',
      true
    ) as result
  ),
  'the owner enables the exact source by appending policy version two'
);
reset role;

select ok(
  (
    select source.is_enabled
    from public.sources as source
    where source.code = 'alpaca_iex'
  ),
  'source state is enabled'
);
select is(
  (
    select count(*)
    from public.source_policies as policy
    join public.sources as source on source.id = policy.source_id
    where source.code = 'alpaca_iex'
      and policy.effective_to is null
      and policy.enabled
      and policy.allowed_use = 'IEX market data for paper-trading research only; no brokerage, account, or order access.'
      and policy.licensing_metadata = '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb
      and policy.retention_days is null
      and policy.requires_authentication
  ),
  1::bigint,
  'one exact enabled policy is current'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select result.replayed and result.policy_version = 2
    from public.set_hosted_market_source_enabled(
      '91000000-0000-4000-8000-000000000011',
      true
    ) as result
  ),
  'an exact lifecycle retry replays its durable result'
);
select throws_ok(
  $$select * from public.set_hosted_market_source_enabled('91000000-0000-4000-8000-000000000011', false)$$,
  '23505',
  'hosted market lifecycle operation id was reused with different input',
  'a lifecycle operation UUID cannot be reused with changed input'
);
reset role;

select is(
  (
    select count(*)
    from private.audit_log
    where correlation_id = '91000000-0000-4000-8000-000000000011'
      and action = 'market.hosted_source_lifecycle_set'
  ),
  1::bigint,
  'lifecycle replay does not duplicate audit evidence'
);

create temporary table manual_ingestion_fixture (
  window_start timestamptz not null,
  window_end timestamptz not null,
  request_metadata jsonb not null,
  quotes jsonb not null,
  bars jsonb not null
) on commit drop;

with times as (
  select date_trunc('minute', statement_timestamp() - interval '30 minutes') as bar_start
)
insert into manual_ingestion_fixture (
  window_start,
  window_end,
  request_metadata,
  quotes,
  bars
)
select
  times.bar_start - interval '5 minutes',
  times.bar_start + interval '5 minutes',
  jsonb_build_object(
    'feed', 'iex',
    'quote_request_id', 'quotes-page-1',
    'bar_request_ids', jsonb_build_array('bars-page-1')
  ),
  jsonb_build_array(
    jsonb_build_object('symbol', 'AAPL', 'provider_event_at', (times.bar_start + interval '2 minutes')::text, 'bid_price', '100.000000000001', 'ask_price', '100.000000000002', 'bid_size', '10.000000000001', 'ask_size', '11.000000000001'),
    jsonb_build_object('symbol', 'MSFT', 'provider_event_at', (times.bar_start + interval '2 minutes')::text, 'bid_price', '200.000000000001', 'ask_price', '200.000000000002', 'bid_size', '20.000000000001', 'ask_size', '21.000000000001'),
    jsonb_build_object('symbol', 'NVDA', 'provider_event_at', (times.bar_start + interval '2 minutes')::text, 'bid_price', '300.000000000001', 'ask_price', '300.000000000002', 'bid_size', '30.000000000001', 'ask_size', '31.000000000001'),
    jsonb_build_object('symbol', 'QQQ', 'provider_event_at', (times.bar_start + interval '2 minutes')::text, 'bid_price', '400.000000000001', 'ask_price', '400.000000000002', 'bid_size', '40.000000000001', 'ask_size', '41.000000000001'),
    jsonb_build_object('symbol', 'SPY', 'provider_event_at', (times.bar_start + interval '2 minutes')::text, 'bid_price', '500.000000000001', 'ask_price', '500.000000000002', 'bid_size', '50.000000000001', 'ask_size', '51.000000000001')
  ),
  jsonb_build_array(
    jsonb_build_object('symbol', 'AAPL', 'bar_start', times.bar_start::text, 'bar_end', (times.bar_start + interval '1 minute')::text, 'open_price', '99.000000000001', 'high_price', '101.000000000001', 'low_price', '98.000000000001', 'close_price', '100.000000000001', 'volume', '12345.000000000001'),
    jsonb_build_object('symbol', 'SPY', 'bar_start', (times.bar_start + interval '1 minute')::text, 'bar_end', (times.bar_start + interval '2 minutes')::text, 'open_price', '499.000000000001', 'high_price', '501.000000000001', 'low_price', '498.000000000001', 'close_price', '500.000000000001', 'volume', '23456.000000000001')
  )
from times;

grant select on manual_ingestion_fixture to authenticated;

create temporary table manual_ingestion_out_of_scope_baseline
on commit drop
as
select
  (select count(*) from public.market_sessions) as session_count,
  (select count(*) from private.scheduler_slots) as scheduler_slot_count,
  (select count(*) from private.scheduler_runs) as scheduler_run_count,
  (select count(*) from public.agent_runs) as agent_run_count,
  (select count(*) from public.orders) as order_count,
  (select count(*) from public.order_status_events) as order_status_count,
  (select count(*) from public.fills) as fill_count,
  (select count(*) from public.fill_market_data_refs) as fill_ref_count,
  (select count(*) from private.cash_ledger_entries) as ledger_count;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.begin_manual_hosted_market_ingestion('91000000-0000-4000-8000-000000000020', statement_timestamp(), statement_timestamp())$$,
  '22023',
  'ingestion window must be positive, no longer than 24 hours, and completed',
  'zero-length windows are rejected'
);
select throws_ok(
  $$select * from public.begin_manual_hosted_market_ingestion('91000000-0000-4000-8000-000000000021', statement_timestamp() - interval '25 hours', statement_timestamp() - interval '1 minute')$$,
  '22023',
  'ingestion window must be positive, no longer than 24 hours, and completed',
  'windows longer than 24 hours are rejected'
);
select throws_ok(
  $$select * from public.begin_manual_hosted_market_ingestion('91000000-0000-4000-8000-000000000022', statement_timestamp(), statement_timestamp() + interval '1 minute')$$,
  '22023',
  'ingestion window must be positive, no longer than 24 hours, and completed',
  'future windows are rejected'
);

select ok(
  (
    select result.status = 'running'
      and result.symbols = array['AAPL', 'MSFT', 'NVDA', 'QQQ', 'SPY']::text[]
      and not result.replayed
    from manual_ingestion_fixture as fixture
    cross join lateral public.begin_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.window_start,
      fixture.window_end
    ) as result
  ),
  'begin persists a running operation and returns exactly five reviewed symbols'
);

select ok(
  (
    select result.status = 'running' and result.replayed
    from manual_ingestion_fixture as fixture
    cross join lateral public.begin_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.window_start,
      fixture.window_end
    ) as result
  ),
  'an exact begin retry replays the running result'
);

select throws_ok(
  $$
    select *
    from manual_ingestion_fixture as fixture
    cross join lateral public.begin_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.window_start - interval '1 minute',
      fixture.window_end
    )
  $$,
  '23505',
  'manual ingestion operation id was reused with a different window',
  'a begin UUID cannot be reused with changed bounds'
);

select throws_ok(
  $$select * from public.set_hosted_market_source_enabled('91000000-0000-4000-8000-000000000101', false)$$,
  '55000',
  'hosted market source cannot be disabled while ingestion is running',
  'disable is rejected while any hosted ingestion run is running'
);

select throws_ok(
  $$
    select *
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.request_metadata,
      fixture.quotes - 4,
      fixture.bars,
      25
    )
  $$,
  '22023',
  'manual ingestion requires five latest quotes and at most 5000 completed bars',
  'commit rejects a missing reviewed quote'
);

select throws_ok(
  $$
    select *
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.request_metadata,
      jsonb_set(fixture.quotes, '{0,bid_price}', '"1e2"'::jsonb),
      fixture.bars,
      25
    )
  $$,
  '22023',
  'quote record does not match the exact decimal-string contract',
  'commit rejects non-canonical decimal notation'
);

select throws_ok(
  $$
    select *
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.request_metadata,
      jsonb_set(fixture.quotes, '{0,bid_price}', '"101.000000000000"'::jsonb),
      fixture.bars,
      25
    )
  $$,
  '22023',
  'quote values violate market invariants',
  'commit rejects a crossed quote'
);

select ok(
  (
    select result.status = 'completed'
      and result.records_seen = 7
      and result.records_inserted = 7
      and result.records_reused = 0
      and result.records_rejected = 0
      and not result.replayed
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.request_metadata,
      fixture.quotes,
      fixture.bars,
      25
    ) as result
  ),
  'a valid payload commits five quotes and two completed one-minute bars atomically'
);
reset role;

select is(
  (
    select count(*)
    from private.raw_source_events
    where correlation_id = '91000000-0000-4000-8000-000000000100'
      and external_id = 'manual-alpaca-ingestion:91000000-0000-4000-8000-000000000100'
      and first_seen_at = available_at
      and available_at = ingested_at
      and normalized_payload ->> 'manifest_id' = 'capital_lab_us_core_alpaca_iex_v1'
  ),
  1::bigint,
  'commit appends one normalized raw envelope with database-stamped availability'
);
select is(
  (
    select count(*)
    from public.market_quotes as quote
    join public.instruments as instrument on instrument.id = quote.instrument_id
    join public.sources as source on source.id = quote.source_id
    where quote.owner_id = '00000000-0000-0000-0000-000000000001'
      and source.code = 'alpaca_iex'
      and instrument.symbol = 'AAPL'
      and quote.revision_no = 1
      and quote.correction_state = 'original'
      and quote.bid_price = 100.000000000001::numeric
      and quote.ask_price = 100.000000000002::numeric
      and quote.bid_size = 10.000000000001::numeric
      and quote.ask_size = 11.000000000001::numeric
      and quote.first_seen_at = quote.available_at
      and quote.available_at = quote.ingested_at
      and quote.provider_received_at is null
  ),
  1::bigint,
  'quote decimals remain exact and all local observation timestamps are database-stamped'
);
select is(
  (
    select count(*)
    from public.market_bars as bar
    join public.instruments as instrument on instrument.id = bar.instrument_id
    join public.sources as source on source.id = bar.source_id
    where bar.owner_id = '00000000-0000-0000-0000-000000000001'
      and source.code = 'alpaca_iex'
      and instrument.symbol = 'AAPL'
      and bar.timeframe = '1m'
      and bar.revision_no = 1
      and bar.open_price = 99.000000000001::numeric
      and bar.high_price = 101.000000000001::numeric
      and bar.low_price = 98.000000000001::numeric
      and bar.close_price = 100.000000000001::numeric
      and bar.volume = 12345.000000000001::numeric
      and bar.bar_end - bar.bar_start = interval '1 minute'
      and bar.first_seen_at = bar.available_at
      and bar.available_at = bar.ingested_at
  ),
  1::bigint,
  'one-minute bar decimals and database availability timestamps remain exact'
);
select is(
  (
    select count(*)
    from public.source_health as health
    join public.sources as source on source.id = health.source_id
    where health.owner_id = '00000000-0000-0000-0000-000000000001'
      and source.code = 'alpaca_iex'
      and health.status = 'healthy'
      and health.last_success_at = health.checked_at
      and health.latency_ms = 25
      and health.error_class is null
  ),
  1::bigint,
  'successful commit appends healthy source evidence'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select result.status = 'completed'
      and result.records_seen = 7
      and result.records_inserted = 7
      and result.records_reused = 0
      and result.replayed
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.request_metadata,
      fixture.quotes,
      fixture.bars,
      25
    ) as result
  ),
  'an exact commit retry replays counters without duplicate writes'
);
select throws_ok(
  $$
    select *
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000100',
      fixture.request_metadata,
      fixture.quotes,
      fixture.bars,
      26
    )
  $$,
  '23505',
  'manual ingestion commit operation id was reused with different input',
  'a commit UUID cannot be replayed with changed request metadata or latency'
);

select ok(
  (
    select not result.replayed
    from manual_ingestion_fixture as fixture
    cross join lateral public.begin_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000200',
      fixture.window_start,
      fixture.window_end
    ) as result
  ),
  'a second operation starts for identical provider observations'
);
select ok(
  (
    select result.records_seen = 7
      and result.records_inserted = 0
      and result.records_reused = 7
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000200',
      fixture.request_metadata,
      fixture.quotes,
      fixture.bars,
      30
    ) as result
  ),
  'a distinct operation deduplicates all seven identical observation values'
);

select ok(
  (
    select not result.replayed
    from manual_ingestion_fixture as fixture
    cross join lateral public.begin_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000300',
      fixture.window_start,
      fixture.window_end
    ) as result
  ),
  'a correction operation starts'
);
select ok(
  (
    select result.records_seen = 7
      and result.records_inserted = 1
      and result.records_reused = 6
    from manual_ingestion_fixture as fixture
    cross join lateral public.commit_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000300',
      fixture.request_metadata,
      jsonb_set(
        jsonb_set(fixture.quotes, '{0,bid_price}', '"100.000000000003"'::jsonb),
        '{0,ask_price}',
        '"100.000000000004"'::jsonb
      ),
      fixture.bars,
      35
    ) as result
  ),
  'one changed logical quote appends a correction and reuses six identical values'
);
reset role;

select ok(
  (
    select corrected.revision_no = 2
      and corrected.correction_state = 'corrected'
      and corrected.supersedes_id = original.id
      and corrected.bid_price = 100.000000000003::numeric
      and corrected.ask_price = 100.000000000004::numeric
    from public.market_quotes as corrected
    join public.market_quotes as original
      on original.id = corrected.supersedes_id
    join public.instruments as instrument on instrument.id = corrected.instrument_id
    join public.sources as source on source.id = corrected.source_id
    where corrected.owner_id = '00000000-0000-0000-0000-000000000001'
      and source.code = 'alpaca_iex'
      and instrument.symbol = 'AAPL'
      and original.revision_no = 1
  ),
  'a corrected quote is append-only and explicitly supersedes revision one'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select not result.replayed
    from manual_ingestion_fixture as fixture
    cross join lateral public.begin_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000400',
      fixture.window_start,
      fixture.window_end
    ) as result
  ),
  'a failure-path operation starts'
);
select throws_ok(
  $$select * from public.fail_manual_hosted_market_ingestion('91000000-0000-4000-8000-000000000400', 'database_detail: secret', 40)$$,
  '22023',
  'sanitized allowlisted error class and bounded latency are required',
  'arbitrary provider or persistence error text is rejected'
);
select ok(
  (
    select result.status = 'failed'
      and result.error_class = 'persistence_rejected'
      and result.records_seen = 0
      and result.records_inserted = 0
      and not result.replayed
    from public.fail_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000400',
      'persistence_rejected',
      40
    ) as result
  ),
  'a definite persistence rejection finalizes the durable running operation safely'
);
select ok(
  (
    select result.status = 'failed'
      and result.error_class = 'persistence_rejected'
      and result.replayed
    from public.fail_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000400',
      'persistence_rejected',
      40
    ) as result
  ),
  'an exact failure retry replays without duplicate evidence'
);
select ok(
  (
    select result.status = 'completed'
      and result.records_seen = 7
      and result.records_inserted = 7
      and result.records_reused = 0
      and result.error_class is null
    from public.manual_hosted_market_ingestion_result(
      '91000000-0000-4000-8000-000000000100'
    ) as result
  ),
  'owner reconciliation returns the completed operation counters'
);
select ok(
  (
    select result.status = 'failed'
      and result.error_class = 'persistence_rejected'
      and result.finished_at is not null
    from public.manual_hosted_market_ingestion_result(
      '91000000-0000-4000-8000-000000000400'
    ) as result
  ),
  'owner reconciliation returns the terminal failed operation'
);
reset role;

select is(
  (
    select count(*)
    from public.source_health as health
    join public.sources as source on source.id = health.source_id
    where health.owner_id = '00000000-0000-0000-0000-000000000001'
      and source.code = 'alpaca_iex'
      and health.status = 'unavailable'
      and health.error_class = 'persistence_rejected'
      and health.latency_ms = 40
      and health.last_success_at is not null
  ),
  1::bigint,
  'failure appends sanitized unavailable health while retaining last success'
);
select is(
  (
    select count(*)
    from private.audit_log
    where correlation_id = '91000000-0000-4000-8000-000000000400'
      and action = 'market.manual_hosted_ingestion_failed'
  ),
  1::bigint,
  'failure replay does not duplicate audit evidence'
);
select ok(
  not exists (
    select 1
    from private.audit_log as audit
    where audit.action in (
      'market.hosted_source_lifecycle_set',
      'market.manual_hosted_ingestion_started',
      'market.manual_hosted_ingestion_committed',
      'market.manual_hosted_ingestion_failed'
    )
      and audit.metadata::text ~* '(api[_-]?key|secret|authorization|bid_price|ask_price|open_price|close_price|normalized_payload)'
  ),
  'lifecycle and ingestion audit metadata contains no credentials, raw payload, or market values'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select result.status = 'disabled'
      and not result.enabled
      and not result.replayed
      and result.policy_version = 3
    from public.set_hosted_market_source_enabled(
      '91000000-0000-4000-8000-000000000500',
      false
    ) as result
  ),
  'the owner disables the source after every run is terminal by appending policy version three'
);
select throws_ok(
  $$
    select *
    from manual_ingestion_fixture as fixture
    cross join lateral public.begin_manual_hosted_market_ingestion(
      '91000000-0000-4000-8000-000000000501',
      fixture.window_start,
      fixture.window_end
    )
  $$,
  '55000',
  'hosted market source is disabled',
  'disabled source state blocks a new manual ingestion run'
);
reset role;

select is(
  (select count(*) from public.market_sessions),
  (select session_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates market sessions'
);
select is(
  (select count(*) from private.scheduler_slots),
  (select scheduler_slot_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates scheduler slots'
);
select is(
  (select count(*) from private.scheduler_runs),
  (select scheduler_run_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates scheduler runs'
);
select is(
  (select count(*) from public.agent_runs),
  (select agent_run_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates agent runs'
);
select is(
  (select count(*) from public.orders),
  (select order_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates orders'
);
select is(
  (select count(*) from public.order_status_events),
  (select order_status_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates order status events'
);
select is(
  (select count(*) from public.fills),
  (select fill_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates fills'
);
select is(
  (select count(*) from public.fill_market_data_refs),
  (select fill_ref_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates fill references'
);
select is(
  (select count(*) from private.cash_ledger_entries),
  (select ledger_count from manual_ingestion_out_of_scope_baseline),
  'manual ingestion never creates ledger entries'
);

select * from finish();
rollback;
