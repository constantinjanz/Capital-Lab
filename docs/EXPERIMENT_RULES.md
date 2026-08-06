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

The model may propose direction, thesis, horizon, confidence, bounded target exposure intent, and invalidation conditions. Deterministic code calculates quantity, stops, fees, buying power, margin, and all risk checks. HOLD and ABSTAIN are always valid. A model never writes a fill or ledger entry.

Options, futures, crypto, FX speculation, and other complex products are non-tradable placeholders until their mechanics are explicitly implemented and tested.
