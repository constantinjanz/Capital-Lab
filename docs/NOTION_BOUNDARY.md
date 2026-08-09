# Notion boundary

Notion may later hold the Research Deck, strategy documents, hypotheses, source lists, and weekly human reviews. It is not a Capital Lab runtime dependency and must never be the market database, runtime memory, order/fill source, budget guard, idempotency store, scheduler, sole decision record, ledger, or ledger backup.

The official Notion MCP is an interactive OAuth connection scoped to the signed-in user. It must not be assumed to exist in Vercel or to provide server automation credentials. This audit does not connect Notion.

The only approved future flow is:

`Notion/Research Deck -> reviewed versioned export -> Git or Supabase Storage -> approved immutable snapshot -> agent`

The agent may consume only an explicitly approved versioned snapshot. Raw or mutable Notion pages never enter a decision context directly.
