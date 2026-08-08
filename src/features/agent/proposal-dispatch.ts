import {
  proposalDisposition,
  type AgentRoutingPolicy,
} from '@/domain/agent/routing'
import {
  validateProposalSemantics,
  type TradeProposal,
} from '@/domain/agent/schemas'

export type PersistedProposalStatus = 'shadow' | 'proposed' | 'rejected'

export type ProposalRecord = {
  decisionAt: string
  proposal: TradeProposal
  proposalStatus: PersistedProposalStatus
  conciseRationale: string
  rejectionReasonCode?: string
}

export interface AgentDecisionWriter {
  recordProposal(input: ProposalRecord): Promise<{ decisionId: string }>
}

/**
 * The only port this feature may use for live-paper effects. Its implementation
 * must be the deterministic simulation execution service; it is not a broker.
 */
export interface PaperSimulationExecutionService {
  evaluateProposal(input: {
    decisionId: string
    decisionAt: string
    proposal: TradeProposal
  }): Promise<
    | { accepted: true; simulationOrderId: string }
    | { accepted: false; reasonCodes: readonly string[] }
  >
}

export type ProposalDispatchResult =
  | { status: 'shadow'; decisionId: string; simulationOrderId: null }
  | {
      status: 'simulation_accepted'
      decisionId: string
      simulationOrderId: string
    }
  | {
      status: 'simulation_rejected'
      decisionId: string
      simulationOrderId: null
      reasonCodes: readonly string[]
    }
  | {
      status: 'disabled'
      decisionId: string
      simulationOrderId: null
      reason: 'agent_disabled' | 'live_paper_not_enabled'
    }

export async function dispatchTradeProposal(
  input: {
    policy: AgentRoutingPolicy
    decisionAt: string
    proposal: TradeProposal
  },
  ports: {
    decisions: AgentDecisionWriter
    simulation: PaperSimulationExecutionService
  },
): Promise<ProposalDispatchResult> {
  if (!Number.isFinite(Date.parse(input.decisionAt))) {
    throw new TypeError('decisionAt must be a valid timestamp')
  }
  const proposal = validateProposalSemantics(input.proposal)
  const disposition = proposalDisposition(input.policy)

  if (disposition.kind === 'shadow') {
    const recorded = await ports.decisions.recordProposal({
      decisionAt: input.decisionAt,
      proposal,
      proposalStatus: 'shadow',
      conciseRationale: proposal.thesis,
    })
    return {
      status: 'shadow',
      decisionId: recorded.decisionId,
      simulationOrderId: null,
    }
  }

  if (disposition.kind === 'denied') {
    const recorded = await ports.decisions.recordProposal({
      decisionAt: input.decisionAt,
      proposal,
      proposalStatus: 'rejected',
      conciseRationale: proposal.thesis,
      rejectionReasonCode: disposition.reason,
    })
    return {
      status: 'disabled',
      decisionId: recorded.decisionId,
      simulationOrderId: null,
      reason: disposition.reason,
    }
  }

  const recorded = await ports.decisions.recordProposal({
    decisionAt: input.decisionAt,
    proposal,
    proposalStatus: 'proposed',
    conciseRationale: proposal.thesis,
  })
  const simulation = await ports.simulation.evaluateProposal({
    decisionId: recorded.decisionId,
    decisionAt: input.decisionAt,
    proposal,
  })
  if (!simulation.accepted) {
    return {
      status: 'simulation_rejected',
      decisionId: recorded.decisionId,
      simulationOrderId: null,
      reasonCodes: simulation.reasonCodes,
    }
  }
  return {
    status: 'simulation_accepted',
    decisionId: recorded.decisionId,
    simulationOrderId: simulation.simulationOrderId,
  }
}
