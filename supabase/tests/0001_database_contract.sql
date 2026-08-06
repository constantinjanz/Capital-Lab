begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  to_regclass(format('%I.%I', expected.schema_name, expected.table_name)) is not null,
  format('required table %I.%I exists', expected.schema_name, expected.table_name)
)
from (values
  ('public','app_users'), ('public','experiments'), ('public','experiment_versions'),
  ('public','experiment_controls'), ('public','experiment_benchmarks'), ('public','experiment_status_events'),
  ('public','instruments'), ('public','instrument_aliases'), ('public','market_universes'),
  ('public','market_universe_members'), ('public','exchanges'), ('public','market_sessions'),
  ('public','market_quotes'), ('public','market_bars'), ('public','fx_rates'),
  ('public','corporate_actions'), ('public','source_health'), ('public','sources'),
  ('public','source_policies'), ('private','raw_source_events'), ('public','news_events'),
  ('public','event_entities'), ('public','event_instrument_links'), ('public','event_features'),
  ('public','event_scores'), ('public','event_revisions'), ('public','simulation_accounts'),
  ('private','cash_ledger_entries'), ('public','orders'), ('public','order_status_events'),
  ('public','fills'), ('public','position_lots'), ('public','positions'),
  ('public','portfolio_snapshots'), ('public','risk_events'), ('public','margin_snapshots'),
  ('public','borrow_availability'), ('public','borrow_costs'), ('public','simulator_runs'),
  ('public','model_pricing'), ('public','ai_budget_policies'), ('private','ai_budget_periods'),
  ('private','ai_budget_reservations'), ('private','ai_usage_events'), ('public','model_routing_events'),
  ('public','budget_alerts'), ('public','agent_runs'), ('public','agent_tool_calls'),
  ('public','prompt_versions'), ('private','scheduler_runs'), ('public','knowledge_sources'),
  ('public','knowledge_documents'), ('public','knowledge_chunks'), ('public','knowledge_document_versions'),
  ('public','decision_context_snapshots'), ('public','agent_decisions'), ('public','decision_evidence'),
  ('public','trade_outcomes'), ('public','pattern_hypotheses'), ('public','pattern_evidence'),
  ('public','strategy_versions'), ('public','strategy_assignments'), ('public','memory_summaries'),
  ('private','audit_log'), ('private','system_health_events'), ('private','ingestion_runs'),
  ('private','dead_letter_events'), ('private','application_settings')
) as expected(schema_name, table_name);

select ok(c.relrowsecurity, format('RLS enabled on %I.%I', n.nspname, c.relname))
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname in ('public','private') and c.relkind in ('r','p');

select ok(c.relforcerowsecurity, format('RLS forced on %I.%I', n.nspname, c.relname))
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname in ('public','private') and c.relkind in ('r','p');

select ok(
  not has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'SELECT'),
  format('anonymous cannot select %I.%I', n.nspname, c.relname)
)
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname in ('public','private') and c.relkind in ('r','p','v');

select ok(
  not has_table_privilege('authenticated', format('%I.%I', n.nspname, c.relname), privilege_name),
  format('authenticated cannot %s %I.%I directly', lower(privilege_name), n.nspname, c.relname)
)
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as privilege_name
where n.nspname in ('public','private') and c.relkind in ('r','p');

select ok(
  c.reloptions @> array['security_invoker=true'],
  format('%I is a security-invoker view', c.relname)
)
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('cash_ledger_view','ai_budget_status_view','ai_usage_view','scheduler_health_view','audit_log_view');

select ok(
  not exists (
    select 1 from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public','graphql_public') and p.prosecdef
  ),
  'no security-definer function exists in an exposed schema'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_ai_budget(uuid,uuid,uuid,uuid,uuid,text,integer,integer,integer,timestamptz,text,text)',
    'EXECUTE'
  ),
  'authenticated browser sessions cannot mutate budget state directly'
);

select ok(
  not exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  format('PUBLIC cannot execute private function %s', p.oid::regprocedure)
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'private';

select ok(
  coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false),
  format('privileged function %s fixes search_path', p.oid::regprocedure)
)
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'private' and p.prosecdef;

select has_index('public', 'market_quotes', 'market_quotes_pit_idx', 'market quotes have a PIT index');
select has_index('public', 'market_bars', 'market_bars_pit_idx', 'market bars have a PIT index');
select has_index('public', 'event_revisions', 'event_revisions_event_pit_idx', 'event revisions have a PIT index');
select has_index('public', 'knowledge_chunks', 'knowledge_chunks_pit_idx', 'knowledge chunks have a PIT index');
select has_index('private', 'ai_budget_reservations', 'ai_budget_reservations_status_idx', 'active reservations are indexed');
select has_index('public', 'orders', 'orders_pending_idx', 'pending orders are indexed');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.experiments), 2::bigint, 'owner can read owned experiments');
select is((select count(*) from public.cash_ledger_view), 5::bigint, 'owner can read sanitized private ledger view');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.experiments), 0::bigint, 'second authenticated user cannot read owner experiments');
select is((select count(*) from public.instruments), 0::bigint, 'second authenticated user cannot read global reference data');
select is((select count(*) from public.cash_ledger_view), 0::bigint, 'second authenticated user cannot read ledger view');
reset role;
select set_config('request.jwt.claims', '{}', true);

select throws_ok(
  $$update private.cash_ledger_entries set amount = amount + 1 where id = '91000000-0000-0000-0000-000000000001'$$,
  '55000',
  'private.cash_ledger_entries is append-only',
  'cash ledger rejects updates'
);

select throws_ok(
  $$delete from public.fills where id = '92200000-0000-0000-0000-000000000001'$$,
  '55000',
  'public.fills is append-only',
  'fills reject deletion'
);

select throws_ok(
  $$update public.experiment_versions set objective = 'changed' where id = '71000000-0000-0000-0000-000000000002'$$,
  '55000',
  'public.experiment_versions is append-only',
  'experiment versions are immutable'
);

select throws_ok(
  $$update public.experiments set initial_capital = 1 where id = '70000000-0000-0000-0000-000000000002'$$,
  '55000',
  'locked experiment configuration is immutable',
  'locked experiment configuration cannot change'
);

select throws_ok(
  $$update public.experiments set locked_at = null where id = '70000000-0000-0000-0000-000000000002'$$,
  '55000',
  'an experiment lock cannot be removed',
  'experiment lock cannot be removed'
);

select is(
  private.post_cash_ledger_entry(
    '00000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002', 'experiment:start', 'opening_cash', 'EUR',
    100000, '2026-08-03 13:29:00+00', 'experiment', '70000000-0000-0000-0000-000000000002',
    'initial_capital', '91000000-0000-0000-0000-000000000101', '{}'::jsonb
  ),
  '91000000-0000-0000-0000-000000000001'::uuid,
  'same ledger idempotency key and input returns original row'
);

select throws_ok(
  $$select private.post_cash_ledger_entry(
    '00000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002', 'experiment:start', 'opening_cash', 'EUR',
    99999, '2026-08-03 13:29:00+00', 'experiment', '70000000-0000-0000-0000-000000000002',
    'initial_capital', '91000000-0000-0000-0000-000000000101', '{}'::jsonb
  )$$,
  '23505',
  'ledger idempotency key reused with different input',
  'ledger idempotency key rejects changed input'
);

insert into public.market_quotes(
  id, owner_id, instrument_id, source_id, provider_record_key, revision_no,
  correction_state, bid_price, ask_price, provider_event_at, first_seen_at,
  available_at, content_hash, supersedes_id
) values (
  '81000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  'spy-20260803T1400', 2, 'corrected', 635.20, 635.22, '2026-08-03 14:00:00+00',
  '2026-08-03 14:10:00+00', '2026-08-03 14:10:01+00', repeat('1', 64),
  '81000000-0000-0000-0000-000000000001'
);

select is(
  (select bid_price from private.market_quotes_as_of(
    '00000000-0000-0000-0000-000000000001',
    array['20000000-0000-0000-0000-000000000001'::uuid],
    '2026-08-03 14:05:00+00'
  )),
  635.10::numeric,
  'PIT quote query excludes a later correction'
);

select is(
  (select bid_price from private.market_quotes_as_of(
    '00000000-0000-0000-0000-000000000001',
    array['20000000-0000-0000-0000-000000000001'::uuid],
    '2026-08-03 14:11:00+00'
  )),
  635.20::numeric,
  'PIT quote query includes correction only after it is available'
);

insert into public.event_revisions(
  id, event_id, owner_id, revision_no, revision_of_id, author, title, sanitized_text,
  content_hash, published_at, first_seen_at, available_at, source_quality, correction_state
) values (
  '82100000-0000-0000-0000-000000000101', '82000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001', 2,
  '82100000-0000-0000-0000-000000000001', 'Synthetic authority',
  'Corrected synthetic policy event', 'A later synthetic correction.', repeat('6',64),
  '2026-08-03 13:49:00+00', '2026-08-03 14:10:00+00', '2026-08-03 14:10:01+00',
  0.80, 'corrected'
);

select is(
  (select revision_no from private.event_revisions_as_of(
     '00000000-0000-0000-0000-000000000001', '2026-08-03 14:05:00+00'
   ) where event_id = '82000000-0000-0000-0000-000000000001'),
  1,
  'PIT event query excludes a later correction'
);

insert into public.knowledge_document_versions(
  id, owner_id, document_id, version, content_hash, sanitized_text, metadata,
  valid_from, first_seen_at, available_at
) values (
  'a2000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001', 2, repeat('7',64),
  'Later synthetic revision.', '{"synthetic":true}', '2026-08-04 12:00:00+00',
  '2026-08-04 12:00:00+00', '2026-08-04 12:00:01+00'
);
insert into public.knowledge_chunks(
  id, owner_id, document_version_id, chunk_index, plain_text, token_estimate,
  source_quality, valid_from, available_at, content_hash
) values (
  'a3000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000101', 0, 'Later synthetic revision.', 4,
  0.50, '2026-08-04 12:00:00+00', '2026-08-04 12:00:01+00', repeat('8',64)
);

select is(
  (select plain_text from private.knowledge_chunks_as_of(
     '00000000-0000-0000-0000-000000000001', '2026-08-03 14:05:00+00'
   ) where document_version_id = 'a2000000-0000-0000-0000-000000000001'),
  'Synthetic fixture: stale prices block execution and holding cash is valid.',
  'PIT knowledge query excludes a later document version'
);

select is(
  (select count(*) from private.knowledge_chunks_as_of(
     '00000000-0000-0000-0000-000000000001', '2026-08-05 14:05:00+00'
   ) where document_version_id = 'a2000000-0000-0000-0000-000000000101'),
  1::bigint,
  'PIT knowledge query selects the later version only after availability'
);

select throws_ok(
  $$insert into public.decision_evidence(
      decision_id, owner_id, evidence_kind, market_quote_id, evidence_available_at, citation_label
    ) values (
      'b2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
      'quote', '81000000-0000-0000-0000-000000000001', '2026-08-03 14:00:02+00', 'future-quote'
    )$$,
  '23514',
  'decision evidence was not available at decision time',
  'future evidence cannot be attached to a historical decision'
);

insert into public.model_pricing(
  id, provider, model, pricing_mode, context_tier, input_per_million,
  cached_input_per_million, cache_write_per_million, output_per_million,
  tool_call_price, source_url, effective_from, is_verified
) values (
  '60100000-0000-0000-0000-000000000101', 'test', 'test-budget-model', 'tokens',
  'standard', 2.00, 0.20, 2.50, 12.00, 0, 'local://database-test', '2026-01-01', true
);

select is(
  (private.reserve_ai_budget(
    '00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', null,
    '60000000-0000-0000-0000-000000000001', '60100000-0000-0000-0000-000000000101',
    'terra', 1000, 100, 0, '2026-08-04 14:00:00+00', 'test:terra:1', repeat('2',64)
  ) ->> 'allowed')::boolean,
  true,
  'budget guard reserves an affordable call'
);

select is(
  (private.reserve_ai_budget(
    '00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', null,
    '60000000-0000-0000-0000-000000000001', '60100000-0000-0000-0000-000000000101',
    'terra', 1000, 100, 0, '2026-08-04 14:00:00+00', 'test:terra:1', repeat('2',64)
  ) ->> 'idempotent')::boolean,
  true,
  'same budget reservation is idempotent'
);

select throws_ok(
  $$select private.reserve_ai_budget(
    '00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', null,
    '60000000-0000-0000-0000-000000000001', '60100000-0000-0000-0000-000000000101',
    'terra', 1001, 100, 0, '2026-08-04 14:00:00+00', 'test:terra:1', repeat('3',64)
  )$$,
  '23505',
  'idempotency key reused with different request',
  'budget reservation rejects changed request under same key'
);

select is(
  (private.reserve_ai_budget(
    '00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', null,
    '60000000-0000-0000-0000-000000000001', '60100000-0000-0000-0000-000000000101',
    'luna', 10000000, 1000000, 0, '2026-08-04 14:15:00+00', 'test:luna:too-expensive', repeat('4',64)
  ) ->> 'allowed')::boolean,
  false,
  'budget guard denies a reservation above the hard limit'
);

select is(
  (private.settle_ai_budget(
    '00000000-0000-0000-0000-000000000001',
    (select id from private.ai_budget_reservations where owner_id = '00000000-0000-0000-0000-000000000001' and idempotency_key = 'test:terra:1'),
    'synthetic-response-1', 900, 100, 0, 80, 10, 0, 0, 42, 'completed'
  ) ->> 'status'),
  'settled',
  'successful usage settles the reservation'
);

select is(
  (select count(*) from private.ai_usage_events where provider_response_id = 'synthetic-response-1'),
  1::bigint,
  'settlement creates exactly one usage event'
);

select throws_ok(
  $$update private.ai_usage_events set actual_cost = 0 where provider_response_id = 'synthetic-response-1'$$,
  '55000',
  'private.ai_usage_events is append-only',
  'AI usage events are append-only'
);

select is(
  (private.reserve_ai_budget(
    '00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', null,
    '60000000-0000-0000-0000-000000000001', '60100000-0000-0000-0000-000000000101',
    'terra', 1000, 100, 0, '2026-08-04 14:30:00+00', 'test:terra:unknown', repeat('5',64)
  ) ->> 'allowed')::boolean,
  true,
  'second Terra call fits the configured daily quota'
);

select is(
  (private.transition_ai_reservation(
    '00000000-0000-0000-0000-000000000001',
    (select id from private.ai_budget_reservations where idempotency_key = 'test:terra:unknown'),
    'unknown'
  ) ->> 'status'),
  'unknown',
  'uncertain network outcome remains charged to unknown budget'
);

select ok(
  (select unknown_amount > 0 from private.ai_budget_periods
   where owner_id = '00000000-0000-0000-0000-000000000001'
     and period_kind = 'trading_day'
     and period_start <= '2026-08-04 14:30:00+00'
     and period_end > '2026-08-04 14:30:00+00'),
  'unknown reservation amount remains committed in the daily period'
);

select is(
  (private.acquire_scheduler_slot(
    '00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
    'test:market-cycle:2026-08-04T14:00Z', 'market_cycle', 'manual',
    '80000000-0000-0000-0000-000000000002', '2026-08-04 14:00:00+00', 300
  ) ->> 'acquired')::boolean,
  true,
  'first scheduler delivery acquires the slot'
);

select is(
  (private.acquire_scheduler_slot(
    '00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
    'test:market-cycle:2026-08-04T14:00Z', 'market_cycle', 'manual',
    '80000000-0000-0000-0000-000000000002', '2026-08-04 14:00:00+00', 300
  ) ->> 'acquired')::boolean,
  false,
  'duplicate scheduler delivery returns the existing slot'
);

select * from finish();
rollback;
