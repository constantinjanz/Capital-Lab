# Security

> **PAPER TRADING ONLY. No brokerage account, order forwarding, or real-trade credential is supported.**

Supabase email/password auth allows one owner. `OWNER_EMAIL` is a bootstrap allowlist only; authorization state lives in the server-controlled `app_users` table. Client metadata and submitted owner flags are never trusted. `proxy.ts` refreshes signed sessions, while every Server Action and Route Handler independently authorizes its caller.

Every exposed table has RLS and explicit grants. Policies include ownership; authenticated alone is insufficient. UPDATE policies have both `USING` and `WITH CHECK`. Privileged security-definer functions live in a private schema with fixed search paths and revoked PUBLIC execute privileges. Views are security-invoker.

Secrets stay server-side and are filtered from structured logs. Health checks reveal status, not secret values. Manual agent/cycle endpoints are owner-only and rate-limited. External content is sanitized and delimited as untrusted data.

Run `pnpm test:safety` to scan for forbidden brokerage hosts, endpoints, SDKs, and credential names. Treat a failure as a release blocker.
