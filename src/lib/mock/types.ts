export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info'

export type ExperimentStatus =
  'draft' | 'replay' | 'shadow' | 'live-paper' | 'paused' | 'completed'

export interface MoneyValue {
  raw: string
  currency: 'EUR' | 'USD'
  formatted: string
}

export interface ShellViewModel {
  owner: { name: string; email: string; initials: string }
  experiments: Array<{ id: string; name: string; status: ExperimentStatus }>
  currentExperiment: { id: string; name: string; status: ExperimentStatus }
  market: { state: 'open' | 'closed'; detail: string; asOf: string }
  dataMode: 'mock'
  agentMode: 'shadow'
  scheduler: { state: 'healthy' | 'delayed'; detail: string }
  spend: { daily: string; monthly: string; lifetime: string }
}

export interface Metric {
  label: string
  value: string
  detail: string
  tone?: Tone
}

export interface EquityPoint {
  at: string
  navMinor: number
  benchmarkMinor: number
}

export interface Position {
  symbol: string
  name: string
  side: 'Long' | 'Short'
  quantity: string
  marketValue: string
  weight: string
  pnl: string
  pnlTone: Tone
}

export interface Decision {
  id: string
  at: string
  symbol: string
  action: string
  summary: string
  model: string
  status: 'accepted' | 'rejected' | 'abstained'
  confidence: string
}

export interface Fill {
  id: string
  at: string
  symbol: string
  side: string
  quantity: string
  price: string
  status: 'filled' | 'partial'
}

export interface MarketEvent {
  id: string
  at: string
  category: string
  source: string
  title: string
  summary: string
  symbols: string[]
  relevance: number
  quality: 'high' | 'medium' | 'low'
  state: 'new' | 'reviewed' | 'dismissed'
  timing: string
}

export interface DashboardViewModel {
  asOf: string
  metrics: Metric[]
  equityCurve: EquityPoint[]
  positions: Position[]
  decisions: Decision[]
  fills: Fill[]
  events: MarketEvent[]
  risk: {
    state: 'within-limits' | 'warning'
    utilization: number
    items: Array<{
      label: string
      value: string
      limit: string
      utilization: number
    }>
  }
  budget: { used: number; label: string; detail: string }
  sources: Array<{
    name: string
    status: 'healthy' | 'stale'
    freshness: string
  }>
}

export interface ExperimentSummary {
  id: string
  name: string
  status: ExperimentStatus
  mode: string
  objective: string
  startedAt: string
  nav: string
  return: string
  version: string
}

export interface ExperimentDetail extends ExperimentSummary {
  description: string
  lockedAt: string | null
  configuration: Array<{ label: string; value: string; detail: string }>
  versions: Array<{ label: string; value: string }>
  timeline: Array<{ at: string; title: string; detail: string; tone: Tone }>
  checks: Array<{ label: string; state: 'pass' | 'warning'; detail: string }>
}

export interface MarketViewModel {
  asOf: string
  session: { state: 'open'; name: string; window: string; elapsed: string }
  quotes: Array<{
    symbol: string
    name: string
    bid: string
    ask: string
    last: string
    change: string
    volume: string
    freshness: string
    status: 'fresh' | 'stale'
  }>
  breadth: Array<{ label: string; value: string; detail: string; tone: Tone }>
  sessions: Array<{
    date: string
    state: string
    open: string
    close: string
    records: string
  }>
  providers: Array<{
    name: string
    role: string
    status: 'healthy' | 'stale'
    detail: string
  }>
}

export interface EventsViewModel {
  events: MarketEvent[]
  categories: Array<{ name: string; count: number }>
  selected: MarketEvent
}

export interface AgentStage {
  name: 'Luna' | 'Terra' | 'Sol' | 'Risk engine'
  state: 'complete' | 'skipped' | 'rejected'
  at: string
  summary: string
  model: string
  tokens: string
  cost: string
  latency: string
  evidence: string[]
  tools: string[]
}

export interface AgentViewModel {
  asOf: string
  candidates: Array<MarketEvent & { signal: string }>
  run: {
    id: string
    status: string
    trigger: string
    duration: string
    stages: AgentStage[]
    rationale: string
    scenarios: Array<{ name: string; probability: string; summary: string }>
    proposal: {
      action: string
      symbol: string
      exposure: string
      horizon: string
      result: string
    }
    rejectionReasons: string[]
  }
  impact: {
    before: Array<{ label: string; value: string }>
    after: Array<{ label: string; value: string }>
    constraints: Array<{
      label: string
      utilization: number
      state: 'pass' | 'warning'
    }>
  }
}

export interface MemoryViewModel {
  corpus: Array<{
    version: string
    state: string
    documents: number
    chunks: number
    created: string
  }>
  sources: Array<{
    title: string
    type: string
    quality: string
    version: string
    available: string
  }>
  chunks: Array<{
    id: string
    title: string
    excerpt: string
    score: string
    provenance: string
  }>
  outcomes: Array<{
    decision: string
    symbol: string
    horizon: string
    return: string
    calibration: string
  }>
  hypotheses: Array<{
    name: string
    state: string
    evidence: string
    confidence: string
    nextGate: string
  }>
  strategies: Array<{
    name: string
    role: 'Champion' | 'Challenger'
    return: string
    drawdown: string
    samples: number
  }>
  calibration: Array<{ band: string; predicted: number; observed: number }>
  sourcePerformance: Array<{
    source: string
    events: number
    hitRate: string
    avgReturn: string
  }>
}

export interface ResearchViewModel {
  documents: Array<{
    title: string
    type: string
    state: string
    version: string
    chunks: number
    updated: string
    synthetic: boolean
  }>
  importFormats: Array<{ name: string; description: string; extension: string }>
  stats: Array<{ label: string; value: string; detail: string }>
}

export interface CostViewModel {
  periods: Array<{
    label: string
    spent: string
    reserved: string
    limit: string
    utilization: number
    state: Tone
  }>
  states: Array<{ label: string; value: string; detail: string; tone: Tone }>
  byModel: Array<{
    model: string
    calls: number
    tokens: string
    spend: string
    share: number
  }>
  byRun: Array<{ type: string; runs: number; spend: string; avg: string }>
  alerts: Array<{ threshold: string; state: string; detail: string }>
  runway: { tradingDays: string; months: string; basis: string }
  webSearch: { today: string; month: string; limit: string }
}

export interface SettingsViewModel {
  defaults: Array<{ label: string; value: string; detail: string }>
  providers: Array<{
    name: string
    mode: string
    state: string
    detail: string
  }>
  sources: Array<{
    name: string
    type: string
    allowed: boolean
    policy: string
  }>
  routing: Array<{ model: string; role: string; cap: string; enabled: boolean }>
  budget: Array<{ label: string; value: string; hard: boolean }>
  flags: Array<{ name: string; enabled: boolean; detail: string }>
  prompts: Array<{
    role: string
    version: string
    status: string
    updated: string
  }>
}
