begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select plan(42);

select has_column('public', 'model_pricing', 'verified_at', 'pricing records have a verification timestamp');
select has_column('public', 'model_pricing', 'verification_expires_at', 'pricing records expire closed');
select has_column('public', 'model_pricing', 'pricing_version', 'pricing records are versioned');
select has_column('public', 'model_pricing', 'checksum', 'pricing records are checksummed');
select has_column('public', 'ai_budget_policies', 'trading_day_soft_limit', 'daily soft target is explicit');
select has_column('public', 'ai_budget_policies', 'experiment_hard_limit', 'experiment hard limit is explicit');
select has_column('private', 'scheduler_slots', 'session_date', 'scheduler slot stores the exchange date');
select has_column('private', 'scheduler_slots', 'slot_number', 'scheduler slot stores the quarter-hour number');
select has_column('private', 'scheduler_slots', 'heartbeat_at', 'scheduler slot stores a heartbeat');
select has_column('private', 'scheduler_slots', 'max_attempts', 'scheduler slot stores a retry ceiling');
select has_column('private', 'scheduler_runs', 'deadline_at', 'scheduler run stores a deadline');
select has_column('private', 'scheduler_runs', 'attempt_number', 'scheduler run stores its attempt');
select has_table('public', 'budget_threshold_alerts', 'durable threshold alerts exist');
select has_table('private', 'scheduler_reconciliation_events', 'reconciler audit trail exists');
select has_table('private', 'paid_canary_runs', 'paid Canary one-shot locks exist');
select has_table('public', 'model_comparisons', 'paired challenger evidence exists');
select has_table('public', 'storage_monitor_snapshots', 'storage snapshots exist');
select has_table('private', 'retention_cleanup_runs', 'retention cleanup is audited');
select has_function(
  'public',
  'run_hosted_scheduler_request',
  array['text', 'uuid', 'uuid', 'timestamp with time zone'],
  'protected scheduler database contract exists'
);
select has_function(
  'public',
  'claim_paid_canary',
  array['uuid', 'uuid'],
  'paid Canary lock contract exists'
);
select has_function(
  'public',
  'paid_canary_context',
  array['timestamp with time zone'],
  'paid Canary resolves only current server-side budget metadata'
);
select has_function('public', 'hosted_storage_status', array[]::text[], 'owner storage projection exists');
select has_function('public', 'hosted_budget_threshold_status', array[]::text[], 'owner budget-alert projection exists');
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'ai_budget_reservations_validate_current_pricing' and not tgisinternal
  ),
  'every reservation validates current verified pricing'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'ai_budget_reservations_refresh_threshold_alerts' and not tgisinternal
  ),
  'reservation changes refresh durable threshold alerts'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'orders_reject_sol_origin' and not tgisinternal
  ),
  'Sol decisions cannot originate paper orders'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and indexname = 'scheduler_slots_cycle_identity_idx'
  ),
  'experiment/session/quarter-hour scheduler identity is unique'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.budget_threshold_alerts'::regclass),
  'budget threshold alerts force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.model_comparisons'::regclass),
  'model comparisons force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.storage_monitor_snapshots'::regclass),
  'storage snapshots force RLS'
);
select is(
  (select count(*) from public.model_pricing
   where model in ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')
     and pricing_version = 'openai-2026-08-09-v1'),
  3::bigint,
  'all three exact model price records exist'
);
select is(
  (select count(*) from public.model_pricing where model = 'gpt-5.6'),
  0::bigint,
  'no generic gpt-5.6 alias exists'
);
select is(
  (select count(*) from public.model_pricing
   where pricing_version = 'openai-2026-08-09-v1'
     and is_verified
     and verification_expires_at > verified_at),
  3::bigint,
  'seeded price records are verified and time bounded'
);
select is(
  (select count(*) from private.application_settings
   where setting_key in (
     'agent_enabled', 'autonomous_paper_execution_enabled',
     'paid_model_calls_enabled', 'openai_canary_enabled',
     'openai_web_search_enabled', 'sol_challenger_enabled',
     'sol_live_execution_enabled', 'real_broker_enabled', 'scheduler_enabled'
   ) and value <> 'false'::jsonb),
  0::bigint,
  'all persisted safety gates default disabled'
);
select is(
  (select count(*) from public.experiment_controls where agent_enabled),
  0::bigint,
  'no experiment agent was enabled by the migration'
);
select is(
  (select count(*) from public.experiment_controls where scheduler_enabled),
  0::bigint,
  'no experiment scheduler was enabled by the migration'
);
select is(
  (select count(*) from pg_extension where extname = 'pg_cron'),
  0::bigint,
  'the scheduler Cron authority is not activated by the migration'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.run_hosted_scheduler_request(text,uuid,uuid,timestamptz)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute scheduler work'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.run_hosted_scheduler_request(text,uuid,uuid,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute scheduler work'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.run_hosted_scheduler_request(uuid,uuid,uuid,text,uuid,uuid,timestamptz)',
    'EXECUTE'
  ),
  'only the server service role can execute the identity-bound scheduler wrapper'
);
select hasnt_column('public', 'model_comparisons', 'promoted_at', 'comparison evidence cannot auto-promote Sol');
select results_eq(
  $$
    select
      result ->> 'status',
      result ->> 'model_calls',
      result ->> 'paper_orders_created',
      result ->> 'paper_fills_created',
      result ->> 'ledger_entries_created'
    from (
      select public.run_hosted_scheduler_request(
        'market_dispatcher',
        gen_random_uuid(),
        gen_random_uuid(),
        statement_timestamp()
      ) as result
    ) as invocation
  $$,
  $$values ('skipped', '0', '0', '0', '0')$$,
  'disabled scheduler request is a zero-side-effect no-op'
);

select * from finish();
rollback;
