export type AgentToolContext = {
  ownerId: string
  experimentId: string
  decisionAt: string
}

export type AgentEvidence = {
  evidenceId: string
  availableAt: string
  provenance: string
  content: unknown
}

export interface AgentReadTools {
  getMarketSnapshot(context: AgentToolContext): Promise<AgentEvidence[]>
  getRecentEvents(context: AgentToolContext): Promise<AgentEvidence[]>
  getEventDetails(
    context: AgentToolContext,
    eventId: string,
  ): Promise<AgentEvidence>
  retrieveResearch(
    context: AgentToolContext,
    query: string,
  ): Promise<AgentEvidence[]>
  getSimilarPastDecisions(context: AgentToolContext): Promise<AgentEvidence[]>
  getPortfolioState(context: AgentToolContext): Promise<AgentEvidence>
  getExperimentRules(context: AgentToolContext): Promise<AgentEvidence>
  getSourceProvenance(
    context: AgentToolContext,
    evidenceId: string,
  ): Promise<AgentEvidence>
}

export function assertPointInTimeEvidence(
  context: AgentToolContext,
  evidence: readonly AgentEvidence[],
): void {
  const cutoff = new Date(context.decisionAt).getTime()
  if (Number.isNaN(cutoff)) throw new TypeError('Invalid decision timestamp')
  for (const item of evidence) {
    if (new Date(item.availableAt).getTime() > cutoff) {
      throw new Error(`LOOKAHEAD_REJECTED:${item.evidenceId}`)
    }
  }
}
