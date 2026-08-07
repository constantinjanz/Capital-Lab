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

Starting an experiment validates providers, calendar, simulator/risk/budget configuration, snapshots every version, creates starting ledger/snapshot events, locks mutable rules, and writes an audit event. An active experiment cannot be reset or edited in place; clone into a new ID.

Once locked, an active shadow experiment may be promoted only to `live_paper` simulation. Promotion requires the exact confirmation phrase, the exact locked version, and the current control revision. It does not enable the scheduler, agent, a broker, or any order-forwarding path. An owner pause disables runtime controls and pauses the simulation account while preserving the locked version and execution mode. Resume is available only from a manual, non-emergency pause with runtime controls still disabled. Completion requires every simulated order to be terminal and closes only the simulation account. Clone copies the locked paper-capital/objective configuration into a separate disabled draft with source provenance; it never copies lifecycle state, a lock, orders, fills, positions, ledger entries, or runtime enablement.

Every locked lifecycle mutation is owner-authorized, revision-checked, idempotent by operation UUID, and recorded as immutable status/audit evidence. A stale page must be reloaded. An unknown network result must be retried with the same operation UUID. Draft-to-replay/shadow start remains unavailable until the complete reviewed runtime manifest can be locked atomically.

The model may propose direction, thesis, horizon, confidence, bounded target exposure intent, and invalidation conditions. Deterministic code calculates quantity, stops, fees, buying power, margin, and all risk checks. HOLD and ABSTAIN are always valid. A model never writes a fill or ledger entry.

Options, futures, crypto, FX speculation, and other complex products are non-tradable placeholders until their mechanics are explicitly implemented and tested.
