# Security

> **PAPER TRADING ONLY. No brokerage account, order forwarding, or real-trade credential is supported.**

Supabase email/password auth allows one permanent owner. `OWNER_EMAIL` gates the temporary registration action, while the same expected address is stored separately in an RLS-protected private singleton. The authenticated bootstrap function derives identity from `auth.uid()`, requires a confirmed matching email, serializes competing requests with a transaction advisory lock, and inserts the only possible `app_users` row. Client metadata and submitted owner flags are never trusted. Disable `OWNER_BOOTSTRAP_ENABLED` after provisioning and separately disable new-user signups in the hosted Supabase Auth settings; the application flag cannot close the project-level Auth endpoint. `proxy.ts` refreshes signed sessions, while every Server Action and Route Handler independently authorizes its caller.

Every exposed table has RLS and explicit grants. Policies include ownership; authenticated alone is insufficient. UPDATE policies have both `USING` and `WITH CHECK`. Privileged security-definer functions live in a private schema with fixed search paths and revoked PUBLIC execute privileges. Views are security-invoker.

Hosted experiment writes use narrow public security-invoker RPCs backed by private security-definer implementations. The draft metadata update derives ownership from `auth.uid()`, locks rows in a consistent order, requires an exact expected revision, accepts only name and objective, and records redacted audit metadata plus a durable idempotency result. Authenticated clients retain no direct experiment-table mutation privilege.

Secrets stay server-side and are filtered from structured logs. Health checks reveal status, not secret values. Manual agent/cycle endpoints are owner-only and rate-limited. External content is sanitized and delimited as untrusted data.

Run `pnpm test:safety` to scan for forbidden brokerage hosts, endpoints, SDKs, and credential names. Treat a failure as a release blocker.
