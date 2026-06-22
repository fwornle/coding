---
phase: 68-foundational-token-attribution-storage
plan: 03
subsystem: rapid-llm-proxy write path + coding backfill sweep
tags: [telemetry, token-attribution, write-path, backfill, TELEM-03, checkpoint-paused]
status: paused-at-checkpoint
requires:
  - "Plan 68-01 token_usage attribution columns (task_id TEXT NOT NULL DEFAULT '')"
  - "Plan 68-02 getActiveMeasurement single reader + start/stop lifecycle"
provides:
  - "resolveLiveTaskId(overrideDataDir?) in measurement-span.ts — the write-path task_id resolution rule (active span → span.task_id; no span / any error → ''), best-effort, never throws"
  - "proxy-bridge/server.mjs stamps task_id on the logTokenCall row via resolveLiveTaskId (single reader, one consult/request)"
  - "scripts/backfill-task-id-by-timestamp.mjs — completed-session sweep: timestamp-joins archived spans to unattributed rows, never overwrites live values, idempotent, --dry-run + --self-test"
affects:
  - "Phases 69–70 (per-agent adapters stamp agent/tool_call_id/parent_call_id/granularity_tier/reasoning_tokens on the same row; task_id now live)"
  - "Phase 71 (km-core Run-write path sources attributed rows)"
tech-stack:
  added: []
  patterns:
    - "Single-reader resolution: resolveLiveTaskId consults getActiveMeasurement (the only active-span parser) and never re-parses; wrapped in try/catch returning '' (best-effort hot path)"
    - "ISO-8601 UTC lexical timestamp join for the backfill UPDATE (no SQL date parsing) — both row.timestamp and span started_at/ended_at are toISOString()"
    - "Overwrite guard: UPDATE … WHERE task_id = '' bounds blast radius to unattributed rows"
key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-stamping.test.mjs
    - /Users/Q284340/Agentic/coding/scripts/backfill-task-id-by-timestamp.mjs
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/index.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
decisions:
  - "resolveLiveTaskId factored into measurement-span.ts (exported + barrel-exported) rather than kept private in server.mjs — the plan's preferred option: keeps the write-path rule in ONE testable place next to the single reader it consults; the integration test imports it directly instead of replicating the logic."
  - "Live span is open (no ended_at), so the in-window rule reduces to 'span present ⇒ in-window' on the hot path; the full started_at ≤ T ≤ ended_at window check lives only in the backfill sweep against archived (ended_at-bearing) spans."
  - "Backfill defaults the data dir to LLM_PROXY_DATA_DIR (→ /Users/Q284340/Agentic/coding/.data fallback); opens the token DB readonly for --dry-run, read-write for apply; a missing .data/measurements dir is a non-fatal no-op (it does not exist until the first stopMeasurement archives a span)."
metrics:
  duration: "in progress (paused at checkpoint)"
  completed: 2026-06-22
  tasks: "2 of 3 autonomous tasks complete; Task 3 is a blocking operator checkpoint (live restarted-daemon row gate)"
  files: 5
---

# Phase 68 Plan 03: Proxy Write-Path task_id Stamping + Backfill Sweep Summary

Wired the rapid-llm-proxy token-usage write path to stamp every row with the active measurement span's `task_id` through the single `getActiveMeasurement()` reader (via a new exported `resolveLiveTaskId` rule — active span → `span.task_id`, no span / any error → `''`, best-effort and never-throwing), and added a completed-session backfill sweep that timestamp-joins archived spans to already-written unattributed rows without ever overwriting a live-stamped value. **Tasks 1 & 2 are complete and committed atomically across both repos; Task 3 (the live restarted-daemon row gate) is a BLOCKING operator checkpoint — this plan is PAUSED awaiting operator verification and may NOT be marked TELEM-03-complete until the live stamped row is confirmed.**

## What Was Built

**Task 1 — write-path stamping + resolveLiveTaskId + stamping test (rapid-llm-proxy `5aa92a2` feat, `bf17f24` test):**
- `src/measurement-span.ts`: added `resolveLiveTaskId(overrideDataDir?)` — the TELEM-03 write-path rule. Calls `getActiveMeasurement()` (the single reader, never a second `JSON.parse`); returns `span.task_id` when a span is present, `''` when null, and `''` on any thrown error (defense-in-depth try/catch — a measurement-read failure can never break token logging, T-68-03-01).
- `src/index.ts`: barrel-exported `resolveLiveTaskId` alongside the rest of the measurement-span surface.
- `proxy-bridge/server.mjs`: imported `resolveLiveTaskId` from `../dist/measurement-span.js` (the same local dist the daemon loads — single reader system-wide) and added `task_id: resolveLiveTaskId(),` to the `logTokenCall` row object inside the existing `if (_tokenDb) { … }` best-effort guard. No other row fields changed; `agent`/`tool_call_id`/`parent_call_id`/`granularity_tier`/`reasoning_tokens` stay unset (logCall defaults them — Phases 69–70 populate them).
- `tests/integration/token-stamping.test.mjs`: imports `resolveLiveTaskId` + `start/stopMeasurement` + `initTokenDb`/`logCall` from dist; isolates span + token DB under one shared tmp dataDir. Subtests: (a) active span → logged row carries `span.task_id`; (b) no span → row `task_id = ''`; (c) corrupt `active-measurement.json` → resolver returns `''` AND a row is still inserted (best-effort proven).

**Task 2 — completed-session backfill sweep (coding `ad60b02eb` feat):**
- `scripts/backfill-task-id-by-timestamp.mjs`: reads `.data/measurements/*.json` archived spans (skips unreadable/corrupt/shape-invalid with a stderr warning — never crashes; a missing measurements dir is a non-fatal no-op). For each span with valid `started_at`+`ended_at`, runs `UPDATE token_usage SET task_id = ? WHERE task_id = '' AND timestamp >= ? AND timestamp <= ?` (parameterized; ISO-8601 UTC lexical comparison is chronologically correct). Reports per-span + total `changes`. `--dry-run` swaps the UPDATE for a `SELECT COUNT(*)` (read-only handle, mutates nothing). `--self-test` runs a node:test fixture. Overwrite guard (`WHERE task_id = ''`) means a live-stamped value is never clobbered (T-68-03-02); idempotent.

## Verification Results (autonomous)

- `npm run build` (rapid-llm-proxy) — exit 0; `dist/measurement-span.js` + `dist/index.js` carry `resolveLiveTaskId`.
- `node --test tests/integration/token-stamping.test.mjs` — exit 0, 3/3 subtests pass (in-window / out-of-window / best-effort-on-read-failure).
- `node scripts/backfill-task-id-by-timestamp.mjs --self-test` — exit 0, 1/1 (attribute in-window row, idempotent second run, never clobber pre-set, dry-run mutates nothing).
- `node scripts/backfill-task-id-by-timestamp.mjs --dry-run` against the LIVE DB — exit 0, mutated nothing (row count 123186 before == after); correctly reported the not-yet-existing `.data/measurements` dir as a no-op.
- Acceptance greps:
  - `grep "getActiveMeasurement\|resolveLiveTaskId" proxy-bridge/server.mjs` → present (write path consults the single reader).
  - `grep "task_id:" proxy-bridge/server.mjs` → `task_id: resolveLiveTaskId(),` set on the row.
  - `grep -c "console\." proxy-bridge/server.mjs` → 0 (no new console.*).
  - `grep "task_id = ''" scripts/backfill-task-id-by-timestamp.mjs` → UPDATE + COUNT both gated on the empty-string default.
  - `grep -c "console\." scripts/backfill-task-id-by-timestamp.mjs` → 0.

## Live-DB schema state (evidence for the gate)

The RUNNING daemon predates Plan 68-01's migration — the live token DB does NOT yet carry `task_id`:

```
cols: id, timestamp, provider, model, process, subscription, input_tokens,
      output_tokens, total_tokens, latency_ms, prompt_preview, tokens_estimated,
      user_hash, model_raw, overhead_ms
has task_id: false
```

The 68-01 additive columns only apply to NEW `initTokenDb()` connections. Restarting `com.coding.llm-cli-proxy` runs `initTokenDb()` and migrates the live schema (adds the 6 attribution columns), after which the new write path stamps `task_id`. This is exactly what Task 3 verifies.

## CHECKPOINT REACHED — Task 3 (live restarted-daemon row gate)

**Type:** human-verify (gate="blocking")
**Plan:** 68-03
**Progress:** 2 / 3 tasks complete (both autonomous tasks done + committed)

### Completed Tasks

| Task | Name | Repo | Commit | Files |
| ---- | ---- | ---- | ------ | ----- |
| 1 | Stamp task_id via resolveLiveTaskId + stamping test | rapid-llm-proxy | `5aa92a2` (feat), `bf17f24` (test) | measurement-span.ts, index.ts, server.mjs, token-stamping.test.mjs, .d.ts.maps |
| 2 | Completed-session backfill sweep | coding | `ad60b02eb` (feat) | scripts/backfill-task-id-by-timestamp.mjs |

### Why the executor stopped here

Task 3 requires restarting the launchd-managed live proxy daemon and driving real LLM calls that mutate the live token DB. Per the plan (`autonomous: false`, `gate="blocking"`) and the execution objective, the executor does NOT restart launchd daemons or drive live provider calls — the operator owns the live restart + row verification. The proxy is already built (`npm run build` exit 0) and `dist/` carries the new export, so the daemon will pick up the stamping code on restart.

### Operator commands to run (exact)

```bash
# 1. (already done by executor) build is green — confirm if you wish:
cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && npm run build   # MUST exit 0

# 2. Restart the daemon so it loads the new dist + migrates the live schema:
launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy

# 2a. Confirm the live schema migrated (task_id now present):
sqlite3 /Users/Q284340/Agentic/coding/.data/llm-proxy/token-usage.db "PRAGMA table_info(token_usage);" | grep task_id

# 2b. Confirm the proxy is up on the RIGHT port (12435 — NOT 3033):
curl -s -X POST http://localhost:12435/api/complete -H 'Content-Type: application/json' \
  -d '{"process":"telem-smoke","messages":[{"role":"user","content":"reply with the single word OK"}]}'
#   → expect JSON { content, provider, model, ... }  (NOT "Cannot POST" — that means wrong port)

# 3. Start a measurement span:
node /Users/Q284340/Agentic/coding/scripts/measurement-start.mjs --task-id telem-live-68
#   → .data/active-measurement.json with task_id=telem-live-68

# 4. Trigger one real LLM call THROUGH the proxy (repeat the curl from 2b).

# 5. Read back the newest row — task_id MUST equal telem-live-68:
sqlite3 /Users/Q284340/Agentic/coding/.data/llm-proxy/token-usage.db \
  "SELECT id, timestamp, process, task_id FROM token_usage ORDER BY id DESC LIMIT 3;"

# 6. Stop the span:
node /Users/Q284340/Agentic/coding/scripts/measurement-stop.mjs
#   → .data/measurements/telem-live-68.json with ended_at; active-measurement.json gone

# 7. Trigger one MORE LLM call (no active span) and re-query — newest task_id MUST be '' (empty):
sqlite3 /Users/Q284340/Agentic/coding/.data/llm-proxy/token-usage.db \
  "SELECT id, timestamp, process, task_id FROM token_usage ORDER BY id DESC LIMIT 3;"

# 8. (optional) Confirm the backfill would attribute step-7's unattributed rows to the archived span:
node /Users/Q284340/Agentic/coding/scripts/backfill-task-id-by-timestamp.mjs --dry-run
```

### Evidence required back

1. The step-5 sqlite3 output showing the newest row's `task_id = telem-live-68` (with an active span).
2. The step-7 sqlite3 output showing the newest row's `task_id = ''` (no active span).
3. Confirmation `launchctl kickstart` succeeded and `.data/measurements/telem-live-68.json` was written with `ended_at`.

### Resume signal

Type **"approved"** (paste the two sqlite3 outputs) once the live stamped row (`task_id=telem-live-68`) and the empty-task_id row are both confirmed, or describe what failed.

## Threat Model Disposition

- **T-68-03-01 (DoS / resolveActiveTaskId in hot path):** mitigated — `resolveLiveTaskId` wraps `getActiveMeasurement` (itself null-safe, Plan 68-02) in try/catch returning `''`; the stamping test's subtest (c) proves a corrupt span yields `''` and the row is still logged.
- **T-68-03-02 (Tampering / backfill UPDATE):** mitigated — parameterized better-sqlite3 placeholders, gated on `task_id = ''` (never clobbers a live value), `--dry-run` issues no writes. Self-test proves the never-overwrite property.
- **T-68-03-03 (Repudiation / attribution correctness):** accepted — timestamp-join is heuristic; single-operator sequential spans make overlap unlikely; overwrite-guard bounds blast radius. Documented.
- **T-68-03-SC (npm installs):** accepted — no new packages (better-sqlite3 + node builtins only). No package-legitimacy checkpoint.

## Deviations from Plan

None — both autonomous tasks executed as written. The plan's preferred factoring (export `resolveLiveTaskId` from measurement-span.ts so the test imports it rather than replicating the rule) was taken. Tracked `.d.ts.map` artifacts committed alongside source per the 68-01/68-02 repo convention.

## Cross-Repo Commits

**rapid-llm-proxy (branch main):**
- `5aa92a2` feat(68-03): stamp task_id on proxy write path via resolveLiveTaskId (TELEM-03)
- `bf17f24` test(68-03): prove write-path task_id stamping (in-window/out-of-window/best-effort)

**coding (branch main):**
- `ad60b02eb` feat(68-03): completed-session backfill sweep (timestamp-join archived spans -> task_id)

## Self-Check: PASSED

- FOUND: `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-stamping.test.mjs`
- FOUND: `/Users/Q284340/Agentic/coding/scripts/backfill-task-id-by-timestamp.mjs`
- FOUND: `.planning/phases/68-foundational-token-attribution-storage/68-03-SUMMARY.md`
- FOUND commits (rapid-llm-proxy): `5aa92a2`, `bf17f24`
- FOUND commit (coding): `ad60b02eb`

(Plan PAUSED at the Task 3 operator checkpoint; STATE/ROADMAP keep Plan 68-03 OPEN — they advance only after the live gate is approved.)
