---
phase: 83-token-reconciliation-layer
plan: 02
subsystem: infra
tags: [llm-proxy, token-usage, sqlite, openai-cache, prompt-cache, migration, tdd]

# Dependency graph
requires:
  - phase: 83-01
    provides: "safeSanitizeTaskId + tap ambient-span guard (deployed together in this plan's single build+kickstart)"
  - phase: 82-wire-measurement-foundation
    provides: "token_usage cache columns, parseUsageCache Anthropic tap helper, dedup-merge semantics, adapter user_hash convention"
provides:
  - "parseOpenAICache pure helper (OpenAI-wire cache split) wired into the 3 shim/copilot completion parse sites + shim logTokenCall"
  - "partial UNIQUE request-id index (idx_token_usage_reqid) + coordinated DB-authoritative id allocation with retry — eliminates tap-vs-adapter id collisions"
  - "combined Phase-83 proxy edits (Plan 01 + Plan 02) live on port 12435"
affects: [83-03, reconcile-matcher, measurement-stop, token-attribution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OpenAI-wire cache parse mirrors the Anthropic parseUsageCache pure/never-throw/coalesce-to-0 contract"
    - "PRAGMA-guarded (table_info + index_list) idempotent non-fatal SQLite migration with one-shot best-effort dup repair"
    - "probe-based disambiguation of composite-PK collision vs request-id dedup (both surface as SQLITE_CONSTRAINT_UNIQUE)"

key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/openai-cache-parse.test.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-dupid-constraint.test.mjs
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs

key-decisions:
  - "D-11 mechanics: partial UNIQUE index on (user_hash, tool_call_id) WHERE tool_call_id != '' for genuine dedup + coordinated per-user_hash MAX(id)+1 allocation with retry for distinct-row survival (chose both over widening the PK)"
  - "Disambiguate id-collision (retry) from request-id duplicate (drop) by SELECT probe, NOT error code — SQLite reports composite-PK conflicts as SQLITE_CONSTRAINT_UNIQUE, identical to the partial index"
  - "OpenAI cache_write_tokens is always 0 (OpenAI exposes no cache-write counter); only cached_tokens → cache_read_tokens"

patterns-established:
  - "Empty tool_call_id is never an identity — never deduped (many unrelated background rows share '')"
  - "One-shot dup repair keeps the earliest rowid (the wire row the reconcile matcher deterministically prefers)"

requirements-completed: [D-09, D-11]

# Metrics
duration: 45min
completed: 2026-07-06
---

# Phase 83 Plan 02: Proxy Reconciliation Prerequisites Summary

**OpenAI-wire cache parsing on the shim/copilot path (D-09) plus a request-id dedup index + coordinated id allocation that ends tap-vs-adapter id collisions (D-11) — combined Plan 01+02 proxy edits built and live-verified on port 12435.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-06
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified) in the external rapid-llm-proxy repo

## Accomplishments
- **D-09 (IN-05):** `parseOpenAICache(usage)` added to `src/usage-cache.ts` (pure, never-throws, coalesces to 0), maps `usage.prompt_tokens_details.cached_tokens → cache_read_tokens` (`cache_write_tokens` always 0). Wired into the three shim/copilot completion parse sites (`readCopilotStream`, `completeCopilot`, `completeOpenAICompatible`) and threaded through the shim `logTokenCall`, so copilot/opencode wire rows now carry the real cache split instead of dropping it. Live-confirmed: a fresh `cladpt` tap row shows `cache_read_tokens=53052`.
- **D-11:** partial UNIQUE index `idx_token_usage_reqid` on `(user_hash, tool_call_id) WHERE tool_call_id != ''` (idempotent, PRAGMA-guarded, non-fatal, with a one-shot best-effort repair that collapsed 206 pre-existing duplicate rows) + coordinated DB-authoritative per-`user_hash` id allocation with retry-on-conflict in `logCall`. Concurrent tap-writer + adapter-writer INSERTs to the same `user_hash` no longer collide/drop.
- **Deploy:** single `npm run build` + `launchctl kickstart` activated Plan 01 + Plan 02 edits. Coordinator confirmed `network.location=open` before each kickstart. Smoke `POST /api/complete` returns a proper `{content, provider, model, tokens}` shape (copilot + claude-code rows both landed); `PRAGMA integrity_check=ok`; zero remaining non-empty-request-id duplicate groups; zero `logCall` id-collision failures in the daemon log post-fix.

## Task Commits

All code commits are in the external repo `/Users/Q284340/Agentic/_work/rapid-llm-proxy` (branch `main`):

1. **Task 1: OpenAI cache parse (D-09)** — `8ff4b41` (test, RED) → `634f23b` (feat, GREEN)
2. **Task 2: duplicate-id constraint (D-11)** — `be925ae` (test, RED) → `530351e` (feat, GREEN) → `7a01346` (fix, Rule 1)
3. **Task 3: build + deploy + smoke** — no code commit (dist rebuilt from committed source; live-verified on port 12435)

SUMMARY committed separately in the coding-repo worktree.

## Files Created/Modified
- `src/usage-cache.ts` — `parseOpenAICache` pure helper + `OpenAIUsageCache` interface
- `src/token-usage.ts` — D-11 request-id dedup index migration + repair; `logCall` coordinated id allocation with probe-based retry
- `proxy-bridge/server.mjs` — `parseOpenAICache` import + 3 parse sites (`...parseOpenAICache(usage)`) + shim `logTokenCall` cache threading
- `tests/integration/openai-cache-parse.test.mjs` — 4 pure-helper cache cases
- `tests/integration/token-usage-dupid-constraint.test.mjs` — migration idempotency + forced PK-collision retry + genuine-dedup

## Decisions Made
- Chose "both mechanisms" for D-11 (index for dedup + coordinated allocation for distinct-row survival) rather than widening the PK to include `tool_call_id`, because many rows carry `tool_call_id=''` and would collapse into one bucket.
- Kept `cache_write_tokens=0` for OpenAI (no cache-write counter on the OpenAI wire).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Composite-PK collision misclassified as request-id dedup → distinct rows dropped**
- **Found during:** Task 3 (live deploy smoke — the daemon log flooded with `logCall failed (non-fatal): UNIQUE constraint failed: token_usage.user_hash, token_usage.id`)
- **Issue:** SQLite reports a composite-PRIMARY-KEY conflict with the SAME error code (`SQLITE_CONSTRAINT_UNIQUE`) as a partial-unique-index conflict. The first D-11 implementation branched on the error code alone, so every id-collision was mistaken for a genuine request-id duplicate and the distinct `cladpt`/`copadt` tap row was silently dropped instead of retried.
- **Fix:** Disambiguate by SELECT probe, not error code — dedup genuine `(user_hash, tool_call_id)` duplicates up front, and on ANY constraint failure re-probe the request-id: a true duplicate is dropped, otherwise it's an id collision that recomputes `MAX(id)+1` and retries. Strengthened Test 2 to force an ACTUAL PK id-collision (stale machine counter) so this path is a real regression guard.
- **Files modified:** `src/token-usage.ts`, `tests/integration/token-usage-dupid-constraint.test.mjs`
- **Verification:** Rebuilt + redeployed; 19/19 tests pass (1 LIVE-gated skip); zero `logCall` id-collision failures in the daemon log since the fixed restart; `integrity_check=ok`.
- **Committed in:** `7a01346`

---

**Total deviations:** 1 auto-fixed (1 bug). Caught by the plan's own live-deploy verification step (Task 3), which is why the smoke-and-log check was load-bearing.
**Impact on plan:** No scope creep — the fix is squarely within D-11's stated goal ("concurrent tap+adapter writes … can no longer collide on id, or a collision no longer throws").

## Issues Encountered
- The pre-fix broken build (PID 55655) was live for a few minutes and dropped some colliding wire-tap rows during that window. Impact is bounded: the coding-side transcript adapter independently writes the same foreground rows (the reconcile design keeps both wire + transcript), so no foreground turn is lost — only redundant wire duplicates that the dedup index would drop anyway. Resolved by the `7a01346` redeploy.

## Threat Flags
None — edits stay within the plan's `<threat_model>` surface (untrusted upstream `usage` handled by the pure/never-throw parser; concurrent-writer id allocation is the mitigated boundary). No new endpoints, auth paths, or schema at trust boundaries beyond the declared migration.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Wire rows now carry real copilot/opencode cache splits (D-09) and `token_usage` row identity is collision-free (D-11) — both prerequisites the Plan 03 reconcile matcher relies on (joins on `tool_call_id`, reads per-field cache/reasoning deltas).
- The combined Plan 01 + Plan 02 proxy edits are live on port 12435 and verified.

## Self-Check: PASSED

---
*Phase: 83-token-reconciliation-layer*
*Completed: 2026-07-06*
