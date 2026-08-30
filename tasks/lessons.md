# Lessons

- A branch credential gate must enumerate ancestors of an exact verified HEAD,
  never `--all`; otherwise stale or divergent local refs make identical PR
  commits produce environment-dependent evidence.
- A disposable Supabase workdir must copy every repository pgTAP filename
  accepted by the test runner, including descriptive non-numbered SQL files;
  exercise the real closure and emit CI evidence even when workdir creation
  fails before `supabase start`.
- A suppressed infrastructure log is not actionable evidence. Buffer it only in bounded process memory, classify against a fixed diagnostic enum, persist only allowlisted fields, and test the entire serialized evidence path with synthetic secrets.
- Independent schema Goldens need a runnable bootstrap closure, not just a capture script: exact clean HEAD, frozen migration bytes, pinned CLI and exact official image, fresh isolated clusters, double-build byte reproducibility, row-free artifacts, and verify-only normal CI.

- A deployment control-plane proof establishes identity only; runtime flags must be observed once from the immutable deployment URL and must never be derived from a requested role or echoed client claims.
- A schema golden is independent evidence only when generated from a fresh seed-free reference cluster. Never derive or refresh it from the source being backed up, the restore target, or Hosted production.
- A restore-isolation proof must bind distinct server system identifiers plus a run-specific container, database role, random disposable marker, and exact cleanup scope; two databases or aliases on one cluster are not isolation.
- Auth recovery is incomplete until synthetic users preserve UUID/identity closure, a new login succeeds, and an owner/deny-user Data API test proves RLS after restore.
- Local infrastructure commands may print ephemeral credentials. Suppress both streams and emit only fixed safe status; redaction tests must cover encoded URLs, JWTs, provider token shapes, headers, cookies, and passwords.
- When a OneDrive cleanup runs long enough to look interrupted, keep the user informed, resume from the exact verified state, and split further cleanup into bounded operations instead of restarting completed work.
- Treat owner attestation that a credential was rotated separately from verification that every intended server-side consumer uses the new credential generation. Record the former as `owner_attested`, keep the latter `pending` until names and scopes are proven without viewing secret values, and never request or expose credential values, prefixes, fragments, or hashes as evidence.
- Never model a Vercel environment-variable transition by mutating one deployment fixture in place. Each environment snapshot is immutable per deployment; bind distinct reviewed deployment IDs append-only and force every later request/response check to use the phase-specific binding.
- A handoff checksum claim is only evidence when a deterministic generator derives the complete path set from the real merge base, hashes canonical checkout bytes, and a CI verifier rejects stale, missing, extra, duplicate, or case-drifted entries.
- Any repository contract derived from text files must hash canonical Git UTF-8/LF bytes, not platform-specific checkout line endings. External evidence artifacts remain exact raw-byte contracts; internal SQL/JSON/script identities normalize only line endings and reject binary or invalid UTF-8 input.
- Immutable mutation evidence needs an explicit expected-versus-forbidden classification. Recording reviewed control-plane mutations in the same evidence relation is safe only when terminal decisions count the forbidden class and tests prove no forbidden row can be reclassified.
- A reviewed Production alias is an identity check, not the immutable Runtime transport target. After the Runtime deployment is bound, every dry-run Bearer request must use that binding's exact immutable deployment URL while independently rechecking that Vault still contains the reviewed alias.
- A sensitive external path check is not durable across a long export or restore. Re-canonicalize the directory and every artifact, then re-hash retained bytes after their final use; if the path changed, fail without recursively deleting an unverified target.
- Windows test fixtures must canonicalize freshly created temp roots before exercising a contract that deliberately rejects 8.3 names, case aliases, junctions, and symlinks. Fix the fixture path; never relax the production containment check to accept an alias.
- A Windows CI allowlist is only complete when it covers every executable wrapper reachable from package scripts, not just newly added activation helpers. Scan package entrypoints for legacy `shell: true` paths and exercise them with injected native-process fixtures.
- Before authorizing a new CLI argument in an exact-file task, trace it through the caller, parser, canonicalizer, and final spawn reconstruction, and include every required wrapper and test file in the allowlist before execution.
- Before freezing an exact-file allowlist for a changed invariant, search its old and new values repository-wide and trace every runner, validator, and success fixture that consumes it; include all necessary dependent files before execution.
- When repository text intentionally preserves checkout bytes, canonicalize only the assertion view for multiline semantic checks and keep a separate test proving that execution still receives the raw bytes.
- When a local CLI stack starts on an explicit Docker network, audit every later CLI subcommand that launches sibling containers and pass the same verified network identity explicitly.
- Before using a pgTAP pattern assertion, verify the exact framework API: use alike() for SQL LIKE patterns and matches() for regular expressions; do not infer aliases such as like().
- For a fully buffered failure gate, keep raw child output suppressed and pass the original failed child's stdout only to an exact allowlisted structured-diagnostic parser; never derive diagnostics from a gate-adjusted failure or let identity rejection lose priority.
- A fault-injection fixture must respect permanent singleton and uniqueness invariants; when the prohibited state is the condition under test, assert its rejection instead of weakening schema constraints or seeding an impossible second owner.
- Emit an exact revalidated structured primary diagnostic before entering cleanup that can throw; a `finally` failure must remain fail-closed without erasing the already safe root-cause evidence.
