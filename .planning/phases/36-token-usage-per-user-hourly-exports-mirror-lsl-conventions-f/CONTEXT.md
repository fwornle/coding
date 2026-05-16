# Phase 36 — Context for planning

Pre-planning notes captured 2026-05-16 from the conversation that
triggered phase creation. Goal: don't make `/gsd:plan-phase 36` repeat
codebase discovery I already did.

## Problem statement

Token-usage data is persisted to a per-project SQLite DB and snapshotted
to a single monolithic JSON for git-share. That snapshot will balloon
and cause merge conflicts as more users push exports. We want the
same pattern LSL already uses: one file per user per hour-window,
organized under `YYYY/MM/`, recursively merged on read.

## Verified facts

- `.data/llm-proxy/token-usage.db` IS gitignored (via `*.db` at
  `.gitignore:180`). User's "DB still dirty" report was because
  `.db-wal` (4.1 MB today) and `.db-shm` are NOT covered — they show
  up as `?? .data/llm-proxy/` in `git status`.
- Current monolithic export: `.data/llm-proxy-export/token-usage.json`
  — 637 KB, 20 400 lines, 1 457 rows after ~24 h, contributor `c197ef`
  only. Append-only with a safety-merge on write.
- Writer: `_work/rapid-llm-proxy/src/token-usage.ts`
  - `resolveTokenExportPath` → single file path
  - `exportToJson` → debounced 2 s after every `logCall`, full table
    snapshot with id-set safety merge
  - `restoreFromJsonIfEmpty` → cold-start hydration, only when DB is
    empty, reads exactly one file
- Dashboard reads from the proxy (`http://localhost:12435/api/token-usage/{summary,recent}`),
  not from JSON. Proxy's local DB is authoritative.
- Health coordinator at `/health/state` does NOT publish the LSL
  time-window today. Statusline (`scripts/combined-status-line.js`)
  and LSL filename generation (`scripts/timezone-utils.js`) both call
  `getTimeWindow(localDate)` directly. Canonical computation lives in
  `scripts/timezone-utils.js:79`. Config-driven session_duration
  (default 60 min) from `config/live-logging-config.json`.
- User hash: `scripts/user-hash-generator.js` — SHA-256 of `$USER`
  with salt `lsl-user-hash`, 6 char. Current user → `c197ef`.

## LSL contract to mirror

- Dir: `<baseDir>/YYYY/MM/<filename>` (`scripts/lsl-paths.js`)
- Filename: `YYYY-MM-DD_HHMM-HHMM[-N]_<hash6>.md`
- Reader: `lslListAll(baseDir, predicate)` recursive walk
- Window source-of-truth: `scripts/timezone-utils.js:getTimeWindow()`
  Honors `config/live-logging-config.json` `session_duration`.

For Phase 36 we adopt the same names + dir layout but with `.json`,
drop the `_from-<project>` redirect aspect (each proxy owns its own
`.data/`), and source the window from the coordinator (which the
coordinator will need to start publishing in Wave 1).

## Approved design decisions (from user 2026-05-16)

- **Identity / dedup**: option (c) — add `user_hash TEXT` column to
  `token_usage`, keep integer `id`, dedup on `UNIQUE (user_hash, id)`.
  Existing dashboard SQL keeps working; cross-user hydration safe.
- **Hash propagation**: (revised after pattern-mapping) — the proxy is
  launched by **launchd** (`com.coding.llm-cli-proxy`), not by
  `bin/coding`. Compute the hash in
  `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` (the existing
  wrapper invoked by launchd) by shelling out to
  `scripts/user-hash-generator.js` (path resolved relative to the
  coding repo root), then `export LLM_PROXY_USER_HASH=<hash>` before
  `exec node …`. Works for launchd, `bin/coding`, and direct
  invocation. Proxy still does not depend on coding-side modules at
  runtime — only the wrapper does, and only at startup.
- **Hydrate semantics**: `hydrateFromExports()` runs on **every**
  proxy init, not just when DB is empty (replaces the
  `restoreFromJsonIfEmpty` `count > 0` early-exit). Idempotency
  guaranteed by `UNIQUE INDEX (user_hash, id)` + `INSERT … ON
  CONFLICT(user_hash, id) DO NOTHING`. This is the only way
  cross-user merge works after `git pull`.
- **Time-window source**: coordinator publishes
  `state.lsl.current_window` at `/health/state`; proxy reads it on
  write with local fallback (= recompute via the same formula if the
  coordinator is unreachable on cold boot). Statusline + dashboard
  can later switch to the coordinator's value to dedupe sources.
- **Retention/rotation**: out of scope for v1. Revisit after 90 days
  of real-world data. 24 files/day × 365 × ~30 KB ≈ 260 MB/year
  worst case — git-pack handles it.
- **Dashboard cross-project merge**: out of scope. Single proxy stays
  authoritative for its `.data/llm-proxy-export/` tree. The
  `LLM_PROXY_EXTRA_EXPORT_DIRS` env hook is a future hint, not a v1
  requirement.

## Proposed waves

**Wave 1 — Coordinator publishes the window** (foundation; no proxy
changes yet)
- `scripts/health-coordinator.js`: import `getTimeWindow` from
  `scripts/timezone-utils.js`, populate
  `currentState.lsl.current_window` on every poll tick.
- Schema doc + smoke test: `curl /health/state | jq .lsl.current_window`
  returns `HHMM-HHMM`.

**Wave 2 — Proxy writer rewrite** (rapid-llm-proxy submodule)
- New `resolveTokenExportDir()` returns base.
- New `exportToHourFile(now)`:
  - Pull `current_window` from coordinator with timeout, else compute
    locally from `now` (same formula, no config read on hot path).
  - Pull user hash from `LLM_PROXY_USER_HASH`, default `unknown`.
  - SELECT rows in `[windowStart, windowEnd)`, write to
    `<baseDir>/YYYY/MM/YYYY-MM-DD_HHMM-HHMM_<hash>.json`.
- Debounce still 2 s but keyed per-window. Hour-boundary flush.

**Wave 3 — Schema migration + multi-file hydration** (proxy)
- `ALTER TABLE token_usage ADD COLUMN user_hash TEXT NOT NULL DEFAULT 'unknown'`.
- `CREATE UNIQUE INDEX idx_token_usage_user_id ON token_usage(user_hash, id)`.
- Replace `restoreFromJsonIfEmpty` with `hydrateFromExports()` that
  always runs on init, walks `<baseDir>/**/*.json`, does
  `INSERT … ON CONFLICT(user_hash, id) DO NOTHING`. Tag each row's
  `user_hash` from the filename suffix.

**Wave 4 — Hash env propagation** (wrapper script — see revised
"Hash propagation" decision above)
- `_work/rapid-llm-proxy/bin/start-llm-proxy.sh`: before
  `exec node …`, compute `LLM_PROXY_USER_HASH=$(node
  "${CODING_REPO}/scripts/user-hash-generator.js")` and export it.
  Wrapper resolves `${CODING_REPO}` either from an env var the
  launchd plist already sets or by walking up from `$0` until it
  finds a sibling `coding/` directory.
- No change to `bin/coding`. Launchd-started proxies, manual launches
  from `bin/coding`, and direct `start-llm-proxy.sh` invocations all
  go through the same wrapper.

**Wave 5 — Gitignore + monolithic-file migration** (coding)
- `.gitignore`: add `.data/llm-proxy/*.db-wal`, `*.db-shm` (or
  broaden `*.db` → `*.db*`). One-line fix lands FIRST.
- One-shot migration script that:
  1. Reads existing `.data/llm-proxy-export/token-usage.json`.
  2. Buckets rows by `(getTimeWindow(timestamp), 'c197ef')`.
  3. Writes per-window files under the new layout.
  4. Deletes the old monolithic file in the same commit.

## Files in play

| File | Change |
|---|---|
| `scripts/health-coordinator.js` | Publish `lsl.current_window` (Wave 1) |
| `_work/rapid-llm-proxy/src/token-usage.ts` | Writer + reader rewrite, schema migration (Waves 2, 3); always-hydrate semantics |
| `_work/rapid-llm-proxy/proxy-bridge/server.mjs` | Wire coordinator URL env (Wave 2) |
| `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` | Compute + export `LLM_PROXY_USER_HASH` before exec (Wave 4) |
| `.gitignore` | WAL/SHM coverage (Wave 5) |
| `scripts/migrate-token-usage-export.mjs` (new) | One-shot bucketing (Wave 5) |
| `.data/llm-proxy-export/token-usage.json` | Removed in migration commit (Wave 5) |

## Out of scope (deferred / explicit non-goals)

- Retention/rotation of old per-hour files.
- Dashboard reading from multiple proxies / `.data/` dirs.
- Switching statusline / dashboard to coordinator-published window
  (we add the field; consumers stay on local computation in v1).
- Backfilling `user_hash='c197ef'` on legacy rows is automatic via
  the migration script's bucketing; no separate UPDATE pass needed.
