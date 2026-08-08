BEGIN;

create function private.guard_pattern_hypothesis_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'pattern hypotheses are append-preserved';
  end if;

  if new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.experiment_id is distinct from old.experiment_id
    or new.name is distinct from old.name
    or new.hypothesis is distinct from old.hypothesis
    or new.gate_config is distinct from old.gate_config
    or new.proposed_at is distinct from old.proposed_at
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'pattern hypothesis provenance is immutable';
  end if;

  if new.lifecycle_status = old.lifecycle_status then
    return new;
  end if;

  if not (
    (old.lifecycle_status = 'proposed' and new.lifecycle_status in ('shadow', 'rejected'))
    or (old.lifecycle_status = 'shadow' and new.lifecycle_status in ('eligible', 'rejected', 'retired'))
    or (old.lifecycle_status = 'eligible' and new.lifecycle_status in ('active', 'rejected', 'retired'))
    or (old.lifecycle_status = 'active' and new.lifecycle_status = 'retired')
  ) then
    raise exception using
      errcode = '23514',
      message = 'pattern lifecycle transition is not allowed';
  end if;

  return new;
end;
$$;

create trigger pattern_hypotheses_guard_lifecycle
before update or delete on public.pattern_hypotheses
for each row execute function private.guard_pattern_hypothesis_lifecycle();

create index pattern_hypotheses_owner_proposed_at_idx
on public.pattern_hypotheses(owner_id, proposed_at desc, id desc);

create index pattern_evidence_owner_pattern_observed_at_idx
on public.pattern_evidence(owner_id, pattern_id, observed_at, outcome_id);

create index trade_outcomes_owner_horizon_evaluated_at_idx
on public.trade_outcomes(owner_id, horizon, evaluated_at, decision_id);

create index strategy_assignments_owner_experiment_valid_from_idx
on public.strategy_assignments(owner_id, experiment_id, valid_from desc, id desc);

create function private.hosted_pattern_gate_at(
  p_owner_id uuid,
  p_pattern_id uuid,
  p_decision_at timestamptz
)
returns table (
  independent_observations bigint,
  hit_rate numeric,
  mean_benchmark_relative_return numeric,
  worst_maximum_adverse_excursion numeric,
  holdout_passed boolean,
  policy_matches boolean,
  eligible boolean,
  reasons jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pattern_row as materialized (
    select pattern.gate_config
    from public.pattern_hypotheses as pattern
    where pattern.id = p_pattern_id
      and pattern.owner_id = p_owner_id
      and pattern.proposed_at <= p_decision_at
      and pattern.created_at <= p_decision_at
  ),
  eligible_outcomes as materialized (
    select distinct on (outcome.decision_id)
      outcome.decision_id,
      outcome.benchmark_relative_return,
      outcome.maximum_adverse_excursion
    from public.pattern_evidence as evidence
    join public.trade_outcomes as outcome
      on outcome.id = evidence.outcome_id
     and outcome.owner_id = evidence.owner_id
    join public.agent_decisions as decision
      on decision.id = outcome.decision_id
     and decision.owner_id = outcome.owner_id
    where evidence.pattern_id = p_pattern_id
      and evidence.owner_id = p_owner_id
      and evidence.outcome_id is not null
      and evidence.observed_at <= p_decision_at
      and evidence.created_at <= p_decision_at
      and outcome.horizon = '1d'
      and outcome.evaluated_at <= p_decision_at
      and outcome.created_at <= p_decision_at
      and decision.decided_at <= p_decision_at
      and decision.created_at <= p_decision_at
    order by outcome.decision_id, outcome.evaluated_at desc, outcome.id desc
  ),
  aggregate_summary as (
    select
      count(*)::bigint as independent_observations,
      (
        count(*) filter (where benchmark_relative_return > 0)
      )::numeric / nullif(count(*), 0)::numeric as hit_rate,
      avg(benchmark_relative_return) as mean_benchmark_relative_return,
      min(maximum_adverse_excursion) as worst_maximum_adverse_excursion
    from eligible_outcomes
  ),
  gate_summary as (
    select
      aggregate_summary.*,
      exists (
        select 1
        from public.pattern_evidence as evidence
        join public.trade_outcomes as outcome
          on outcome.id = evidence.outcome_id
         and outcome.owner_id = evidence.owner_id
        where evidence.pattern_id = p_pattern_id
          and evidence.owner_id = p_owner_id
          and evidence.evidence_type = 'holdout'
          and evidence.evidence -> 'passed' = 'true'::jsonb
          and evidence.observed_at <= p_decision_at
          and evidence.created_at <= p_decision_at
          and outcome.horizon = '1d'
          and outcome.evaluated_at <= p_decision_at
          and outcome.created_at <= p_decision_at
      ) as holdout_passed,
      pattern_row.gate_config = jsonb_build_object(
        'policyVersion', 'hosted-pattern-promotion-v1',
        'minimumIndependentObservations', 30,
        'minimumHitRate', '0.55',
        'minimumMeanBenchmarkRelativeReturn', '0.01',
        'minimumAllowedMaximumAdverseExcursion', '-0.12',
        'requireHoldout', true
      ) as policy_matches
    from aggregate_summary
    cross join pattern_row
  )
  select
    gate_summary.independent_observations,
    gate_summary.hit_rate,
    gate_summary.mean_benchmark_relative_return,
    gate_summary.worst_maximum_adverse_excursion,
    gate_summary.holdout_passed,
    gate_summary.policy_matches,
    gate_summary.policy_matches
      and gate_summary.independent_observations >= 30
      and gate_summary.hit_rate >= 0.55
      and gate_summary.mean_benchmark_relative_return >= 0.01
      and gate_summary.worst_maximum_adverse_excursion >= -0.12
      and gate_summary.holdout_passed as eligible,
    to_jsonb(array_remove(array[
      case when not gate_summary.policy_matches then 'POLICY_CONFIG_MISMATCH' end,
      case when gate_summary.independent_observations < 30 then 'INSUFFICIENT_INDEPENDENT_OBSERVATIONS' end,
      case
        when gate_summary.hit_rate is null then 'HIT_RATE_UNAVAILABLE'
        when gate_summary.hit_rate < 0.55 then 'HIT_RATE_BELOW_THRESHOLD'
      end,
      case
        when gate_summary.mean_benchmark_relative_return is null then 'BENCHMARK_RELATIVE_RETURN_UNAVAILABLE'
        when gate_summary.mean_benchmark_relative_return < 0.01 then 'BENCHMARK_RELATIVE_RETURN_BELOW_THRESHOLD'
      end,
      case
        when gate_summary.worst_maximum_adverse_excursion is null then 'ADVERSE_EXCURSION_UNAVAILABLE'
        when gate_summary.worst_maximum_adverse_excursion < -0.12 then 'ADVERSE_EXCURSION_BELOW_LIMIT'
      end,
      case when not gate_summary.holdout_passed then 'HOLDOUT_NOT_PASSED' end
    ]::text[], null)) as reasons
  from gate_summary;
$$;

create function public.hosted_learning_snapshot(
  p_decision_at timestamptz,
  p_pattern_limit integer default 100
)
returns table (
  owner_id uuid,
  decision_at timestamptz,
  calibration_rows jsonb,
  category_rows jsonb,
  evidence_kind_rows jsonb,
  horizon_rows jsonb,
  pattern_rows jsonb,
  assignment_rows jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_owner_id uuid := auth.uid();
begin
  if caller_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'hosted learning snapshot is unavailable';
  end if;

  if p_decision_at is null then
    raise exception using errcode = '22023', message = 'decisionAt is required';
  end if;
  if p_decision_at > statement_timestamp() then
    raise exception using errcode = '22023', message = 'decisionAt cannot be in the future';
  end if;
  if p_pattern_limit is null or p_pattern_limit < 1 or p_pattern_limit > 200 then
    raise exception using errcode = '22023', message = 'pattern limit must be between 1 and 200';
  end if;

  return query
  with eligible_decisions as materialized (
    select decision.*
    from public.agent_decisions as decision
    where decision.owner_id = caller_owner_id
      and decision.decided_at <= p_decision_at
      and decision.created_at <= p_decision_at
  ),
  eligible_outcomes as materialized (
    select outcome.*
    from public.trade_outcomes as outcome
    join eligible_decisions as decision
      on decision.id = outcome.decision_id
     and decision.owner_id = outcome.owner_id
    where outcome.owner_id = caller_owner_id
      and outcome.evaluated_at <= p_decision_at
      and outcome.created_at <= p_decision_at
  ),
  one_day_outcomes as materialized (
    select *
    from eligible_outcomes
    where horizon = '1d'
  ),
  calibration_base as (
    select
      case
        when decision.confidence < 0.2 then 0
        when decision.confidence < 0.4 then 1
        when decision.confidence < 0.6 then 2
        when decision.confidence < 0.8 then 3
        else 4
      end as band_index,
      decision.confidence,
      outcome.id as outcome_id,
      outcome.benchmark_relative_return
    from eligible_decisions as decision
    left join one_day_outcomes as outcome
      on outcome.decision_id = decision.id
     and outcome.owner_id = decision.owner_id
    where decision.confidence is not null
  ),
  calibration_groups as (
    select
      band_index,
      count(*)::bigint as decision_count,
      count(outcome_id)::bigint as evaluated_count,
      avg(confidence) as mean_confidence,
      (count(*) filter (where outcome_id is not null and benchmark_relative_return > 0))::numeric
        / nullif(count(outcome_id), 0)::numeric as observed_hit_rate
    from calibration_base
    group by band_index
  ),
  category_groups as (
    select
      decision.decision_type,
      count(*)::bigint as decision_count,
      count(outcome.id)::bigint as evaluated_count,
      avg(decision.confidence) as mean_confidence,
      (count(*) filter (where outcome.id is not null and outcome.benchmark_relative_return > 0))::numeric
        / nullif(count(outcome.id), 0)::numeric as hit_rate,
      avg(outcome.forward_return) as mean_forward_return,
      avg(outcome.benchmark_relative_return) as mean_benchmark_relative_return
    from eligible_decisions as decision
    left join one_day_outcomes as outcome
      on outcome.decision_id = decision.id
     and outcome.owner_id = decision.owner_id
    group by decision.decision_type
  ),
  evidence_groups as (
    select
      evidence.evidence_kind,
      count(*)::bigint as citation_count,
      count(distinct evidence.decision_id)::bigint as decision_count
    from public.decision_evidence as evidence
    join eligible_decisions as decision
      on decision.id = evidence.decision_id
     and decision.owner_id = evidence.owner_id
    where evidence.owner_id = caller_owner_id
      and evidence.evidence_available_at <= p_decision_at
      and evidence.created_at <= p_decision_at
    group by evidence.evidence_kind
  ),
  horizon_groups as (
    select
      outcome.horizon,
      count(*)::bigint as outcome_count,
      (count(*) filter (where outcome.benchmark_relative_return > 0))::numeric
        / nullif(count(*), 0)::numeric as hit_rate,
      avg(outcome.forward_return) as mean_forward_return,
      avg(outcome.benchmark_relative_return) as mean_benchmark_relative_return,
      max(outcome.maximum_favorable_excursion) as maximum_favorable_excursion,
      min(outcome.maximum_adverse_excursion) as worst_maximum_adverse_excursion
    from eligible_outcomes as outcome
    group by outcome.horizon
  ),
  selected_patterns as materialized (
    select pattern.*
    from public.pattern_hypotheses as pattern
    where pattern.owner_id = caller_owner_id
      and pattern.proposed_at <= p_decision_at
      and pattern.created_at <= p_decision_at
      and pattern.updated_at <= p_decision_at
    order by pattern.proposed_at desc, pattern.id desc
    limit p_pattern_limit
  ),
  selected_assignments as materialized (
    select
      assignment.*,
      strategy.name as strategy_name,
      strategy.version as strategy_version,
      strategy.content_hash as strategy_content_hash
    from public.strategy_assignments as assignment
    join public.strategy_versions as strategy
      on strategy.id = assignment.strategy_version_id
     and strategy.owner_id = assignment.owner_id
    where assignment.owner_id = caller_owner_id
      and assignment.valid_from <= p_decision_at
      and (assignment.valid_to is null or assignment.valid_to > p_decision_at)
      and assignment.created_at <= p_decision_at
      and strategy.created_at <= p_decision_at
    order by assignment.experiment_id, assignment.assignment_type, assignment.valid_from desc, assignment.id desc
    limit 200
  )
  select
    caller_owner_id,
    p_decision_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'band_index', group_row.band_index,
        'band_lower_text', (group_row.band_index::numeric * 0.2)::text,
        'band_upper_text', ((group_row.band_index + 1)::numeric * 0.2)::text,
        'decision_count_text', group_row.decision_count::text,
        'evaluated_count_text', group_row.evaluated_count::text,
        'mean_confidence_text', group_row.mean_confidence::text,
        'observed_hit_rate_text', group_row.observed_hit_rate::text
      ) order by group_row.band_index)
      from calibration_groups as group_row
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'decision_type', group_row.decision_type,
        'decision_count_text', group_row.decision_count::text,
        'evaluated_count_text', group_row.evaluated_count::text,
        'mean_confidence_text', group_row.mean_confidence::text,
        'hit_rate_text', group_row.hit_rate::text,
        'mean_forward_return_text', group_row.mean_forward_return::text,
        'mean_benchmark_relative_return_text', group_row.mean_benchmark_relative_return::text
      ) order by group_row.decision_type)
      from category_groups as group_row
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'evidence_kind', group_row.evidence_kind,
        'citation_count_text', group_row.citation_count::text,
        'decision_count_text', group_row.decision_count::text
      ) order by group_row.evidence_kind)
      from evidence_groups as group_row
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'horizon', group_row.horizon,
        'outcome_count_text', group_row.outcome_count::text,
        'hit_rate_text', group_row.hit_rate::text,
        'mean_forward_return_text', group_row.mean_forward_return::text,
        'mean_benchmark_relative_return_text', group_row.mean_benchmark_relative_return::text,
        'maximum_favorable_excursion_text', group_row.maximum_favorable_excursion::text,
        'worst_maximum_adverse_excursion_text', group_row.worst_maximum_adverse_excursion::text
      ) order by group_row.horizon)
      from horizon_groups as group_row
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pattern.id,
        'experiment_id', pattern.experiment_id,
        'name', pattern.name,
        'hypothesis', pattern.hypothesis,
        'lifecycle_status', pattern.lifecycle_status,
        'gate_config', pattern.gate_config,
        'proposed_at', pattern.proposed_at,
        'updated_at', pattern.updated_at,
        'created_at', pattern.created_at,
        'policy_version', 'hosted-pattern-promotion-v1',
        'independent_observations_text', gate.independent_observations::text,
        'hit_rate_text', gate.hit_rate::text,
        'mean_benchmark_relative_return_text', gate.mean_benchmark_relative_return::text,
        'worst_maximum_adverse_excursion_text', gate.worst_maximum_adverse_excursion::text,
        'holdout_passed', gate.holdout_passed,
        'policy_matches', gate.policy_matches,
        'eligible', gate.eligible,
        'reasons', gate.reasons
      ) order by pattern.proposed_at desc, pattern.id desc)
      from selected_patterns as pattern
      cross join lateral private.hosted_pattern_gate_at(
        caller_owner_id,
        pattern.id,
        p_decision_at
      ) as gate
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id,
        'experiment_id', assignment.experiment_id,
        'strategy_version_id', assignment.strategy_version_id,
        'strategy_name', assignment.strategy_name,
        'strategy_version', assignment.strategy_version,
        'strategy_content_hash', assignment.strategy_content_hash,
        'assignment_type', assignment.assignment_type,
        'allocation_fraction_text', assignment.allocation_fraction::text,
        'valid_from', assignment.valid_from,
        'valid_to', assignment.valid_to,
        'promotion_evidence', assignment.promotion_evidence,
        'created_at', assignment.created_at
      ) order by assignment.experiment_id, assignment.assignment_type, assignment.valid_from desc, assignment.id desc)
      from selected_assignments as assignment
    ), '[]'::jsonb);
end;
$$;

create function private.review_hosted_pattern_lifecycle(
  p_operation_id uuid,
  p_pattern_id uuid,
  p_expected_status text,
  p_action text,
  p_confirmation text,
  p_reason text default null
)
returns table (
  pattern_id uuid,
  lifecycle_status text,
  reviewed_at timestamptz,
  independent_observations_text text,
  hit_rate_text text,
  mean_benchmark_relative_return_text text,
  worst_maximum_adverse_excursion_text text,
  holdout_passed boolean,
  gate_eligible boolean,
  gate_reasons jsonb,
  policy_version text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_owner_id uuid := auth.uid();
  normalized_expected_status text := btrim(coalesce(p_expected_status, ''));
  normalized_action text := btrim(coalesce(p_action, ''));
  normalized_confirmation text := coalesce(p_confirmation, '');
  normalized_reason text := btrim(coalesce(p_reason, ''));
  target_status text;
  review_timestamp timestamptz := statement_timestamp();
  request_payload jsonb;
  request_hash text;
  idempotency private.idempotency_records%rowtype;
  inserted_idempotency boolean;
  pattern public.pattern_hypotheses%rowtype;
  gate record;
  audit private.audit_log%rowtype;
begin
  if caller_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'hosted pattern review is unavailable';
  end if;
  if p_operation_id is null or p_pattern_id is null then
    raise exception using errcode = '22023', message = 'operation id and pattern id are required';
  end if;
  if normalized_expected_status not in ('proposed', 'shadow', 'eligible', 'active') then
    raise exception using errcode = '22023', message = 'expected pattern status is invalid';
  end if;
  if normalized_action not in ('start_shadow', 'mark_eligible', 'reject', 'retire') then
    raise exception using errcode = '22023', message = 'pattern review action is invalid';
  end if;

  target_status := case normalized_action
    when 'start_shadow' then 'shadow'
    when 'mark_eligible' then 'eligible'
    when 'reject' then 'rejected'
    when 'retire' then 'retired'
  end;

  if normalized_confirmation <> (
    case normalized_action
      when 'start_shadow' then 'START PATTERN SHADOW REVIEW'
      when 'mark_eligible' then 'MARK PATTERN ELIGIBLE'
      when 'reject' then 'REJECT PATTERN'
      when 'retire' then 'RETIRE PATTERN'
    end
  ) then
    raise exception using errcode = '22023', message = 'exact pattern review confirmation is required';
  end if;

  if normalized_action in ('reject', 'retire') then
    if char_length(normalized_reason) < 3 or char_length(normalized_reason) > 200 then
      raise exception using errcode = '22023', message = 'review reason must contain between 3 and 200 characters';
    end if;
  elsif normalized_reason <> '' then
    raise exception using errcode = '22023', message = 'reason is not accepted for this pattern review action';
  end if;

  request_payload := jsonb_build_object(
    'contract_version', 1,
    'pattern_id', p_pattern_id::text,
    'expected_status', normalized_expected_status,
    'action', normalized_action,
    'confirmation', normalized_confirmation,
    'reason', nullif(normalized_reason, '')
  );
  request_hash := encode(extensions.digest(request_payload::text, 'sha256'), 'hex');

  insert into private.idempotency_records (
    owner_id, scope, idempotency_key, request_hash, status
  ) values (
    caller_owner_id,
    'pattern.lifecycle_review.v1',
    p_operation_id::text,
    request_hash,
    'processing'
  )
  on conflict (owner_id, scope, idempotency_key) do nothing
  returning * into idempotency;

  inserted_idempotency := found;

  if not inserted_idempotency then
    select record.*
    into strict idempotency
    from private.idempotency_records as record
    where record.owner_id = caller_owner_id
      and record.scope = 'pattern.lifecycle_review.v1'
      and record.idempotency_key = p_operation_id::text
    for update;

    if idempotency.request_hash <> request_hash then
      raise exception using errcode = '23505', message = 'pattern review operation id was reused with different input';
    end if;
    if idempotency.status <> 'completed'
      or idempotency.result_ref_type <> 'pattern_hypothesis'
      or idempotency.result_ref_id <> p_pattern_id
    then
      raise exception using errcode = '55000', message = 'pattern review idempotency record is inconsistent';
    end if;

    select entry.*
    into audit
    from private.audit_log as entry
    where entry.owner_id = caller_owner_id
      and entry.actor_type = 'owner'
      and entry.actor_id = caller_owner_id
      and entry.action = 'pattern.lifecycle_reviewed'
      and entry.target_type = 'pattern_hypothesis'
      and entry.target_id = p_pattern_id
      and entry.correlation_id = p_operation_id;

    if not found or audit.metadata ->> 'contract_version' <> '1' then
      raise exception using errcode = '55000', message = 'pattern review result evidence is missing';
    end if;

    return query select
      p_pattern_id,
      audit.metadata ->> 'lifecycle_status',
      (audit.metadata ->> 'reviewed_at')::timestamptz,
      audit.metadata ->> 'independent_observations_text',
      audit.metadata ->> 'hit_rate_text',
      audit.metadata ->> 'mean_benchmark_relative_return_text',
      audit.metadata ->> 'worst_maximum_adverse_excursion_text',
      (audit.metadata ->> 'holdout_passed')::boolean,
      (audit.metadata ->> 'gate_eligible')::boolean,
      audit.metadata -> 'gate_reasons',
      audit.metadata ->> 'policy_version',
      true;
    return;
  end if;

  select candidate.*
  into pattern
  from public.pattern_hypotheses as candidate
  where candidate.id = p_pattern_id
    and candidate.owner_id = caller_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'pattern hypothesis is unavailable';
  end if;
  if pattern.lifecycle_status <> normalized_expected_status then
    raise exception using errcode = '40001', message = 'pattern lifecycle status changed';
  end if;
  if normalized_action = 'start_shadow' and pattern.lifecycle_status <> 'proposed' then
    raise exception using errcode = '23514', message = 'only proposed patterns can start shadow review';
  end if;
  if normalized_action = 'mark_eligible' and pattern.lifecycle_status <> 'shadow' then
    raise exception using errcode = '23514', message = 'only shadow patterns can be marked eligible';
  end if;
  if normalized_action = 'reject' and pattern.lifecycle_status not in ('proposed', 'shadow', 'eligible') then
    raise exception using errcode = '23514', message = 'pattern cannot be rejected from its current state';
  end if;
  if normalized_action = 'retire' and pattern.lifecycle_status not in ('shadow', 'eligible', 'active') then
    raise exception using errcode = '23514', message = 'pattern cannot be retired from its current state';
  end if;

  select *
  into gate
  from private.hosted_pattern_gate_at(caller_owner_id, p_pattern_id, review_timestamp);

  if not found then
    raise exception using errcode = '55000', message = 'pattern gate snapshot is unavailable';
  end if;
  if normalized_action = 'mark_eligible' and not gate.eligible then
    raise exception using errcode = '23514', message = 'pattern evidence does not pass the deterministic gate';
  end if;

  update public.pattern_hypotheses as hypothesis
  set lifecycle_status = target_status
  where hypothesis.id = p_pattern_id
    and hypothesis.owner_id = caller_owner_id
    and hypothesis.lifecycle_status = normalized_expected_status;

  if not found then
    raise exception using errcode = '40001', message = 'pattern lifecycle status changed';
  end if;

  insert into private.audit_log (
    owner_id,
    experiment_id,
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    correlation_id,
    metadata
  ) values (
    caller_owner_id,
    pattern.experiment_id,
    'owner',
    caller_owner_id,
    'pattern.lifecycle_reviewed',
    'pattern_hypothesis',
    p_pattern_id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'paper_only', true,
      'reviewed_at', review_timestamp,
      'action', normalized_action,
      'reason', nullif(normalized_reason, ''),
      'prior_lifecycle_status', pattern.lifecycle_status,
      'lifecycle_status', target_status,
      'policy_version', 'hosted-pattern-promotion-v1',
      'independent_observations_text', gate.independent_observations::text,
      'hit_rate_text', gate.hit_rate::text,
      'mean_benchmark_relative_return_text', gate.mean_benchmark_relative_return::text,
      'worst_maximum_adverse_excursion_text', gate.worst_maximum_adverse_excursion::text,
      'holdout_passed', gate.holdout_passed,
      'gate_eligible', gate.eligible,
      'gate_reasons', gate.reasons,
      'strategy_assignment_created', false,
      'allocation_changed', false,
      'agent_enabled', false,
      'scheduler_enabled', false
    )
  );

  update private.idempotency_records
  set status = 'completed',
      result_ref_type = 'pattern_hypothesis',
      result_ref_id = p_pattern_id,
      completed_at = review_timestamp
  where id = idempotency.id
    and owner_id = caller_owner_id;

  if not found then
    raise exception using errcode = '55000', message = 'pattern review could not finalize idempotency';
  end if;

  return query select
    p_pattern_id,
    target_status,
    review_timestamp,
    gate.independent_observations::text,
    gate.hit_rate::text,
    gate.mean_benchmark_relative_return::text,
    gate.worst_maximum_adverse_excursion::text,
    gate.holdout_passed,
    gate.eligible,
    gate.reasons,
    'hosted-pattern-promotion-v1'::text,
    false;
end;
$$;

create function public.review_hosted_pattern_lifecycle(
  p_operation_id uuid,
  p_pattern_id uuid,
  p_expected_status text,
  p_action text,
  p_confirmation text,
  p_reason text default null
)
returns table (
  pattern_id uuid,
  lifecycle_status text,
  reviewed_at timestamptz,
  independent_observations_text text,
  hit_rate_text text,
  mean_benchmark_relative_return_text text,
  worst_maximum_adverse_excursion_text text,
  holdout_passed boolean,
  gate_eligible boolean,
  gate_reasons jsonb,
  policy_version text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.review_hosted_pattern_lifecycle(
    p_operation_id,
    p_pattern_id,
    p_expected_status,
    p_action,
    p_confirmation,
    p_reason
  );
$$;

revoke all on function private.guard_pattern_hypothesis_lifecycle()
from public, anon, authenticated, service_role;
revoke all on function private.hosted_pattern_gate_at(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.hosted_learning_snapshot(timestamptz, integer)
from public, anon, authenticated, service_role;
revoke all on function private.review_hosted_pattern_lifecycle(uuid, uuid, text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.review_hosted_pattern_lifecycle(uuid, uuid, text, text, text, text)
from public, anon, authenticated, service_role;

grant execute on function private.hosted_pattern_gate_at(uuid, uuid, timestamptz)
to authenticated;
grant execute on function public.hosted_learning_snapshot(timestamptz, integer)
to authenticated;
grant execute on function private.review_hosted_pattern_lifecycle(uuid, uuid, text, text, text, text)
to authenticated;
grant execute on function public.review_hosted_pattern_lifecycle(uuid, uuid, text, text, text, text)
to authenticated;

commit;
