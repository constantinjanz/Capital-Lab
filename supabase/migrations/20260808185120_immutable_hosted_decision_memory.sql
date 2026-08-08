begin;

create function private.guard_agent_run_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'agent run provenance is immutable';
  end if;

  if (to_jsonb(old) - array['status', 'started_at', 'finished_at'])
     is distinct from
     (to_jsonb(new) - array['status', 'started_at', 'finished_at']) then
    raise exception using
      errcode = '55000',
      message = 'agent run provenance is immutable';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_agent_run_provenance() from public, anon, authenticated;

create trigger agent_runs_guard_provenance
before update or delete on public.agent_runs
for each row execute function private.guard_agent_run_provenance();

create function private.validate_decision_context_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  run_row public.agent_runs%rowtype;
  version_row public.experiment_versions%rowtype;
  portfolio_row public.portfolio_snapshots%rowtype;
begin
  select run.*
  into run_row
  from public.agent_runs as run
  where run.id = new.agent_run_id
    and run.owner_id = new.owner_id;

  if not found
     or run_row.experiment_id <> new.experiment_id
     or run_row.decision_at <> new.decision_at then
    raise exception using
      errcode = '23514',
      message = 'decision context run scope or decision time is inconsistent';
  end if;

  select version.*
  into version_row
  from public.experiment_versions as version
  where version.id = new.experiment_version_id
    and version.owner_id = new.owner_id;

  if not found
     or version_row.experiment_id <> new.experiment_id
     or version_row.created_at > new.decision_at then
    raise exception using
      errcode = '23514',
      message = 'decision context experiment version scope is inconsistent';
  end if;

  if new.portfolio_snapshot_id is not null then
    select snapshot.*
    into portfolio_row
    from public.portfolio_snapshots as snapshot
    where snapshot.id = new.portfolio_snapshot_id
      and snapshot.owner_id = new.owner_id;

    if not found
       or portfolio_row.experiment_id <> new.experiment_id
       or portfolio_row.as_of > new.decision_at then
      raise exception using
        errcode = '23514',
        message = 'decision context portfolio scope or availability is inconsistent';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_decision_context_snapshot() from public, anon, authenticated;

create trigger decision_context_snapshots_validate_insert
before insert on public.decision_context_snapshots
for each row execute function private.validate_decision_context_snapshot();

create function private.validate_agent_decision_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  context_row public.decision_context_snapshots%rowtype;
begin
  select context.*
  into context_row
  from public.decision_context_snapshots as context
  where context.id = new.context_snapshot_id
    and context.owner_id = new.owner_id;

  if not found
     or context_row.agent_run_id <> new.agent_run_id
     or context_row.experiment_id <> new.experiment_id
     or context_row.decision_at <> new.decided_at then
    raise exception using
      errcode = '23514',
      message = 'agent decision context scope or decision time is inconsistent';
  end if;

  if new.decision_type not in ('hold', 'abstain') and new.instrument_id is null then
    raise exception using
      errcode = '23514',
      message = 'an actionable agent decision requires an instrument';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_agent_decision_snapshot() from public, anon, authenticated;

create trigger agent_decisions_validate_insert
before insert on public.agent_decisions
for each row execute function private.validate_agent_decision_snapshot();

alter table public.trade_outcomes
  add constraint trade_outcomes_complete_metrics_check
  check (
    num_nonnulls(
      forward_return,
      benchmark_relative_return,
      maximum_favorable_excursion,
      maximum_adverse_excursion
    ) = 4
  );

alter table public.trade_outcomes
  add constraint trade_outcomes_excursion_sign_check
  check (
    maximum_favorable_excursion >= 0
    and maximum_adverse_excursion <= 0
  );

create function private.validate_trade_outcome_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  decision_row public.agent_decisions%rowtype;
begin
  select decision.*
  into decision_row
  from public.agent_decisions as decision
  where decision.id = new.decision_id
    and decision.owner_id = new.owner_id;

  if not found
     or new.evaluated_at <= decision_row.decided_at
     or new.evaluated_at > statement_timestamp() then
    raise exception using
      errcode = '23514',
      message = 'trade outcome must be measured strictly after its decision';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_trade_outcome_snapshot() from public, anon, authenticated;

create trigger trade_outcomes_validate_insert
before insert on public.trade_outcomes
for each row execute function private.validate_trade_outcome_snapshot();

create index decision_context_snapshots_owner_decision_at_idx
on public.decision_context_snapshots(owner_id, decision_at desc, id);

create index agent_decisions_owner_decided_at_idx
on public.agent_decisions(owner_id, decided_at desc, id);

create index decision_evidence_owner_available_at_idx
on public.decision_evidence(owner_id, evidence_available_at desc, decision_id);

create index trade_outcomes_owner_evaluated_at_idx
on public.trade_outcomes(owner_id, evaluated_at desc, decision_id);

create function public.hosted_decision_memory_read(
  p_decision_at timestamptz,
  p_context_limit integer default 100
)
returns table (
  owner_id uuid,
  decision_at timestamptz,
  context_rows jsonb,
  decision_rows jsonb,
  evidence_rows jsonb,
  outcome_rows jsonb
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
      message = 'active owner authentication required';
  end if;

  if p_decision_at is null then
    raise exception using
      errcode = '22004',
      message = 'decisionAt is required';
  end if;

  if p_decision_at > statement_timestamp() then
    raise exception using
      errcode = '22007',
      message = 'decisionAt cannot be in the future';
  end if;

  if p_context_limit < 1 or p_context_limit > 200 then
    raise exception using
      errcode = '22023',
      message = 'context limit must be between 1 and 200';
  end if;

  return query
  with selected_contexts as materialized (
    select
      context.id,
      context.owner_id,
      context.agent_run_id,
      context.experiment_id,
      context.experiment_version_id,
      context.strategy_version_id,
      context.decision_at,
      context.portfolio_snapshot_id,
      context.context_manifest,
      context.content_hash,
      context.created_at,
      run.role as agent_role,
      run.run_type,
      run.model,
      run.prompt_version_id,
      run.routing_reason,
      version.version as experiment_version,
      version.content_hash as experiment_version_content_hash,
      portfolio.as_of as portfolio_as_of,
      portfolio.net_liquidation_value::text as net_liquidation_value_text,
      portfolio.drawdown_fraction::text as drawdown_fraction_text
    from public.decision_context_snapshots as context
    join public.agent_runs as run
      on run.id = context.agent_run_id
     and run.owner_id = context.owner_id
    join public.experiment_versions as version
      on version.id = context.experiment_version_id
     and version.owner_id = context.owner_id
    left join public.portfolio_snapshots as portfolio
      on portfolio.id = context.portfolio_snapshot_id
     and portfolio.owner_id = context.owner_id
    where context.owner_id = caller_owner_id
      and context.decision_at <= p_decision_at
      and context.created_at <= p_decision_at
      and run.created_at <= p_decision_at
      and version.created_at <= p_decision_at
      and (portfolio.id is null or portfolio.created_at <= p_decision_at)
    order by context.decision_at desc, context.id
    limit p_context_limit
  ),
  selected_decisions as materialized (
    select decision.*
    from public.agent_decisions as decision
    join selected_contexts as context
      on context.id = decision.context_snapshot_id
     and context.owner_id = decision.owner_id
    where decision.decided_at <= p_decision_at
      and decision.created_at <= p_decision_at
  ),
  selected_evidence as materialized (
    select ranked.*
    from (
      select
        evidence.*,
        row_number() over (
          partition by evidence.decision_id
          order by evidence.evidence_available_at desc, evidence.id
        ) as evidence_rank
      from public.decision_evidence as evidence
      join selected_decisions as decision
        on decision.id = evidence.decision_id
       and decision.owner_id = evidence.owner_id
      where evidence.evidence_available_at <= decision.decided_at
        and evidence.evidence_available_at <= p_decision_at
        and evidence.created_at <= p_decision_at
    ) as ranked
    where ranked.evidence_rank <= 100
  ),
  selected_outcomes as materialized (
    select outcome.*
    from public.trade_outcomes as outcome
    join selected_decisions as decision
      on decision.id = outcome.decision_id
     and decision.owner_id = outcome.owner_id
    where outcome.evaluated_at > decision.decided_at
      and outcome.evaluated_at <= p_decision_at
      and outcome.created_at <= p_decision_at
  )
  select
    caller_owner_id,
    p_decision_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', context.id,
            'owner_id', context.owner_id,
            'agent_run_id', context.agent_run_id,
            'experiment_id', context.experiment_id,
            'experiment_version_id', context.experiment_version_id,
            'experiment_version', context.experiment_version,
            'experiment_version_content_hash', context.experiment_version_content_hash,
            'strategy_version_id', context.strategy_version_id,
            'decision_at', context.decision_at,
            'portfolio_snapshot_id', context.portfolio_snapshot_id,
            'portfolio_as_of', context.portfolio_as_of,
            'net_liquidation_value_text', context.net_liquidation_value_text,
            'drawdown_fraction_text', context.drawdown_fraction_text,
            'agent_role', context.agent_role,
            'run_type', context.run_type,
            'model', context.model,
            'prompt_version_id', context.prompt_version_id,
            'routing_reason', context.routing_reason,
            'context_manifest', context.context_manifest,
            'content_hash', context.content_hash,
            'created_at', context.created_at
          )
          order by context.decision_at desc, context.id
        )
        from selected_contexts as context
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', decision.id,
            'owner_id', decision.owner_id,
            'context_snapshot_id', decision.context_snapshot_id,
            'agent_run_id', decision.agent_run_id,
            'experiment_id', decision.experiment_id,
            'decision_type', decision.decision_type,
            'instrument_id', decision.instrument_id,
            'structured_output', decision.structured_output,
            'concise_rationale', decision.concise_rationale,
            'confidence_text', decision.confidence::text,
            'proposal_status', decision.proposal_status,
            'rejection_reason_code', decision.rejection_reason_code,
            'decided_at', decision.decided_at,
            'created_at', decision.created_at
          )
          order by decision.decided_at desc, decision.id
        )
        from selected_decisions as decision
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', evidence.id,
            'owner_id', evidence.owner_id,
            'decision_id', evidence.decision_id,
            'evidence_kind', evidence.evidence_kind,
            'market_quote_id', evidence.market_quote_id,
            'market_bar_id', evidence.market_bar_id,
            'event_revision_id', evidence.event_revision_id,
            'knowledge_chunk_id', evidence.knowledge_chunk_id,
            'prior_decision_id', evidence.prior_decision_id,
            'evidence_available_at', evidence.evidence_available_at,
            'citation_label', evidence.citation_label,
            'created_at', evidence.created_at
          )
          order by evidence.evidence_available_at desc, evidence.id
        )
        from selected_evidence as evidence
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', outcome.id,
            'owner_id', outcome.owner_id,
            'decision_id', outcome.decision_id,
            'horizon', outcome.horizon,
            'evaluated_at', outcome.evaluated_at,
            'forward_return_text', outcome.forward_return::text,
            'benchmark_relative_return_text', outcome.benchmark_relative_return::text,
            'maximum_favorable_excursion_text', outcome.maximum_favorable_excursion::text,
            'maximum_adverse_excursion_text', outcome.maximum_adverse_excursion::text,
            'thesis_valid', outcome.thesis_valid,
            'execution_outcome', outcome.execution_outcome,
            'created_at', outcome.created_at
          )
          order by outcome.evaluated_at desc, outcome.id
        )
        from selected_outcomes as outcome
      ),
      '[]'::jsonb
    );
end;
$$;

revoke all on function public.hosted_decision_memory_read(timestamptz, integer)
from public, anon, authenticated, service_role;

grant execute on function public.hosted_decision_memory_read(timestamptz, integer)
to authenticated;

comment on function public.hosted_decision_memory_read(timestamptz, integer) is
'Returns a bounded owner-only point-in-time projection of immutable decision contexts, decisions, citations, and outcomes. Exact financial values are text; no row at or after its availability boundary may cross decisionAt.';

commit;
