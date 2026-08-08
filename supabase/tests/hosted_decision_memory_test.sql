begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.hosted_decision_memory_read(timestamptz,integer)',
    'EXECUTE'
  ),
  'authenticated owners may read bounded point-in-time decision memory'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.hosted_decision_memory_read(timestamptz,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot read hosted decision memory'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as acl
    where namespace.nspname = 'public'
      and procedure.proname = 'hosted_decision_memory_read'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the hosted decision-memory function'
);

select is(
  procedure.provolatile::text,
  's'::text,
  'hosted decision memory is a stable read'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'hosted_decision_memory_read';

select ok(
  not procedure.prosecdef,
  'hosted decision memory runs with invoker rights'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'hosted_decision_memory_read';

select ok(
  coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'hosted decision memory fixes search_path'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'hosted_decision_memory_read';

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as acl
    where namespace.nspname = 'private'
      and procedure.proname in (
        'guard_agent_run_provenance',
        'validate_decision_context_snapshot',
        'validate_agent_decision_snapshot',
        'validate_trade_outcome_snapshot'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute decision-memory integrity triggers'
);

select ok(
  coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  format('%s fixes search_path', procedure.oid::regprocedure)
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'private'
  and procedure.proname in (
    'guard_agent_run_provenance',
    'validate_decision_context_snapshot',
    'validate_agent_decision_snapshot',
    'validate_trade_outcome_snapshot'
  );

select has_index(
  'public',
  'decision_context_snapshots',
  'decision_context_snapshots_owner_decision_at_idx',
  'owner decision-context reads have a bounded timeline index'
);
select has_index(
  'public',
  'agent_decisions',
  'agent_decisions_owner_decided_at_idx',
  'owner decision reads have a bounded timeline index'
);
select has_index(
  'public',
  'decision_evidence',
  'decision_evidence_owner_available_at_idx',
  'owner citation reads have an availability index'
);
select has_index(
  'public',
  'trade_outcomes',
  'trade_outcomes_owner_evaluated_at_idx',
  'owner outcome reads have an evaluation index'
);

create temporary table decision_memory_fixture as
select
  owner.user_id as owner_id,
  experiment.id as experiment_id,
  experiment.locked_version_id as experiment_version_id,
  gen_random_uuid() as prior_run_id,
  gen_random_uuid() as prior_context_id,
  gen_random_uuid() as prior_decision_id,
  gen_random_uuid() as current_run_id,
  gen_random_uuid() as current_context_id,
  gen_random_uuid() as current_decision_id,
  gen_random_uuid() as evidence_id,
  gen_random_uuid() as outcome_id,
  gen_random_uuid() as invalid_context_id,
  gen_random_uuid() as invalid_decision_id,
  gen_random_uuid() as invalid_outcome_id,
  gen_random_uuid() as invalid_sign_outcome_id,
  statement_timestamp() - interval '2 hours' as prior_decision_at,
  statement_timestamp() - interval '1 hour' as current_decision_at,
  statement_timestamp() - interval '45 minutes' as outcome_at
from public.app_users as owner
join lateral (
  select candidate.*
  from public.experiments as candidate
  where candidate.owner_id = owner.user_id
    and candidate.locked_version_id is not null
  order by candidate.created_at, candidate.id
  limit 1
) as experiment on true
where owner.role = 'owner'
  and owner.is_active
limit 1;

select is(
  (select count(*) from decision_memory_fixture),
  1::bigint,
  'the test found one active owner with a locked paper experiment'
);

-- Local reset fixtures are inserted immediately before pgTAP runs, while their
-- synthetic decisions are historical. Keep the referenced immutable version
-- behind this rollback-only fixture boundary without retaining the adjustment.
set local session_replication_role = replica;
update public.experiment_versions as version
set created_at = least(
  version.created_at,
  fixture.prior_decision_at - interval '1 day'
)
from decision_memory_fixture as fixture
where version.id = fixture.experiment_version_id
  and version.owner_id = fixture.owner_id;
set local session_replication_role = origin;

insert into public.agent_runs(
  id,
  experiment_id,
  owner_id,
  role,
  run_type,
  model,
  status,
  routing_reason,
  decision_at,
  started_at,
  finished_at,
  correlation_id,
  created_at
)
select
  fixture.prior_run_id,
  fixture.experiment_id,
  fixture.owner_id,
  'luna',
  'decision_memory_fixture',
  'fixture-paper-model',
  'completed',
  'deterministic test fixture',
  fixture.prior_decision_at,
  fixture.prior_decision_at,
  fixture.prior_decision_at + interval '1 second',
  gen_random_uuid(),
  fixture.prior_decision_at
from decision_memory_fixture as fixture
union all
select
  fixture.current_run_id,
  fixture.experiment_id,
  fixture.owner_id,
  'luna',
  'decision_memory_fixture',
  'fixture-paper-model',
  'completed',
  'deterministic test fixture',
  fixture.current_decision_at,
  fixture.current_decision_at,
  fixture.current_decision_at + interval '1 second',
  gen_random_uuid(),
  fixture.current_decision_at
from decision_memory_fixture as fixture;

insert into public.decision_context_snapshots(
  id,
  agent_run_id,
  experiment_id,
  owner_id,
  experiment_version_id,
  decision_at,
  context_manifest,
  content_hash,
  created_at
)
select
  fixture.prior_context_id,
  fixture.prior_run_id,
  fixture.experiment_id,
  fixture.owner_id,
  fixture.experiment_version_id,
  fixture.prior_decision_at,
  '{"fixture":"paper-only","sequence":"prior"}'::jsonb,
  repeat('c', 64),
  fixture.prior_decision_at
from decision_memory_fixture as fixture
union all
select
  fixture.current_context_id,
  fixture.current_run_id,
  fixture.experiment_id,
  fixture.owner_id,
  fixture.experiment_version_id,
  fixture.current_decision_at,
  '{"fixture":"paper-only","sequence":"current"}'::jsonb,
  repeat('d', 64),
  fixture.current_decision_at
from decision_memory_fixture as fixture;

insert into public.agent_decisions(
  id,
  context_snapshot_id,
  agent_run_id,
  experiment_id,
  owner_id,
  decision_type,
  structured_output,
  concise_rationale,
  confidence,
  proposal_status,
  decided_at,
  created_at
)
select
  fixture.prior_decision_id,
  fixture.prior_context_id,
  fixture.prior_run_id,
  fixture.experiment_id,
  fixture.owner_id,
  'abstain',
  '{"fixture":"paper-only","sequence":"prior"}'::jsonb,
  'Deterministic prior paper-only fixture.',
  0.80,
  'abstained',
  fixture.prior_decision_at,
  fixture.prior_decision_at
from decision_memory_fixture as fixture
union all
select
  fixture.current_decision_id,
  fixture.current_context_id,
  fixture.current_run_id,
  fixture.experiment_id,
  fixture.owner_id,
  'abstain',
  '{"fixture":"paper-only","sequence":"current"}'::jsonb,
  'Deterministic current paper-only fixture.',
  0.95,
  'abstained',
  fixture.current_decision_at,
  fixture.current_decision_at
from decision_memory_fixture as fixture;

insert into public.decision_evidence(
  id,
  decision_id,
  owner_id,
  evidence_kind,
  prior_decision_id,
  evidence_available_at,
  citation_label,
  created_at
)
select
  fixture.evidence_id,
  fixture.current_decision_id,
  fixture.owner_id,
  'prior_decision',
  fixture.prior_decision_id,
  fixture.prior_decision_at,
  'decision:paper-only-prior',
  fixture.current_decision_at
from decision_memory_fixture as fixture;

insert into public.trade_outcomes(
  id,
  decision_id,
  owner_id,
  horizon,
  evaluated_at,
  forward_return,
  benchmark_relative_return,
  maximum_favorable_excursion,
  maximum_adverse_excursion,
  thesis_valid,
  execution_outcome,
  created_at
)
select
  fixture.outcome_id,
  fixture.current_decision_id,
  fixture.owner_id,
  '15m',
  fixture.outcome_at,
  0.012345678901,
  0.002345678901,
  0.020000000000,
  -0.005000000000,
  true,
  '{"fixture":"paper-only"}'::jsonb,
  fixture.outcome_at
from decision_memory_fixture as fixture;

grant select on decision_memory_fixture to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select owner_id from decision_memory_fixture),
    'role', 'authenticated'
  )::text,
  true
);

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(memory.context_rows) as element
    where (element ->> 'id')::uuid in (
      fixture.prior_context_id,
      fixture.current_context_id
    )
  ),
  2,
  'the owner sees both immutable fixture contexts at decisionAt'
)
from public.hosted_decision_memory_read(
  (select current_decision_at from decision_memory_fixture),
  100
) as memory
cross join decision_memory_fixture as fixture;

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(memory.decision_rows) as element
    where (element ->> 'id')::uuid in (
      fixture.prior_decision_id,
      fixture.current_decision_id
    )
  ),
  2,
  'the owner sees both linked decisions at decisionAt'
)
from public.hosted_decision_memory_read(
  (select current_decision_at from decision_memory_fixture),
  100
) as memory
cross join decision_memory_fixture as fixture;

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(memory.evidence_rows) as element
    where (element ->> 'id')::uuid = fixture.evidence_id
  ),
  1,
  'evidence available before the decision remains visible'
)
from public.hosted_decision_memory_read(
  (select current_decision_at from decision_memory_fixture),
  100
) as memory
cross join decision_memory_fixture as fixture;

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(memory.outcome_rows) as element
    where (element ->> 'id')::uuid = fixture.outcome_id
  ),
  0,
  'an outcome evaluated after decisionAt is excluded'
)
from public.hosted_decision_memory_read(
  (select current_decision_at from decision_memory_fixture),
  100
) as memory
cross join decision_memory_fixture as fixture;

select is(
  (
    select element ->> 'forward_return_text'
    from jsonb_array_elements(memory.outcome_rows) as element
    where (element ->> 'id')::uuid = fixture.outcome_id
  ),
  '0.012345678901',
  'an eligible outcome is returned as exact decimal text'
)
from public.hosted_decision_memory_read(
  (select outcome_at from decision_memory_fixture),
  100
) as memory
cross join decision_memory_fixture as fixture;

select is(
  (
    select element ->> 'confidence_text'
    from jsonb_array_elements(memory.decision_rows) as element
    where (element ->> 'id')::uuid = fixture.current_decision_id
  ),
  '0.95000',
  'decision confidence is returned as exact decimal text'
)
from public.hosted_decision_memory_read(
  (select outcome_at from decision_memory_fixture),
  100
) as memory
cross join decision_memory_fixture as fixture;

select throws_ok(
  $$select * from public.hosted_decision_memory_read(null, 100)$$,
  '22004',
  'decisionAt is required',
  'a missing decisionAt is rejected'
);

select throws_ok(
  $$select * from public.hosted_decision_memory_read(statement_timestamp() + interval '1 minute', 100)$$,
  '22007',
  'decisionAt cannot be in the future',
  'a future decisionAt is rejected'
);

select throws_ok(
  $$select * from public.hosted_decision_memory_read(statement_timestamp(), 0)$$,
  '22023',
  'context limit must be between 1 and 200',
  'an unbounded or empty context limit is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$select * from public.hosted_decision_memory_read(statement_timestamp(), 100)$$,
  '42501',
  'active owner authentication required',
  'a non-owner cannot read owner decision memory'
);

reset role;
select set_config('request.jwt.claims', '{}', true);

select throws_ok(
  format(
    'update public.agent_runs set model = %L where id = %L',
    'mutated-model',
    fixture.current_run_id
  ),
  '55000',
  'agent run provenance is immutable',
  'agent model provenance cannot be rewritten'
) from decision_memory_fixture as fixture;

select lives_ok(
  format(
    'update public.agent_runs set status = %L, finished_at = %L where id = %L',
    'completed',
    fixture.current_decision_at + interval '2 seconds',
    fixture.current_run_id
  ),
  'agent run completion evidence remains updateable'
) from decision_memory_fixture as fixture;

select throws_ok(
  format($sql$insert into public.decision_context_snapshots(
      id, agent_run_id, experiment_id, owner_id, experiment_version_id,
      decision_at, context_manifest, content_hash
    ) values (
      %L, %L, %L, %L, %L, %L, '{}',
      repeat('c', 64)
    )$sql$,
    fixture.invalid_context_id,
    fixture.current_run_id,
    fixture.experiment_id,
    fixture.owner_id,
    fixture.experiment_version_id,
    fixture.current_decision_at + interval '1 second'
  ),
  '23514',
  'decision context run scope or decision time is inconsistent',
  'a context cannot drift from its agent run decision time'
) from decision_memory_fixture as fixture;

select throws_ok(
  format($sql$insert into public.agent_decisions(
      id, context_snapshot_id, agent_run_id, experiment_id, owner_id,
      decision_type, structured_output, concise_rationale, confidence,
      proposal_status, decided_at
    ) values (
      %L, %L, %L, %L, %L,
      'buy', '{}', 'invalid fixture', 0.5, 'shadow', %L
    )$sql$,
    fixture.invalid_decision_id,
    fixture.current_context_id,
    fixture.current_run_id,
    fixture.experiment_id,
    fixture.owner_id,
    fixture.current_decision_at
  ),
  '23514',
  'an actionable agent decision requires an instrument',
  'an actionable decision cannot omit its instrument'
) from decision_memory_fixture as fixture;

select throws_ok(
  format($sql$insert into public.trade_outcomes(
      id, decision_id, owner_id, horizon, evaluated_at, forward_return,
      benchmark_relative_return, maximum_favorable_excursion,
      maximum_adverse_excursion, execution_outcome
    ) values (
      %L, %L, %L, '1h', %L, 0, 0, 0, 0, '{}'
    )$sql$,
    fixture.invalid_outcome_id,
    fixture.current_decision_id,
    fixture.owner_id,
    fixture.current_decision_at
  ),
  '23514',
  'trade outcome must be measured strictly after its decision',
  'an outcome cannot be measured at the decision boundary'
) from decision_memory_fixture as fixture;

select throws_ok(
  format($sql$insert into public.trade_outcomes(
      id, decision_id, owner_id, horizon, evaluated_at, forward_return,
      benchmark_relative_return, maximum_favorable_excursion,
      maximum_adverse_excursion, execution_outcome
    ) values (
      %L, %L, %L, '1h', %L, 0, 0, -0.01, 0, '{}'
    )$sql$,
    fixture.invalid_sign_outcome_id,
    fixture.current_decision_id,
    fixture.owner_id,
    fixture.current_decision_at + interval '30 minutes'
  ),
  '23514',
  null,
  'maximum favorable excursion cannot be negative'
) from decision_memory_fixture as fixture;

select throws_ok(
  format(
    'update public.trade_outcomes set forward_return = 0 where id = %L',
    fixture.outcome_id
  ),
  '55000',
  'public.trade_outcomes is append-only',
  'persisted outcome evidence remains immutable'
) from decision_memory_fixture as fixture;

select * from finish();
rollback;
