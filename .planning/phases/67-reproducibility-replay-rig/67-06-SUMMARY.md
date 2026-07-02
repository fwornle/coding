---
phase: 67-reproducibility-replay-rig
plan: 06
subsystem: infra
tags: [llm-proxy, record-replay, reproducibility, measurement-span, fixtures]

# Dependency graph
requires:
  - phase: 67-01
    provides: "single match/record/replay impl — lib/repro/fixtures/{match-key,llm-replay,llm-record}.mjs"
provides:
  - "LLM record/replay taps wired into the live proxy bridge POST /api/complete (REPRO-02 LLM channel)"
  - "Replay tap: serves recorded response by D-07 match key or hard-fails 409 REPLAY_MISS before provider resolution (D-06 — never falls through to a live provider)"
  - "Record tap: best-effort fixture append to the span's snapshot fixtures dir, guarded by span.meta.record"
  - "Single-reader discipline preserved: getActiveMeasurement is the only active-span parser; single Plan 01 hash/record/replay impl via env-resolved dynamic import"
affects: [67-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env-resolved (LLM_PROXY_REPRO_DIR) lazy+cached dynamic import of the coding-repo fixtures into the external proxy daemon — taps stay inert on load failure"
    - "D-07 ordinal reset on armed-span transition inside the long-lived daemon so record and replay ordinals align"

key-files:
  created: []
  modified:
    - "_work/rapid-llm-proxy/proxy-bridge/server.mjs (external repo — live runtime; +119/-1)"

key-decisions:
  - "Reset the D-07 ordinal counter on each armed-span transition (task_id|started_at identity) — the daemon is long-lived and resetOrdinals is otherwise only called span-side, so without it replay ordinals would never line up with recorded fixture keys"
  - "Record fixtures dir resolves to .data/run-snapshots/<sanitizeTaskId(task_id)>/fixtures (the same dir replay reads), with an explicit span.meta.record string path winning for future-proofing"
  - "Repro modules lazy-loaded + cached; a load failure logs once and leaves the taps inert so normal /api/complete serving can never break"

patterns-established:
  - "Replay/record taps live entirely inside the existing /api/complete handler and are inert unless the active span arms them (byte-for-byte unchanged unarmed serving)"

requirements-completed: [REPRO-02]

# Metrics
duration: ~20min
completed: 2026-07-02
---

# Phase 67 Plan 06: LLM Record/Replay Proxy Taps Summary

**Wired D-07 record + D-06 hard-fail replay taps into the live rapid-llm-proxy `POST /api/complete` handler, reusing the single `getActiveMeasurement` span reader and the single Plan 01 fixtures impl via an env-resolved dynamic import — inert unless the active span arms them.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-02T09:16:19Z
- **Tasks:** 2
- **Files modified:** 1 (external proxy repo runtime file)

## Accomplishments
- **Replay tap** (after body parse, before provider-chain resolution at the former line 1754): reads the active span once via `getActiveMeasurement()`; when `span.meta.replay_from` is set, computes the D-07 key once (`matchKey(normalizeReq(body))`) and `replayLookup(...)`. On a hit it re-serves the recorded `{content,provider,model,tokens,latencyMs}` as 200; on a miss it `res.writeHead(409)` + `return`s a `REPLAY_MISS` — the `return` precedes provider resolution, so it NEVER falls through to a live provider (D-06).
- **Record tap** (where `result` is ready, before the `if (_tokenDb) logTokenCall` block): guarded by `span.meta.record`, computes the D-07 key once and `recordFixture(...)` into the span's snapshot fixtures dir, wrapped in try/catch so a fixture write can never fail or slow the real LLM call (mirrors the `_tokenDb` best-effort contract).
- **Single-reader / single-impl discipline preserved:** extended the existing `../dist/measurement-span.js` import to also bring in `getActiveMeasurement` + `sanitizeTaskId` (no second parser of `active-measurement.json`); the three fixtures modules are dynamic-imported once from `LLM_PROXY_REPRO_DIR` (default `/Users/Q284340/Agentic/coding/lib/repro`), lazy-loaded + cached.
- **Daemon restarted + verified:** `launchctl kickstart -k com.coding.llm-cli-proxy`; health OK after 7s; an unarmed `POST /api/complete` returned the normal contract (`{"content":"pong","provider":"claude-code",...}`), no startup errors in `.data/llm-proxy/logs/stderr.log`.

## Task Commits

The plan's code artifact lives in a **separate, protected repo** (`_work/rapid-llm-proxy`, on `main`) whose runtime file the daemon loads directly from disk. Per the plan ("do not push in this plan, just edit the runtime file the daemon loads"), the edit was made to the live working tree and NOT committed/pushed there. Consequently there is **no per-task code commit in the coding worktree** — the only coding-repo commit is this SUMMARY (metadata).

1. **Task 1: Insert replay + record taps** — external file `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (+119/-1); verified via `node --check` + source-ordering/grep assertions (no coding-repo commit — external protected repo).
2. **Task 2: Restart daemon + verify unarmed serving** — daemon kickstarted, health + unarmed smoke green (no coding-repo commit — operational verification).

## Files Created/Modified
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (external repo) — extended `measurement-span.js` import (`getActiveMeasurement`, `sanitizeTaskId`); added a module-level lazy+cached repro-module loader (`REPRO_DIR`/`CODING_ROOT`/`loadReproMods`/`recordFixturesDir`); inserted the replay tap after body parse and the record tap where `result` is ready, both inside `POST /api/complete`.

## Decisions Made
- **D-07 ordinal reset on armed-span transition:** `resetOrdinals()` is otherwise only called span-side (in `measurement-start`, a different process). Because the proxy daemon is long-lived and spans many runs, without a reset the replay run's ordinals would not align with the record run's fixture keys. Added a reset keyed on `task_id|started_at` identity, fired once per armed span before any `matchKey` call (documented as a Rule 2 deviation below).
- **Record fixtures dir:** an explicit `span.meta.record` string path wins (future-proofing); otherwise derived as `<CODING_ROOT>/.data/run-snapshots/<sanitizeTaskId(task_id)>/fixtures` — the same location the replay side reads (`span.meta.replay_from` → `<dir>/llm/`), so record and replay round-trip through one dir (Plan 07 archives from here).
- **Skipped a live armed end-to-end test:** arming the daemon's global `active-measurement.json` would record/409 any concurrent background traffic (obs-api, etc.). The live armed replay proof is Plan 07's checkpoint. Instead validated: `node --check`, source ordering (409 return at line 1779 precedes provider chain at 1849), and a standalone dynamic-import resolution of all three fixtures modules from `LLM_PROXY_REPRO_DIR`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Stripped a stray NUL byte from the inserted replay tap**
- **Found during:** Task 1 (post-edit verification)
- **Issue:** The `spanId` template literal separator between `span.task_id` and `span.started_at` was written as a literal `\x00` (NUL) byte instead of a printable delimiter. `node --check` passed (a NUL inside a JS string is syntactically valid) but the file became a "binary" match to `grep`/tooling and the delimiter was non-printable.
- **Fix:** Replaced the NUL with a `|` delimiter (`${span.task_id}|${span.started_at}`).
- **Files modified:** `_work/rapid-llm-proxy/proxy-bridge/server.mjs`
- **Verification:** `python3` NUL-count == 0; `node --check` passes; `grep -c getActiveMeasurement` now returns 5 (exit 0).

**2. [Rule 2 - Missing Critical] Added a D-07 ordinal reset on armed-span transition**
- **Found during:** Task 1 (implementation reasoning)
- **Issue:** The plan wires the tap but the per-hash ordinal counter in `match-key.mjs` is module-level in the daemon and is only reset span-side by `measurement-start` (a different process). Without a daemon-side reset, a replay run's ordinals would start wherever the counter last left off and miss every fixture — the feature would be non-functional across runs.
- **Fix:** Track the last armed span's `task_id|started_at`; when it changes, call `repro.resetOrdinals()` once before any `matchKey` call in that request.
- **Files modified:** `_work/rapid-llm-proxy/proxy-bridge/server.mjs`
- **Verification:** `node --check` passes; reset is inside the `span?.meta?.replay_from || span?.meta?.record` guard so it only fires for armed spans (unarmed serving unaffected — confirmed by the unarmed smoke test).

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both necessary for correctness (NUL removal) and for the feature to actually work across record→replay runs (ordinal reset). No scope creep; all edits remain inside the `/api/complete` block.

## Issues Encountered
- **macOS BSD `grep` reported the file as binary** (due to the stray NUL, above), silently suppressing acceptance greps. Diagnosed with `ripgrep`/`python3` (both matched), located the NUL at byte offset 73124 (line 1773), and removed it — after which `grep` worked normally. (Matches the project MEMORY note: "macOS grep differs from GNU".)

## User Setup Required
None - no external service configuration required. (The proxy runtime edit is loaded live by the already-running `com.coding.llm-cli-proxy` daemon after the kickstart performed in Task 2.)

## Next Phase Readiness
- REPRO-02's LLM channel chokepoint is live: a span with `meta.replay_from` serves fixtures or hard-fails 409; a span with `meta.record` appends fixtures best-effort.
- **Ready for Plan 67-07** (integration): `measurement-start` arms `meta:{record,replay_from}` and captures the snapshot; `measurement-stop` archives `fixtures/` and threads `snapshot_id`. The record/replay dir convention this plan uses (`.data/run-snapshots/<task_id>/fixtures`, replay reads `<dir>/llm/`) matches Plan 07's archive target.
- **Note for Plan 07:** the external proxy edit is uncommitted on the proxy repo's protected `main` and is not tracked by the coding repo. If the daemon host is ever re-provisioned or the proxy repo hard-reset, re-apply the two taps. A PR to the proxy repo is out of scope for this plan.

---
*Phase: 67-reproducibility-replay-rig*
*Completed: 2026-07-02*
