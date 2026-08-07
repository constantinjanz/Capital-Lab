begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.configure_hosted_market_manifest(uuid)',
    'EXECUTE'
  ),
  'authenticated owners may request the fixed hosted market manifest'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.configure_hosted_market_manifest(uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot request hosted market configuration'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.configure_hosted_market_manifest(uuid)',
    'EXECUTE'
  ),
  'service-role credentials cannot bypass owner authentication for hosted market configuration'
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
      and procedure.proname = 'configure_hosted_market_manifest'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute either hosted market configuration function'
);
select ok(
  not (
    select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'configure_hosted_market_manifest'
  ),
  'the exposed hosted market configuration wrapper is a security invoker'
);
select ok(
  (
    select procedure.prosecdef
      and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'configure_hosted_market_manifest'
  ),
  'the private hosted market implementation is a security definer with a fixed search path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'private.reviewed_hosted_market_manifest_id(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated snapshot callers may evaluate the private reviewed-manifest signal'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.reviewed_hosted_market_manifest_id(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'the existing service-role snapshot grant chain can evaluate the private signal'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.reviewed_hosted_market_manifest_id(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'anonymous callers cannot evaluate the private reviewed-manifest signal'
);
select ok(
  not (
    select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'reviewed_hosted_market_manifest_id'
  ),
  'the reviewed-manifest signal is a security invoker'
);
select ok(
  (
    select coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'reviewed_hosted_market_manifest_id'
  ),
  'the reviewed-manifest signal has a fixed search path'
);

select ok(
  not has_table_privilege(
    'authenticated',
    format('%I.%I', target.schema_name, target.table_name),
    privilege_name
  ),
  format(
    'authenticated callers cannot %s %I.%I directly',
    lower(privilege_name),
    target.schema_name,
    target.table_name
  )
)
from (values
  ('public', 'exchanges'),
  ('public', 'instruments'),
  ('public', 'instrument_aliases'),
  ('public', 'market_universes'),
  ('public', 'market_universe_members'),
  ('public', 'sources'),
  ('public', 'source_policies'),
  ('private', 'idempotency_records'),
  ('private', 'audit_log')
) as target(schema_name, table_name)
cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as privilege_name;

set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000001')$$,
  '42501',
  'active owner authentication required',
  'an authenticated session without an owner identity fails closed'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000002')$$,
  '42501',
  'active owner authentication required',
  'a non-owner identity cannot configure the hosted market manifest'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest(null)$$,
  '22023',
  'operation id is required',
  'a null operation identifier is rejected'
);
reset role;

-- The local seed predates the reviewed hosted manifest. Align its reused AAPL
-- reference inside this rollback-only test; hosted projects begin without it.
update public.instruments as instrument
set is_shortable = false,
    active_from = null
from public.exchanges as exchange
where exchange.id = instrument.primary_exchange_id
  and exchange.mic = 'XNAS'
  and instrument.symbol = 'AAPL';

create temporary table hosted_market_evidence_baseline
on commit drop
as
select
  (select count(*) from public.market_quotes) as quote_count,
  (select count(*) from public.market_bars) as bar_count,
  (select count(*) from public.fx_rates) as fx_rate_count,
  (select count(*) from public.corporate_actions) as corporate_action_count,
  (select count(*) from private.raw_source_events) as raw_count,
  (select count(*) from public.source_health) as health_count,
  (select count(*) from public.market_sessions) as session_count,
  (select count(*) from private.ingestion_runs) as ingestion_run_count,
  (select count(*) from private.scheduler_slots) as scheduler_slot_count,
  (select count(*) from private.scheduler_runs) as scheduler_run_count;

savepoint conflicting_reference;
insert into public.sources (
  code,
  name,
  source_type,
  provider,
  base_url,
  is_mock,
  is_enabled
) values (
  'alpaca_iex',
  'Conflicting source',
  'market_data',
  'alpaca',
  'https://example.invalid',
  false,
  false
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000100')$$,
  '23514',
  'hosted market source conflicts with the reviewed manifest',
  'conflicting source metadata is rejected after reference validation'
);
reset role;

select is(
  (select count(*) from public.exchanges where mic = 'ARCX'),
  0::bigint,
  'a late source conflict rolls back the newly inserted exchange'
);
select is(
  (
    select count(*)
    from public.instruments as instrument
    join public.exchanges as exchange on exchange.id = instrument.primary_exchange_id
    where (exchange.mic, instrument.symbol) in (
      ('ARCX', 'QQQ'),
      ('ARCX', 'SPY'),
      ('XNAS', 'MSFT'),
      ('XNAS', 'NVDA')
    )
  ),
  0::bigint,
  'a late source conflict rolls back all newly inserted instruments'
);
select is(
  (select count(*) from public.instrument_aliases where provider = 'alpaca'),
  0::bigint,
  'a late source conflict rolls back all newly inserted aliases'
);
select is(
  (
    select count(*)
    from private.idempotency_records
    where scope = 'market.configure_hosted_manifest.v1'
      and idempotency_key = '90000000-0000-4000-8000-000000000100'
  ),
  0::bigint,
  'a rejected configuration leaves no processing idempotency record'
);
select is(
  (
    select count(*)
    from private.audit_log
    where correlation_id = '90000000-0000-4000-8000-000000000100'
  ),
  0::bigint,
  'a rejected configuration leaves no audit evidence'
);
rollback to savepoint conflicting_reference;

savepoint initially_enabled_source;
insert into public.sources (
  code,
  name,
  source_type,
  provider,
  base_url,
  is_mock,
  is_enabled
) values (
  'alpaca_iex',
  'Alpaca IEX Market Data',
  'market_data',
  'alpaca',
  'https://data.alpaca.markets',
  false,
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000118')$$,
  '23514',
  'hosted market source conflicts with the reviewed manifest',
  'an initially enabled source without prior reviewed provenance is rejected'
);
reset role;
rollback to savepoint initially_enabled_source;

savepoint initially_enabled_policy;
insert into public.sources (
  code,
  name,
  source_type,
  provider,
  base_url,
  is_mock,
  is_enabled
) values (
  'alpaca_iex',
  'Alpaca IEX Market Data',
  'market_data',
  'alpaca',
  'https://data.alpaca.markets',
  false,
  false
);
insert into public.source_policies (
  source_id,
  version,
  allowed_use,
  licensing_metadata,
  retention_days,
  requires_authentication,
  enabled,
  effective_from,
  effective_to
)
select
  source.id,
  1,
  'IEX market data for paper-trading research only; no brokerage, account, or order access.',
  '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb,
  null,
  true,
  true,
  statement_timestamp(),
  null
from public.sources as source
where source.code = 'alpaca_iex';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000119')$$,
  '23514',
  'hosted market source policy conflicts with the reviewed manifest',
  'an initially enabled policy without prior reviewed provenance is rejected'
);
reset role;
rollback to savepoint initially_enabled_policy;

savepoint initially_extra_policy_version;
insert into public.sources (
  code,
  name,
  source_type,
  provider,
  base_url,
  is_mock,
  is_enabled
) values (
  'alpaca_iex',
  'Alpaca IEX Market Data',
  'market_data',
  'alpaca',
  'https://data.alpaca.markets',
  false,
  false
);
insert into public.source_policies (
  source_id,
  version,
  allowed_use,
  licensing_metadata,
  retention_days,
  requires_authentication,
  enabled,
  effective_from,
  effective_to
)
select
  source.id,
  policy.version,
  policy.allowed_use,
  policy.licensing_metadata,
  null,
  true,
  false,
  statement_timestamp(),
  null
from public.sources as source
cross join (values
  (
    1,
    'IEX market data for paper-trading research only; no brokerage, account, or order access.'::text,
    '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb
  ),
  (2, 'unreviewed policy'::text, '{}'::jsonb)
) as policy(version, allowed_use, licensing_metadata)
where source.code = 'alpaca_iex';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000113')$$,
  '23514',
  'hosted market source has an unreviewed policy version',
  'an extra policy version without prior reviewed provenance is rejected'
);
reset role;
rollback to savepoint initially_extra_policy_version;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'a pre-existing unrelated current universe has no reviewed manifest signal'
);
select ok(
  (
    select
      operation_id = '90000000-0000-4000-8000-000000000101'::uuid
      and status = 'configured'
      and universe_id is not null
      and source_id is not null
      and not replayed
    from public.configure_hosted_market_manifest(
      '90000000-0000-4000-8000-000000000101'
    )
  ),
  'the first owner operation returns one configured non-replay result'
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  'capital_lab_us_core_alpaca_iex_v1'::text,
  'the atomic market snapshot carries the database-attested reviewed manifest id'
);
reset role;

savepoint reviewed_manifest_source_url;
update public.sources
set base_url = 'https://example.invalid'
where code = 'alpaca_iex';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'a conflicting source URL removes the reviewed manifest signal'
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000101')$$,
  '55000',
  'hosted market operation result no longer matches its reviewed manifest',
  'an idempotent replay fails closed when immutable source evidence drifts'
);
reset role;
rollback to savepoint reviewed_manifest_source_url;

savepoint reviewed_manifest_exchange_country;
update public.exchanges
set country_code = 'CA'
where mic = 'XNAS';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'conflicting exchange country metadata removes the reviewed manifest signal'
);
reset role;
rollback to savepoint reviewed_manifest_exchange_country;

savepoint reviewed_manifest_alias;
update public.instrument_aliases
set valid_to = statement_timestamp() + interval '1 day'
where provider = 'alpaca'
  and alias = 'NVDA';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'a future-bounded Alpaca alias removes the reviewed manifest signal'
);
reset role;
rollback to savepoint reviewed_manifest_alias;

savepoint reviewed_manifest_policy;
set local session_replication_role = replica;
update public.source_policies as policy
set allowed_use = 'conflicting use'
from public.sources as source
where source.id = policy.source_id
  and source.code = 'alpaca_iex'
  and policy.version = 1;
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'conflicting active policy terms remove the reviewed manifest signal'
);
reset role;
rollback to savepoint reviewed_manifest_policy;

savepoint reviewed_manifest_enablement;
create temporary table reviewed_manifest_activation_boundary
on commit drop
as select statement_timestamp() as effective_at;
update public.sources
set is_enabled = true
where code = 'alpaca_iex';
update public.source_policies as policy
set effective_to = boundary.effective_at
from public.sources as source
cross join reviewed_manifest_activation_boundary as boundary
where source.id = policy.source_id
  and source.code = 'alpaca_iex'
  and policy.version = 1;
insert into public.source_policies (
  source_id,
  version,
  allowed_use,
  licensing_metadata,
  retention_days,
  requires_authentication,
  enabled,
  effective_from,
  effective_to
)
select
  source.id,
  2,
  'IEX market data for paper-trading research only; no brokerage, account, or order access.',
  '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb,
  null,
  true,
  true,
  boundary.effective_at,
  null
from public.sources as source
cross join reviewed_manifest_activation_boundary as boundary
where source.code = 'alpaca_iex';
select ok(
  (
    select closed_policy.effective_to = active_policy.effective_from
    from public.source_policies as closed_policy
    join public.source_policies as active_policy
      on active_policy.source_id = closed_policy.source_id
      and active_policy.version = 2
    join public.sources as source on source.id = closed_policy.source_id
    where source.code = 'alpaca_iex'
      and closed_policy.version = 1
  ),
  'the append-only policy activation shares one gap-free effective boundary'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  'capital_lab_us_core_alpaca_iex_v1'::text,
  'a legitimate append-only policy activation does not erase manifest provenance'
);
select ok(
  (
    select result.replayed
    from public.configure_hosted_market_manifest(
      '90000000-0000-4000-8000-000000000101'
    ) as result
  ),
  'idempotent replay recognizes the reviewed foundation after separate activation'
);
reset role;

insert into public.market_universes (
  owner_id,
  name,
  version,
  description,
  content_hash,
  locked_at
) values (
  '00000000-0000-0000-0000-000000000001',
  'Activated lifecycle placeholder',
  1,
  'Exercises reviewed-universe append after a separate activation.',
  repeat('b', 64),
  statement_timestamp()
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select
      result.status = 'configured'
      and universe.name = 'Capital Lab US Core'
      and universe.version = 2
      and not result.replayed
    from public.configure_hosted_market_manifest(
      '90000000-0000-4000-8000-000000000117'
    ) as result
    join public.market_universes as universe on universe.id = result.universe_id
  ),
  'a fresh operation appends the reviewed universe after activation and unrelated current state'
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  'capital_lab_us_core_alpaca_iex_v1'::text,
  'the appended current universe restores the reviewed manifest signal'
);
reset role;
select ok(
  (
    select source.is_enabled
    from public.sources as source
    where source.code = 'alpaca_iex'
  ),
  'fresh universe configuration preserves the separately enabled source'
);
select ok(
  (
    select
      count(*) = 2
      and bool_and(
        (policy.version = 1 and policy.effective_to = boundary.effective_at and not policy.enabled)
        or (policy.version = 2 and policy.effective_from = boundary.effective_at and policy.effective_to is null and policy.enabled)
      )
    from public.source_policies as policy
    join public.sources as source on source.id = policy.source_id
    cross join reviewed_manifest_activation_boundary as boundary
    where source.code = 'alpaca_iex'
  ),
  'fresh universe configuration leaves the two-version policy lifecycle unchanged'
);
select ok(
  (
    select
      audit.metadata ->> 'lifecycle_preserved' = 'true'
      and audit.metadata ->> 'source_enabled' = 'true'
    from private.audit_log as audit
    where audit.correlation_id = '90000000-0000-4000-8000-000000000117'
      and audit.action = 'market.hosted_manifest_configured'
  ),
  'the new audit truthfully records that activated lifecycle state was preserved'
);
rollback to savepoint reviewed_manifest_enablement;

savepoint reviewed_manifest_member;
update public.market_universe_members as member
set valid_to = statement_timestamp() + interval '1 day'
where member.id = (
  select target_member.id
  from public.market_universe_members as target_member
  join public.market_universes as universe
    on universe.id = target_member.universe_id
  join public.instruments as instrument
    on instrument.id = target_member.instrument_id
  where universe.owner_id = '00000000-0000-0000-0000-000000000001'
    and universe.name = 'Capital Lab US Core'
    and universe.version = 1
    and instrument.symbol = 'NVDA'
  limit 1
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'a future-ending universe member removes the reviewed manifest signal'
);
reset role;
rollback to savepoint reviewed_manifest_member;

savepoint reviewed_manifest_instrument;
update public.instruments as instrument
set name = 'Conflicting NVIDIA reference'
from public.exchanges as exchange
where exchange.id = instrument.primary_exchange_id
  and exchange.mic = 'XNAS'
  and instrument.symbol = 'NVDA';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'conflicting instrument metadata removes the reviewed manifest signal'
);
reset role;
rollback to savepoint reviewed_manifest_instrument;

savepoint reviewed_manifest_lock_time;
set local session_replication_role = replica;
update public.market_universes
set locked_at = statement_timestamp() + interval '1 day'
where owner_id = '00000000-0000-0000-0000-000000000001'
  and name = 'Capital Lab US Core'
  and version = 1;
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'a future lock timestamp removes the reviewed manifest signal'
);
reset role;
rollback to savepoint reviewed_manifest_lock_time;

savepoint reviewed_manifest_audit;
set local session_replication_role = replica;
delete from private.audit_log
where correlation_id = '90000000-0000-4000-8000-000000000101'
  and action = 'market.hosted_manifest_configured';
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'missing configuration audit evidence removes the reviewed manifest signal'
);
reset role;
rollback to savepoint reviewed_manifest_audit;

select is(
  (
    select count(*)
    from public.exchanges
    where (mic, name, timezone, country_code) in (
      ('ARCX', 'NYSE Arca', 'America/New_York', 'US'),
      ('XNAS', 'Nasdaq Stock Market', 'America/New_York', 'US')
    )
  ),
  2::bigint,
  'the reviewed exchange references are exact'
);
select is(
  (
    select count(*)
    from public.instruments as instrument
    join public.exchanges as exchange on exchange.id = instrument.primary_exchange_id
    where (exchange.mic, instrument.symbol, instrument.name, instrument.asset_class) in (
      ('ARCX', 'QQQ', 'Invesco QQQ Trust', 'etf'),
      ('ARCX', 'SPY', 'SPDR S&P 500 ETF Trust', 'etf'),
      ('XNAS', 'AAPL', 'Apple Inc.', 'equity'),
      ('XNAS', 'MSFT', 'Microsoft Corporation', 'equity'),
      ('XNAS', 'NVDA', 'NVIDIA Corporation', 'equity')
    )
      and instrument.currency = 'USD'
      and instrument.price_increment = 0.01::numeric
      and instrument.quantity_increment = 1::numeric
      and instrument.is_tradable
      and not instrument.is_shortable
      and instrument.active_from is null
      and instrument.active_to is null
  ),
  5::bigint,
  'the reviewed five-instrument manifest has exact paper-only metadata'
);
select is(
  (
    select count(*)
    from public.instrument_aliases as alias
    join public.instruments as instrument on instrument.id = alias.instrument_id
    join public.exchanges as exchange on exchange.id = instrument.primary_exchange_id
    where alias.provider = 'alpaca'
      and alias.alias = instrument.symbol
      and alias.valid_from <= statement_timestamp()
      and alias.valid_to is null
      and (exchange.mic, instrument.symbol) in (
        ('ARCX', 'QQQ'),
        ('ARCX', 'SPY'),
        ('XNAS', 'AAPL'),
        ('XNAS', 'MSFT'),
        ('XNAS', 'NVDA')
      )
  ),
  5::bigint,
  'all five exact Alpaca aliases are immediately effective'
);
select ok(
  (
    select
      source.name = 'Alpaca IEX Market Data'
      and source.source_type = 'market_data'
      and source.provider = 'alpaca'
      and source.base_url = 'https://data.alpaca.markets'
      and not source.is_mock
      and not source.is_enabled
    from public.sources as source
    where source.code = 'alpaca_iex'
  ),
  'the Alpaca IEX source is data-only, non-mock, and disabled'
);
select ok(
  (
    select
      policy.version = 1
      and policy.allowed_use = 'IEX market data for paper-trading research only; no brokerage, account, or order access.'
      and policy.licensing_metadata = '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb
      and policy.retention_days is null
      and policy.requires_authentication
      and not policy.enabled
      and policy.effective_from <= statement_timestamp()
      and policy.effective_to is null
    from public.source_policies as policy
    join public.sources as source on source.id = policy.source_id
    where source.code = 'alpaca_iex'
  ),
  'the only Alpaca policy is reviewed, authenticated, effective, and disabled'
);
select is(
  (
    select count(*)
    from public.source_policies as policy
    join public.sources as source on source.id = policy.source_id
    where source.code = 'alpaca_iex'
  ),
  1::bigint,
  'the configured source has exactly one reviewed policy version'
);
select ok(
  (
    select
      universe.name = 'Capital Lab US Core'
      and universe.version = 1
      and universe.description = 'Owner-reviewed paper-only US core market universe.'
      and universe.locked_at is not null
      and universe.content_hash ~ '^[0-9a-f]{64}$'
    from public.market_universes as universe
    where universe.owner_id = '00000000-0000-0000-0000-000000000001'
    order by universe.created_at desc, universe.version desc, universe.id
    limit 1
  ),
  'the current owner universe is the locked reviewed version'
);
select is(
  (
    select count(*)
    from public.market_universe_members as member
    join public.market_universes as universe on universe.id = member.universe_id
    where universe.owner_id = '00000000-0000-0000-0000-000000000001'
      and universe.name = 'Capital Lab US Core'
      and universe.version = 1
      and member.valid_from <= statement_timestamp()
      and member.valid_to is null
  ),
  5::bigint,
  'the first reviewed universe version has five active members'
);
select ok(
  (
    select
      record.status = 'completed'
      and record.result_ref_type = 'market_universe'
      and record.result_ref_id = universe.id
      and record.request_hash ~ '^[0-9a-f]{64}$'
      and record.completed_at is not null
    from private.idempotency_records as record
    join public.market_universes as universe on universe.id = record.result_ref_id
    where record.owner_id = '00000000-0000-0000-0000-000000000001'
      and record.scope = 'market.configure_hosted_manifest.v1'
      and record.idempotency_key = '90000000-0000-4000-8000-000000000101'
  ),
  'the successful operation has durable completed idempotency evidence'
);
select ok(
  (
    select
      audit.actor_type = 'owner'
      and audit.actor_id = audit.owner_id
      and audit.action = 'market.hosted_manifest_configured'
      and audit.target_type = 'market_universe'
      and audit.metadata ->> 'manifest_id' = 'capital_lab_us_core_alpaca_iex_v1'
      and audit.metadata ->> 'member_count' = '5'
      and audit.metadata ->> 'paper_only' = 'true'
      and audit.metadata ->> 'provider_request_made' = 'false'
      and audit.metadata ->> 'lifecycle_preserved' = 'false'
      and audit.metadata ->> 'source_enabled' = 'false'
      and audit.metadata::text !~* '(secret|credential|api[_-]?key|token)'
    from private.audit_log as audit
    where audit.owner_id = '00000000-0000-0000-0000-000000000001'
      and audit.correlation_id = '90000000-0000-4000-8000-000000000101'
  ),
  'the successful operation records redacted immutable paper-only audit evidence'
);

select is(
  (select count(*) from public.market_quotes),
  (select quote_count from hosted_market_evidence_baseline),
  'configuration creates no market quote observation'
);
select is(
  (select count(*) from public.market_bars),
  (select bar_count from hosted_market_evidence_baseline),
  'configuration creates no market bar observation'
);
select is(
  (select count(*) from public.fx_rates),
  (select fx_rate_count from hosted_market_evidence_baseline),
  'configuration creates no foreign-exchange observation'
);
select is(
  (select count(*) from public.corporate_actions),
  (select corporate_action_count from hosted_market_evidence_baseline),
  'configuration creates no corporate-action observation'
);
select is(
  (select count(*) from private.raw_source_events),
  (select raw_count from hosted_market_evidence_baseline),
  'configuration creates no raw provider event'
);
select is(
  (select count(*) from public.source_health),
  (select health_count from hosted_market_evidence_baseline),
  'configuration creates no source-health observation'
);
select is(
  (select count(*) from public.market_sessions),
  (select session_count from hosted_market_evidence_baseline),
  'configuration creates no market calendar session'
);
select is(
  (select count(*) from private.ingestion_runs),
  (select ingestion_run_count from hosted_market_evidence_baseline),
  'configuration creates no ingestion run'
);
select is(
  (select count(*) from private.scheduler_slots),
  (select scheduler_slot_count from hosted_market_evidence_baseline),
  'configuration creates no scheduler slot'
);
select is(
  (select count(*) from private.scheduler_runs),
  (select scheduler_run_count from hosted_market_evidence_baseline),
  'configuration creates no scheduler run'
);

-- A completed operation replays from immutable evidence without requiring the
-- source to remain disabled after a separately reviewed future activation.
update public.sources
set is_enabled = true
where code = 'alpaca_iex';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select
      result.operation_id = '90000000-0000-4000-8000-000000000101'::uuid
      and result.status = 'configured'
      and result.universe_id = universe.id
      and result.source_id = source.id
      and result.replayed
    from public.configure_hosted_market_manifest(
      '90000000-0000-4000-8000-000000000101'
    ) as result
    cross join public.market_universes as universe
    cross join public.sources as source
    where universe.owner_id = '00000000-0000-0000-0000-000000000001'
      and universe.name = 'Capital Lab US Core'
      and universe.version = 1
      and source.code = 'alpaca_iex'
  ),
  'same-operation replay returns the original IDs and status after source activation'
);
reset role;
update public.sources
set is_enabled = false
where code = 'alpaca_iex';

savepoint changed_manifest_hash;
update private.idempotency_records
set request_hash = repeat('f', 64)
where owner_id = '00000000-0000-0000-0000-000000000001'
  and scope = 'market.configure_hosted_manifest.v1'
  and idempotency_key = '90000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000101')$$,
  '23505',
  'hosted market operation id was reused with a different manifest contract',
  'an operation record from a different fixed-manifest contract cannot replay'
);
reset role;
rollback to savepoint changed_manifest_hash;

savepoint replaced_source_identity;
set local session_replication_role = replica;
delete from public.sources where code = 'alpaca_iex';
set local session_replication_role = origin;
insert into public.sources (
  code,
  name,
  source_type,
  provider,
  base_url,
  is_mock,
  is_enabled
) values (
  'alpaca_iex',
  'Alpaca IEX Market Data',
  'market_data',
  'alpaca',
  'https://data.alpaca.markets',
  false,
  false
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000101')$$,
  '55000',
  'hosted market operation result is missing its source reference',
  'same-operation replay cannot substitute a replacement source identity'
);
reset role;
rollback to savepoint replaced_source_identity;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (
    select
      result.status = 'configured'
      and result.universe_id = universe.id
      and result.source_id = source.id
      and not result.replayed
    from public.configure_hosted_market_manifest(
      '90000000-0000-4000-8000-000000000102'
    ) as result
    cross join public.market_universes as universe
    cross join public.sources as source
    where universe.owner_id = '00000000-0000-0000-0000-000000000001'
      and universe.name = 'Capital Lab US Core'
      and universe.version = 1
      and source.code = 'alpaca_iex'
  ),
  'a new operation reuses the already-current exact manifest without appending a version'
);
reset role;
select is(
  (
    select count(*)
    from public.market_universes
    where owner_id = '00000000-0000-0000-0000-000000000001'
      and name = 'Capital Lab US Core'
  ),
  1::bigint,
  'an exact current manifest remains one immutable universe version'
);

savepoint future_instrument_reference;
update public.instruments as instrument
set active_from = statement_timestamp() + interval '1 day'
from public.exchanges as exchange
where exchange.id = instrument.primary_exchange_id
  and exchange.mic = 'XNAS'
  and instrument.symbol = 'MSFT';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000110')$$,
  '23514',
  'hosted market instrument XNAS:MSFT conflicts with the reviewed manifest',
  'a future-dated fixed instrument reference is rejected'
);
reset role;
rollback to savepoint future_instrument_reference;

savepoint future_alias_reference;
update public.instrument_aliases
set valid_from = statement_timestamp() + interval '1 day'
where provider = 'alpaca'
  and alias = 'MSFT';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000111')$$,
  '23514',
  'Alpaca alias MSFT conflicts with the reviewed manifest',
  'a future-dated open alias is rejected as unavailable'
);
reset role;
rollback to savepoint future_alias_reference;

savepoint bounded_alias_reference;
update public.instrument_aliases
set valid_to = statement_timestamp() + interval '1 day'
where provider = 'alpaca'
  and alias = 'MSFT';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000114')$$,
  '23514',
  'Alpaca alias MSFT conflicts with the reviewed manifest',
  'a bounded alias that overlaps the configured interval is rejected'
);
reset role;
rollback to savepoint bounded_alias_reference;

savepoint extra_alias_reference;
insert into public.instrument_aliases (
  instrument_id,
  provider,
  alias,
  valid_from
)
select
  instrument.id,
  'alpaca',
  'AAPL_ALT',
  statement_timestamp()
from public.instruments as instrument
join public.exchanges as exchange
  on exchange.id = instrument.primary_exchange_id
where exchange.mic = 'XNAS'
  and instrument.symbol = 'AAPL';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000116')$$,
  '23514',
  'hosted market aliases conflict with the reviewed manifest',
  'an extra active Alpaca alias on a reviewed instrument is rejected'
);
reset role;
rollback to savepoint extra_alias_reference;

savepoint future_policy_reference;
set local session_replication_role = replica;
update public.source_policies as policy
set effective_from = statement_timestamp() + interval '1 day'
from public.sources as source
where source.id = policy.source_id
  and source.code = 'alpaca_iex'
  and policy.version = 1;
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000112')$$,
  '23514',
  'hosted market source policy conflicts with the reviewed manifest',
  'a future-dated source policy is rejected as unavailable'
);
reset role;
rollback to savepoint future_policy_reference;

savepoint duplicate_member_universe;
insert into public.market_universes (
  owner_id,
  name,
  version,
  description,
  content_hash,
  locked_at
)
select
  owner_id,
  name,
  2,
  description,
  content_hash,
  statement_timestamp()
from public.market_universes
where owner_id = '00000000-0000-0000-0000-000000000001'
  and name = 'Capital Lab US Core'
  and version = 1;

insert into public.market_universe_members (
  universe_id,
  owner_id,
  instrument_id,
  valid_from
)
select
  duplicate_universe.id,
  duplicate_universe.owner_id,
  original_member.instrument_id,
  statement_timestamp() - interval '2 seconds'
from public.market_universes as duplicate_universe
join public.market_universes as original_universe
  on original_universe.owner_id = duplicate_universe.owner_id
  and original_universe.name = duplicate_universe.name
  and original_universe.version = 1
join public.market_universe_members as original_member
  on original_member.universe_id = original_universe.id
join public.instruments as instrument
  on instrument.id = original_member.instrument_id
where duplicate_universe.owner_id = '00000000-0000-0000-0000-000000000001'
  and duplicate_universe.name = 'Capital Lab US Core'
  and duplicate_universe.version = 2
  and instrument.symbol <> 'NVDA';

insert into public.market_universe_members (
  universe_id,
  owner_id,
  instrument_id,
  valid_from
)
select
  duplicate_universe.id,
  duplicate_universe.owner_id,
  instrument.id,
  statement_timestamp() - interval '1 second'
from public.market_universes as duplicate_universe
join public.instruments as instrument on instrument.symbol = 'AAPL'
join public.exchanges as exchange
  on exchange.id = instrument.primary_exchange_id
  and exchange.mic = 'XNAS'
where duplicate_universe.owner_id = '00000000-0000-0000-0000-000000000001'
  and duplicate_universe.name = 'Capital Lab US Core'
  and duplicate_universe.version = 2;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_market_manifest('90000000-0000-4000-8000-000000000115')$$,
  '55000',
  'hosted market universe hash does not match its members',
  'an exact hash cannot hide a duplicate member and missing reviewed symbol'
);
reset role;
rollback to savepoint duplicate_member_universe;

insert into public.market_universes (
  owner_id,
  name,
  version,
  description,
  content_hash,
  locked_at
) values (
  '00000000-0000-0000-0000-000000000001',
  'Later reviewed placeholder',
  1,
  'Forces fixed-manifest version append coverage.',
  repeat('a', 64),
  statement_timestamp()
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (
    select scope.universe_row ->> 'reviewed_manifest_id'
    from public.market_snapshot_scope() as scope
  ),
  null::text,
  'a later unrelated current universe removes the reviewed manifest signal'
);
select ok(
  (
    select
      result.status = 'configured'
      and universe.version = 2
      and universe.name = 'Capital Lab US Core'
      and not result.replayed
    from public.configure_hosted_market_manifest(
      '90000000-0000-4000-8000-000000000103'
    ) as result
    join public.market_universes as universe on universe.id = result.universe_id
  ),
  'a different current universe appends a new fixed-manifest version'
);
reset role;

select is(
  (
    select count(*)
    from public.market_universes
    where owner_id = '00000000-0000-0000-0000-000000000001'
      and name = 'Capital Lab US Core'
  ),
  2::bigint,
  'the fixed manifest now has two append-only versions'
);
select ok(
  (
    select
      first_version.content_hash = second_version.content_hash
      and first_version.description = second_version.description
      and first_version.locked_at is not null
      and second_version.locked_at is not null
    from public.market_universes as first_version
    join public.market_universes as second_version
      on second_version.owner_id = first_version.owner_id
      and second_version.name = first_version.name
      and second_version.version = 2
    where first_version.owner_id = '00000000-0000-0000-0000-000000000001'
      and first_version.name = 'Capital Lab US Core'
      and first_version.version = 1
  ),
  'the prior reviewed universe metadata remains unchanged after append'
);
select is(
  (
    select count(*)
    from public.market_universe_members as member
    join public.market_universes as universe on universe.id = member.universe_id
    where universe.owner_id = '00000000-0000-0000-0000-000000000001'
      and universe.name = 'Capital Lab US Core'
      and universe.version = 1
      and member.valid_to is null
  ),
  5::bigint,
  'all five prior universe members remain effective and unchanged after append'
);
select throws_ok(
  $$
    update public.market_universes
    set description = 'tampered'
    where owner_id = '00000000-0000-0000-0000-000000000001'
      and name = 'Capital Lab US Core'
      and version = 1
  $$,
  '55000',
  'public.market_universes is append-only',
  'a prior universe version cannot be edited'
);
select throws_ok(
  $$
    update public.market_universe_members as member
    set instrument_id = (
      select candidate.id
      from public.instruments as candidate
      where candidate.id <> member.instrument_id
      limit 1
    )
    where member.universe_id = (
      select universe.id
      from public.market_universes as universe
      where universe.owner_id = '00000000-0000-0000-0000-000000000001'
        and universe.name = 'Capital Lab US Core'
        and universe.version = 1
    )
  $$,
  '55000',
  'only the effective end timestamp may be changed',
  'a prior universe member cannot be rewritten'
);

select is(
  (select count(*) from public.market_quotes),
  (select quote_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave quotes unchanged'
);
select is(
  (select count(*) from public.market_bars),
  (select bar_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave bars unchanged'
);
select is(
  (select count(*) from public.fx_rates),
  (select fx_rate_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave foreign-exchange observations unchanged'
);
select is(
  (select count(*) from public.corporate_actions),
  (select corporate_action_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave corporate actions unchanged'
);
select is(
  (select count(*) from private.raw_source_events),
  (select raw_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave raw events unchanged'
);
select is(
  (select count(*) from public.source_health),
  (select health_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave source health unchanged'
);
select is(
  (select count(*) from public.market_sessions),
  (select session_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave sessions unchanged'
);
select is(
  (select count(*) from private.ingestion_runs),
  (select ingestion_run_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave ingestion runs unchanged'
);
select is(
  (select count(*) from private.scheduler_slots),
  (select scheduler_slot_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave scheduler slots unchanged'
);
select is(
  (select count(*) from private.scheduler_runs),
  (select scheduler_run_count from hosted_market_evidence_baseline),
  'all configuration and replay paths leave scheduler runs unchanged'
);

select * from finish();
rollback;
