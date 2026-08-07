begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.market_feature_bars_at(uuid[],uuid[],text,timestamptz,integer)',
    'EXECUTE'
  ),
  'authenticated owners may read deterministic market-feature inputs'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.market_feature_bars_at(uuid[],uuid[],text,timestamptz,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot read deterministic market-feature inputs'
);
select ok(
  not exists (
    select 1
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where n.nspname = 'public'
      and p.proname = 'market_feature_bars_at'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot read deterministic market-feature inputs'
);

select is(
  p.provolatile::text,
  's'::text,
  'the feature-input function is stable'
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'market_feature_bars_at';
select ok(
  not p.prosecdef,
  'the feature-input function runs with invoker rights'
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'market_feature_bars_at';
select ok(
  coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false),
  'the feature-input function fixes search_path'
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'market_feature_bars_at';

set local session_replication_role = replica;
update public.instruments
set created_at = statement_timestamp() - interval '1 day',
    updated_at = statement_timestamp() - interval '1 day'
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
);
update public.sources
set created_at = statement_timestamp() - interval '1 day',
    updated_at = statement_timestamp() - interval '1 day'
where id = '30000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;

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
  content_hash
)
select
  ('d1000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000001'::uuid,
  'feature-spy-' || series::text,
  '1m',
  date_trunc('minute', statement_timestamp()) - interval '30 minutes' + series * interval '1 minute',
  date_trunc('minute', statement_timestamp()) - interval '29 minutes' + series * interval '1 minute',
  100 + series,
  100 + series,
  100 + series,
  100 + series,
  1000 + series * 10,
  1,
  'original',
  date_trunc('minute', statement_timestamp()) - interval '29 minutes' + series * interval '1 minute',
  date_trunc('minute', statement_timestamp()) - interval '29 minutes' + series * interval '1 minute' + interval '1 second',
  date_trunc('minute', statement_timestamp()) - interval '29 minutes' + series * interval '1 minute' + interval '1 second',
  date_trunc('minute', statement_timestamp()) - interval '29 minutes' + series * interval '1 minute' + interval '2 seconds',
  encode(extensions.digest('feature-spy-' || series::text, 'sha256'), 'hex')
from generate_series(0, 21) as generated(series);

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
)
select
  'd2000000-0000-4000-8000-000000000001',
  owner_id,
  instrument_id,
  source_id,
  provider_record_key,
  timeframe,
  bar_start,
  bar_end,
  121.123456789012,
  123.123456789012,
  120.123456789012,
  122.123456789012,
  1210,
  2,
  'corrected',
  provider_event_at,
  statement_timestamp() - interval '3 minutes',
  statement_timestamp() - interval '3 minutes',
  statement_timestamp() - interval '3 minutes',
  repeat('a', 64),
  id
from public.market_bars
where id = 'd1000000-0000-4000-8000-000000000021';

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
)
select
  'd2000000-0000-4000-8000-000000000002',
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
  3,
  'cancelled',
  provider_event_at,
  statement_timestamp() - interval '1 minute',
  statement_timestamp() - interval '1 minute',
  statement_timestamp() - interval '1 minute',
  repeat('b', 64),
  id
from public.market_bars
where id = 'd2000000-0000-4000-8000-000000000001';

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
    'd3000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'feature-qqq-future-receipt',
    '1m',
    date_trunc('minute', statement_timestamp()) - interval '10 minutes',
    date_trunc('minute', statement_timestamp()) - interval '9 minutes',
    200,
    201,
    199,
    200,
    1000,
    1,
    'original',
    date_trunc('minute', statement_timestamp()) - interval '9 minutes',
    statement_timestamp() - interval '8 minutes',
    statement_timestamp() - interval '8 minutes',
    statement_timestamp() - interval '8 minutes',
    repeat('c', 64),
    null
  ),
  (
    'd3000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'feature-qqq-future-receipt',
    '1m',
    date_trunc('minute', statement_timestamp()) - interval '10 minutes',
    date_trunc('minute', statement_timestamp()) - interval '9 minutes',
    201,
    202,
    200,
    201,
    1001,
    2,
    'corrected',
    date_trunc('minute', statement_timestamp()) - interval '9 minutes',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '1 minute',
    repeat('d', 64),
    'd3000000-0000-4000-8000-000000000001'
  );

create temporary table feature_read_counts as
select count(*) as bar_count from public.market_bars;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)
    from public.market_feature_bars_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      statement_timestamp() - interval '4 minutes',
      21
    )
  ),
  21::bigint,
  'feature inputs are bounded to the latest 21 eligible logical bars'
);

select is(
  (
    select close_price_text
    from public.market_feature_bars_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      statement_timestamp() - interval '2 minutes',
      21
    )
    where bar_id = 'd2000000-0000-4000-8000-000000000001'
  ),
  '122.123456789012'::text,
  'an eligible correction is selected and its financial value remains exact text'
);

select is(
  (
    select count(*)
    from public.market_feature_bars_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      statement_timestamp(),
      21
    )
    where bar_start = date_trunc('minute', statement_timestamp()) - interval '9 minutes'
  ),
  0::bigint,
  'a latest cancellation removes its logical bar without resurrecting an older revision'
);

select is(
  (
    select count(*)
    from public.market_feature_bars_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000002']::uuid[],
      '1m',
      statement_timestamp(),
      21
    )
  ),
  0::bigint,
  'a latest future-received correction cannot resurrect an older logical bar revision'
);

select ok(
  (
    select bool_and(
      decision_at <= statement_timestamp()
      and bar_end <= decision_at
      and bar_provider_event_at <= decision_at
      and coalesce(bar_provider_received_at <= decision_at, true)
      and bar_available_at <= decision_at
      and pg_typeof(close_price_text) = 'text'::regtype
      and pg_typeof(volume_text) = 'text'::regtype
    )
    from public.market_feature_bars_at(
      array['30000000-0000-0000-0000-000000000001']::uuid[],
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      '1m',
      statement_timestamp(),
      21
    )
  ),
  'every feature input enforces the decision boundary and exact-text financial contract'
);

select throws_ok(
  $$select * from public.market_feature_bars_at(array[]::uuid[], array[]::uuid[], '5m', statement_timestamp(), 21)$$,
  '22023',
  'deterministic market features require one-minute bars',
  'unsupported feature timeframes fail closed'
);
select throws_ok(
  $$select * from public.market_feature_bars_at(array[]::uuid[], array[]::uuid[], '1m', statement_timestamp(), 22)$$,
  '22023',
  'feature-bar limit must be between 1 and 21',
  'unbounded feature histories fail closed'
);
select throws_ok(
  $$select * from public.market_feature_bars_at(array[]::uuid[], array[]::uuid[], '1m', null, 21)$$,
  '22023',
  'decision timestamp is required',
  'null decision timestamps fail closed'
);
select throws_ok(
  $$select * from public.market_feature_bars_at(array[]::uuid[], array[]::uuid[], '1m', statement_timestamp() + interval '1 hour', 21)$$,
  '22023',
  'future decision timestamp is not allowed',
  'future decision timestamps fail closed'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.market_feature_bars_at(array[]::uuid[], array[]::uuid[], '1m', statement_timestamp(), 21)$$,
  '42501',
  'active owner authentication required',
  'non-owner identities fail closed'
);

reset role;
select is(
  (select count(*) from public.market_bars),
  (select bar_count from feature_read_counts),
  'feature reads do not mutate persisted market bars'
);

select * from finish();
rollback;
