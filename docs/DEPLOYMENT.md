# Deployment

1. Run all local quality gates and review `docs/KNOWN_LIMITATIONS.md`.
2. Create a Supabase project and apply committed migrations; never edit the dashboard as the schema source of truth.
3. Configure the public URL/publishable key pair in Vercel. Add a secret key only when a reviewed server-side adapter needs it; never expose it through a `NEXT_PUBLIC_` variable.
4. Bootstrap and verify the single owner; test a second authenticated user is denied.
5. Configure Alpaca data credentials only if live data is desired. Verify requests use the data origin and run the safety scan.
6. Keep remote scheduling disabled until the durable database cycle passes runtime review. Then choose exactly one scheduler. Vercel's 15-minute schedule requires a plan that supports frequent cron; Hobby is daily-only. Supabase Cron is the fallback.
7. Keep the agent disabled through database/security/reconciliation review. Enable shadow mode before any live-paper simulation.

Required initial hosted configuration: Supabase URL and publishable key plus an explicitly provisioned owner identity. A random 16+ character cron secret becomes required only when a remote scheduler is deliberately enabled. Supabase secret, OpenAI, and Alpaca data keys remain optional until reviewed server-side features that need them are deliberately enabled.
