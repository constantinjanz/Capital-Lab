begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select plan(62);

create temporary table activation_experiment_baseline as
select count(*)::bigint as experiment_count from public.experiments;

select has_table('private', 'no_ai_shadow_dry_runs', 'dedicated dry-run class exists');
select has_table('private', 'no_ai_shadow_dry_run_transitions', 'state transitions persist');
select has_table('private', 'no_ai_shadow_dry_run_events', 'expected and actual events persist');
select has_table('private', 'no_ai_shadow_dry_run_baselines', 'zero-side-effect baseline persists');
select has_table('private', 'no_ai_shadow_dry_run_alarms', 'deduplicated alarms persist');
select has_function('private', 'prepare_no_ai_shadow_dry_run', array['text', 'text', 'uuid'], 'stable preparation exists');
select has_function('private', 'plan_no_ai_shadow_dry_run', array['uuid', 'timestamp with time zone', 'timestamp with time zone'], 'session planner exists');
select has_function('private', 'transition_no_ai_shadow_dry_run', array['uuid', 'text', 'text', 'text', 'text', 'text', 'uuid', 'jsonb'], 'state transition guard exists');
select has_function('private', 'freeze_no_ai_shadow_dry_run_baseline', array['uuid', 'text', 'text', 'uuid'], 'baseline freezer exists');
select has_function('private', 'stop_no_ai_shadow_dry_run', array['uuid', 'text', 'text', 'jsonb', 'boolean'], 'atomic stop exists');
select has_function('private', 'dispatch_no_ai_shadow_dry_run_event', array['text', 'timestamp with time zone'], 'pg_net dispatch envelope exists');
select has_function('private', 'reconcile_no_ai_shadow_dry_run', array['uuid', 'timestamp with time zone'], 'reconciler exists');
select has_function('private', 'finalize_no_ai_shadow_dry_run', array['uuid', 'text', 'text', 'uuid', 'timestamp with time zone'], 'expected-vs-actual finalizer exists');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.no_ai_shadow_dry_runs'::regclass), 'dry runs force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.no_ai_shadow_dry_run_transitions'::regclass), 'transitions force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.no_ai_shadow_dry_run_events'::regclass), 'events force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.no_ai_shadow_dry_run_baselines'::regclass), 'baselines force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.no_ai_shadow_dry_run_alarms'::regclass), 'alarms force RLS');
select ok(not has_table_privilege('authenticated', 'private.no_ai_shadow_dry_runs', 'SELECT'), 'authenticated has no dry-run table privilege');
select ok(not has_table_privilege('authenticated', 'private.no_ai_shadow_dry_run_transitions', 'SELECT'), 'authenticated has no transition table privilege');
select ok(not has_table_privilege('authenticated', 'private.no_ai_shadow_dry_run_events', 'SELECT'), 'authenticated has no event table privilege');
select ok(not has_table_privilege('authenticated', 'private.no_ai_shadow_dry_run_baselines', 'SELECT'), 'authenticated has no baseline table privilege');
select ok(not has_table_privilege('authenticated', 'private.no_ai_shadow_dry_run_alarms', 'SELECT'), 'authenticated has no alarm table privilege');
select is((select count(*) from pg_extension where extname = 'pg_cron'), 0::bigint, 'schema migration installs no pg_cron');
select is((select count(*) from pg_extension where extname = 'pg_net'), 0::bigint, 'schema migration installs no pg_net');
select is((select count(*) from private.application_settings where setting_key in ('scheduler_enabled', 'agent_enabled', 'paid_model_calls_enabled', 'openai_canary_enabled', 'openai_web_search_enabled', 'sol_challenger_enabled', 'sol_live_execution_enabled', 'real_broker_enabled') and value <> 'false'::jsonb), 0::bigint, 'migration leaves dangerous flags false');
select is((select count(*) from private.no_ai_shadow_dry_runs), 0::bigint, 'migration does not start a dry run');
select has_column('private', 'paid_canary_runs', 'campaign_key', 'Canary has an immutable campaign key');
select has_column('private', 'paid_canary_runs', 'model', 'Canary lock is exact-model scoped');
select ok(exists (select 1 from pg_indexes where schemaname = 'private' and tablename = 'paid_canary_runs' and indexdef like '%campaign_key, model%'), 'campaign and exact model are unique');
select ok((select prosrc like '%pg_advisory_xact_lock%' from pg_proc where oid = 'private.claim_paid_canary(uuid,uuid)'::regprocedure), 'parallel Canary claims serialize on the campaign');

select lives_ok(
  $$select private.prepare_no_ai_shadow_dry_run(repeat('a', 40), 'activation-readiness-v1', '10000000-0000-4000-8000-000000000001')$$,
  'stable dry-run preparation succeeds'
);
select is((select state from private.no_ai_shadow_dry_runs), 'prepared', 'preparation begins at prepared');
select is((select id from private.no_ai_shadow_dry_runs), '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001'::uuid, 'dry-run ID is stable');
select lives_ok(
  $$select private.prepare_no_ai_shadow_dry_run(repeat('a', 40), 'activation-readiness-v1', '10000000-0000-4000-8000-000000000002')$$,
  'preparation is idempotent'
);
select is((select count(*) from private.no_ai_shadow_dry_runs), 1::bigint, 'idempotency does not duplicate the run');
select throws_ok(
  $$select private.transition_no_ai_shadow_dry_run('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', 'prepared', 'armed', 'owner', repeat('a', 40), 'activation-readiness-v1', gen_random_uuid(), '{}'::jsonb)$$,
  '55000', 'activation state transition is forbidden', 'state skipping fails closed'
);
select lives_ok($$select private.transition_no_ai_shadow_dry_run('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', 'prepared', 'infra_installed', 'admin_script', repeat('a', 40), 'activation-readiness-v1', gen_random_uuid(), '{}'::jsonb)$$, 'prepared advances once');
select lives_ok($$select private.transition_no_ai_shadow_dry_run('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', 'infra_installed', 'vault_verified', 'owner', repeat('a', 40), 'activation-readiness-v1', gen_random_uuid(), '{}'::jsonb)$$, 'infrastructure advances once');
select lives_ok($$select private.transition_no_ai_shadow_dry_run('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', 'vault_verified', 'jobs_installed_disabled', 'admin_script', repeat('a', 40), 'activation-readiness-v1', gen_random_uuid(), '{}'::jsonb)$$, 'Vault evidence advances once');
select lives_ok($$select private.transition_no_ai_shadow_dry_run('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', 'jobs_installed_disabled', 'auth_noop_verified', 'owner', repeat('a', 40), 'activation-readiness-v1', gen_random_uuid(), '{}'::jsonb)$$, 'auth no-op advances once');

select lives_ok(
  $test$
  do $fixture$
  begin
    insert into public.market_calendar_manifests (
      id, owner_id, manifest_id, calendar_year, timezone,
      definition, content_hash, reviewed_at
    ) values (
      '11000000-0000-4000-8000-000000000001',
      (select user_id from public.app_users where role = 'owner' and is_active),
      'activation_readiness_fixture', 2026, 'America/New_York',
      '{"fixture":true}'::jsonb, repeat('b', 64), '2026-01-01 00:00:00+00'
    ) on conflict (id) do nothing;
    insert into public.market_sessions (
      id, exchange_id, session_date, opens_at, closes_at, session_type,
      calendar_source_id, source_identifier, available_at, calendar_manifest_id
    ) values
      ('11000000-0000-4000-8000-000000000010', (select id from public.exchanges where mic = 'XNAS'), '2026-08-10', '2026-08-10 13:30:00+00', '2026-08-10 20:00:00+00', 'regular', null, 'activation-2026-08-10', '2026-01-01 00:00:00+00', '11000000-0000-4000-8000-000000000001'),
      ('11000000-0000-4000-8000-000000000011', (select id from public.exchanges where mic = 'XNAS'), '2026-08-11', '2026-08-11 13:30:00+00', '2026-08-11 20:00:00+00', 'regular', null, 'activation-2026-08-11', '2026-01-01 00:00:00+00', '11000000-0000-4000-8000-000000000001')
    on conflict (exchange_id, session_date) do nothing;
  end;
  $fixture$;
  $test$,
  'versioned regular-session fixtures are installed'
);
update public.experiments set lifecycle_status = 'paused'
where lifecycle_status = 'active';
select lives_ok(
  $$select private.plan_no_ai_shadow_dry_run('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', '2026-08-10 12:00:00+00', '2026-08-10 12:00:00+00')$$,
  'two full regular sessions are planned'
);
select is((select expected_slot_count from private.no_ai_shadow_dry_runs), 52, 'two regular sessions contain 52 quarter-hour slots');
select is((select count(*) from private.no_ai_shadow_dry_run_events), 104::bigint, 'dispatcher and reconciler expectations are preregistered');
select is((select count(*) from public.experiments), (select experiment_count from activation_experiment_baseline), 'dedicated dry run does not create or count as a research experiment');

select is(public.claim_paid_canary((select user_id from public.app_users where role = 'owner' and is_active), '12000000-0000-4000-8000-000000000001'), true, 'first global Canary campaign claim succeeds');
select is((select count(*) from private.paid_canary_runs), 3::bigint, 'one campaign creates one lock per exact model');
select is((select count(distinct model) from private.paid_canary_runs), 3::bigint, 'all exact models are locked');
select is(public.claim_paid_canary((select user_id from public.app_users where role = 'owner' and is_active), '12000000-0000-4000-8000-000000000001'), false, 'same operation ID cannot repeat');
select is(public.claim_paid_canary((select user_id from public.app_users where role = 'owner' and is_active), '12000000-0000-4000-8000-000000000002'), false, 'different operation ID cannot repeat');
select lives_ok($$update private.paid_canary_runs set status = 'unknown' where model = 'gpt-5.6-luna'$$, 'unknown/possibly-charged state persists');
select is(public.claim_paid_canary((select user_id from public.app_users where role = 'owner' and is_active), '12000000-0000-4000-8000-000000000003'), false, 'unknown state cannot be bypassed by a new UUID');
select is((select count(distinct campaign_key) from private.paid_canary_runs), 1::bigint, 'only the immutable global campaign exists');
select is((select count(distinct operation_id) from private.paid_canary_runs), 1::bigint, 'all model locks retain one correlation operation');
select is((select count(*) from private.no_ai_shadow_dry_run_events where model_call_count <> 0 or budget_reservation_count <> 0 or order_count <> 0 or fill_count <> 0 or ledger_entry_count <> 0), 0::bigint, 'planned events have exactly zero forbidden effects');
select lives_ok($$select private.freeze_no_ai_shadow_dry_run_baseline('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', repeat('a', 40), 'activation-readiness-v1', gen_random_uuid())$$, 'baseline freezes independently of research');
select lives_ok($$select private.stop_no_ai_shadow_dry_run('6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001', 'forbidden_database_delta', 'forbidden_delta', '{"test":true}'::jsonb, false)$$, 'first forbidden delta invokes atomic stop');
select is((select state from private.no_ai_shadow_dry_runs), 'failed', 'atomic stop persists terminal failure');
select is((select count(*) from private.no_ai_shadow_dry_run_alarms where alarm_class = 'forbidden_delta'), 1::bigint, 'atomic stop deduplicates durable alarm evidence');
select is((select count(*) from private.application_settings where setting_key in ('scheduler_enabled', 'agent_enabled', 'paid_model_calls_enabled', 'openai_canary_enabled') and value <> 'false'::jsonb), 0::bigint, 'atomic stop leaves runtime controls false');
select is((select count(*) from private.scheduler_slots where slot_key like 'no-ai-infrastructure:%'), 0::bigint, 'planning and stopping create no scheduler cycle');

select * from finish();
rollback;
