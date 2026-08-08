# Experiment rules

> **PAPER TRADING ONLY. Capital Lab never places real trades.**

Seed defaults are transparent and versioned:

- initial capital: EUR 100,000
- universe: configured liquid US-listed equities and ETFs
- session: regular US hours only
- long and short paper positions enabled
- maximum gross leverage: 2.0× NAV
- maximum absolute single-name exposure: 25% NAV
- maximum new risk allocation per trade: 5% NAV
- stale quote threshold: 5 minutes during regular hours
- auto-pause: 20% single-session loss or 50% peak-to-trough drawdown
- auto-pause: insolvency, unresolvable buying power, corrupted ledger, or monthly/lifetime AI budget exhaustion

Hosted draft start accepts only `replay` or `shadow` with the exact `START REPLAY` or `START SHADOW` confirmation and current draft/control revisions. One atomic owner-only operation locks the reviewed five-symbol market universe, fixed 2026 XNAS/ARCX calendar, conservative paper simulator, long-only risk rules, disabled model routing, runtime-off data sources, disabled Luna prompt, empty corpus, and bounded USD AI budget. It creates one immutable experiment version, one paper simulation account, one exact EUR opening-cash ledger entry, and one zero-exposure portfolio snapshot. It does not fetch provider data, call a model, enable a scheduler or agent, create an order or fill, or add any broker capability.

An active experiment cannot be reset or edited in place; clone into a new ID. The locked hosted start risk contract permits long paper positions only, caps gross leverage at 2.0x NAV, caps single-name exposure at 25% NAV, caps new risk at 5% NAV, and retains the 20% daily-loss and 50% drawdown pause thresholds.

Once locked, an active shadow experiment may be promoted only to `live_paper` simulation. Promotion requires the exact confirmation phrase, the exact locked version, and the current control revision. It does not enable the scheduler, agent, a broker, or any order-forwarding path. An owner pause disables runtime controls and pauses the simulation account while preserving the locked version and execution mode. Resume is available only from a manual, non-emergency pause with runtime controls still disabled. Completion requires every simulated order to be terminal and closes only the simulation account. Clone copies the locked paper-capital/objective configuration into a separate disabled draft with source provenance; it never copies lifecycle state, a lock, orders, fills, positions, ledger entries, or runtime enablement.

Every start and locked lifecycle mutation is owner-authorized, revision-checked, idempotent by operation UUID, and recorded as immutable status/audit evidence. A stale page must be reloaded. An unknown network result must be retried with the same operation UUID. Starting only initializes disabled-runtime paper evidence; launching a replay cycle, shadow proposal cycle, remote scheduler, model call, or simulated order remains a separate reviewed action.

The model may propose direction, thesis, horizon, confidence, bounded target exposure intent, and invalidation conditions. Deterministic code calculates quantity, stops, fees, buying power, margin, and all risk checks. HOLD and ABSTAIN are always valid. A model never writes a fill or ledger entry.

Options, futures, crypto, FX speculation, and other complex products are non-tradable placeholders until their mechanics are explicitly implemented and tested.
