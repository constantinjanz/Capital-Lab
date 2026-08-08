begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.configure_hosted_official_calendar_manifest(uuid)',
    'EXECUTE'
  ),
  'authenticated owners may request the fixed official calendar'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.configure_hosted_official_calendar_manifest(uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot configure the official calendar'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.configure_hosted_official_calendar_manifest(uuid)',
    'EXECUTE'
  ),
  'service-role credentials cannot invoke owner calendar configuration'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.hosted_official_calendar_state()',
    'EXECUTE'
  ),
  'authenticated owners may read official-calendar attestation'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.hosted_official_calendar_state()',
    'EXECUTE'
  ),
  'anonymous callers cannot read official-calendar attestation'
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
        'configure_hosted_official_calendar_manifest',
        'hosted_official_calendar_state',
        'reviewed_hosted_official_calendar_manifest_id'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any official-calendar function'
);
select ok(
  not procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the exposed calendar wrapper is an invoker with fixed search_path'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'configure_hosted_official_calendar_manifest';
select ok(
  procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the private calendar implementation is a definer with fixed search_path'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'private'
  and procedure.proname = 'configure_hosted_official_calendar_manifest';
select ok(
  not procedure.prosecdef
    and procedure.provolatile = 's'
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the public calendar state is a stable invoker with fixed search_path'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'hosted_official_calendar_state';

select ok(
  c.relrowsecurity and c.relforcerowsecurity,
  'calendar manifests have forced row-level security'
)
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'market_calendar_manifests';
select ok(
  has_table_privilege('authenticated', 'public.market_calendar_manifests', 'SELECT')
    and not has_table_privilege('authenticated', 'public.market_calendar_manifests', 'INSERT')
    and not has_table_privilege('authenticated', 'public.market_calendar_manifests', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.market_calendar_manifests', 'DELETE'),
  'authenticated callers have read-only manifest table privileges'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'market_sessions_manifest_idx'
  ),
  'calendar-manifest session references are indexed'
);

create temporary table official_calendar_evidence_baseline as
select
  (select count(*) from private.scheduler_runs) as scheduler_runs,
  (select count(*) from private.scheduler_slots) as scheduler_slots,
  (select count(*) from public.agent_runs) as agent_runs,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.fills) as fills,
  (select count(*) from private.cash_ledger_entries) as ledger_entries,
  (select count(*) from private.ingestion_runs) as ingestion_runs;

create temporary table official_calendar_test_owner as
select user_id
from public.app_users
where role = 'owner'
order by created_at, user_id
limit 1;
grant select on official_calendar_test_owner to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select * from public.configure_hosted_official_calendar_manifest('91000000-0000-4000-8000-000000000001')$$,
  '42501',
  'active owner authentication required',
  'an authenticated session without identity fails closed'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.configure_hosted_official_calendar_manifest('91000000-0000-4000-8000-000000000002')$$,
  '42501',
  'active owner authentication required',
  'a non-owner cannot configure the official calendar'
);
select throws_ok(
  $$select * from public.hosted_official_calendar_state()$$,
  '42501',
  'active owner authentication required',
  'a non-owner cannot read the official calendar state'
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from official_calendar_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select throws_ok(
  $$select * from public.configure_hosted_official_calendar_manifest(null)$$,
  '22023',
  'operation id is required',
  'a null calendar operation id is rejected'
);
select is(
  (select configured from public.hosted_official_calendar_state()),
  false,
  'calendar state is explicitly unconfigured before review'
);
select is(
  (select session_count from public.hosted_official_calendar_state()),
  0,
  'unconfigured calendar state exposes no trusted session count'
);
select ok(
  (
    select
      result.status = 'configured'
      and result.manifest_record_id is not null
      and result.source_count = 2
      and result.session_count = 522
      and not result.replayed
    from public.configure_hosted_official_calendar_manifest(
      '91000000-0000-4000-8000-000000000101'
    ) as result
  ),
  'the first owner operation atomically configures the fixed calendar'
);

select is(
  (select count(*) from public.market_calendar_manifests),
  1::bigint,
  'one append-only calendar manifest is persisted'
);
select is(
  (
    select manifest.manifest_id
    from public.market_calendar_manifests as manifest
  ),
  'capital_lab_us_equities_calendar_2026_v1'::text,
  'the exact reviewed manifest identifier is persisted'
);
select is(
  (
    select manifest.definition ->> 'timezone'
    from public.market_calendar_manifests as manifest
  ),
  'America/New_York'::text,
  'the manifest records its authoritative local timezone'
);
select is(
  (
    select jsonb_array_length(manifest.definition -> 'holidays')
    from public.market_calendar_manifests as manifest
  ),
  10,
  'the manifest fixes all ten 2026 exchange holidays'
);
select is(
  (
    select jsonb_array_length(manifest.definition -> 'early_closes')
    from public.market_calendar_manifests as manifest
  ),
  2,
  'the manifest fixes the two official 2026 early closes'
);
select is(
  (
    select count(*)
    from public.sources
    where code in (
      'nasdaq_official_calendar_2026',
      'nyse_official_calendar_2026'
    )
      and source_type = 'research'
      and not is_mock
      and not is_enabled
  ),
  2::bigint,
  'both official provenance sources are persisted and disabled'
);
select is(
  (
    select count(*)
    from public.source_policies as policy
    join public.sources as source on source.id = policy.source_id
    where source.code in (
      'nasdaq_official_calendar_2026',
      'nyse_official_calendar_2026'
    )
      and policy.version = 1
      and not policy.enabled
      and not policy.requires_authentication
      and policy.effective_to is null
      and policy.licensing_metadata ->> 'runtime_fetch' = 'false'
  ),
  2::bigint,
  'both calendar policies forbid runtime fetching and remain disabled'
);
select is(
  (
    select count(*)
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic in ('ARCX', 'XNAS')
      and session.session_date between date '2026-01-01' and date '2026-12-31'
  ),
  522::bigint,
  'the calendar contains exactly 261 weekday records per exchange'
);
select is(
  (
    select count(*)
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic in ('ARCX', 'XNAS')
      and session.session_type = 'regular'
  ),
  498::bigint,
  'the calendar contains 249 regular sessions per exchange'
);
select is(
  (
    select count(*)
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic in ('ARCX', 'XNAS')
      and session.session_type = 'early_close'
  ),
  4::bigint,
  'the calendar contains two early closes per exchange'
);
select is(
  (
    select count(*)
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic in ('ARCX', 'XNAS')
      and session.session_type = 'closed'
  ),
  20::bigint,
  'the calendar contains ten holiday records per exchange'
);
select is(
  (
    select count(*)
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic in ('ARCX', 'XNAS')
      and extract(isodow from session.session_date) not between 1 and 5
  ),
  0::bigint,
  'the manifest never fabricates weekend session rows'
);
select results_eq(
  $$
    select session.opens_at, session.closes_at
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic = 'XNAS'
      and session.session_date = date '2026-01-02'
  $$,
  $$values (
    timestamptz '2026-01-02 14:30:00+00',
    timestamptz '2026-01-02 21:00:00+00'
  )$$,
  'winter regular-session local times are converted to exact UTC'
);
select results_eq(
  $$
    select session.opens_at, session.closes_at
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic = 'XNAS'
      and session.session_date = date '2026-07-06'
  $$,
  $$values (
    timestamptz '2026-07-06 13:30:00+00',
    timestamptz '2026-07-06 20:00:00+00'
  )$$,
  'summer regular-session local times follow New York daylight saving time'
);
select results_eq(
  $$
    select session.session_type, session.opens_at, session.closes_at
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic = 'ARCX'
      and session.session_date = date '2026-11-27'
  $$,
  $$values (
    'early_close'::text,
    timestamptz '2026-11-27 14:30:00+00',
    timestamptz '2026-11-27 18:00:00+00'
  )$$,
  'the post-Thanksgiving early close ends at 13:00 New York time'
);
select results_eq(
  $$
    select session.session_type, session.opens_at, session.closes_at
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic = 'XNAS'
      and session.session_date = date '2026-07-03'
  $$,
  $$values ('closed'::text, null::timestamptz, null::timestamptz)$$,
  'the observed Independence Day holiday has no trading window'
);
select is(
  (
    select count(*)
    from public.market_sessions as session
    where session.calendar_manifest_id is not null
      and session.source_identifier like
        'capital_lab_us_equities_calendar_2026_v1:%'
  ),
  522::bigint,
  'every session links to the reviewed manifest and canonical source identifier'
);
select ok(
  (
    select
      state.configured
      and state.manifest_id = 'capital_lab_us_equities_calendar_2026_v1'
      and state.calendar_year = 2026
      and state.exchange_count = 2
      and state.session_count = 522
      and state.regular_session_count = 498
      and state.early_close_session_count = 4
      and state.closed_session_count = 20
    from public.hosted_official_calendar_state() as state
  ),
  'the read boundary attests only the complete exact manifest'
);
select ok(
  (
    select result.replayed
    from public.configure_hosted_official_calendar_manifest(
      '91000000-0000-4000-8000-000000000101'
    ) as result
  ),
  'the same operation replays its durable result'
);
select ok(
  (
    select not result.replayed
    from public.configure_hosted_official_calendar_manifest(
      '91000000-0000-4000-8000-000000000102'
    ) as result
  ),
  'a new operation re-attests the already exact fixed calendar'
);
select is(
  (select count(*) from public.market_calendar_manifests),
  1::bigint,
  're-attestation never appends a duplicate manifest'
);
select is(
  (
    select count(*)
    from public.market_sessions as session
    where session.calendar_manifest_id is not null
  ),
  522::bigint,
  're-attestation never appends duplicate sessions'
);
reset role;

select is(
  (
    select count(*)
    from private.audit_log as audit
    where audit.action = 'market.official_calendar_configured'
      and audit.owner_id = (select user_id from official_calendar_test_owner)
  ),
  2::bigint,
  'fresh operations append one redacted calendar audit each while replay does not'
);
select ok(
  not exists (
    select 1
    from private.audit_log as audit
    where audit.action = 'market.official_calendar_configured'
      and (
        audit.metadata ? 'credential'
        or audit.metadata ? 'secret'
        or audit.metadata ? 'token'
        or audit.metadata ? 'request_body'
      )
  ),
  'calendar audits contain no credential or provider payload fields'
);

savepoint source_drift;
update public.sources
set base_url = 'https://example.invalid'
where code = 'nasdaq_official_calendar_2026';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from official_calendar_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select is(
  (select configured from public.hosted_official_calendar_state()),
  false,
  'source provenance drift removes the reviewed calendar signal'
);
select throws_ok(
  $$select * from public.configure_hosted_official_calendar_manifest('91000000-0000-4000-8000-000000000103')$$,
  '23514',
  'official calendar source nasdaq_official_calendar_2026 conflicts with the reviewed manifest',
  'a new operation rejects drift instead of silently rewriting provenance'
);
reset role;
rollback to savepoint source_drift;

savepoint unexpected_weekend;
insert into public.market_sessions (
  exchange_id,
  session_date,
  session_type,
  calendar_source_id,
  source_identifier,
  available_at,
  calendar_manifest_id
)
select
  exchange.id,
  date '2026-01-03',
  'closed',
  source.id,
  'capital_lab_us_equities_calendar_2026_v1:ARCX:2026-01-03',
  statement_timestamp(),
  manifest.id
from public.exchanges as exchange
cross join public.sources as source
cross join public.market_calendar_manifests as manifest
where exchange.mic = 'ARCX'
  and source.code = 'nyse_official_calendar_2026';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from official_calendar_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select is(
  (select configured from public.hosted_official_calendar_state()),
  false,
  'an unexpected weekend record removes the reviewed calendar signal'
);
select throws_ok(
  $$select * from public.configure_hosted_official_calendar_manifest('91000000-0000-4000-8000-000000000104')$$,
  '23514',
  'existing 2026 market sessions conflict with the reviewed official calendar',
  'a new operation rejects an extra weekend row atomically'
);
reset role;
rollback to savepoint unexpected_weekend;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from official_calendar_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select throws_ok(
  $$insert into public.market_calendar_manifests (
      owner_id, manifest_id, calendar_year, timezone, definition,
      content_hash, reviewed_at
    ) values (
      (select user_id from official_calendar_test_owner), 'forged', 2026,
      'America/New_York', '{}'::jsonb, repeat('a', 64), statement_timestamp()
    )$$,
  '42501',
  'permission denied for table market_calendar_manifests',
  'authenticated owners cannot bypass the manifest RPC with direct inserts'
);
reset role;

select is(
  (select count(*) from private.scheduler_runs),
  (select scheduler_runs from official_calendar_evidence_baseline),
  'calendar configuration leaves scheduler runs unchanged'
);
select is(
  (select count(*) from private.scheduler_slots),
  (select scheduler_slots from official_calendar_evidence_baseline),
  'calendar configuration leaves scheduler slots unchanged'
);
select is(
  (select count(*) from public.agent_runs),
  (select agent_runs from official_calendar_evidence_baseline),
  'calendar configuration leaves agent runs unchanged'
);
select is(
  (select count(*) from public.orders),
  (select orders from official_calendar_evidence_baseline),
  'calendar configuration leaves orders unchanged'
);
select is(
  (select count(*) from public.fills),
  (select fills from official_calendar_evidence_baseline),
  'calendar configuration leaves fills unchanged'
);
select is(
  (select count(*) from private.cash_ledger_entries),
  (select ledger_entries from official_calendar_evidence_baseline),
  'calendar configuration leaves the cash ledger unchanged'
);
select is(
  (select count(*) from private.ingestion_runs),
  (select ingestion_runs from official_calendar_evidence_baseline),
  'calendar configuration leaves ingestion runs unchanged'
);

select * from finish();
rollback;
