begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'service_role',
    'public.begin_hosted_agent_run(uuid,uuid,uuid,text,timestamptz,text,uuid,text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'only the server runtime role may begin a hosted agent run'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_hosted_agent_run(uuid,uuid,uuid,text,timestamptz,text,uuid,text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'the browser role cannot begin a hosted agent run'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_hosted_shadow_proposal(uuid,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,integer,integer,integer,integer,integer,integer,text)',
    'EXECUTE'
  ),
  'only the server runtime role may finalize a structured shadow proposal'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.finalize_hosted_shadow_proposal(uuid,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,integer,integer,integer,integer,integer,integer,text)',
    'EXECUTE'
  ),
  'the browser role cannot finalize a structured shadow proposal'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_hosted_luna_run(uuid,uuid,uuid,text,jsonb,integer,integer,integer,integer,integer,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.finalize_hosted_luna_run(uuid,uuid,uuid,text,jsonb,integer,integer,integer,integer,integer,integer,text)',
    'EXECUTE'
  ),
  'only the server runtime role may finalize Luna relevance results'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.hosted_agent_console_read(timestamptz,integer)',
    'EXECUTE'
  ),
  'the authenticated owner may read the bounded agent console'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.hosted_agent_console_read(timestamptz,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot read the hosted agent console'
);

select ok(
  relation.relrowsecurity and relation.relforcerowsecurity,
  'role-specific experiment prompt pins have forced RLS'
)
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'experiment_agent_prompt_versions';

select ok(
  has_table_privilege('authenticated', 'public.experiment_agent_prompt_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.experiment_agent_prompt_versions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.experiment_agent_prompt_versions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.experiment_agent_prompt_versions', 'DELETE'),
  'owners may read prompt pins but cannot mutate them'
);

create temporary table structured_runtime_fixture as
select
  '00000000-0000-0000-0000-000000000001'::uuid as owner_id,
  '70000000-0000-0000-0000-000000000002'::uuid as experiment_id,
  '71000000-0000-0000-0000-000000000002'::uuid as experiment_version_id,
  '61100000-0000-0000-0000-000000000001'::uuid as terra_prompt_id,
  'a3000000-0000-0000-0000-000000000001'::uuid as evidence_id,
  'a3000000-0000-0000-0000-000000000099'::uuid as future_evidence_id,
  gen_random_uuid() as operation_id,
  gen_random_uuid() as invalid_operation_id,
  statement_timestamp() - interval '1 second' as decision_at,
  (select count(*) from public.orders) as orders_before,
  (select count(*) from public.fills) as fills_before,
  (select count(*) from private.cash_ledger_entries) as ledger_before;

select is(
  (select count(*) from structured_runtime_fixture),
  1::bigint,
  'the rollback-only runtime fixture is available'
);

-- The hosted production controls remain disabled. These fixture-only changes
-- bypass immutable lifecycle triggers and are rolled back with this pgTAP file.
set local session_replication_role = replica;

insert into public.prompt_versions (
  id,
  owner_id,
  agent_role,
  version,
  system_prompt,
  output_schema,
  content_hash,
  created_at
)
select
  fixture.terra_prompt_id,
  fixture.owner_id,
  'terra',
  99,
  'Rollback-only Terra paper proposal fixture.',
  '{"$id":"capital_lab_trade_proposal_v1","type":"object"}'::jsonb,
  repeat('e', 64),
  fixture.decision_at - interval '1 minute'
from structured_runtime_fixture as fixture;

insert into public.experiment_agent_prompt_versions (
  experiment_version_id,
  owner_id,
  agent_role,
  prompt_version_id,
  created_at
)
select
  fixture.experiment_version_id,
  fixture.owner_id,
  'terra',
  fixture.terra_prompt_id,
  fixture.decision_at - interval '1 minute'
from structured_runtime_fixture as fixture
on conflict (experiment_version_id, agent_role) do update
set prompt_version_id = excluded.prompt_version_id,
    created_at = excluded.created_at;

update public.experiment_versions as version
set created_at = fixture.decision_at - interval '1 day'
from structured_runtime_fixture as fixture
where version.id = fixture.experiment_version_id
  and version.owner_id = fixture.owner_id;

update public.configuration_versions as routing
set config = routing.config || '{
  "agentEnabled": true,
  "paidCallsEnabled": true,
  "executionMode": "shadow",
  "solEnabled": false,
  "webSearchEnabled": false
}'::jsonb
from public.experiment_versions as version
join structured_runtime_fixture as fixture
  on fixture.experiment_version_id = version.id
where routing.id = version.model_routing_version_id
  and routing.owner_id = fixture.owner_id;

update public.model_pricing
set is_verified = true
where model = 'gpt-5.6-terra'
  and currency = 'USD';

update public.experiment_controls as controls
set agent_enabled = true,
    emergency_paused = false,
    state_version = 42
from structured_runtime_fixture as fixture
where controls.experiment_id = fixture.experiment_id
  and controls.owner_id = fixture.owner_id;

update public.experiments as experiment
set lifecycle_status = 'active',
    execution_mode = 'shadow',
    starts_at = fixture.decision_at - interval '1 day',
    ends_at = null,
    pause_reason = null
from structured_runtime_fixture as fixture
where experiment.id = fixture.experiment_id
  and experiment.owner_id = fixture.owner_id;

set local session_replication_role = origin;

create temporary table structured_begin as
select result.*
from structured_runtime_fixture as fixture
cross join lateral public.begin_hosted_agent_run(
  fixture.owner_id,
  fixture.operation_id,
  fixture.experiment_id,
  '42',
  fixture.decision_at,
  'terra',
  null,
  'exceptional_deterministic_trigger',
  1,
  100,
  50,
  0
) as result;

select ok(
  begin_result.allowed
  and not begin_result.replayed
  and begin_result.model = 'gpt-5.6-terra'
  and begin_result.output_schema ->> '$id' = 'capital_lab_trade_proposal_v1'
  and begin_result.reservation_id is not null,
  'an explicitly enabled shadow Terra call is atomically routed and budget-reserved'
)
from structured_begin as begin_result;

select is(
  (
    select replay.agent_run_id = begin_result.agent_run_id
      and replay.reservation_id = begin_result.reservation_id
      and replay.allowed
      and replay.replayed
    from structured_runtime_fixture as fixture
    cross join lateral public.begin_hosted_agent_run(
      fixture.owner_id,
      fixture.operation_id,
      fixture.experiment_id,
      '42',
      fixture.decision_at,
      'terra',
      null,
      'exceptional_deterministic_trigger',
      1,
      100,
      50,
      0
    ) as replay
  ),
  true,
  'an in-flight begin retry reuses the exact run and reservation'
)
from structured_begin as begin_result;

create temporary table structured_finalize as
select result.*
from structured_runtime_fixture as fixture
cross join structured_begin as begin_result
cross join lateral public.finalize_hosted_shadow_proposal(
  fixture.owner_id,
  begin_result.agent_run_id,
  begin_result.reservation_id,
  'resp_structured_shadow_fixture_1',
  '{"contractVersion":1,"source":"rollback-only"}'::jsonb,
  jsonb_build_object(
    'decisionType', 'abstain',
    'eventIds', '[]'::jsonb,
    'evidenceIds', jsonb_build_array(fixture.evidence_id::text),
    'thesis', 'Point-in-time evidence does not justify paper exposure.',
    'scenarios', jsonb_build_object(
      'bull', jsonb_build_object('summary', 'Evidence improves.', 'probabilityPercent', 20),
      'base', jsonb_build_object('summary', 'Evidence remains inconclusive.', 'probabilityPercent', 60),
      'bear', jsonb_build_object('summary', 'Evidence weakens.', 'probabilityPercent', 20)
    ),
    'confidencePercent', 60,
    'expectedDirection', 'uncertain',
    'expectedReturnRangeBps', jsonb_build_object('minimum', '-25', 'maximum', '50.5'),
    'intendedHorizon', '1_hour',
    'invalidationConditions', jsonb_build_array('New point-in-time evidence changes the assessment.'),
    'urgency', 'normal',
    'escalationRequested', false,
    'abstentionReason', 'Evidence is insufficient for a bounded paper proposal.'
  ),
  'Point-in-time evidence does not justify paper exposure.',
  '0.6',
  jsonb_build_array(jsonb_build_object(
    'kind', 'knowledge',
    'id', fixture.evidence_id::text,
    'citationLabel', 'knowledge:synthetic-risk-note'
  )),
  20,
  5,
  0,
  10,
  2,
  125,
  'completed'
) as result;

select ok(
  finalize_result.proposal_status = 'shadow'
  and finalize_result.model_calls = 1
  and finalize_result.paper_orders_created = 0
  and finalize_result.paper_fills_created = 0
  and finalize_result.ledger_entries_created = 0
  and not finalize_result.replayed,
  'finalization records a shadow proposal with no execution side effects'
)
from structured_finalize as finalize_result;

select is(
  decision.structured_output #>> '{expectedReturnRangeBps,minimum}',
  '-25',
  'the expected-return lower bound remains exact decimal text'
)
from structured_finalize as finalized
join public.agent_decisions as decision on decision.id = finalized.decision_id;

select is(
  decision.structured_output #>> '{expectedReturnRangeBps,maximum}',
  '50.5',
  'the expected-return upper bound remains exact decimal text'
)
from structured_finalize as finalized
join public.agent_decisions as decision on decision.id = finalized.decision_id;

select ok(
  decision.proposal_status = 'shadow'
  and decision.decision_type = 'abstain'
  and decision.confidence = 0.60000::numeric
  and decision.concise_rationale = 'Point-in-time evidence does not justify paper exposure.'
  and not (decision.structured_output ?| array[
    'analysis', 'reasoning', 'chainOfThought', 'chain_of_thought', 'hiddenReasoning'
  ]),
  'the decision persists concise rationale and scenarios without hidden reasoning'
)
from structured_finalize as finalized
join public.agent_decisions as decision on decision.id = finalized.decision_id;

select is(
  evidence.knowledge_chunk_id,
  fixture.evidence_id,
  'the proposal persists its immutable point-in-time evidence reference'
)
from structured_finalize as finalized
join public.decision_evidence as evidence on evidence.decision_id = finalized.decision_id
cross join structured_runtime_fixture as fixture;

select ok(
  tool.tool_name = 'submit_trade_proposal'
  and tool.status = 'completed'
  and tool.response_summary ->> 'proposal_status' = 'shadow'
  and tool.response_summary ->> 'paper_orders_created' = '0',
  'the structured proposal tool call is audit-visible and paper-only'
)
from structured_begin as begin_result
join public.agent_tool_calls as tool on tool.agent_run_id = begin_result.agent_run_id;

select is(
  usage.actual_cost::text,
  '0.00015100',
  'the exact settled provider cost matches the immutable usage inputs'
)
from structured_begin as begin_result
join private.ai_usage_events as usage on usage.agent_run_id = begin_result.agent_run_id;

select ok(
  replay.replayed
  and replay.context_snapshot_id = finalized.context_snapshot_id
  and replay.decision_id = finalized.decision_id,
  'an exact finalization retry reuses the immutable context and decision'
)
from structured_runtime_fixture as fixture
cross join structured_begin as begin_result
cross join structured_finalize as finalized
cross join lateral public.finalize_hosted_shadow_proposal(
  fixture.owner_id,
  begin_result.agent_run_id,
  begin_result.reservation_id,
  'resp_structured_shadow_fixture_1',
  '{"contractVersion":1,"source":"rollback-only"}'::jsonb,
  jsonb_build_object(
    'decisionType', 'abstain',
    'eventIds', '[]'::jsonb,
    'evidenceIds', jsonb_build_array(fixture.evidence_id::text),
    'thesis', 'Point-in-time evidence does not justify paper exposure.',
    'scenarios', jsonb_build_object(
      'bull', jsonb_build_object('summary', 'Evidence improves.', 'probabilityPercent', 20),
      'base', jsonb_build_object('summary', 'Evidence remains inconclusive.', 'probabilityPercent', 60),
      'bear', jsonb_build_object('summary', 'Evidence weakens.', 'probabilityPercent', 20)
    ),
    'confidencePercent', 60,
    'expectedDirection', 'uncertain',
    'expectedReturnRangeBps', jsonb_build_object('minimum', '-25', 'maximum', '50.5'),
    'intendedHorizon', '1_hour',
    'invalidationConditions', jsonb_build_array('New point-in-time evidence changes the assessment.'),
    'urgency', 'normal',
    'escalationRequested', false,
    'abstentionReason', 'Evidence is insufficient for a bounded paper proposal.'
  ),
  'Point-in-time evidence does not justify paper exposure.',
  '0.6',
  jsonb_build_array(jsonb_build_object(
    'kind', 'knowledge',
    'id', fixture.evidence_id::text,
    'citationLabel', 'knowledge:synthetic-risk-note'
  )),
  20,
  5,
  0,
  10,
  2,
  125,
  'completed'
) as replay;

select throws_ok(
  $$
    select *
    from structured_runtime_fixture as fixture
    cross join structured_begin as begin_result
    cross join lateral public.finalize_hosted_shadow_proposal(
      fixture.owner_id,
      begin_result.agent_run_id,
      begin_result.reservation_id,
      'resp_structured_shadow_fixture_1',
      '{"contractVersion":1,"source":"changed-replay"}'::jsonb,
      '{}'::jsonb,
      'Changed replay.',
      '0.6',
      '[]'::jsonb,
      20, 5, 0, 10, 2, 125, 'completed'
    )
  $$,
  '23505',
  'shadow proposal replay payload mismatch',
  'a changed payload cannot reuse a completed provider response'
);

select throws_ok(
  $$
    update public.agent_runs
    set provider_response_id = 'resp_changed_after_completion'
    where provider_response_id = 'resp_structured_shadow_fixture_1'
  $$,
  '55000',
  'agent provider response provenance is immutable',
  'provider response provenance cannot be rewritten after completion'
);

insert into public.knowledge_chunks (
  id,
  owner_id,
  document_version_id,
  chunk_index,
  plain_text,
  token_estimate,
  source_quality,
  valid_from,
  available_at,
  content_hash,
  created_at
)
select
  fixture.future_evidence_id,
  fixture.owner_id,
  'a2000000-0000-0000-0000-000000000001',
  99,
  'Rollback-only future evidence.',
  5,
  0.50,
  fixture.decision_at + interval '1 hour',
  fixture.decision_at + interval '1 hour',
  repeat('f', 64),
  statement_timestamp()
from structured_runtime_fixture as fixture;

create temporary table invalid_structured_begin as
select result.*
from structured_runtime_fixture as fixture
cross join lateral public.begin_hosted_agent_run(
  fixture.owner_id,
  fixture.invalid_operation_id,
  fixture.experiment_id,
  '42',
  fixture.decision_at,
  'terra',
  null,
  'exceptional_deterministic_trigger',
  1,
  100,
  50,
  0
) as result;

select throws_ok(
  $$
    select *
    from structured_runtime_fixture as fixture
    cross join invalid_structured_begin as begin_result
    cross join lateral public.finalize_hosted_shadow_proposal(
      fixture.owner_id,
      begin_result.agent_run_id,
      begin_result.reservation_id,
      'resp_future_evidence_fixture',
      '{"contractVersion":1}'::jsonb,
      jsonb_build_object(
        'decisionType', 'abstain',
        'eventIds', '[]'::jsonb,
        'evidenceIds', jsonb_build_array(fixture.future_evidence_id::text),
        'thesis', 'Future evidence must not be visible.',
        'scenarios', jsonb_build_object(
          'bull', jsonb_build_object('summary', 'Future.', 'probabilityPercent', 0),
          'base', jsonb_build_object('summary', 'Future.', 'probabilityPercent', 100),
          'bear', jsonb_build_object('summary', 'Future.', 'probabilityPercent', 0)
        ),
        'confidencePercent', 10,
        'expectedDirection', 'uncertain',
        'expectedReturnRangeBps', jsonb_build_object('minimum', '0', 'maximum', '0'),
        'intendedHorizon', '1_hour',
        'invalidationConditions', '[]'::jsonb,
        'urgency', 'low',
        'escalationRequested', false,
        'abstentionReason', 'Future evidence is ineligible.'
      ),
      'Future evidence must not be visible.',
      '0.1',
      jsonb_build_array(jsonb_build_object(
        'kind', 'knowledge',
        'id', fixture.future_evidence_id::text,
        'citationLabel', 'knowledge:future-ineligible'
      )),
      10, 0, 0, 5, 0, 50, 'completed'
    )
  $$,
  '23514',
  'decision evidence was not available at decision time',
  'future evidence cannot be persisted for a historical decision'
);

select is(
  failure.reservation_status,
  'released',
  'a rejected provider result releases its reservation explicitly'
)
from structured_runtime_fixture as fixture
cross join invalid_structured_begin as begin_result
cross join lateral public.fail_hosted_agent_run(
  fixture.owner_id,
  begin_result.agent_run_id,
  begin_result.reservation_id,
  'released',
  'invalid_point_in_time_evidence'
) as failure;

select ok(
  (select count(*) from public.orders) = fixture.orders_before
  and (select count(*) from public.fills) = fixture.fills_before
  and (select count(*) from private.cash_ledger_entries) = fixture.ledger_before,
  'shadow orchestration creates no orders, fills, or cash-ledger entries'
)
from structured_runtime_fixture as fixture;

grant select on structured_runtime_fixture, structured_begin, structured_finalize
to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(console.run_rows) as run(value)
    cross join structured_begin as begin_result
    where (run.value ->> 'id')::uuid = begin_result.agent_run_id
      and run.value ->> 'actualCostUsd' = '0.00015100'
  )
  and exists (
    select 1
    from jsonb_array_elements(console.decision_rows) as decision(value)
    cross join structured_finalize as finalized
    where (decision.value ->> 'id')::uuid = finalized.decision_id
      and decision.value ->> 'proposalStatus' = 'shadow'
  )
  and exists (
    select 1
    from jsonb_array_elements(console.evidence_rows) as evidence(value)
    cross join structured_runtime_fixture as fixture
    where (evidence.value ->> 'knowledgeChunkId')::uuid = fixture.evidence_id
  ),
  'the owner console returns bounded runs, exact cost, decisions, and evidence'
)
from public.hosted_agent_console_read(statement_timestamp(), 100) as console;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select throws_ok(
  $$select * from public.hosted_agent_console_read(statement_timestamp(), 100)$$,
  '42501',
  'hosted agent console is unavailable',
  'a non-owner cannot read the hosted agent console'
);

reset role;
select set_config('request.jwt.claims', '{}', true);

select * from finish();
rollback;
