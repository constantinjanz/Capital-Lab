begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.market_snapshot_scope()',
    'EXECUTE'
  ),
  'authenticated owners may atomically select the current market scope'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.market_snapshot_scope()',
    'EXECUTE'
  ),
  'anonymous callers cannot select the current market scope'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.market_snapshot_read(text,integer)',
    'EXECUTE'
  ),
  'authenticated owners may request one atomic hosted market snapshot'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.market_snapshot_read(text,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot request an atomic hosted market snapshot'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.market_instrument_snapshot_at(uuid[],uuid[],text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated owners may request an instrument market snapshot'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.market_instrument_snapshot_at(uuid[],uuid[],text,timestamptz)',
    'EXECUTE'
  ),
  'anonymous callers cannot request an instrument market snapshot'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.market_sessions_at(uuid[],timestamptz,integer)',
    'EXECUTE'
  ),
  'authenticated owners may request a bounded session snapshot'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.market_sessions_at(uuid[],timestamptz,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot request a session snapshot'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.market_source_health_at(uuid[],timestamptz)',
    'EXECUTE'
  ),
  'authenticated owners may request a source-health snapshot'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.market_source_health_at(uuid[],timestamptz)',
    'EXECUTE'
  ),
  'anonymous callers cannot request a source-health snapshot'
);

select ok(
  not exists (
    select 1
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where n.nspname = 'public'
      and p.proname in (
        'market_snapshot_scope',
        'market_snapshot_read',
        'market_instrument_snapshot_at',
        'market_sessions_at',
        'market_source_health_at'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute hosted market snapshot functions'
);

select is(
  p.provolatile::text,
  's'::text,
  format('%s is stable', p.oid::regprocedure)
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'market_snapshot_scope',
    'market_snapshot_read',
    'market_instrument_snapshot_at',
    'market_sessions_at',
    'market_source_health_at'
  );

select ok(
  not p.prosecdef,
  format('%s runs with invoker rights', p.oid::regprocedure)
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'market_snapshot_scope',
    'market_snapshot_read',
    'market_instrument_snapshot_at',
    'market_sessions_at',
    'market_source_health_at'
  );

select ok(
  coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false),
  format('%s fixes search_path', p.oid::regprocedure)
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'market_snapshot_scope',
    'market_snapshot_read',
    'market_instrument_snapshot_at',
    'market_sessions_at',
    'market_source_health_at'
  );

-- The seed uses default creation timestamps. Move only the selected reference rows
-- behind the fixed decision timestamps used below; the surrounding transaction rolls back.
set local session_replication_role = replica;
update public.exchanges
set created_at = '2026-01-01 00:00:00+00',
    updated_at = '2026-01-01 00:00:00+00'
where id = '10000000-0000-0000-0000-000000000001';

update public.instruments
set created_at = '2026-01-01 00:00:00+00',
    updated_at = '2026-01-01 00:00:00+00'
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003'
);

update public.sources
set created_at = '2026-01-01 00:00:00+00',
    updated_at = '2026-01-01 00:00:00+00'
where id = '30000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;

insert into public.market_quotes(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  revision_no,
  correction_state,
  bid_price,
  ask_price,
  bid_size,
  ask_size,
  provider_event_at,
  first_seen_at,
  available_at,
  content_hash,
  supersedes_id
) values
  (
    '81000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-20260803T1400',
    2,
    'corrected',
    635.11,
    635.13,
    1100,
    950,
    '2026-08-03 14:00:00+00',
    '2026-08-03 14:10:00+00',
    '2026-08-03 14:10:01+00',
    repeat('1', 64),
    '81000000-0000-0000-0000-000000000001'
  ),
  (
    '81000000-0000-0000-0000-000000000012',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-20260803T1400',
    3,
    'cancelled',
    null,
    null,
    null,
    null,
    '2026-08-03 14:00:00+00',
    '2026-08-03 14:20:00+00',
    '2026-08-03 14:20:01+00',
    repeat('2', 64),
    '81000000-0000-0000-0000-000000000011'
  ),
  (
    '81000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    'aapl-exact-20260803T1420',
    1,
    'original',
    9007199254740993.123456789012,
    9007199254740993.223456789012,
    9007199254740993.323456789012,
    9007199254740993.423456789012,
    '2026-08-03 14:20:00+00',
    '2026-08-03 14:20:01+00',
    '2026-08-03 14:20:02+00',
    repeat('3', 64),
    null
  ),
  (
    '81000000-0000-0000-0000-000000000013',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-newer-20260803T1405',
    1,
    'original',
    636.00,
    636.02,
    1000,
    1000,
    '2026-08-03 14:05:00+00',
    '2026-08-03 14:26:00+00',
    '2026-08-03 14:26:01+00',
    repeat('6', 64),
    null
  ),
  (
    '81000000-0000-0000-0000-000000000014',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-20260803T1400',
    4,
    'corrected',
    999.00,
    999.02,
    1000,
    1000,
    '2026-08-03 14:00:00+00',
    '2026-08-03 14:30:00+00',
    '2026-08-03 14:30:01+00',
    repeat('7', 64),
    '81000000-0000-0000-0000-000000000012'
  );

insert into public.market_quotes(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  revision_no,
  correction_state,
  bid_price,
  ask_price,
  bid_size,
  ask_size,
  provider_event_at,
  provider_received_at,
  first_seen_at,
  available_at,
  content_hash,
  supersedes_id
) values (
  '81000000-0000-0000-0000-000000000022',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  'qqq-stale',
  2,
  'corrected',
  566.00,
  566.05,
  100,
  100,
  '2026-08-03 13:30:00+00',
  '2026-08-03 14:30:00+00',
  '2026-08-03 13:40:00+00',
  '2026-08-03 13:40:01+00',
  repeat('8', 64),
  '81000000-0000-0000-0000-000000000002'
);

insert into public.market_quotes(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  revision_no,
  correction_state,
  bid_price,
  ask_price,
  bid_size,
  ask_size,
  provider_event_at,
  first_seen_at,
  available_at,
  content_hash,
  supersedes_id
) values
  (
    '81000000-0000-0000-0000-000000000031',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    'aapl-future-event-correction',
    1,
    'original',
    200.00,
    200.05,
    100,
    100,
    '2026-08-03 13:45:00+00',
    '2026-08-03 13:50:00+00',
    '2026-08-03 13:50:01+00',
    repeat('d', 64),
    null
  ),
  (
    '81000000-0000-0000-0000-000000000032',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    'aapl-future-event-correction',
    2,
    'corrected',
    201.00,
    201.05,
    100,
    100,
    '2026-08-04 14:30:00+00',
    '2026-08-03 13:55:00+00',
    '2026-08-03 13:55:01+00',
    repeat('e', 64),
    '81000000-0000-0000-0000-000000000031'
  );

insert into public.market_bars(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  timeframe,
  bar_start,
  bar_end,
  open_price,
  high_price,
  low_price,
  close_price,
  volume,
  revision_no,
  correction_state,
  provider_event_at,
  first_seen_at,
  available_at,
  content_hash,
  supersedes_id
) values
  (
    '81100000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-bar-20260803T1400',
    '1m',
    '2026-08-03 14:00:00+00',
    '2026-08-03 14:01:00+00',
    635.08,
    635.20,
    635.04,
    635.15,
    125000,
    2,
    'cancelled',
    '2026-08-03 14:01:00+00',
    '2026-08-03 14:03:00+00',
    '2026-08-03 14:03:01+00',
    repeat('4', 64),
    '81100000-0000-0000-0000-000000000001'
  ),
  (
    '81100000-0000-0000-0000-000000000012',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-bar-20260803T1400',
    '1m',
    '2026-08-03 14:00:00+00',
    '2026-08-03 14:10:00+00',
    635.08,
    635.20,
    635.04,
    635.15,
    125000,
    3,
    'corrected',
    '2026-08-03 14:05:00+00',
    '2026-08-03 14:05:00+00',
    '2026-08-03 14:05:01+00',
    repeat('5', 64),
    '81100000-0000-0000-0000-000000000011'
  );

insert into public.market_bars(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  timeframe,
  bar_start,
  bar_end,
  open_price,
  high_price,
  low_price,
  close_price,
  volume,
  revision_no,
  correction_state,
  provider_event_at,
  provider_received_at,
  first_seen_at,
  available_at,
  content_hash,
  supersedes_id
) values
  (
    '81100000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'qqq-bar-received-late',
    '1m',
    '2026-08-03 13:40:00+00',
    '2026-08-03 13:41:00+00',
    565.00,
    565.10,
    564.90,
    565.05,
    1000,
    1,
    'original',
    '2026-08-03 13:41:00+00',
    '2026-08-03 13:42:00+00',
    '2026-08-03 13:42:00+00',
    '2026-08-03 13:42:01+00',
    repeat('9', 64),
    null
  ),
  (
    '81100000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'qqq-bar-received-late',
    '1m',
    '2026-08-03 13:40:00+00',
    '2026-08-03 13:41:00+00',
    565.01,
    565.11,
    564.91,
    565.06,
    1001,
    2,
    'corrected',
    '2026-08-03 13:41:00+00',
    '2026-08-03 14:30:00+00',
    '2026-08-03 13:50:00+00',
    '2026-08-03 13:50:01+00',
    repeat('a', 64),
    '81100000-0000-0000-0000-000000000021'
  ),
  (
    '81100000-0000-0000-0000-000000000031',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    'aapl-bar-incomplete-correction',
    '1m',
    '2026-08-03 14:00:00+00',
    '2026-08-03 14:01:00+00',
    200.00,
    200.20,
    199.90,
    200.10,
    2000,
    1,
    'original',
    '2026-08-03 14:01:00+00',
    null,
    '2026-08-03 14:02:00+00',
    '2026-08-03 14:02:01+00',
    repeat('b', 64),
    null
  ),
  (
    '81100000-0000-0000-0000-000000000032',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    'aapl-bar-incomplete-correction',
    '1m',
    '2026-08-03 14:00:00+00',
    '2026-08-03 14:10:00+00',
    200.00,
    200.20,
    199.90,
    200.10,
    2000,
    2,
    'corrected',
    '2026-08-03 14:05:00+00',
    null,
    '2026-08-03 14:05:00+00',
    '2026-08-03 14:05:01+00',
    repeat('c', 64),
    '81100000-0000-0000-0000-000000000031'
  );

insert into public.market_bars(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  timeframe,
  bar_start,
  bar_end,
  open_price,
  high_price,
  low_price,
  close_price,
  volume,
  revision_no,
  correction_state,
  provider_event_at,
  first_seen_at,
  available_at,
  content_hash,
  supersedes_id
) values
  (
    '81100000-0000-0000-0000-000000000041',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-bar-future-event-correction',
    '1m',
    '2026-08-03 13:50:00+00',
    '2026-08-03 13:51:00+00',
    634.00,
    634.20,
    633.90,
    634.10,
    500,
    1,
    'original',
    '2026-08-03 13:51:00+00',
    '2026-08-03 13:52:00+00',
    '2026-08-03 13:52:01+00',
    repeat('f', 64),
    null
  ),
  (
    '81100000-0000-0000-0000-000000000042',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'spy-bar-future-event-correction',
    '1m',
    '2026-08-03 13:50:00+00',
    '2026-08-03 13:51:00+00',
    634.01,
    634.21,
    633.91,
    634.11,
    501,
    2,
    'corrected',
    '2026-08-03 14:30:00+00',
    '2026-08-03 13:55:00+00',
    '2026-08-03 13:55:01+00',
    repeat('0', 64),
    '81100000-0000-0000-0000-000000000041'
  );

insert into public.market_sessions(
  id,
  exchange_id,
  session_date,
  opens_at,
  closes_at,
  session_type,
  calendar_source_id,
  source_identifier,
  available_at
) values (
  '80000000-0000-0000-0000-000000000011',
  '10000000-0000-0000-0000-000000000001',
  '2026-08-05',
  '2026-08-05 13:30:00+00',
  '2026-08-05 20:00:00+00',
  'regular',
  '30000000-0000-0000-0000-000000000001',
  'future-available-session',
  '2026-08-06 12:00:00+00'
);

insert into public.source_health(
  id,
  owner_id,
  source_id,
  status,
  checked_at,
  last_success_at,
  latency_ms,
  error_class,
  created_at
) values
  (
    '83000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'healthy',
    '2026-08-03 13:59:00+00',
    '2026-08-03 13:59:00+00',
    12,
    null,
    '2026-08-03 14:00:00+00'
  ),
  (
    '83000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'degraded',
    '2026-08-03 14:10:00+00',
    '2026-08-03 13:59:00+00',
    200,
    'synthetic_timeout',
    '2026-08-03 14:20:00+00'
  );

create temporary table market_snapshot_read_counts as
select
  (select count(*) from public.market_quotes) as quote_count,
  (select count(*) from public.market_bars) as bar_count,
  (select count(*) from public.market_sessions) as session_count,
  (select count(*) from public.source_health) as health_count;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select owner_id from public.market_snapshot_scope()),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'the atomic market scope belongs to the active owner'
);

select ok(
  (select decision_at <= statement_timestamp() from public.market_snapshot_scope()),
  'the atomic market scope returns its database decision timestamp'
);

select is(
  (select count(*) from public.market_snapshot_read('1m', 5)),
  1::bigint,
  'the production market RPC returns exactly one aggregate snapshot row'
);

select ok(
  (
    select
      owner_id = '00000000-0000-0000-0000-000000000001'::uuid
      and decision_at <= statement_timestamp()
      and jsonb_typeof(member_rows) = 'array'
      and jsonb_typeof(instrument_rows) = 'array'
      and jsonb_typeof(session_rows) = 'array'
      and jsonb_typeof(health_rows) = 'array'
      and not exists (
        select 1
        from jsonb_array_elements(instrument_rows) as instrument(value)
        where (instrument.value ->> 'decision_at')::timestamptz <> decision_at
      )
      and not exists (
        select 1
        from jsonb_array_elements(session_rows) as session(value)
        where (session.value ->> 'decision_at')::timestamptz <> decision_at
      )
      and not exists (
        select 1
        from jsonb_array_elements(health_rows) as health(value)
        where (health.value ->> 'decision_at')::timestamptz <> decision_at
      )
    from public.market_snapshot_read('1m', 5)
  ),
  'the production RPC keeps its owner, decision timestamp, and evidence collections coherent'
);

reset role;
savepoint aggregate_market_evidence;
insert into public.sources(
  id,
  code,
  name,
  source_type,
  provider,
  is_mock,
  is_enabled
) values (
  'a5000000-0000-4000-8000-000000000001',
  'pgtap-market',
  'pgTAP Market Data',
  'market_data',
  'pgtap',
  true,
  true
);

insert into public.market_quotes(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  bid_price,
  ask_price,
  bid_size,
  ask_size,
  provider_event_at,
  first_seen_at,
  available_at,
  content_hash
) values (
  'a6000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'aggregate-current-quote',
  9007199254740993.123456789012,
  9007199254740993.223456789012,
  10,
  11,
  statement_timestamp() - interval '3 minutes',
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '1 minute',
  repeat('d', 64)
);

insert into public.market_bars(
  id,
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  timeframe,
  bar_start,
  bar_end,
  open_price,
  high_price,
  low_price,
  close_price,
  volume,
  provider_event_at,
  first_seen_at,
  available_at,
  content_hash
) values (
  'a7000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'aggregate-current-bar',
  '1m',
  statement_timestamp() - interval '4 minutes',
  statement_timestamp() - interval '3 minutes',
  100,
  102,
  99,
  101,
  1234567890123456.123456789012,
  statement_timestamp() - interval '3 minutes',
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '1 minute',
  repeat('e', 64)
);

insert into public.source_health(
  id,
  owner_id,
  source_id,
  status,
  checked_at,
  last_success_at,
  latency_ms,
  created_at
) values (
  'a8000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'healthy',
  statement_timestamp() - interval '1 minute',
  statement_timestamp() - interval '1 minute',
  7,
  statement_timestamp() - interval '30 seconds'
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
      source_ids = array['a5000000-0000-4000-8000-000000000001']::uuid[]
      and jsonb_array_length(instrument_rows) = 3
      and exists (
        select 1
        from jsonb_array_elements(instrument_rows) as instrument(value)
        where instrument.value ->> 'instrument_id' = '20000000-0000-0000-0000-000000000001'
          and instrument.value ->> 'source_id' = 'a5000000-0000-4000-8000-000000000001'
          and instrument.value ->> 'quote_id' = 'a6000000-0000-4000-8000-000000000001'
          and instrument.value ->> 'bar_id' = 'a7000000-0000-4000-8000-000000000001'
          and instrument.value ->> 'bid_price_text' = '9007199254740993.123456789012'
          and instrument.value ->> 'volume_text' = '1234567890123456.123456789012'
      )
      and jsonb_array_length(health_rows) = 1
      and health_rows -> 0 ->> 'health_status' = 'healthy'
    from public.market_snapshot_read('1m', 5)
  ),
  'the production RPC returns configured exact quote, completed-bar, and health evidence'
);
reset role;
rollback to savepoint aggregate_market_evidence;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select bid_price_text
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:05:00+00'
    )
  ),
  '635.100000000000',
  'the quote snapshot returns the original revision before a correction is available'
);

select is(
  (
    select bid_price_text
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:15:00+00'
    )
  ),
  '635.110000000000',
  'the quote snapshot switches to a correction only after availability'
);

select is(
  (
    select quote_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:25:00+00'
    )
  ),
  null::uuid,
  'a latest cancellation removes its logical quote without removing the instrument row'
);

select is(
  (
    select bid_price_text
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000003']::uuid[],
      '1m',
      '2026-08-03 14:25:00+00'
    )
  ),
  '9007199254740993.123456789012',
  'the quote snapshot preserves an exact decimal beyond JavaScript safe-integer precision'
);

select is(
  (
    select quote_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000002']::uuid[],
      '1m',
      '2026-08-03 14:00:00+00'
    )
  ),
  null::uuid,
  'a latest logical quote with a future receipt timestamp cannot resurrect an older revision'
);

select is(
  (
    select quote_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000003']::uuid[],
      '1m',
      '2026-08-03 14:00:00+00'
    )
  ),
  null::uuid,
  'a latest logical quote with a future provider event cannot resurrect an older revision'
);

select is(
  (
    select bid_price_text
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:35:00+00'
    )
  ),
  '636.000000000000',
  'a late correction to an older event cannot displace a newer quote event'
);

select is(
  (
    select price_increment_text
    from public.market_instrument_snapshot_at(
      array[]::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:25:00+00'
    )
  ),
  '0.010000000000',
  'an instrument remains visible without a configured market source'
);

select is(
  (
    select source_id
    from public.market_instrument_snapshot_at(
      array[]::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:25:00+00'
    )
  ),
  null::uuid,
  'an empty source selection cannot fall back to a synthetic source'
);

select is(
  (
    select bar_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:00:30+00'
    )
  ),
  null::uuid,
  'an incomplete bar is unavailable even when its row exists'
);

select is(
  (
    select close_price_text
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:02:00+00'
    )
  ),
  '635.150000000000',
  'a completed bar appears only after its availability timestamp'
);

select is(
  (
    select bar_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:04:00+00'
    )
  ),
  null::uuid,
  'a latest cancellation removes its logical bar'
);

select is(
  (
    select bar_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000003']::uuid[],
      '1m',
      '2026-08-03 14:06:00+00'
    )
  ),
  null::uuid,
  'an incomplete latest correction cannot resurrect an older completed bar'
);

select is(
  (
    select bar_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000002']::uuid[],
      '1m',
      '2026-08-03 14:00:00+00'
    )
  ),
  null::uuid,
  'a latest logical bar with a future receipt timestamp cannot resurrect an older revision'
);

select is(
  (
    select bar_id
    from public.market_instrument_snapshot_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:00:00+00'
    )
  ),
  null::uuid,
  'a latest logical bar with a future provider event cannot resurrect an older revision'
);

select is(
  (
    select count(*)
    from public.market_sessions_at(
      array['10000000-0000-0000-0000-000000000001']::uuid[],
      '2026-08-05 18:00:00+00',
      10
    )
    where session_date = '2026-08-05'
  ),
  0::bigint,
  'a calendar row published after the decision is excluded'
);

select is(
  (
    select count(*)
    from public.market_sessions_at(
      array['10000000-0000-0000-0000-000000000001']::uuid[],
      '2026-08-05 18:00:00+00',
      1
    )
  ),
  1::bigint,
  'the per-exchange session limit truncates eligible calendar rows'
);

select is(
  (
    select health_status
    from public.market_source_health_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      '2026-08-03 14:10:00+00'
    )
  ),
  'healthy',
  'a late-created health observation is excluded before system availability'
);

select is(
  (
    select health_status
    from public.market_source_health_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      '2026-08-03 14:30:00+00'
    )
  ),
  'degraded',
  'the latest available provider-health observation is selected'
);

select is(
  (
    select decision_at
    from public.market_instrument_snapshot_at(
      array[]::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      '2026-08-03 14:25:00+00'
    )
  ),
  '2026-08-03 14:25:00+00'::timestamptz,
  'the requested decision timestamp is returned unchanged'
);

select throws_ok(
  $$select * from public.market_instrument_snapshot_at(array[]::uuid[], array[]::uuid[], '1m', null)$$,
  '22023',
  'decision timestamp is required',
  'a null decision timestamp fails closed'
);

select throws_ok(
  $$select * from public.market_sessions_at(array[]::uuid[], statement_timestamp() + interval '1 hour', 5)$$,
  '22023',
  'future decision timestamp is not allowed',
  'a future decision timestamp fails closed'
);

select throws_ok(
  $$select * from public.market_instrument_snapshot_at(array[]::uuid[], array[]::uuid[], '30s', statement_timestamp())$$,
  '22023',
  'unsupported market bar timeframe',
  'an unsupported bar timeframe fails closed'
);

select throws_ok(
  $$select * from public.market_source_health_at(array_fill('30000000-0000-0000-0000-000000000001'::uuid, array[11]), statement_timestamp())$$,
  '22023',
  'market source selection must contain at most 10 identifiers',
  'a source selection above the declared bound fails closed'
);

select throws_ok(
  $$select * from public.market_instrument_snapshot_at(array[]::uuid[], array_fill('20000000-0000-0000-0000-000000000001'::uuid, array[101]), '1m', statement_timestamp())$$,
  '22023',
  'instrument selection must contain at most 100 identifiers',
  'an instrument selection above the declared bound fails closed'
);

select throws_ok(
  $$select * from public.market_sessions_at(array_fill('10000000-0000-0000-0000-000000000001'::uuid, array[26]), statement_timestamp(), 5)$$,
  '22023',
  'exchange selection must contain at most 25 identifiers',
  'an exchange selection above the declared bound fails closed'
);

select throws_ok(
  $$select * from public.market_sessions_at(array[]::uuid[], statement_timestamp(), 11)$$,
  '22023',
  'session limit must be between 1 and 10',
  'a per-exchange session limit above the declared bound fails closed'
);

reset role;
savepoint source_metadata_after_boundary;
set local session_replication_role = replica;
update public.sources
set updated_at = '2026-08-04 00:00:00+00'
where id = '30000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.market_instrument_snapshot_at(array['30000000-0000-0000-0000-000000000001']::uuid[], array[]::uuid[], '1m', '2026-08-03 14:25:00+00')$$,
  '22023',
  'market source selection contains an unavailable identifier',
  'source metadata changed after the boundary fails closed'
);
reset role;
rollback to savepoint source_metadata_after_boundary;

savepoint instrument_metadata_after_boundary;
set local session_replication_role = replica;
update public.instruments
set updated_at = '2026-08-04 00:00:00+00'
where id = '20000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.market_instrument_snapshot_at(array[]::uuid[], array['20000000-0000-0000-0000-000000000001']::uuid[], '1m', '2026-08-03 14:25:00+00')$$,
  '22023',
  'instrument selection contains an unavailable identifier',
  'instrument metadata changed after the boundary fails closed'
);
reset role;
rollback to savepoint instrument_metadata_after_boundary;

savepoint exchange_metadata_after_boundary;
set local session_replication_role = replica;
update public.exchanges
set updated_at = '2026-08-04 00:00:00+00'
where id = '10000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.market_instrument_snapshot_at(array[]::uuid[], array['20000000-0000-0000-0000-000000000001']::uuid[], '1m', '2026-08-03 14:25:00+00')$$,
  '22023',
  'instrument selection contains an unavailable identifier',
  'exchange metadata changed after the boundary fails closed'
);
reset role;
rollback to savepoint exchange_metadata_after_boundary;

savepoint calendar_source_metadata_after_boundary;
set local session_replication_role = replica;
update public.sources
set updated_at = '2026-08-06 00:00:00+00'
where id = '30000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.market_sessions_at(array['10000000-0000-0000-0000-000000000001']::uuid[], '2026-08-05 18:00:00+00', 5)$$,
  '22023',
  'calendar source metadata is unavailable at the decision timestamp',
  'calendar-source metadata changed after the boundary fails closed'
);
reset role;
rollback to savepoint calendar_source_metadata_after_boundary;

savepoint scope_member_bound;
insert into public.instruments(
  id,
  primary_exchange_id,
  symbol,
  name,
  asset_class,
  currency,
  price_increment,
  quantity_increment,
  is_tradable,
  is_shortable
)
select
  ('a1000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  'B' || lpad(series::text, 3, '0'),
  'Scope bound instrument ' || series,
  'equity',
  'USD',
  0.01,
  1,
  false,
  false
from generate_series(1, 101) as series;

insert into public.market_universes(
  id,
  owner_id,
  name,
  version,
  description,
  content_hash
) values (
  'a2000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Scope member bound',
  1,
  'temporary pgTAP scope bound',
  repeat('e', 64)
);

insert into public.market_universe_members(
  id,
  universe_id,
  owner_id,
  instrument_id,
  valid_from
)
select
  ('a3000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'a2000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  ('a1000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  statement_timestamp() - interval '1 minute'
from generate_series(1, 101) as series;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.market_snapshot_read('1m', 5)$$,
  '22023',
  'current market universe exceeds 100 instruments',
  'the production snapshot enforces its current-universe response bound'
);
reset role;
rollback to savepoint scope_member_bound;

savepoint scope_source_bound;
insert into public.sources(
  id,
  code,
  name,
  source_type,
  provider,
  is_mock,
  is_enabled
)
select
  ('a4000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'scope-bound-' || lpad(series::text, 2, '0'),
  'Scope bound source ' || series,
  'market_data',
  'pgtap',
  false,
  true
from generate_series(1, 11) as series;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.market_snapshot_read('1m', 5)$$,
  '22023',
  'current market configuration exceeds 10 sources',
  'the production snapshot enforces its configured-source response bound'
);
reset role;
rollback to savepoint scope_source_bound;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

reset role;
select set_config('request.jwt.claims', '{}', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select throws_ok(
  $$select * from public.market_snapshot_scope()$$,
  '42501',
  'active owner authentication required',
  'a non-owner identity cannot select the current market scope'
);
select throws_ok(
  $$select * from public.market_snapshot_read('1m', 5)$$,
  '42501',
  'active owner authentication required',
  'a non-owner identity cannot request the production market snapshot'
);

select throws_ok(
  $$select * from public.market_instrument_snapshot_at(array[]::uuid[], array[]::uuid[], '1m', statement_timestamp())$$,
  '42501',
  'active owner authentication required',
  'a non-owner identity cannot request market data'
);
select throws_ok(
  $$select * from public.market_sessions_at(array[]::uuid[], statement_timestamp(), 5)$$,
  '42501',
  'active owner authentication required',
  'a non-owner identity cannot request market sessions'
);
select throws_ok(
  $$select * from public.market_source_health_at(array[]::uuid[], statement_timestamp())$$,
  '42501',
  'active owner authentication required',
  'a non-owner identity cannot request source health'
);

reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  (select count(*) from public.market_quotes),
  (select quote_count from market_snapshot_read_counts),
  'market snapshot reads do not mutate quotes'
);
select is(
  (select count(*) from public.market_bars),
  (select bar_count from market_snapshot_read_counts),
  'market snapshot reads do not mutate bars'
);
select is(
  (select count(*) from public.market_sessions),
  (select session_count from market_snapshot_read_counts),
  'market snapshot reads do not mutate sessions'
);
select is(
  (select count(*) from public.source_health),
  (select health_count from market_snapshot_read_counts),
  'market snapshot reads do not mutate source health'
);

select * from finish();
rollback;
