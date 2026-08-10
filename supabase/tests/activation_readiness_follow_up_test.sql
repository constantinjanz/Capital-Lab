begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

create function pg_temp.campaign_id()
returns uuid language sql immutable as $$
  select '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d201'::uuid;
$$;

create function pg_temp.zero_counters()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'agent_decisions', 0, 'agent_proposals', 0, 'agent_runs', 0,
    'broker_requests', 0, 'budget_reservations', 0, 'canary_runs', 0,
    'fills', 0, 'ledger_entries', 0, 'market_data_requests', 0,
    'model_calls', 0, 'news_requests', 0, 'orders', 0,
    'position_mutations', 0, 'provider_requests', 0, 'sol_executions', 0,
    'web_search_requests', 0
  );
$$;

create function pg_temp.auth_noop_body()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'schema_version', 2,
    'mode', 'auth_noop',
    'campaign_id', pg_temp.campaign_id(),
    'correlation_id', '30000000-0000-4000-8000-000000000004'::uuid,
    'nonce', '30000000-0000-4000-8000-000000000002'::uuid,
    'request_id', '30000000-0000-4000-8000-000000000001'::uuid,
    'environment', 'production',
    'deployment_id', 'dpl_12345678901234567890',
    'commit_sha', repeat('a', 40),
    'status', 'authenticated_noop',
    'terminal_reason', 'auth_noop_verified',
    'scheduler_disabled', true,
    'agent_disabled', true,
    'counters', pg_temp.zero_counters()
  );
$$;

create function pg_temp.assert_invalid_auth_response(
  p_transport_id bigint,
  p_body jsonb,
  p_status integer default 200,
  p_timed_out boolean default false,
  p_error text default null
)
returns void language plpgsql as $$
begin
  begin
    update private.activation_auth_noop_requests
    set pg_net_request_id = p_transport_id, status = 'transport_terminal',
        terminal_at = statement_timestamp()
    where campaign_id = pg_temp.campaign_id();
    insert into net._http_response (
      id, status_code, content_type, headers, content, timed_out, error_msg
    ) values (
      p_transport_id, p_status, 'application/json', '{}'::jsonb,
      p_body::text, p_timed_out, p_error
    );
    perform private.verify_activation_auth_noop(
      pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
      repeat('b', 64), repeat('c', 64), private.activation_database_fingerprint(),
      '30000000-0000-4000-8000-000000000004'
    );
    raise exception using errcode = 'P0001', message = 'invalid auth response was accepted';
  exception when sqlstate '55000' then
    null;
  end;
  if exists (
    select 1 from private.activation_http_responses
    where pg_net_request_id = p_transport_id
  ) then
    raise exception using errcode = 'P0001', message = 'rejected response evidence escaped its failed reconciliation';
  end if;
end;
$$;

create function pg_temp.campaign_manifest()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'campaign_id', pg_temp.campaign_id(),
    'config_version', 'activation-readiness-v2',
    'prepared_commit_sha', repeat('a', 40),
    'phase_contract_sha256', repeat('c', 64),
    'relation_contract_sha256', private.activation_relation_contract_hash(),
    'production_origin', 'https://capital-lab.example',
    'production_host', 'capital-lab.example',
    'scheduler_path', '/api/internal/scheduler',
    'scheduler_url', 'https://capital-lab.example/api/internal/scheduler',
    'production_deployment_id', 'dpl_12345678901234567890',
    'vercel_commit_sha', repeat('a', 40),
    'vercel_environment', 'production',
    'database_target', jsonb_build_object(
      'database_fingerprint', private.activation_database_fingerprint()
    ),
    'providers', jsonb_build_object(
      'market_data', 'mock', 'news', 'mock', 'execution', 'paper'
    ),
    'expected_slot_count', 52,
    'expected_event_count', 104,
    'max_request_seconds', 120,
    'drain_safety_seconds', 180,
    'minimum_lead_seconds', 900
  );
$$;

select has_table('private', 'activation_job_spec_versions', 'versioned Cron identities persist');
select has_table('private', 'activation_auth_noop_requests', 'auth no-op claims persist');
select has_table('private', 'activation_auth_failure_requests', 'auth failure probes persist');
select has_table('private', 'activation_http_responses', 'sanitized transport evidence persists');
select has_table('private', 'activation_relation_snapshots', 'full-row side-effect snapshots persist');
select has_table('private', 'activation_control_snapshots', 'control snapshots persist');
select has_table('private', 'activation_terminal_evidence', 'terminal evidence persists');
select has_function('private', 'emergency_kill_activation_controls', array['uuid'], 'DB-first kill exists');
select has_function('private', 'assert_activation_job_specs', array['uuid', 'boolean'], 'full Cron comparator exists');
select has_function('private', 'finalize_activation_campaign', array[
  'uuid', 'text', 'text', 'text', 'text', 'text', 'uuid', 'uuid'
], 'strict finalizer exists');

select ok((
  select bool_and(class.relrowsecurity and class.relforcerowsecurity)
  from pg_class as class
  where class.oid = any(array[
    'private.no_ai_shadow_dry_runs'::regclass,
    'private.activation_job_spec_versions'::regclass,
    'private.activation_http_responses'::regclass,
    'private.activation_terminal_evidence'::regclass
  ])
), 'all activation control and evidence tables force RLS');
select ok(not has_table_privilege('anon', 'private.activation_http_responses', 'SELECT'), 'anon cannot read transport evidence');
select ok(not has_table_privilege('authenticated', 'private.activation_http_responses', 'INSERT'), 'authenticated cannot forge transport evidence');
select ok(not has_table_privilege('service_role', 'private.activation_job_spec_versions', 'UPDATE'), 'service role cannot rewrite Cron identities');
select ok(not has_function_privilege('service_role', 'private.transition_no_ai_shadow_dry_run(uuid,text,text,text,text,text,uuid,jsonb)', 'EXECUTE'), 'service role cannot invoke generic transitions');
select ok(has_function_privilege('service_role', 'public.run_hosted_scheduler_request(uuid,uuid,uuid,text,uuid,uuid,timestamptz)', 'EXECUTE'), 'service role has only the narrow scheduler wrapper');
select ok(not has_function_privilege('authenticated', 'public.run_hosted_scheduler_request(uuid,uuid,uuid,text,uuid,uuid,timestamptz)', 'EXECUTE'), 'authenticated cannot execute scheduler wrapper');
select ok((
  select array_to_string(proconfig, ',') in ('search_path=', 'search_path=""')
  from pg_proc where oid = 'private.emergency_kill_activation_controls(uuid)'::regprocedure
), 'emergency kill has an empty fixed search_path');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'private.activation_http_responses'::regclass
    and contype = 'f' and array_length(conkey, 1) = 2
), 'response evidence has a composite owner boundary');

insert into private.application_settings (owner_id, setting_key, value, is_secret)
select app_user.user_id, setting.setting_key, 'false'::jsonb, false
from public.app_users as app_user
cross join (values
  ('scheduler_enabled'), ('agent_enabled'),
  ('autonomous_paper_execution_enabled'), ('paid_model_calls_enabled'),
  ('openai_canary_enabled'), ('openai_web_search_enabled'),
  ('sol_challenger_enabled'), ('sol_live_execution_enabled'),
  ('real_broker_enabled')
) as setting(setting_key)
where app_user.role = 'owner' and app_user.is_active
on conflict (owner_id, setting_key) do update set value = excluded.value;

select lives_ok(
  $$select private.prepare_no_ai_shadow_dry_run_v2(
    pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_relation_contract_hash(),
    pg_temp.campaign_manifest(), '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002'
  )$$,
  'prepare derives and persists the server database identity'
);
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'prepared', 'campaign begins prepared');
select is((select database_fingerprint from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), private.activation_database_fingerprint(), 'prepared target fingerprint is server-derived');
select lives_ok(
  $$select private.prepare_no_ai_shadow_dry_run_v2(
    pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_relation_contract_hash(),
    pg_temp.campaign_manifest(), '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002'
  )$$,
  'prepare retry reuses the identical campaign'
);
select is((select count(*) from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 1::bigint, 'prepare retry creates no duplicate');
select throws_ok(
  $$select private.prepare_no_ai_shadow_dry_run_v2(
    pg_temp.campaign_id(), repeat('d', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_relation_contract_hash(),
    pg_temp.campaign_manifest(), '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002'
  )$$,
  '22023', 'activation campaign manifest is invalid', 'commit mismatch fails before mutation'
);
select throws_ok(
  $$select private.transition_no_ai_shadow_dry_run(
    pg_temp.campaign_id(), 'prepared', 'infra_installed', 'owner', repeat('a', 40),
    'activation-readiness-v2', gen_random_uuid(), '{}'::jsonb
  )$$,
  '55000', 'actor is forbidden for activation transition', 'actor matrix rejects an owner-only bypass'
);
select lives_ok(
  $$select private.transition_no_ai_shadow_dry_run(
    pg_temp.campaign_id(), 'prepared', 'infra_installed', 'admin_script', repeat('a', 40),
    'activation-readiness-v2', gen_random_uuid(), '{}'::jsonb
  )$$,
  'prepare advances only through the allowed actor'
);

create extension if not exists pg_cron with schema pg_catalog;
select lives_ok($$select private.assert_unmanaged_activation_jobs_safe()$$, 'empty Cron inventory is safe');

create temporary table activation_collision_job as
select cron.schedule(
  'capital-lab-no-ai-dispatcher', '@hourly', 'select 1;'
)::bigint as jobid;
select throws_ok(
  $$select private.assert_unmanaged_activation_jobs_safe()$$,
  '55000', 'unmanaged expected-name Cron job has drifted', 'expected-name collision with a foreign command fails closed'
);
select cron.unschedule(jobid) from activation_collision_job;

select vault.create_secret(
  'https://capital-lab.example/api/internal/scheduler',
  'capital_lab_scheduler_url', 'local activation test fixture'
);
select vault.create_secret(
  repeat('x', 48), 'capital_lab_scheduler_shared_secret',
  'local activation test fixture'
);
select lives_ok($$select private.verify_activation_vault_scope(pg_temp.campaign_id())$$, 'Vault URL and secret scope verify without disclosure');
select lives_ok(
  $$select private.transition_no_ai_shadow_dry_run(
    pg_temp.campaign_id(), 'infra_installed', 'vault_verified', 'owner', repeat('a', 40),
    'activation-readiness-v2', gen_random_uuid(), '{}'::jsonb
  )$$,
  'verified infrastructure advances to Vault verified'
);

create temporary table activation_jobs (job_role text primary key, jobid bigint not null);
insert into activation_jobs values
  ('dispatcher', cron.schedule(
    'capital-lab-no-ai-dispatcher', '*/15 * * * 1-5',
    $$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$$
  )),
  ('reconciler', cron.schedule(
    'capital-lab-no-ai-reconciler', '5,20,35,50 * * * 1-5',
    $$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp());$$
  ));
select lives_ok(
  $$select private.register_activation_job_spec(
    pg_temp.campaign_id(), job_role, jobid, true,
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002'
  ) from activation_jobs order by job_role$$,
  'cron.schedule return IDs are persisted with complete definitions'
);
select lives_ok(
  $$select private.set_activation_jobs_active(
    pg_temp.campaign_id(), false,
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004'
  )$$,
  'jobs are disabled only through persisted IDs'
);
select lives_ok(
  $$select private.set_activation_jobs_active(
    pg_temp.campaign_id(), false,
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004'
  )$$,
  'disabled job operation is idempotent'
);
select is((select count(*) from private.activation_job_spec_versions where campaign_id = pg_temp.campaign_id()), 4::bigint, 'each supported state change records a new version per job');

select cron.alter_job((select jobid from activation_jobs where job_role = 'dispatcher'), command := 'select 1;', active := false);
select throws_ok($$select private.assert_activation_job_specs(pg_temp.campaign_id(), false)$$, '55000', 'Cron job definition drift or tampering detected', 'command tampering fails before arm');
select cron.alter_job(
  (select jobid from activation_jobs where job_role = 'dispatcher'),
  command := $$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$$,
  active := false
);
select cron.alter_job((select jobid from activation_jobs where job_role = 'dispatcher'), schedule := '@hourly', active := false);
select throws_ok($$select private.assert_activation_job_specs(pg_temp.campaign_id(), false)$$, '55000', 'Cron job definition drift or tampering detected', 'schedule tampering fails before arm');
select cron.alter_job((select jobid from activation_jobs where job_role = 'dispatcher'), schedule := '*/15 * * * 1-5', active := false);
select cron.alter_job((select jobid from activation_jobs where job_role = 'dispatcher'), database := 'template1', active := false);
select throws_ok($$select private.assert_activation_job_specs(pg_temp.campaign_id(), false)$$, '55000', 'Cron job definition drift or tampering detected', 'database tampering fails before arm');
select cron.alter_job((select jobid from activation_jobs where job_role = 'dispatcher'), database := current_database(), active := false);
select throws_ok(
  $$select cron.alter_job(
    (select jobid from activation_jobs where job_role = 'dispatcher'),
    username := 'authenticator', active := false
  )$$,
  'XX000', 'must be superuser to alter username',
  'documented Cron API rejects unauthorized username tampering before arm'
);
select isnt(
  private.activation_job_spec_hash(
    (select jobid from activation_jobs where job_role = 'dispatcher'),
    'capital-lab-no-ai-dispatcher', '*/15 * * * 1-5',
    $$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$$,
    current_database(), current_user, false
  ),
  private.activation_job_spec_hash(
    (select jobid from activation_jobs where job_role = 'dispatcher'),
    'capital-lab-no-ai-dispatcher', '*/15 * * * 1-5',
    $$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$$,
    current_database(), 'authenticator', false
  ),
  'versioned full-definition hash binds the exact Cron username'
);
select throws_ok(
  $$select private.register_activation_job_spec(
    pg_temp.campaign_id(), 'dispatcher', 9223372036854775800, false,
    gen_random_uuid(), gen_random_uuid()
  )$$,
  '55000', 'Cron job cannot be registered because its full definition differs', 'wrong job ID cannot be registered'
);
create temporary table activation_extra_job as
select cron.schedule('capital-lab-unexpected', '@hourly', 'select 1;')::bigint as jobid;
select throws_ok($$select private.assert_activation_job_specs(pg_temp.campaign_id(), false)$$, '55000', 'unexpected Capital Lab Cron job detected', 'additional Capital Lab job fails closed');
select cron.unschedule(jobid) from activation_extra_job;
select lives_ok($$select private.assert_activation_job_specs(pg_temp.campaign_id(), false)$$, 'restored exact jobs verify');

select lives_ok(
  $$select private.transition_no_ai_shadow_dry_run(
    pg_temp.campaign_id(), 'vault_verified', 'jobs_installed_disabled', 'admin_script', repeat('a', 40),
    'activation-readiness-v2', gen_random_uuid(), '{}'::jsonb
  )$$,
  'disabled exact jobs complete infrastructure preparation'
);
select lives_ok(
  $$select private.claim_activation_auth_noop(
    pg_temp.campaign_id(), '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  'auth no-op identity is atomically claimed once'
);
select throws_ok(
  $$select private.claim_activation_auth_noop(
    pg_temp.campaign_id(), '30000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000013',
    '30000000-0000-4000-8000-000000000014', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  '55000', 'auth no-op identity is immutable; reconcile the original request', 'unknown outcome cannot be resent with a new identity'
);
select lives_ok(
  $$select pg_temp.assert_invalid_auth_response(
    90001,
    jsonb_set(pg_temp.auth_noop_body(), '{correlation_id}', to_jsonb(gen_random_uuid()))
  )$$,
  'wrong auth correlation ID is rejected and rolled back'
);
select lives_ok(
  $$select pg_temp.assert_invalid_auth_response(
    90002,
    jsonb_set(pg_temp.auth_noop_body(), '{counters,orders}', '1'::jsonb)
  )$$,
  'nonzero auth side-effect counter is rejected and rolled back'
);
select lives_ok(
  $$select pg_temp.assert_invalid_auth_response(
    90003, pg_temp.auth_noop_body(), 503, false, 'local transport fixture'
  )$$,
  'transport error response is rejected and rolled back'
);
select lives_ok(
  $$select pg_temp.assert_invalid_auth_response(
    90004,
    jsonb_set(
      pg_temp.auth_noop_body(), '{terminal_reason}', '"mismatched_terminal"'::jsonb
    )
  )$$,
  'terminal-reason mismatch is rejected and rolled back'
);
update private.activation_auth_noop_requests
set pg_net_request_id = 90010, status = 'transport_terminal',
    terminal_at = statement_timestamp()
where campaign_id = pg_temp.campaign_id();
insert into net._http_response (
  id, status_code, content_type, headers, content, timed_out, error_msg
) values (
  90010, 200, 'application/json', '{}'::jsonb,
  pg_temp.auth_noop_body()::text, false, null
);
select lives_ok(
  $$select private.verify_activation_auth_noop(
    pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_database_fingerprint(),
    '30000000-0000-4000-8000-000000000004'
  )$$,
  'only the persisted exact auth no-op response verifies'
);
select is((
  select count(*) from private.activation_http_responses
  where campaign_id = pg_temp.campaign_id() and mode = 'auth_noop'
    and schema_valid and counters = pg_temp.zero_counters()
), 1::bigint, 'auth no-op verifier persists exactly the parsed zero counters');
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auth_noop_verified', 'auth verification advances through the guarded transition');

insert into public.market_calendar_manifests (
  id, owner_id, manifest_id, calendar_year, timezone, definition,
  content_hash, reviewed_at
) values (
  '40000000-0000-4000-8000-000000000001',
  (select user_id from public.app_users where role = 'owner' and is_active),
  'activation_dynamic_fixture', extract(year from statement_timestamp())::integer,
  'America/New_York', '{"fixture":"local-only"}'::jsonb, repeat('d', 64),
  statement_timestamp()
);
insert into public.market_sessions (
  id, exchange_id, session_date, opens_at, closes_at, session_type,
  calendar_source_id, source_identifier, available_at, calendar_manifest_id
)
select gen_random_uuid(), exchange.id, day::date,
  (day::date + time '13:30') at time zone 'UTC',
  ((day::date + time '13:30') at time zone 'UTC') + interval '6 hours 30 minutes',
  'regular', null, 'activation-' || day::date::text,
  statement_timestamp() - interval '1 day',
  '40000000-0000-4000-8000-000000000001'
from generate_series(
  (statement_timestamp() at time zone 'America/New_York')::date,
  (statement_timestamp() at time zone 'America/New_York')::date + 30,
  interval '1 day'
) as day
cross join lateral (select id from public.exchanges where mic = 'XNAS') as exchange
where extract(isodow from day) between 1 and 5
on conflict (exchange_id, session_date) do update
set calendar_manifest_id = excluded.calendar_manifest_id,
    available_at = excluded.available_at,
    opens_at = excluded.opens_at,
    closes_at = excluded.closes_at,
    session_type = excluded.session_type;
update public.experiments set lifecycle_status = 'paused'
where owner_id = (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id())
  and lifecycle_status = 'active';

select lives_ok(
  $$select private.freeze_activation_baseline(
    pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_database_fingerprint(),
    '40000000-0000-4000-8000-000000000002'
  )$$,
  'server-time planning freezes the two-session baseline'
);
select is((select count(*) from private.no_ai_shadow_dry_run_events where dry_run_id = pg_temp.campaign_id()), 104::bigint, 'freeze derives exactly 104 complete events');
select is((select count(distinct (session_date, slot_number)) from private.no_ai_shadow_dry_run_events where dry_run_id = pg_temp.campaign_id()), 52::bigint, 'freeze derives exactly 52 slots');
select lives_ok(
  $$select private.freeze_activation_baseline(
    pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_database_fingerprint(),
    '40000000-0000-4000-8000-000000000002'
  )$$,
  'baseline retry verifies byte-equivalent persisted evidence'
);
select throws_ok(
  $$update private.no_ai_shadow_dry_run_baselines set order_count = order_count + 1
    where dry_run_id = pg_temp.campaign_id()$$,
  '55000', 'private.no_ai_shadow_dry_run_baselines is append-only', 'baseline evidence cannot be updated'
);
select throws_ok(
  $$update private.no_ai_shadow_dry_run_events set http_status = 299
    where dry_run_id = pg_temp.campaign_id()$$,
  '55000', 'activation event identity is immutable', 'direct event mutation is rejected outside internal writers'
);
select throws_ok(
  $$truncate table private.activation_http_responses$$,
  '55000', 'private.activation_http_responses is append-only', 'transport evidence rejects truncate'
);

select lives_ok(
  $$select private.arm_activation_campaign(
    pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_database_fingerprint(),
    '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002'
  )$$,
  'local-only arm requires exact controls, target, Vault, baseline, and job identities'
);
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'armed', 'arm transition is persisted');
select lives_ok($$select private.assert_activation_job_specs(pg_temp.campaign_id(), true)$$, 'armed jobs still match the persisted full definitions');

select set_config('capital_lab.internal_event_write', 'on', true);
with numbered as (
  select id, 100000 + row_number() over (order by expected_at, event_type) as transport_id
  from private.no_ai_shadow_dry_run_events where dry_run_id = pg_temp.campaign_id()
)
update private.no_ai_shadow_dry_run_events as event
set pg_net_request_id = numbered.transport_id,
    request_submitted_at = statement_timestamp()
from numbered where numbered.id = event.id;
select set_config('capital_lab.internal_event_write', 'off', true);
insert into private.scheduler_slots (
  slot_key, owner_id, experiment_id, job_type, scheduler_provider,
  exchange_session_id, slot_at, lease_until, attempt_count, status,
  result, session_date, slot_number, lease_owner, heartbeat_at, max_attempts
)
select 'no-ai-infrastructure:' || event.dry_run_id::text || ':'
    || event.session_date::text || ':' || event.slot_number::text,
  event.owner_id, null, 'no_ai_shadow_infrastructure_dry_run', 'supabase',
  event.exchange_session_id, event.expected_at, event.expected_at + interval '2 minutes',
  1, 'skipped', '{"fixture":"preclaimed"}'::jsonb, event.session_date,
  event.slot_number, event.cycle_id, statement_timestamp(), 1
from private.no_ai_shadow_dry_run_events as event
where event.dry_run_id = pg_temp.campaign_id() and event.event_type = 'market_dispatcher';
select lives_ok(
  $test$
  do $body$
  declare event private.no_ai_shadow_dry_run_events%rowtype;
  begin
    for event in select * from private.no_ai_shadow_dry_run_events
      where dry_run_id = pg_temp.campaign_id()
      order by expected_at, event_type
    loop
      perform public.run_hosted_scheduler_request(
        event.dry_run_id, event.id, event.request_id, event.event_type,
        event.correlation_id, event.cycle_id, statement_timestamp()
      );
    end loop;
  end;
  $body$;
  $test$,
  'all 104 locally mocked route calls traverse the narrow scheduler wrapper'
);
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'running', 'first authenticated event advances armed to running');
select is((select count(*) from private.no_ai_shadow_dry_run_events where dry_run_id = pg_temp.campaign_id() and authenticated_count = 1 and terminal_reason is not null), 104::bigint, 'all 104 route events have terminal no-side-effect evidence');

insert into net._http_response (
  id, status_code, content_type, headers, content, timed_out, error_msg
)
select event.pg_net_request_id, 200, 'application/json', '{}'::jsonb,
  jsonb_build_object(
    'schema_version', 2,
    'mode', 'dry_run',
    'campaign_id', event.dry_run_id,
    'event_id', event.id,
    'correlation_id', event.correlation_id,
    'request_id', event.request_id,
    'cycle_id', event.cycle_id,
    'job', event.event_type,
    'slot_number', event.slot_number,
    'environment', 'production',
    'deployment_id', campaign.production_deployment_id,
    'commit_sha', campaign.prepared_commit_sha,
    'status', 'completed',
    'terminal_reason', case when event.event_type = 'market_dispatcher'
      then 'no_ai_shadow_cycle_recorded' else 'dry_run_evidence_reconciled' end,
    'scheduler_disabled', false,
    'agent_disabled', true,
    'cycles_claimed', case when event.event_type = 'market_dispatcher' then 1 else 0 end,
    'cycles_reconciled', 0,
    'counters', pg_temp.zero_counters()
  )::text,
  false, null
from private.no_ai_shadow_dry_run_events as event
join private.no_ai_shadow_dry_runs as campaign on campaign.id = event.dry_run_id
where event.dry_run_id = pg_temp.campaign_id();
select is(
  private.capture_activation_http_responses(),
  104,
  'reconciler parses and persists all 104 exact local pg_net responses'
);
select is((select count(*) from private.activation_http_responses where campaign_id = pg_temp.campaign_id() and mode = 'dry_run' and schema_valid), 104::bigint, '104 sanitized exact responses persist independently of pg_net TTL');
select is((select count(*) from private.no_ai_shadow_dry_run_events where dry_run_id = pg_temp.campaign_id() and model_call_count = 0 and budget_reservation_count = 0 and order_count = 0 and fill_count = 0 and ledger_entry_count = 0), 104::bigint, 'actual parsed zero counters are copied into every event');
delete from net._http_response where id between 100001 and 100104;
select is((select count(*) from private.activation_http_responses where campaign_id = pg_temp.campaign_id() and mode = 'dry_run'), 104::bigint, 'expired pg_net transport rows cannot erase durable reconciliation evidence');

select lives_ok($$select private.emergency_kill_activation_controls(pg_temp.campaign_id())$$, 'phase one emergency kill commits only database gates');
select lives_ok($$select private.emergency_kill_activation_controls(pg_temp.campaign_id())$$, 'repeated emergency kill is idempotent');
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'emergency kill reaches server-side stopped state');
select is((select count(*) from private.application_settings where owner_id = (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()) and setting_key in (
  'scheduler_enabled', 'agent_enabled', 'autonomous_paper_execution_enabled',
  'paid_model_calls_enabled', 'openai_canary_enabled', 'openai_web_search_enabled',
  'sol_challenger_enabled', 'sol_live_execution_enabled', 'real_broker_enabled'
) and value = 'false'::jsonb), 9::bigint, 'all nine dangerous controls are false after phase one');
select throws_ok(
  $$select private.finalize_activation_campaign(
    pg_temp.campaign_id(), repeat('a', 40), 'activation-readiness-v2',
    repeat('b', 64), repeat('c', 64), private.activation_database_fingerprint(),
    gen_random_uuid(), gen_random_uuid()
  )$$,
  '55000', 'campaign finalization is too early or in the wrong state',
  'finalize remains closed during the mandatory 300-second post-stop window'
);
select cron.alter_job(
  (select jobid from activation_jobs where job_role = 'dispatcher'),
  command := 'select 1;', active := true
);
select throws_ok(
  $$select private.disable_activation_jobs_after_emergency(
    pg_temp.campaign_id(), '60000000-0000-4000-8000-000000000011',
    '60000000-0000-4000-8000-000000000012'
  )$$,
  '55000', 'Cron job definition drift or tampering detected',
  'phase-two Cron failure cannot roll back the committed phase-one controls'
);
select is((select count(*) from private.application_settings where owner_id = (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()) and setting_key in (
  'scheduler_enabled', 'agent_enabled', 'autonomous_paper_execution_enabled',
  'paid_model_calls_enabled', 'openai_canary_enabled', 'openai_web_search_enabled',
  'sol_challenger_enabled', 'sol_live_execution_enabled', 'real_broker_enabled'
) and value = 'false'::jsonb), 9::bigint, 'phase-one controls survive the failed Cron phase');
select cron.alter_job(
  (select jobid from activation_jobs where job_role = 'dispatcher'),
  command := $$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$$,
  active := true
);
create function pg_temp.fail_activation_audit_write()
returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'injected audit failure';
end;
$$;
create trigger inject_activation_audit_failure
before insert on private.no_ai_shadow_dry_run_transitions
for each statement execute function pg_temp.fail_activation_audit_write();
select throws_ok(
  $$select private.disable_activation_jobs_after_emergency(
    pg_temp.campaign_id(), '60000000-0000-4000-8000-000000000021',
    '60000000-0000-4000-8000-000000000022'
  )$$,
  'P0001', 'injected audit failure',
  'phase-two audit failure cannot roll back the committed phase-one controls'
);
drop trigger inject_activation_audit_failure on private.no_ai_shadow_dry_run_transitions;
drop function pg_temp.fail_activation_audit_write();
select is((select count(*) from private.application_settings where owner_id = (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()) and setting_key in (
  'scheduler_enabled', 'agent_enabled', 'autonomous_paper_execution_enabled',
  'paid_model_calls_enabled', 'openai_canary_enabled', 'openai_web_search_enabled',
  'sol_challenger_enabled', 'sol_live_execution_enabled', 'real_broker_enabled'
) and value = 'false'::jsonb), 9::bigint, 'phase-one controls survive the failed audit phase');
select lives_ok(
  $$select private.disable_activation_jobs_after_emergency(
    pg_temp.campaign_id(), '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002'
  )$$,
  'phase two disables only reverified persisted job IDs'
);
select lives_ok($$select private.assert_activation_job_specs(pg_temp.campaign_id(), false)$$, 'both exact jobs are inactive after phase two');
select ok(exists (
  select 1 from private.no_ai_shadow_dry_run_transitions
  where dry_run_id = pg_temp.campaign_id() and to_state = 'auto_stopped'
    and evidence ->> 'phase_one_controls_committed' = 'true'
), 'retryable phase two records the already-committed emergency outcome');

update private.no_ai_shadow_dry_runs
set stopped_at = statement_timestamp() - interval '301 seconds',
    finalize_not_before_at = statement_timestamp() - interval '1 second'
where id = pg_temp.campaign_id();
select lives_ok(
  $$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp())$$,
  'owner-offline reconciler automatically persists terminal evidence and finalizes'
);
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'passed', '52-slot 104-event deterministic happy path reaches passed');
select is((select terminal_status from private.activation_terminal_evidence where campaign_id = pg_temp.campaign_id()), 'passed', 'terminal evidence records passed before job removal');
select is((select complete_response_count from private.activation_terminal_evidence where campaign_id = pg_temp.campaign_id()), 104, 'finalizer uses all 104 persisted responses');
select is(private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp()), null::bigint, 'duplicate terminal tick is idempotent');
select cron.alter_job(
  (select jobid from activation_jobs where job_role = 'reconciler'),
  command := 'select 1;', active := false
);
select throws_ok(
  $$select private.unschedule_terminal_activation_jobs(pg_temp.campaign_id())$$,
  '55000', 'Cron job definition drift or tampering detected',
  'unschedule fails closed on terminal job drift without changing safe controls'
);
select cron.alter_job(
  (select jobid from activation_jobs where job_role = 'reconciler'),
  command := $$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp());$$,
  active := false
);
select lives_ok($$select private.unschedule_terminal_activation_jobs(pg_temp.campaign_id())$$, 'terminal jobs unschedule only after terminal evidence');

select is(public.claim_paid_canary(
  (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()),
  '70000000-0000-4000-8000-000000000001'
), true, 'first global Canary claim succeeds only after the dry run is terminal');
select is((select count(*) from private.paid_canary_runs), 3::bigint, 'global Canary claim freezes all three exact models');
select is(public.claim_paid_canary(
  (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()),
  '70000000-0000-4000-8000-000000000002'
), false, 'new operation or campaign UUID cannot bypass the global Canary lock');
select throws_ok(
  $$update private.paid_canary_runs set status = 'unknown'$$,
  '55000', 'private.paid_canary_runs is append-only', 'Canary evidence rejects update'
);
select throws_ok(
  $$delete from private.paid_canary_runs$$,
  '55000', 'private.paid_canary_runs is append-only', 'Canary evidence rejects delete'
);
select throws_ok(
  $$truncate table private.paid_canary_runs$$,
  '55000', 'private.paid_canary_runs is append-only', 'Canary evidence rejects truncate'
);

select * from finish();
rollback;
