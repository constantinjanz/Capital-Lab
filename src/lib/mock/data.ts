import type {
  AgentViewModel,
  CostViewModel,
  DashboardViewModel,
  EventsViewModel,
  ExperimentDetail,
  ExperimentSummary,
  MarketEvent,
  MarketViewModel,
  MemoryViewModel,
  ResearchViewModel,
  SettingsViewModel,
  ShellViewModel,
} from './types'

export const MOCK_NOW = '2026-08-06T14:45:00.000Z'

export const experiments: ExperimentSummary[] = [
  {
    id: 'northstar-event-lab',
    name: 'Northstar Event Lab',
    status: 'shadow',
    mode: 'US equities · regular hours',
    objective: 'Event-driven, risk-bounded paper strategy',
    startedAt: 'Aug 3, 2026',
    nav: '€103,842.66',
    return: '+3.84%',
    version: 'EXP-004 · v1.0',
  },
  {
    id: 'earnings-drift-v2',
    name: 'Earnings Drift v2',
    status: 'draft',
    mode: 'US equities · draft',
    objective: 'Post-guidance drift with strict evidence gates',
    startedAt: 'Not started',
    nav: '€100,000.00',
    return: '—',
    version: 'EXP-006 · draft 3',
  },
  {
    id: 'march-volatility-replay',
    name: 'March Volatility Replay',
    status: 'replay',
    mode: 'Historical replay · point-in-time',
    objective: 'Validate policy-shock handling without lookahead',
    startedAt: 'Jul 28, 2026',
    nav: '€98,611.42',
    return: '−1.39%',
    version: 'EXP-003 · v1.1',
  },
]

export const shell: ShellViewModel = {
  owner: {
    name: 'Research Owner',
    email: 'owner@capital-lab.local',
    initials: 'RO',
  },
  experiments: experiments.map(({ id, name, status }) => ({
    id,
    name,
    status,
  })),
  currentExperiment: {
    id: experiments[0].id,
    name: experiments[0].name,
    status: experiments[0].status,
  },
  market: {
    state: 'open',
    detail: 'NYSE regular session · closes in 5h 15m',
    asOf: MOCK_NOW,
  },
  dataMode: 'mock',
  agentMode: 'shadow',
  scheduler: { state: 'healthy', detail: 'Last cycle 3m ago' },
  spend: {
    state: 'connected',
    daily: '$0.14',
    monthly: '$5.82',
    lifetime: '$12.41',
  },
}

const events: MarketEvent[] = [
  {
    id: 'EVT-2841',
    at: '14:37 UTC',
    category: 'SEC filing',
    source: 'SEC EDGAR · synthetic fixture',
    title: 'Semiconductor issuer raises full-year capital expenditure range',
    summary:
      'The synthetic 8-K fixture shows a higher capex range and unchanged gross-margin guidance. No instructions from source content were used.',
    symbols: ['NVDA', 'SMH'],
    relevance: 94,
    quality: 'high',
    state: 'new',
    timing: 'Published 14:31 · first seen 14:33 · available 14:34 UTC',
  },
  {
    id: 'EVT-2838',
    at: '14:18 UTC',
    category: 'Policy',
    source: 'Federal Register · synthetic fixture',
    title:
      'Draft export-control language narrows covered accelerator threshold',
    summary:
      'A synthetic policy notice may reduce the scope of a previously modeled restriction. The document is unconfirmed until final publication.',
    symbols: ['NVDA', 'AMD', 'SMH'],
    relevance: 88,
    quality: 'high',
    state: 'reviewed',
    timing: 'Published 14:10 · first seen 14:14 · available 14:16 UTC',
  },
  {
    id: 'EVT-2834',
    at: '13:56 UTC',
    category: 'Macro',
    source: 'BLS calendar · synthetic fixture',
    title: 'Productivity revision lands within the consensus range',
    summary:
      'The revision is unlikely to alter the current rate path in isolation.',
    symbols: ['SPY', 'TLT'],
    relevance: 42,
    quality: 'high',
    state: 'dismissed',
    timing: 'Published 13:50 · first seen 13:51 · available 13:52 UTC',
  },
  {
    id: 'EVT-2829',
    at: '13:41 UTC',
    category: 'News',
    source: 'Public RSS · synthetic fixture',
    title: 'Retailer announces previously scheduled store-format briefing',
    summary: 'Routine scheduling update with no new financial information.',
    symbols: ['XLY'],
    relevance: 18,
    quality: 'medium',
    state: 'dismissed',
    timing: 'Published 13:34 · first seen 13:39 · available 13:40 UTC',
  },
]

export const dashboard: DashboardViewModel = {
  asOf: MOCK_NOW,
  metrics: [
    {
      label: 'Net asset value',
      value: '€103,842.66',
      detail: '+€3,842.66 since inception',
      tone: 'positive',
    },
    {
      label: 'Total return',
      value: '+3.84%',
      detail: '+1.73% vs SPY benchmark',
      tone: 'positive',
    },
    {
      label: 'Available cash',
      value: '€38,204.18',
      detail: '36.8% of NAV',
      tone: 'neutral',
    },
    {
      label: 'Realized P&L',
      value: '+€1,520.31',
      detail: '14 closed lots',
      tone: 'positive',
    },
    {
      label: 'Unrealized P&L',
      value: '+€2,322.35',
      detail: '6 open positions',
      tone: 'positive',
    },
    {
      label: 'Maximum drawdown',
      value: '−2.74%',
      detail: '50.0% hard pause threshold',
      tone: 'warning',
    },
  ],
  equityCurve: [
    { at: 'Jul 20', navMinor: 10000000, benchmarkMinor: 10000000 },
    { at: 'Jul 21', navMinor: 10042000, benchmarkMinor: 10018000 },
    { at: 'Jul 22', navMinor: 10016000, benchmarkMinor: 10008000 },
    { at: 'Jul 23', navMinor: 10106000, benchmarkMinor: 10052000 },
    { at: 'Jul 24', navMinor: 10088000, benchmarkMinor: 10076000 },
    { at: 'Jul 27', navMinor: 10172000, benchmarkMinor: 10104000 },
    { at: 'Jul 28', navMinor: 10236000, benchmarkMinor: 10151000 },
    { at: 'Jul 29', navMinor: 10196000, benchmarkMinor: 10133000 },
    { at: 'Jul 30', navMinor: 10312000, benchmarkMinor: 10178000 },
    { at: 'Jul 31', navMinor: 10284000, benchmarkMinor: 10196000 },
    { at: 'Aug 3', navMinor: 10346000, benchmarkMinor: 10204000 },
    { at: 'Aug 4', navMinor: 10411000, benchmarkMinor: 10242000 },
    { at: 'Aug 5', navMinor: 10327000, benchmarkMinor: 10198000 },
    { at: 'Aug 6', navMinor: 10384266, benchmarkMinor: 10211000 },
  ],
  positions: [
    {
      symbol: 'NVDA',
      name: 'NVIDIA',
      side: 'Long',
      quantity: '42',
      marketValue: '€14,802.24',
      weight: '14.3%',
      pnl: '+€1,381.42',
      pnlTone: 'positive',
    },
    {
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF',
      side: 'Long',
      quantity: '31',
      marketValue: '€13,944.62',
      weight: '13.4%',
      pnl: '+€642.11',
      pnlTone: 'positive',
    },
    {
      symbol: 'XLF',
      name: 'Financial Select Sector',
      side: 'Short',
      quantity: '−210',
      marketValue: '−€7,681.80',
      weight: '−7.4%',
      pnl: '+€416.28',
      pnlTone: 'positive',
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft',
      side: 'Long',
      quantity: '24',
      marketValue: '€9,630.72',
      weight: '9.3%',
      pnl: '+€198.06',
      pnlTone: 'positive',
    },
    {
      symbol: 'TLT',
      name: 'iShares 20+ Year Treasury',
      side: 'Short',
      quantity: '−76',
      marketValue: '−€6,199.32',
      weight: '−6.0%',
      pnl: '−€315.52',
      pnlTone: 'negative',
    },
  ],
  decisions: [
    {
      id: 'DEC-1092',
      at: '14:39',
      symbol: 'NVDA',
      action: 'REDUCE',
      summary:
        'Capex signal is constructive, but concentration is near its soft gate.',
      model: 'Terra',
      status: 'rejected',
      confidence: '71%',
    },
    {
      id: 'DEC-1091',
      at: '14:19',
      symbol: 'AMD',
      action: 'ABSTAIN',
      summary: 'Policy impact remains ambiguous and the quote is stale.',
      model: 'Terra',
      status: 'abstained',
      confidence: '58%',
    },
    {
      id: 'DEC-1090',
      at: '13:57',
      symbol: 'SPY',
      action: 'HOLD',
      summary: 'Macro revision lacks sufficient surprise for portfolio action.',
      model: 'Luna',
      status: 'accepted',
      confidence: '82%',
    },
  ],
  fills: [
    {
      id: 'FIL-722',
      at: '13:33',
      symbol: 'MSFT',
      side: 'BUY',
      quantity: '8',
      price: '$421.08',
      status: 'filled',
    },
    {
      id: 'FIL-721',
      at: '13:31',
      symbol: 'XLF',
      side: 'SELL SHORT',
      quantity: '70',
      price: '$48.72',
      status: 'filled',
    },
    {
      id: 'FIL-718',
      at: 'Aug 5 · 19:42',
      symbol: 'SPY',
      side: 'BUY',
      quantity: '11',
      price: '$523.16',
      status: 'partial',
    },
  ],
  events,
  risk: {
    state: 'within-limits',
    utilization: 61,
    items: [
      {
        label: 'Gross leverage',
        value: '1.21×',
        limit: '2.00×',
        utilization: 61,
      },
      {
        label: 'Largest position',
        value: '14.3%',
        limit: '25.0%',
        utilization: 57,
      },
      { label: 'Daily loss', value: '0.55%', limit: '20.0%', utilization: 3 },
      { label: 'Drawdown', value: '2.74%', limit: '50.0%', utilization: 5 },
    ],
  },
  budget: {
    used: 60,
    label: '$0.14 / $0.30 today',
    detail: '3 settled · 1 skipped · $0.03 reserved · $0.01 unknown',
  },
  sources: [
    { name: 'Market quotes', status: 'healthy', freshness: '12s' },
    { name: 'SEC filings', status: 'healthy', freshness: '4m' },
    { name: 'Policy feed', status: 'healthy', freshness: '8m' },
    { name: 'AMD quote', status: 'stale', freshness: '7m 18s' },
  ],
}

const commonConfiguration = [
  {
    label: 'Initial capital',
    value: '€100,000.00',
    detail: 'Immutable after start',
  },
  {
    label: 'Base currency',
    value: 'EUR',
    detail: 'FX conversions use point-in-time rates',
  },
  {
    label: 'Session',
    value: 'US regular hours',
    detail: 'America/New_York calendar',
  },
  {
    label: 'Gross leverage',
    value: '2.00× max',
    detail: 'Hard deterministic limit',
  },
  { label: 'Single name', value: '25.0% max', detail: 'Absolute NAV exposure' },
  {
    label: 'Risk per trade',
    value: '5.0% max',
    detail: 'New exposure allocation',
  },
  {
    label: 'Stale quote',
    value: '5 minutes',
    detail: 'Execution blocked beyond threshold',
  },
  {
    label: 'Drawdown pause',
    value: '50.0%',
    detail: 'Automatic and irreversible for this run',
  },
]

export const experimentDetails: Record<string, ExperimentDetail> =
  Object.fromEntries(
    experiments.map((experiment) => [
      experiment.id,
      {
        ...experiment,
        description:
          experiment.status === 'draft'
            ? 'A versioned draft awaiting deterministic configuration validation.'
            : 'A continuous, auditable paper-trading episode. All market, evidence, model, and simulator timestamps are point-in-time constrained.',
        lockedAt:
          experiment.status === 'draft' ? null : 'Aug 3, 2026 · 13:25 UTC',
        configuration: commonConfiguration,
        versions: [
          { label: 'Market universe', value: 'us-liquid-v3' },
          { label: 'Simulator', value: 'sim-core-1.2.0' },
          { label: 'Risk policy', value: 'conservative-v4' },
          { label: 'Agent prompts', value: 'luna-3 / terra-5 / sol-2' },
          { label: 'Model routing', value: 'router-v2' },
          { label: 'Knowledge corpus', value: 'corpus-2026.08.01' },
        ],
        timeline: [
          {
            at: 'Aug 6 · 14:45',
            title: 'Portfolio snapshot recorded',
            detail: 'Ledger reconciled; all limits within bounds.',
            tone: 'positive',
          },
          {
            at: 'Aug 6 · 14:39',
            title: 'Trade proposal rejected',
            detail:
              'Single-name concentration soft gate prevented additional NVDA exposure.',
            tone: 'warning',
          },
          {
            at: 'Aug 6 · 14:30',
            title: 'Market cycle completed',
            detail:
              '4 events scored; 1 routed to Terra; no simulated order created.',
            tone: 'info',
          },
          {
            at: 'Aug 3 · 13:25',
            title: 'Configuration locked',
            detail: 'Experiment versions snapshotted and starting cash posted.',
            tone: 'neutral',
          },
        ],
        checks: [
          {
            label: 'Paper-only boundary',
            state: 'pass',
            detail: 'No broker trading adapter is configured',
          },
          {
            label: 'Market calendar',
            state: 'pass',
            detail: 'NYSE calendar available through 2027',
          },
          {
            label: 'Budget policy',
            state: 'pass',
            detail: 'Daily, monthly and lifetime hard limits present',
          },
          {
            label: 'Provider freshness',
            state: experiment.status === 'draft' ? 'warning' : 'pass',
            detail:
              experiment.status === 'draft'
                ? 'Run validation before starting'
                : 'Eligible mock providers healthy',
          },
        ],
      },
    ]),
  )

export const markets: MarketViewModel = {
  asOf: MOCK_NOW,
  session: {
    state: 'open',
    name: 'NYSE regular session',
    window: '09:30–16:00 America/New_York',
    elapsed: '45m elapsed · 5h 15m remaining',
  },
  quotes: [
    {
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF',
      bid: '$523.46',
      ask: '$523.48',
      last: '$523.47',
      change: '+0.42%',
      volume: '18.2M',
      freshness: '12s',
      status: 'fresh',
    },
    {
      symbol: 'QQQ',
      name: 'Invesco QQQ',
      bid: '$491.18',
      ask: '$491.22',
      last: '$491.20',
      change: '+0.71%',
      volume: '11.8M',
      freshness: '14s',
      status: 'fresh',
    },
    {
      symbol: 'NVDA',
      name: 'NVIDIA',
      bid: '$389.92',
      ask: '$390.01',
      last: '$389.96',
      change: '+2.18%',
      volume: '31.4M',
      freshness: '9s',
      status: 'fresh',
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft',
      bid: '$421.06',
      ask: '$421.10',
      last: '$421.08',
      change: '+0.23%',
      volume: '7.6M',
      freshness: '11s',
      status: 'fresh',
    },
    {
      symbol: 'XLF',
      name: 'Financial Select Sector',
      bid: '$48.71',
      ask: '$48.73',
      last: '$48.72',
      change: '−0.36%',
      volume: '5.1M',
      freshness: '16s',
      status: 'fresh',
    },
    {
      symbol: 'AMD',
      name: 'Advanced Micro Devices',
      bid: '$186.10',
      ask: '$186.42',
      last: '$186.24',
      change: '+1.04%',
      volume: '8.9M',
      freshness: '7m 18s',
      status: 'stale',
    },
  ],
  breadth: [
    {
      label: 'Advancers',
      value: '61%',
      detail: 'Universe breadth',
      tone: 'positive',
    },
    {
      label: 'Median move',
      value: '+0.31%',
      detail: '82 instruments',
      tone: 'positive',
    },
    {
      label: 'Median spread',
      value: '3.8 bps',
      detail: 'Regular-hours snapshot',
      tone: 'neutral',
    },
    {
      label: 'Stale instruments',
      value: '1',
      detail: 'AMD execution blocked',
      tone: 'warning',
    },
  ],
  sessions: [
    {
      date: 'Aug 6',
      state: 'Open',
      open: '13:30 UTC',
      close: '20:00 UTC',
      records: '12,842',
    },
    {
      date: 'Aug 5',
      state: 'Complete',
      open: '13:30 UTC',
      close: '20:00 UTC',
      records: '98,201',
    },
    {
      date: 'Aug 4',
      state: 'Complete',
      open: '13:30 UTC',
      close: '20:00 UTC',
      records: '96,744',
    },
  ],
  providers: [
    {
      name: 'Synthetic SIP',
      role: 'Quotes and bars',
      status: 'healthy',
      detail: 'Deterministic seed capital-lab-v1',
    },
    {
      name: 'Mock NYSE calendar',
      role: 'Sessions',
      status: 'healthy',
      detail: '2026 schedule loaded',
    },
    {
      name: 'Mock FX',
      role: 'EUR/USD conversion',
      status: 'healthy',
      detail: 'Rate timestamp 14:44:58 UTC',
    },
    {
      name: 'AMD quote stream',
      role: 'Instrument quote',
      status: 'stale',
      detail: 'Execution guard engaged',
    },
  ],
}

export const eventsView: EventsViewModel = {
  events,
  categories: [
    { name: 'All events', count: 24 },
    { name: 'SEC filings', count: 6 },
    { name: 'Policy', count: 4 },
    { name: 'Macro', count: 5 },
    { name: 'News', count: 9 },
  ],
  selected: events[0],
}

export const agent: AgentViewModel = {
  asOf: MOCK_NOW,
  candidates: [
    { ...events[0], signal: '+2.1σ capex surprise' },
    { ...events[1], signal: 'Policy scope narrowed' },
    { ...events[2], signal: '0.2σ macro surprise' },
  ],
  run: {
    id: 'RUN-08F2A9',
    status: 'Proposal rejected by deterministic risk engine',
    trigger: 'EVT-2841 · SEC filing',
    duration: '4.8s',
    stages: [
      {
        name: 'Luna',
        state: 'complete',
        at: '14:38:02',
        summary:
          'Classified the capex change as relevant to the active semiconductor basket.',
        model: 'gpt-5.4-mini',
        tokens: '1,184',
        cost: '$0.012',
        latency: '0.8s',
        evidence: ['EVT-2841', 'QTE-NVDA-1445'],
        tools: ['get_event_details', 'get_market_snapshot'],
      },
      {
        name: 'Terra',
        state: 'complete',
        at: '14:38:04',
        summary:
          'Constructive base case, offset by crowded positioning and existing concentration.',
        model: 'gpt-5.4',
        tokens: '3,842',
        cost: '$0.081',
        latency: '3.1s',
        evidence: ['EVT-2841', 'MEM-CHUNK-194', 'DEC-1028'],
        tools: [
          'retrieve_research',
          'get_similar_past_decisions',
          'get_portfolio_state',
          'submit_trade_proposal',
        ],
      },
      {
        name: 'Sol',
        state: 'skipped',
        at: '14:38:04',
        summary:
          'No qualifying high-materiality ambiguity; escalation remained disabled.',
        model: 'Disabled',
        tokens: '0',
        cost: '$0.000',
        latency: '0ms',
        evidence: [],
        tools: [],
      },
      {
        name: 'Risk engine',
        state: 'rejected',
        at: '14:38:05',
        summary:
          'Proposed exposure would breach the configured concentration soft gate.',
        model: 'Deterministic',
        tokens: '0',
        cost: '$0.000',
        latency: '7ms',
        evidence: ['RISK-8271', 'PORT-1445'],
        tools: [],
      },
    ],
    rationale:
      'The filing strengthens demand evidence, but the portfolio already has correlated semiconductor exposure. Waiting for confirmation preserves optionality and keeps the episode inside its risk envelope.',
    scenarios: [
      {
        name: 'Bull',
        probability: '28%',
        summary:
          'Higher capex signals durable accelerator demand; sector rerates.',
      },
      {
        name: 'Base',
        probability: '49%',
        summary:
          'Demand remains firm but is already substantially reflected in price.',
      },
      {
        name: 'Bear',
        probability: '23%',
        summary:
          'Capex raises near-term cost concerns while export policy remains uncertain.',
      },
    ],
    proposal: {
      action: 'REDUCE / HOLD',
      symbol: 'NVDA',
      exposure: '+1.5% intended',
      horizon: '1–5 trading days',
      result: 'REJECTED',
    },
    rejectionReasons: ['CONCENTRATION_SOFT_GATE', 'CORRELATED_SECTOR_EXPOSURE'],
  },
  impact: {
    before: [
      { label: 'Gross exposure', value: '1.21×' },
      { label: 'Net exposure', value: '0.38×' },
      { label: 'NVDA weight', value: '14.3%' },
      { label: 'Buying power', value: '€79,558' },
    ],
    after: [
      { label: 'Gross exposure', value: '1.23×' },
      { label: 'Net exposure', value: '0.40×' },
      { label: 'NVDA weight', value: '15.8%' },
      { label: 'Buying power', value: '€77,991' },
    ],
    constraints: [
      { label: 'Gross leverage', utilization: 62, state: 'pass' },
      { label: 'Single-name hard limit', utilization: 63, state: 'pass' },
      { label: 'Concentration soft gate', utilization: 105, state: 'warning' },
      { label: 'New risk allocation', utilization: 30, state: 'pass' },
    ],
  },
}

export const memory: MemoryViewModel = {
  corpus: [
    {
      version: 'corpus-2026.08.01',
      state: 'Active',
      documents: 18,
      chunks: 284,
      created: 'Aug 1, 2026',
    },
    {
      version: 'corpus-2026.07.15',
      state: 'Archived',
      documents: 16,
      chunks: 251,
      created: 'Jul 15, 2026',
    },
  ],
  sources: [
    {
      title: 'Event-driven failure modes',
      type: 'Research note',
      quality: 'High',
      version: 'v3',
      available: 'Jul 30, 2026',
    },
    {
      title: 'US equity microstructure',
      type: 'Technical guide',
      quality: 'High',
      version: 'v2',
      available: 'Jul 22, 2026',
    },
    {
      title: 'Semiconductor policy map',
      type: 'Strategy card',
      quality: 'Medium',
      version: 'v4',
      available: 'Aug 1, 2026',
    },
  ],
  chunks: [
    {
      id: 'MEM-CHUNK-194',
      title: 'Capex surprises and crowded baskets',
      excerpt:
        'Positive investment revisions lose explanatory power when sector-level crowding and valuation are both elevated…',
      score: '0.88 hybrid',
      provenance: 'Event-driven failure modes · v3 · synthetic',
    },
    {
      id: 'MEM-CHUNK-088',
      title: 'Quote freshness before risk sizing',
      excerpt:
        'A relevant event cannot override an execution block caused by stale or missing bid/ask data…',
      score: '0.81 hybrid',
      provenance: 'US equity microstructure · v2 · synthetic',
    },
  ],
  outcomes: [
    {
      decision: 'DEC-1028',
      symbol: 'NVDA',
      horizon: '5d',
      return: '+3.2%',
      calibration: 'Within range',
    },
    {
      decision: 'DEC-1014',
      symbol: 'XLF',
      horizon: '1d',
      return: '+0.8%',
      calibration: 'Conservative',
    },
    {
      decision: 'DEC-0992',
      symbol: 'TLT',
      horizon: '5d',
      return: '−1.1%',
      calibration: 'Overconfident',
    },
  ],
  hypotheses: [
    {
      name: 'Policy clarification drift',
      state: 'Shadow',
      evidence: '18 / 30 independent events',
      confidence: '63%',
      nextGate: '12 more samples',
    },
    {
      name: 'Capex revision continuation',
      state: 'Eligible',
      evidence: '44 independent events',
      confidence: '71%',
      nextGate: 'Walk-forward review',
    },
    {
      name: 'Unscheduled briefing reversal',
      state: 'Rejected',
      evidence: '11 events',
      confidence: '38%',
      nextGate: 'Insufficient edge',
    },
  ],
  strategies: [
    {
      name: 'Event discipline v4',
      role: 'Champion',
      return: '+3.84%',
      drawdown: '−2.74%',
      samples: 86,
    },
    {
      name: 'Policy context v2',
      role: 'Challenger',
      return: '+3.12%',
      drawdown: '−2.18%',
      samples: 41,
    },
  ],
  calibration: [
    { band: '50–60%', predicted: 55, observed: 52 },
    { band: '60–70%', predicted: 65, observed: 62 },
    { band: '70–80%', predicted: 75, observed: 71 },
    { band: '80–90%', predicted: 85, observed: 78 },
  ],
  sourcePerformance: [
    { source: 'SEC EDGAR', events: 31, hitRate: '58%', avgReturn: '+0.42%' },
    {
      source: 'Federal Register',
      events: 18,
      hitRate: '61%',
      avgReturn: '+0.36%',
    },
    { source: 'Public RSS', events: 42, hitRate: '43%', avgReturn: '+0.08%' },
  ],
}

export const research: ResearchViewModel = {
  documents: [
    {
      title: 'Event-driven failure modes',
      type: 'Markdown',
      state: 'Indexed',
      version: 'v3',
      chunks: 28,
      updated: 'Jul 30, 2026',
      synthetic: true,
    },
    {
      title: 'Semiconductor policy map',
      type: 'Strategy card',
      state: 'Indexed',
      version: 'v4',
      chunks: 14,
      updated: 'Aug 1, 2026',
      synthetic: true,
    },
    {
      title: 'Approved public sources',
      type: 'Source registry',
      state: 'Validated',
      version: 'v2',
      chunks: 0,
      updated: 'Jul 28, 2026',
      synthetic: true,
    },
    {
      title: 'US equity microstructure',
      type: 'Markdown',
      state: 'Indexed',
      version: 'v2',
      chunks: 41,
      updated: 'Jul 22, 2026',
      synthetic: true,
    },
  ],
  importFormats: [
    {
      name: 'Research note',
      description: 'Sanitized Markdown with provenance front matter',
      extension: '.md',
    },
    {
      name: 'Strategy card',
      description: 'Versioned hypothesis and evaluation gates',
      extension: '.json',
    },
    {
      name: 'Source registry',
      description: 'Allowlist, licensing and retention metadata',
      extension: '.csv',
    },
  ],
  stats: [
    {
      label: 'Active documents',
      value: '18',
      detail: 'All synthetic in mock mode',
    },
    {
      label: 'Indexed chunks',
      value: '284',
      detail: 'FTS + deterministic embeddings',
    },
    {
      label: 'Duplicate rate',
      value: '2.1%',
      detail: '7 content hashes rejected',
    },
    {
      label: 'Corpus version',
      value: '2026.08.01',
      detail: 'Locked to active experiment',
    },
  ],
}

export const costs: CostViewModel = {
  periods: [
    {
      label: 'Daily',
      spent: '$0.14',
      reserved: '$0.03',
      limit: '$0.30',
      utilization: 60,
      state: 'info',
    },
    {
      label: 'Monthly',
      spent: '$5.82',
      reserved: '$0.03',
      limit: '$10.00',
      utilization: 59,
      state: 'positive',
    },
    {
      label: 'Lifetime',
      spent: '$12.41',
      reserved: '$0.03',
      limit: '$50.00',
      utilization: 25,
      state: 'positive',
    },
  ],
  states: [
    {
      label: 'Settled',
      value: '$5.82',
      detail: '184 completed calls this month',
      tone: 'positive',
    },
    {
      label: 'Reserved',
      value: '$0.03',
      detail: '1 in-flight reservation',
      tone: 'info',
    },
    {
      label: 'Unknown',
      value: '$0.01',
      detail: '2 timed-out calls held conservatively',
      tone: 'warning',
    },
    {
      label: 'Skipped',
      value: '$2.64',
      detail: 'Estimated cost avoided by gates',
      tone: 'neutral',
    },
  ],
  byModel: [
    {
      model: 'Luna · relevance',
      calls: 142,
      tokens: '168k',
      spend: '$1.42',
      share: 24,
    },
    {
      model: 'Terra · analysis',
      calls: 41,
      tokens: '231k',
      spend: '$4.31',
      share: 74,
    },
    {
      model: 'Sol · escalation',
      calls: 1,
      tokens: '4.2k',
      spend: '$0.09',
      share: 2,
    },
  ],
  byRun: [
    { type: 'Market cycle', runs: 108, spend: '$4.88', avg: '$0.045' },
    { type: 'Manual review', runs: 9, spend: '$0.72', avg: '$0.080' },
    { type: 'Outcome labeling', runs: 67, spend: '$0.22', avg: '$0.003' },
  ],
  alerts: [
    {
      threshold: '70%',
      state: 'Not reached',
      detail: 'Soft warning and lower-cost routing',
    },
    {
      threshold: '90%',
      state: 'Not reached',
      detail: 'Only high-materiality candidates',
    },
    {
      threshold: '100%',
      state: 'Armed',
      detail: 'Hard block and automatic pause',
    },
  ],
  runway: {
    tradingDays: '31 days',
    months: '1.5 months',
    basis:
      'Trailing 10-session average, including conservative unknown reservations',
  },
  webSearch: { today: '0 / 2', month: '3 / 25', limit: 'Disabled by default' },
}

export const settings: SettingsViewModel = {
  defaults: commonConfiguration.slice(0, 6),
  providers: [
    {
      name: 'Market data',
      mode: 'Mock',
      state: 'Ready',
      detail: 'Synthetic SIP adapter · no live credentials',
    },
    {
      name: 'News and events',
      mode: 'Mock',
      state: 'Ready',
      detail: 'Deterministic fixture stream',
    },
    {
      name: 'OpenAI gateway',
      mode: 'Fake client',
      state: 'Disabled',
      detail: 'No paid calls can be made',
    },
    {
      name: 'Embeddings',
      mode: 'Deterministic',
      state: 'Ready',
      detail: 'Test-only local vectors',
    },
  ],
  sources: [
    {
      name: 'SEC EDGAR',
      type: 'Filing',
      allowed: true,
      policy: 'Public documents · retain provenance',
    },
    {
      name: 'Federal Register',
      type: 'Policy',
      allowed: true,
      policy: 'Official publication only',
    },
    {
      name: 'Public RSS',
      type: 'News',
      allowed: true,
      policy: 'Allowlisted feeds · sanitize content',
    },
    {
      name: 'Authenticated social feeds',
      type: 'Social',
      allowed: false,
      policy: 'Blocked',
    },
  ],
  routing: [
    {
      model: 'Luna',
      role: 'Relevance gate',
      cap: 'Routine cycles',
      enabled: false,
    },
    {
      model: 'Terra',
      role: 'Deep analysis',
      cap: '3 / trading day',
      enabled: false,
    },
    {
      model: 'Sol',
      role: 'Exceptional escalation',
      cap: '1 / trading day',
      enabled: false,
    },
  ],
  budget: [
    { label: 'Daily hard limit', value: '$0.30', hard: true },
    { label: 'Monthly soft target', value: '$6.30', hard: false },
    { label: 'Monthly hard limit', value: '$10.00', hard: true },
    { label: 'Lifetime hard limit', value: '$50.00', hard: true },
    { label: 'Soft warning', value: '70%', hard: false },
    { label: 'Critical warning', value: '90%', hard: false },
  ],
  flags: [
    { name: 'Agent runtime', enabled: false, detail: 'AGENT_ENABLED=false' },
    {
      name: 'Live-paper execution',
      enabled: false,
      detail: 'Shadow proposals only',
    },
    { name: 'Sol escalation', enabled: false, detail: 'SOL_ENABLED=false' },
    {
      name: 'Controlled web research',
      enabled: false,
      detail: 'OPENAI_WEB_SEARCH_ENABLED=false',
    },
    {
      name: 'Complex asset classes',
      enabled: false,
      detail: 'Non-tradable placeholders',
    },
  ],
  prompts: [
    {
      role: 'Luna',
      version: 'luna-3',
      status: 'Active mock',
      updated: 'Jul 31, 2026',
    },
    {
      role: 'Terra',
      version: 'terra-5',
      status: 'Active mock',
      updated: 'Aug 1, 2026',
    },
    {
      role: 'Sol',
      version: 'sol-2',
      status: 'Disabled',
      updated: 'Jul 18, 2026',
    },
  ],
}
