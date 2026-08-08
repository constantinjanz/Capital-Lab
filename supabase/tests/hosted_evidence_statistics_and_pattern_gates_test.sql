BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, private, extensions;
SELECT no_plan();

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.hosted_learning_snapshot(timestamptz,integer)',
    'EXECUTE'
  ),
  'authenticated owners may read the point-in-time learning snapshot'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.review_hosted_pattern_lifecycle(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated owners may invoke the reviewed pattern lifecycle boundary'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.hosted_learning_snapshot(timestamptz,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.hosted_learning_snapshot(timestamptz,integer)',
    'EXECUTE'
  ),
  'anonymous and service roles cannot read the hosted learning snapshot'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.review_hosted_pattern_lifecycle(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.review_hosted_pattern_lifecycle(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous and service roles cannot review hosted pattern lifecycle'
);

SELECT ok(
  NOT procedure.prosecdef
  AND procedure.provolatile = 's'
  AND coalesce(array_to_string(procedure.proconfig, ',') LIKE '%search_path=%', false),
  'hosted learning snapshot is a stable fixed-search-path security invoker'
)
FROM pg_proc AS procedure
JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'hosted_learning_snapshot';

SELECT ok(
  NOT procedure.prosecdef
  AND procedure.provolatile = 'v'
  AND coalesce(array_to_string(procedure.proconfig, ',') LIKE '%search_path=%', false),
  'public pattern review is a volatile fixed-search-path security invoker'
)
FROM pg_proc AS procedure
JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'review_hosted_pattern_lifecycle';

SELECT ok(
  procedure.prosecdef
  AND procedure.provolatile = 'v'
  AND coalesce(array_to_string(procedure.proconfig, ',') LIKE '%search_path=%', false),
  'private pattern review is a volatile fixed-search-path security definer'
)
FROM pg_proc AS procedure
JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'private'
  AND procedure.proname = 'review_hosted_pattern_lifecycle';

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) AS acl
    WHERE namespace.nspname IN ('public', 'private')
      AND procedure.proname IN (
        'guard_pattern_hypothesis_lifecycle',
        'hosted_pattern_gate_at',
        'hosted_learning_snapshot',
        'review_hosted_pattern_lifecycle'
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any hosted learning or pattern-review function'
);

SELECT has_index(
  'public',
  'pattern_hypotheses',
  'pattern_hypotheses_owner_proposed_at_idx',
  'pattern timeline reads have an owner/proposed-at index'
);
SELECT has_index(
  'public',
  'pattern_evidence',
  'pattern_evidence_owner_pattern_observed_at_idx',
  'pattern evidence gates have an owner/pattern/observation index'
);
SELECT has_index(
  'public',
  'trade_outcomes',
  'trade_outcomes_owner_horizon_evaluated_at_idx',
  'outcome statistics have an owner/horizon/evaluation index'
);
SELECT has_index(
  'public',
  'strategy_assignments',
  'strategy_assignments_owner_experiment_valid_from_idx',
  'current assignment reads have an owner/experiment/valid-from index'
);

CREATE TEMPORARY TABLE hosted_learning_fixture AS
SELECT
  owner.user_id AS owner_id,
  experiment.id AS experiment_id,
  experiment.locked_version_id AS experiment_version_id,
  gen_random_uuid() AS pattern_id,
  gen_random_uuid() AS sparse_pattern_id,
  gen_random_uuid() AS review_operation_id,
  gen_random_uuid() AS sparse_operation_id,
  statement_timestamp() - interval '5 minutes' AS snapshot_at,
  statement_timestamp() - interval '3 hours' AS first_decision_at,
  statement_timestamp() - interval '1 hour' AS first_outcome_at
FROM public.app_users AS owner
JOIN LATERAL (
  SELECT candidate.*
  FROM public.experiments AS candidate
  WHERE candidate.owner_id = owner.user_id
    AND candidate.locked_version_id IS NOT NULL
  ORDER BY candidate.created_at, candidate.id
  LIMIT 1
) AS experiment ON true
WHERE owner.role = 'owner'
  AND owner.is_active
LIMIT 1;

SELECT is(
  (SELECT count(*) FROM hosted_learning_fixture),
  1::bigint,
  'the test found one active owner with a locked paper experiment'
);

SET LOCAL session_replication_role = replica;
UPDATE public.experiment_versions AS version
SET created_at = least(
  version.created_at,
  fixture.first_decision_at - interval '1 day'
)
FROM hosted_learning_fixture AS fixture
WHERE version.id = fixture.experiment_version_id
  AND version.owner_id = fixture.owner_id;
SET LOCAL session_replication_role = origin;

CREATE TEMPORARY TABLE hosted_learning_observations AS
SELECT
  sequence.value AS observation_number,
  gen_random_uuid() AS run_id,
  gen_random_uuid() AS context_id,
  gen_random_uuid() AS decision_id,
  gen_random_uuid() AS outcome_id,
  gen_random_uuid() AS evidence_id,
  fixture.first_decision_at + sequence.value * interval '1 second' AS decision_at,
  CASE
    WHEN sequence.value <= 30
      THEN fixture.first_outcome_at + sequence.value * interval '1 second'
    ELSE fixture.snapshot_at + interval '1 minute'
  END AS evaluated_at,
  CASE WHEN sequence.value <= 18 THEN 0.030000000000 ELSE -0.010000000000 END::numeric AS benchmark_relative_return
FROM hosted_learning_fixture AS fixture
CROSS JOIN generate_series(1, 31) AS sequence(value);

INSERT INTO public.agent_runs(
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
SELECT
  observation.run_id,
  fixture.experiment_id,
  fixture.owner_id,
  'luna',
  'hosted_learning_fixture',
  'fixture-paper-model',
  'completed',
  'deterministic hosted learning fixture',
  observation.decision_at,
  observation.decision_at,
  observation.decision_at + interval '100 milliseconds',
  gen_random_uuid(),
  observation.decision_at
FROM hosted_learning_observations AS observation
CROSS JOIN hosted_learning_fixture AS fixture;

INSERT INTO public.decision_context_snapshots(
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
SELECT
  observation.context_id,
  observation.run_id,
  fixture.experiment_id,
  fixture.owner_id,
  fixture.experiment_version_id,
  observation.decision_at,
  jsonb_build_object(
    'fixture', 'hosted-learning-paper-only',
    'observation', observation.observation_number
  ),
  encode(extensions.digest(observation.context_id::text, 'sha256'), 'hex'),
  observation.decision_at
FROM hosted_learning_observations AS observation
CROSS JOIN hosted_learning_fixture AS fixture;

INSERT INTO public.agent_decisions(
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
SELECT
  observation.decision_id,
  observation.context_id,
  observation.run_id,
  fixture.experiment_id,
  fixture.owner_id,
  'abstain',
  jsonb_build_object(
    'fixture', 'hosted-learning-paper-only',
    'observation', observation.observation_number
  ),
  'Deterministic paper-only learning fixture.',
  0.60000,
  'abstained',
  observation.decision_at,
  observation.decision_at
FROM hosted_learning_observations AS observation
CROSS JOIN hosted_learning_fixture AS fixture;

INSERT INTO public.trade_outcomes(
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
SELECT
  observation.outcome_id,
  observation.decision_id,
  fixture.owner_id,
  '1d',
  observation.evaluated_at,
  observation.benchmark_relative_return + 0.005000000000,
  observation.benchmark_relative_return,
  0.050000000000,
  -0.080000000000,
  observation.benchmark_relative_return > 0,
  jsonb_build_object(
    'fixture', 'hosted-learning-paper-only',
    'orders', 0,
    'fills', 0
  ),
  observation.evaluated_at
FROM hosted_learning_observations AS observation
CROSS JOIN hosted_learning_fixture AS fixture;

INSERT INTO public.pattern_hypotheses(
  id,
  owner_id,
  experiment_id,
  name,
  hypothesis,
  lifecycle_status,
  gate_config,
  proposed_at,
  updated_at,
  created_at
)
SELECT
  fixture.pattern_id,
  fixture.owner_id,
  fixture.experiment_id,
  'Hosted exact evidence boundary fixture',
  'A rollback-only paper hypothesis with deterministic outcome evidence.',
  'shadow',
  jsonb_build_object(
    'policyVersion', 'hosted-pattern-promotion-v1',
    'minimumIndependentObservations', 30,
    'minimumHitRate', '0.55',
    'minimumMeanBenchmarkRelativeReturn', '0.01',
    'minimumAllowedMaximumAdverseExcursion', '-0.12',
    'requireHoldout', true
  ),
  fixture.first_decision_at - interval '1 minute',
  fixture.first_decision_at - interval '1 minute',
  fixture.first_decision_at - interval '1 minute'
FROM hosted_learning_fixture AS fixture
UNION ALL
SELECT
  fixture.sparse_pattern_id,
  fixture.owner_id,
  fixture.experiment_id,
  'Hosted sparse evidence fixture',
  'A rollback-only paper hypothesis with no linked outcomes.',
  'shadow',
  jsonb_build_object(
    'policyVersion', 'hosted-pattern-promotion-v1',
    'minimumIndependentObservations', 30,
    'minimumHitRate', '0.55',
    'minimumMeanBenchmarkRelativeReturn', '0.01',
    'minimumAllowedMaximumAdverseExcursion', '-0.12',
    'requireHoldout', true
  ),
  fixture.first_decision_at - interval '1 minute',
  fixture.first_decision_at - interval '1 minute',
  fixture.first_decision_at - interval '1 minute'
FROM hosted_learning_fixture AS fixture;

INSERT INTO public.pattern_evidence(
  id,
  pattern_id,
  owner_id,
  decision_id,
  outcome_id,
  evidence_type,
  evidence,
  observed_at,
  created_at
)
SELECT
  observation.evidence_id,
  fixture.pattern_id,
  fixture.owner_id,
  observation.decision_id,
  observation.outcome_id,
  'outcome',
  jsonb_build_object(
    'fixture', 'hosted-learning-paper-only',
    'horizon', '1d'
  ),
  observation.evaluated_at,
  observation.evaluated_at
FROM hosted_learning_observations AS observation
CROSS JOIN hosted_learning_fixture AS fixture;

INSERT INTO public.pattern_evidence(
  id,
  pattern_id,
  owner_id,
  decision_id,
  outcome_id,
  evidence_type,
  evidence,
  observed_at,
  created_at
)
SELECT
  gen_random_uuid(),
  fixture.pattern_id,
  fixture.owner_id,
  observation.decision_id,
  observation.outcome_id,
  'holdout',
  '{"passed":true,"fixture":"hosted-learning-paper-only"}'::jsonb,
  observation.evaluated_at + interval '1 microsecond',
  observation.evaluated_at + interval '1 microsecond'
FROM hosted_learning_observations AS observation
CROSS JOIN hosted_learning_fixture AS fixture
WHERE observation.observation_number = 30;

CREATE TEMPORARY TABLE hosted_learning_side_effect_baseline AS
SELECT
  (SELECT count(*) FROM public.strategy_assignments) AS strategy_assignments,
  (SELECT count(*) FROM public.orders) AS orders,
  (SELECT count(*) FROM public.fills) AS fills,
  (SELECT count(*) FROM private.cash_ledger_entries) AS ledger_entries,
  (SELECT count(*) FROM public.agent_runs) AS agent_runs;

GRANT SELECT ON hosted_learning_fixture TO authenticated;
GRANT SELECT ON hosted_learning_observations TO authenticated;
GRANT SELECT ON hosted_learning_side_effect_baseline TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (SELECT owner_id FROM hosted_learning_fixture),
    'role', 'authenticated'
  )::text,
  true
);

SELECT is(
  pattern ->> 'independent_observations_text',
  '30',
  'the gate counts only independent one-day outcomes available by decisionAt'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN hosted_learning_fixture AS fixture
CROSS JOIN LATERAL jsonb_array_elements(snapshot.pattern_rows) AS pattern
WHERE (pattern ->> 'id')::uuid = fixture.pattern_id;

SELECT is(
  pattern ->> 'hit_rate_text',
  '0.60000000000000000000',
  'the pattern hit rate remains an exact database decimal string'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN hosted_learning_fixture AS fixture
CROSS JOIN LATERAL jsonb_array_elements(snapshot.pattern_rows) AS pattern
WHERE (pattern ->> 'id')::uuid = fixture.pattern_id;

SELECT is(
  pattern ->> 'mean_benchmark_relative_return_text',
  '0.01400000000000000000',
  'the mean benchmark-relative return remains exact'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN hosted_learning_fixture AS fixture
CROSS JOIN LATERAL jsonb_array_elements(snapshot.pattern_rows) AS pattern
WHERE (pattern ->> 'id')::uuid = fixture.pattern_id;

SELECT is(
  pattern ->> 'worst_maximum_adverse_excursion_text',
  '-0.080000000000',
  'the worst adverse excursion remains exact and signed'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN hosted_learning_fixture AS fixture
CROSS JOIN LATERAL jsonb_array_elements(snapshot.pattern_rows) AS pattern
WHERE (pattern ->> 'id')::uuid = fixture.pattern_id;

SELECT ok(
  (pattern ->> 'holdout_passed')::boolean
  AND (pattern ->> 'policy_matches')::boolean
  AND (pattern ->> 'eligible')::boolean
  AND pattern -> 'reasons' = '[]'::jsonb,
  'the exact 30-observation boundary passes every deterministic gate'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN hosted_learning_fixture AS fixture
CROSS JOIN LATERAL jsonb_array_elements(snapshot.pattern_rows) AS pattern
WHERE (pattern ->> 'id')::uuid = fixture.pattern_id;

SELECT ok(
  NOT (pattern ->> 'eligible')::boolean
  AND pattern -> 'reasons' ? 'INSUFFICIENT_INDEPENDENT_OBSERVATIONS'
  AND pattern -> 'reasons' ? 'HIT_RATE_UNAVAILABLE'
  AND pattern -> 'reasons' ? 'HOLDOUT_NOT_PASSED',
  'sparse patterns remain ineligible with explicit missing-evidence reasons'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN hosted_learning_fixture AS fixture
CROSS JOIN LATERAL jsonb_array_elements(snapshot.pattern_rows) AS pattern
WHERE (pattern ->> 'id')::uuid = fixture.sparse_pattern_id;

SELECT is(
  calibration ->> 'decision_count_text',
  '31',
  'calibration includes every decision available by decisionAt'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN LATERAL jsonb_array_elements(snapshot.calibration_rows) AS calibration
WHERE calibration ->> 'band_index' = '3';

SELECT is(
  calibration ->> 'evaluated_count_text',
  '30',
  'calibration excludes the outcome evaluated after decisionAt'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN LATERAL jsonb_array_elements(snapshot.calibration_rows) AS calibration
WHERE calibration ->> 'band_index' = '3';

SELECT is(
  horizon ->> 'outcome_count_text',
  '30',
  'horizon statistics exclude future-evaluated outcomes'
)
FROM public.hosted_learning_snapshot(
  (SELECT snapshot_at FROM hosted_learning_fixture),
  100
) AS snapshot
CROSS JOIN LATERAL jsonb_array_elements(snapshot.horizon_rows) AS horizon
WHERE horizon ->> 'horizon' = '1d';

CREATE TEMPORARY TABLE hosted_pattern_review_result AS
SELECT *
FROM public.review_hosted_pattern_lifecycle(
  (SELECT review_operation_id FROM hosted_learning_fixture),
  (SELECT pattern_id FROM hosted_learning_fixture),
  'shadow',
  'mark_eligible',
  'MARK PATTERN ELIGIBLE',
  NULL
);

SELECT ok(
  lifecycle_status = 'eligible'
  AND gate_eligible
  AND NOT replayed
  AND independent_observations_text = '31',
  'the owner can mark the pattern eligible only after the current database gate passes'
)
FROM hosted_pattern_review_result;

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.hosted_learning_snapshot(
      (SELECT snapshot_at FROM hosted_learning_fixture),
      100
    ) AS snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.pattern_rows) AS pattern
    WHERE pattern ->> 'id' = (SELECT pattern_id::text FROM hosted_learning_fixture)
  ),
  'a later lifecycle review is not leaked into an earlier learning snapshot'
);

SELECT ok(
  lifecycle_status = 'eligible'
  AND gate_eligible
  AND replayed
  AND reviewed_at = (SELECT reviewed_at FROM hosted_pattern_review_result),
  'an exact operation retry reuses the immutable review result'
)
FROM public.review_hosted_pattern_lifecycle(
  (SELECT review_operation_id FROM hosted_learning_fixture),
  (SELECT pattern_id FROM hosted_learning_fixture),
  'shadow',
  'mark_eligible',
  'MARK PATTERN ELIGIBLE',
  NULL
);

SELECT throws_ok(
  format(
    $$SELECT * FROM public.review_hosted_pattern_lifecycle(%L::uuid, %L::uuid, 'eligible', 'retire', 'RETIRE PATTERN', 'different replay input')$$,
    (SELECT review_operation_id FROM hosted_learning_fixture),
    (SELECT pattern_id FROM hosted_learning_fixture)
  ),
  '23505',
  'pattern review operation id was reused with different input',
  'an operation id cannot be reused with changed review input'
);

SELECT throws_ok(
  format(
    $$SELECT * FROM public.review_hosted_pattern_lifecycle(%L::uuid, %L::uuid, 'shadow', 'mark_eligible', 'MARK PATTERN ELIGIBLE', NULL)$$,
    (SELECT sparse_operation_id FROM hosted_learning_fixture),
    (SELECT sparse_pattern_id FROM hosted_learning_fixture)
  ),
  '23514',
  'pattern evidence does not pass the deterministic gate',
  'the owner cannot mark an under-evidenced pattern eligible'
);

SELECT throws_ok(
  $$UPDATE public.pattern_hypotheses SET lifecycle_status = 'active' WHERE id = (SELECT pattern_id FROM hosted_learning_fixture)$$,
  '42501',
  NULL,
  'authenticated owners retain no direct pattern update privilege'
);

SELECT is(
  (SELECT count(*) FROM public.strategy_assignments),
  (SELECT strategy_assignments FROM hosted_learning_side_effect_baseline),
  'pattern review creates no strategy assignment'
);
SELECT is(
  (SELECT count(*) FROM public.orders),
  (SELECT orders FROM hosted_learning_side_effect_baseline),
  'pattern review creates no order'
);
SELECT is(
  (SELECT count(*) FROM public.fills),
  (SELECT fills FROM hosted_learning_side_effect_baseline),
  'pattern review creates no fill'
);
SELECT is(
  (SELECT count(*) FROM private.cash_ledger_entries),
  (SELECT ledger_entries FROM hosted_learning_side_effect_baseline),
  'pattern review creates no cash-ledger entry'
);
SELECT is(
  (SELECT count(*) FROM public.agent_runs),
  (SELECT agent_runs FROM hosted_learning_side_effect_baseline),
  'pattern review starts no additional agent run'
);

SELECT throws_ok(
  $$SELECT * FROM public.hosted_learning_snapshot(NULL, 100)$$,
  '22023',
  'decisionAt is required',
  'learning snapshot requires decisionAt'
);
SELECT throws_ok(
  $$SELECT * FROM public.hosted_learning_snapshot(statement_timestamp() + interval '1 minute', 100)$$,
  '22023',
  'decisionAt cannot be in the future',
  'learning snapshot rejects a future decisionAt'
);
SELECT throws_ok(
  $$SELECT * FROM public.hosted_learning_snapshot(statement_timestamp(), 201)$$,
  '22023',
  'pattern limit must be between 1 and 200',
  'learning snapshot enforces its pattern bound'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated'
  )::text,
  true
);
SELECT throws_ok(
  $$SELECT * FROM public.hosted_learning_snapshot(statement_timestamp(), 100)$$,
  '42501',
  'hosted learning snapshot is unavailable',
  'a non-owner identity cannot read hosted learning statistics'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}'::jsonb::text, true);

SELECT throws_ok(
  format(
    $$UPDATE public.pattern_hypotheses SET name = 'mutated provenance' WHERE id = %L::uuid$$,
    (SELECT pattern_id FROM hosted_learning_fixture)
  ),
  '55000',
  'pattern hypothesis provenance is immutable',
  'pattern review cannot rewrite hypothesis provenance'
);

SELECT throws_ok(
  format(
    $$UPDATE public.pattern_hypotheses SET lifecycle_status = 'shadow' WHERE id = %L::uuid$$,
    (SELECT pattern_id FROM hosted_learning_fixture)
  ),
  '23514',
  'pattern lifecycle transition is not allowed',
  'pattern lifecycle cannot move backward from eligible to shadow'
);

SELECT * FROM finish();
ROLLBACK;
