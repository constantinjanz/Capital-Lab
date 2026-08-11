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
    'schema_version', 3,
    'mode', 'auth_noop',
    'deployment_role', 'auth_disabled',
    'campaign_id', pg_temp.campaign_id(),
    'correlation_id', '30000000-0000-4000-8000-000000000004'::uuid,
    'nonce', '30000000-0000-4000-8000-000000000002'::uuid,
    'request_id', '30000000-0000-4000-8000-000000000001'::uuid,
    'environment', 'production',
    'deployment_id', 'dpl_12345678901234567890',
    'project_id', 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR',
    'commit_sha', repeat('a', 40),
    'status', 'authenticated_noop',
    'terminal_reason', 'auth_noop_verified',
    'scheduler_disabled', true,
    'agent_disabled', true,
    'counters', pg_temp.zero_counters()
  );
$$;

create function pg_temp.auth_failure_body()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'schema_version', 3, 'mode', 'auth_failure', 'error', 'unauthorized',
    'classification', 'bearer_missing_or_invalid', 'scheduler_disabled', true,
    'agent_disabled', true, 'counters', pg_temp.zero_counters()
  );
$$;

create function pg_temp.deployment_proof(
  p_role text,
  p_deployment_id text,
  p_scheduler_enabled boolean
)
returns jsonb language sql stable as $$
  with immutable as (
    select jsonb_build_object(
      'schemaVersion', 1, 'role', p_role,
      'vercelTeamId', 'team_yqndKHk6nfWGlte1UVLTJOHG',
      'vercelProjectId', 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR',
      'supabaseProjectRef', 'qrnuyibntcxwffrxmrvn',
      'deploymentId', p_deployment_id, 'commitSha', repeat('a', 40),
      'environment', 'production', 'target', 'production',
      'readyState', 'READY',
      'productionOrigin', 'https://capital-lab-constantinjanz-7876s-projects.vercel.app',
      'productionHost', 'capital-lab-constantinjanz-7876s-projects.vercel.app',
      'schedulerPath', '/api/internal/scheduler',
      'schedulerUrl', 'https://capital-lab-constantinjanz-7876s-projects.vercel.app/api/internal/scheduler',
      'schedulerEnabled', p_scheduler_enabled
    ) as body
  )
  select body || jsonb_build_object(
    'evidenceHash', encode(extensions.digest(convert_to(concat_ws(E'\x1f',
      'capital-lab-vercel-deployment-proof-v1', body ->> 'schemaVersion',
      body ->> 'role', body ->> 'vercelTeamId', body ->> 'vercelProjectId',
      body ->> 'supabaseProjectRef', body ->> 'deploymentId', body ->> 'commitSha',
      body ->> 'environment', body ->> 'target', body ->> 'readyState',
      body ->> 'productionOrigin', body ->> 'productionHost',
      body ->> 'schedulerPath', body ->> 'schedulerUrl',
      body ->> 'schedulerEnabled'
    ), 'UTF8'), 'sha256'), 'hex'),
    'verifiedAt', statement_timestamp()
  ) from immutable;
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
    perform private.capture_activation_http_responses();
    if not exists (
      select 1 from private.activation_http_responses
      where pg_net_request_id = p_transport_id and not schema_valid
    ) then
      raise exception using errcode = 'P0001', message = 'invalid response was not durably classified before verification';
    end if;
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
    raise exception using errcode = 'P0001', message = 'fixture rollback did not restore the original request';
  end if;
end;
$$;

create function pg_temp.campaign_manifest()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'campaign_id', pg_temp.campaign_id(),
    'schema_version', 3,
    'config_version', 'activation-readiness-v2',
    'prepared_commit_sha', repeat('a', 40),
    'phase_contract_sha256', repeat('c', 64),
    'relation_contract_sha256', private.activation_relation_contract_hash(),
    'project_identity_contract_sha256', 'd6b38244bdc714f3aa68efbb96ddd36115e13410e8c2d9e8c14677e512f1a634',
    'vercel_team_id', 'team_yqndKHk6nfWGlte1UVLTJOHG',
    'vercel_project_id', 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR',
    'supabase_project_ref', 'qrnuyibntcxwffrxmrvn',
    'production_origin', 'https://capital-lab-constantinjanz-7876s-projects.vercel.app',
    'production_host', 'capital-lab-constantinjanz-7876s-projects.vercel.app',
    'scheduler_path', '/api/internal/scheduler',
    'scheduler_url', 'https://capital-lab-constantinjanz-7876s-projects.vercel.app/api/internal/scheduler',
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
select has_table('private', 'activation_deployment_bindings', 'immutable Vercel deployment proofs persist');
select has_table('private', 'activation_relation_classifications', 'schema-wide side-effect classification persists');
select has_table('private', 'activation_terminal_operations', 'retry-safe terminal operation identities persist');
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
select ok(not has_table_privilege('service_role', 'private.activation_deployment_bindings', 'TRUNCATE'), 'service role cannot truncate deployment proofs');
select ok(not has_table_privilege('service_role', 'private.activation_terminal_operations', 'DELETE'), 'service role cannot delete terminal operation evidence');
select ok(not has_function_privilege('service_role', 'private.transition_no_ai_shadow_dry_run(uuid,text,text,text,text,text,uuid,jsonb)', 'EXECUTE'), 'service role cannot invoke generic transitions');
select ok(not has_function_privilege('service_role', 'private.record_activation_deployment_binding(uuid,text,jsonb,text,uuid,uuid,text,text,text,text,text)', 'EXECUTE'), 'service role cannot bind a deployment proof directly');
select ok(not has_function_privilege('service_role', 'private.capture_activation_auth_failure_responses(uuid)', 'EXECUTE'), 'service role cannot forge auth-failure transport reconciliation');
select ok(not has_function_privilege('service_role', 'private.finalize_activation_campaign(uuid,text,text,text,text,text,uuid,uuid)', 'EXECUTE'), 'service role cannot finalize a Campaign directly');
select ok(not has_function_privilege('service_role', 'private.emergency_kill_activation_controls(uuid)', 'EXECUTE'), 'service role cannot invoke the operator-only emergency primitive through PostgREST');
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
select lives_ok($$select private.assert_activation_relation_classification_complete()$$, 'every public/private base relation is classified exactly once');
select is((
  select count(*) from private.activation_relation_classifications
), (
  select count(*) from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('public', 'private') and relation.relkind in ('r', 'p')
), 'classification contract equals the live public/private base-table catalog');
select is((
  select count(*) from private.activation_relation_classifications
  where relation_name in (
    'public.market_quotes', 'public.portfolio_snapshots', 'public.risk_events',
    'public.simulator_runs', 'public.trade_outcomes', 'public.agent_decisions',
    'public.experiments'
  ) and classification = 'forbidden'
), 7::bigint, 'market, portfolio, risk, simulator, trade, decision, and experiment state is forbidden');

-- Seed the deterministic local market-calendar fixture before a Campaign
-- exists. Once endpoint verification begins these relations are intentionally
-- forbidden, so fixture setup after that gate would correctly trigger the
-- DB-first emergency stop.
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
where owner_id = (
    select user_id from public.app_users where role = 'owner' and is_active
  )
  and lifecycle_status = 'active';

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
  'https://capital-lab-constantinjanz-7876s-projects.vercel.app/api/internal/scheduler',
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
select throws_ok(
  $$select private.claim_activation_auth_noop(
    pg_temp.campaign_id(), '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  '55000', 'auth no-op requires both exact 401 probes',
  'auth no-op cannot be claimed before the mandatory endpoint and 401 gates'
);
select lives_ok(
  $$select private.record_activation_deployment_binding(
    pg_temp.campaign_id(), 'auth_disabled',
    pg_temp.deployment_proof('auth_disabled', 'dpl_12345678901234567890', false),
    private.activation_vercel_proof_file_hash(
      pg_temp.deployment_proof('auth_disabled', 'dpl_12345678901234567890', false)
    ), '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  'read-only Vercel proof binds the disabled Auth deployment'
);
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auth_endpoint_verified', 'endpoint proof advances the mandatory state');
select throws_ok(
  $$select private.record_activation_deployment_binding(
    pg_temp.campaign_id(), 'auth_disabled',
    pg_temp.deployment_proof('auth_disabled', 'dpl_12345678901234567890', false),
    repeat('f', 64), '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  '55000', 'Vercel deployment proof drifted from the reviewed identity',
  'caller-asserted deployment proof file hashes are rejected'
);
select throws_ok(
  $$select private.record_activation_deployment_binding(
    pg_temp.campaign_id(), 'no_ai_runtime_enabled',
    pg_temp.deployment_proof('no_ai_runtime_enabled', 'dpl_22345678901234567890', true),
    private.activation_vercel_proof_file_hash(
      pg_temp.deployment_proof('no_ai_runtime_enabled', 'dpl_22345678901234567890', true)
    ), '31000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000004', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  '22023', 'deployment proof is invalid',
  'runtime deployment cannot bind before the reviewed post-auth phase'
);
select lives_ok(
  $$select private.claim_activation_auth_failure_probes(
    pg_temp.campaign_id(), '32000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000002', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  'exactly one missing and one invalid Bearer probe are durably claimed'
);
update private.activation_auth_failure_requests
set pg_net_request_id = case probe_kind when 'missing' then 89901 else 89902 end,
    status = 'submitted', submitted_at = statement_timestamp()
where campaign_id = pg_temp.campaign_id();
insert into net._http_response (
  id, status_code, content_type, headers, content, timed_out, error_msg
) values
  (89901, 401, 'application/json', '{}'::jsonb, pg_temp.auth_failure_body()::text, false, null),
  (89902, 401, 'application/json', '{}'::jsonb, pg_temp.auth_failure_body()::text, false, null);
select lives_ok(
  $$select private.verify_activation_auth_failure_probes(pg_temp.campaign_id())$$,
  'both exact 401 response fixtures reconcile through the durable probe identities'
);
select is((select count(*) from private.activation_auth_failure_requests where campaign_id = pg_temp.campaign_id() and status = 'verified'), 2::bigint, 'exactly two verified 401 probes persist');
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auth_failures_verified', 'the 401 gate must complete before auth no-op claim');
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

select throws_ok(
  $$select private.record_activation_deployment_binding(
    pg_temp.campaign_id(), 'no_ai_runtime_enabled',
    pg_temp.deployment_proof('no_ai_runtime_enabled', 'dpl_12345678901234567890', true),
    private.activation_vercel_proof_file_hash(
      pg_temp.deployment_proof('no_ai_runtime_enabled', 'dpl_12345678901234567890', true)
    ), '33000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000002', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  '55000', 'Vercel deployment proof drifted from the reviewed identity',
  'the Runtime deployment must be different from the Auth deployment'
);
create temporary table runtime_deployment_proof as
select pg_temp.deployment_proof(
  'no_ai_runtime_enabled', 'dpl_22345678901234567890', true
) as proof;
select lives_ok(
  $$select private.record_activation_deployment_binding(
    pg_temp.campaign_id(), 'no_ai_runtime_enabled',
    (select proof from runtime_deployment_proof),
    private.activation_vercel_proof_file_hash((select proof from runtime_deployment_proof)),
    '33000000-0000-4000-8000-000000000003',
    '33000000-0000-4000-8000-000000000004', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  'a second READY Production deployment from the same commit binds as Runtime'
);
select lives_ok(
  $$select private.record_activation_deployment_binding(
    pg_temp.campaign_id(), 'no_ai_runtime_enabled',
    (select proof from runtime_deployment_proof),
    private.activation_vercel_proof_file_hash((select proof from runtime_deployment_proof)),
    '33000000-0000-4000-8000-000000000003',
    '33000000-0000-4000-8000-000000000004', repeat('a', 40),
    'activation-readiness-v2', repeat('b', 64), repeat('c', 64),
    private.activation_database_fingerprint()
  )$$,
  'Runtime deployment binding retry returns the exact durable proof'
);
select is((select count(*) from private.activation_deployment_bindings where campaign_id = pg_temp.campaign_id()), 2::bigint, 'Auth and Runtime deployment identities are append-only');
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'runtime_deployment_verified', 'baseline is blocked until the Runtime deployment is durably verified');

savepoint market_side_effect_guard;
update public.market_quotes set id = id where false;
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'market-data mutation trips the DB-first kill even with zero affected rows');
rollback to savepoint market_side_effect_guard;
savepoint portfolio_side_effect_guard;
update public.portfolio_snapshots set id = id where false;
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'portfolio mutation trips the DB-first kill');
rollback to savepoint portfolio_side_effect_guard;
savepoint risk_side_effect_guard;
update public.risk_events set id = id where false;
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'risk mutation trips the DB-first kill');
rollback to savepoint risk_side_effect_guard;
savepoint simulator_side_effect_guard;
update public.simulator_runs set id = id where false;
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'simulator mutation trips the DB-first kill');
rollback to savepoint simulator_side_effect_guard;
savepoint trade_outcome_side_effect_guard;
update public.trade_outcomes set id = id where false;
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'trade-outcome mutation trips the DB-first kill');
rollback to savepoint trade_outcome_side_effect_guard;
savepoint decision_side_effect_guard;
update public.agent_decisions set id = id where false;
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'decision-evidence mutation trips the DB-first kill');
rollback to savepoint decision_side_effect_guard;
savepoint experiment_side_effect_guard;
update public.experiments set id = id where false;
select is((select state from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()), 'auto_stopped', 'experiment mutation trips the DB-first kill');
rollback to savepoint experiment_side_effect_guard;

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
    'schema_version', 3,
    'mode', 'dry_run',
    'deployment_role', 'no_ai_runtime_enabled',
    'campaign_id', event.dry_run_id,
    'event_id', event.id,
    'correlation_id', event.correlation_id,
    'request_id', event.request_id,
    'cycle_id', event.cycle_id,
    'job', event.event_type,
    'slot_number', event.slot_number,
    'environment', 'production',
    'deployment_id', binding.deployment_id,
    'project_id', binding.vercel_project_id,
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
join private.activation_deployment_bindings as binding
  on binding.campaign_id = event.dry_run_id
  and binding.deployment_role = 'no_ai_runtime_enabled'
where event.dry_run_id = pg_temp.campaign_id();
select is(
  private.capture_activation_http_responses(),
  104,
  'reconciler parses and persists all 104 exact local pg_net responses'
);
select is((select count(*) from private.activation_http_responses where campaign_id = pg_temp.campaign_id() and mode = 'dry_run' and schema_valid), 104::bigint, '104 sanitized exact responses persist independently of pg_net TTL');
select is((select count(*) from private.no_ai_shadow_dry_run_events where dry_run_id = pg_temp.campaign_id() and model_call_count = 0 and budget_reservation_count = 0 and order_count = 0 and fill_count = 0 and ledger_entry_count = 0), 104::bigint, 'actual parsed zero counters are copied into every event');
select is((
  select count(*) from private.activation_http_responses
  where campaign_id = pg_temp.campaign_id() and mode = 'dry_run'
    and response_deployment_id = 'dpl_22345678901234567890'
    and response_deployment_role = 'no_ai_runtime_enabled'
), 104::bigint, 'every Runtime response is bound to the second immutable deployment');
delete from net._http_response where id between 100001 and 100104;
select is((select count(*) from private.activation_http_responses where campaign_id = pg_temp.campaign_id() and mode = 'dry_run'), 104::bigint, 'expired pg_net transport rows cannot erase durable reconciliation evidence');

select throws_ok(
  $$select public.claim_paid_canary(
    (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()),
    '70000000-0000-4000-8000-000000000000'
  )$$,
  '55000', 'exactly one passed Activation campaign is required before paid Canary',
  'a paid Responses claim is impossible before immutable passed terminal evidence'
);

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
create trigger aa_inject_activation_terminal_operation_failure
before update on private.activation_terminal_operations
for each statement execute function pg_temp.fail_activation_audit_write();
select throws_ok(
  $$select private.disable_activation_jobs_after_emergency(
    pg_temp.campaign_id(), '60000000-0000-4000-8000-000000000021',
    '60000000-0000-4000-8000-000000000022'
  )$$,
  'P0001', 'injected audit failure',
  'phase-two audit failure cannot roll back the committed phase-one controls'
);
drop trigger aa_inject_activation_terminal_operation_failure on private.activation_terminal_operations;
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
select lives_ok(
  $$select private.disable_activation_jobs_after_emergency(
    pg_temp.campaign_id(), '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002'
  )$$,
  'same phase-two operation identity returns its durable completed result'
);
select throws_ok(
  $$select private.disable_activation_jobs_after_emergency(
    pg_temp.campaign_id(), '60000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000004'
  )$$,
  '55000', 'emergency phase-two operation identity drifted',
  'a different phase-two identity cannot repeat the operation'
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
  $$select private.unschedule_terminal_activation_jobs(
    pg_temp.campaign_id(), '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000002'
  )$$,
  '55000', 'Cron job definition drift or tampering detected',
  'unschedule fails closed on terminal job drift without changing safe controls'
);
select cron.alter_job(
  (select jobid from activation_jobs where job_role = 'reconciler'),
  command := $$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp());$$,
  active := false
);
select lives_ok(
  $$select private.unschedule_terminal_activation_jobs(
    pg_temp.campaign_id(), '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000002'
  )$$,
  'terminal jobs unschedule only after terminal evidence'
);
select lives_ok(
  $$select private.unschedule_terminal_activation_jobs(
    pg_temp.campaign_id(), '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000002'
  )$$,
  'same terminal unschedule identity returns durable completed evidence'
);
select throws_ok(
  $$select private.unschedule_terminal_activation_jobs(
    pg_temp.campaign_id(), '61000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000004'
  )$$,
  '55000', 'terminal unschedule operation identity drifted',
  'different terminal unschedule identity cannot repeat the operation'
);

select is(public.claim_paid_canary(
  (select owner_id from private.no_ai_shadow_dry_runs where id = pg_temp.campaign_id()),
  '70000000-0000-4000-8000-000000000001'
), true, 'first global Canary claim succeeds only after the dry run is terminal');
select is((select count(*) from private.paid_canary_runs), 3::bigint, 'global Canary claim freezes all three exact models');
select is((
  select count(*) from private.paid_canary_runs
  where result ->> 'activation_campaign_id' = pg_temp.campaign_id()::text
    and result -> 'activation_terminal_passed' = 'true'::jsonb
), 3::bigint, 'every Canary lock preserves the immutable passed-Activation prerequisite');
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
