---
phase: 68-foundational-token-attribution-storage
plan: 02
subsystem: rapid-llm-proxy / measurement-span lifecycle + coding operator CLIs
tags: [telemetry, measurement-span, token-attribution, atomic-archive, TELEM-02]
requires:
  - "Plan 68-01 token_usage attribution columns (the write path stamps task_id from the active span)"
provides:
  - "src/measurement-span.ts: getActiveMeasurement (the SINGLE active-span JSON parser) + startMeasurement + stopMeasurement + sanitizeTaskId + resolveMeasurementPaths + SpanRecord"
  - "SDK barrel re-export of the measurement-span surface (@rapid/llm-proxy)"
  - "coding scripts/measurement-start.mjs + scripts/measurement-stop.mjs operator CLIs"
  - ".data/active-measurement.json open-span contract + .data/measurements/<task_id>.json atomic archive"
affects:
  - "Phase 68-03 (proxy write path imports getActiveMeasurement from the same local dist to stamp rows with task_id)"
  - "Phases 69-70 (per-agent adapters read the active span to attribute calls)"
  - "Phase 72 (goal_sentence capture flows through startMeasurement input)"
tech-stack:
  added: []
  patterns:
    - "Single-reader invariant: getActiveMeasurement is the only JSON.parse of the active span; stopMeasurement reuses it (never re-parses)"
    - "Atomic archive: temp-write + fs.renameSync (crash-safe primitive), mirrors token-usage / km-core writeAtomic"
    - "task_id sanitization: charset whitelist + path.basename defense-in-depth before any filename construction"
    - "Local-dist import for coding CLIs (pathToFileURL dynamic import) — same dist the daemon loads, not coding's pinned node_modules tarball"
key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/measurement-span.test.mjs
    - /Users/Q284340/Agentic/coding/scripts/measurement-start.mjs
    - /Users/Q284340/Agentic/coding/scripts/measurement-stop.mjs
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/index.ts
decisions:
  - "Coding operator CLIs import the measurement-span surface from the LOCAL proxy build (/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist/measurement-span.js via pathToFileURL dynamic import), NOT from coding's node_modules. Rationale: coding pins @rapid/llm-proxy v1.0.0 (.tgz, no measurement-span, no package.json subpath export — the proxy is now 2.0.0); the daemon (proxy-bridge/server.mjs) and Plan 68-03's write path both load this same local dist, so pointing the CLIs there keeps exactly ONE reader system-wide and avoids re-packing/re-pinning a tarball just for two operator scripts. Override with LLM_PROXY_DIST_DIR."
  - "Re-sync command if the v2.0.0 tarball is later published+installed into coding: `cd _work/rapid-llm-proxy && npm pack` then `npm install <tgz>` in coding, after which the CLIs could switch to `import ... from '@rapid/llm-proxy'`. Not done now (deliberate)."
  - "Path-traversal task_id is NEUTRALIZED to a safe basename rather than always throwing — path.basename('../../etc/passwd') → 'passwd'. The plan explicitly permits throw OR safe-basename; only ids that resolve to a pure traversal/empty segment ('..', '.', '') throw. The load-bearing invariant (no file escapes the data dir) holds either way and is asserted in the test."
  - "Overwrite policy on startMeasurement: an already-open active span is overwritten with a non-fatal stderr warning (never silently clobbered) — single-operator workflow, matches T-68-02-03 disposition."
  - "dist/*.js + dist/*.d.ts are gitignored in the proxy repo but dist/*.d.ts.map are tracked (pre-existing inconsistency from 68-01); committed the regenerated measurement-span.d.ts.map + index.d.ts.map alongside source to keep the proxy tree clean."
metrics:
  duration: "~9 min"
  completed: 2026-06-22
  tasks: 2
  files: 5
---

# Phase 68 Plan 02: Measurement-Span Lifecycle Summary

Built the measurement-span lifecycle as a greenfield module in rapid-llm-proxy — a single `getActiveMeasurement()` reader (the ONLY JSON parser of `.data/active-measurement.json`, hot-path-safe and never-throwing) plus `startMeasurement()` / `stopMeasurement()` that write the open span and atomically archive it to `.data/measurements/<task_id>.json` via temp-write + `fs.renameSync` — exported the surface from the SDK barrel and added thin coding-side operator CLIs that consume the same local dist the daemon loads. (Satisfies TELEM-02 + Success Criteria 3 & 4.)

## What Was Built

**Task 1 — measurement-span.ts (commit `3cdf4ee`, rapid-llm-proxy):**
- `resolveMeasurementPaths(overrideDataDir?)` → `{ dataDir, activePath, archiveDir }`, mirroring `resolveTokenDbPath`'s `overrideDataDir || LLM_PROXY_DATA_DIR || cwd/.data` order so span files sit next to the token DB.
- `sanitizeTaskId(raw)` — the security gate (T-68-02-01): `path.basename` first (defense-in-depth), then reject `.`/`..`/empty, cap at 200 chars, and enforce the `[A-Za-z0-9._-]` charset; throws a clear Error on an unsanitizable id.
- `getActiveMeasurement(overrideDataDir?)` — THE single reader: `readFileSync` (ENOENT → null), exactly one `JSON.parse(` wrapped in try/catch (corrupt → non-fatal stderr + null, NEVER throws), minimal shape validation (task_id + started_at non-empty strings), and a `>24h` stale-span stderr warning that still returns the span.
- `startMeasurement(input, overrideDataDir?)` — sanitizes task_id, warns on overwrite of an existing open span, writes `{ task_id, started_at: now, goal_sentence?, meta? }`.
- `stopMeasurement(overrideDataDir?)` — reuses `getActiveMeasurement` (no independent parse — the single-parser invariant), stamps `ended_at`, archives atomically (`<id>.json.tmp-<pid>` → `fs.renameSync` → `<id>.json`), then removes the active file; returns null + stderr warning when no span is open.
- `SpanRecord` type exported. All logging via `process.stderr.write` (no-console-log compliant).

**Task 2 — barrel export + CLIs + integration test (proxy `7505ba6`, coding `a326e4e41`):**
- `src/index.ts`: added a commented "Measurement span (TELEM-02)" block re-exporting the surface; `dist/index.d.ts` confirmed carrying the new exports after build.
- `scripts/measurement-start.mjs`: `--task-id` (required) + optional `--goal`; dynamic-imports `startMeasurement` from the local proxy dist; prints the active-span path; exits non-zero with a clear message on a sanitize error.
- `scripts/measurement-stop.mjs`: archives the active span (prints archive path) or prints "no active measurement span" and exits 0 (idempotent).
- `tests/integration/measurement-span.test.mjs` (node:test, fresh tmpdir per test as overrideDataDir): 6/6 subtests — (a) full start→read→stop→archive lifecycle (active file gone, archive present with non-empty `ended_at`), (b) null-when-absent, (c) corrupt → null + no throw, (d) >24h → span returned + stale stderr line, (e) single-parser invariant (corrupt active file → stop returns null, writes no archive), (f) traversal task_id collapses to a safe basename with no file escaping the data dir + a pure-traversal id throws.

## Verification Results

- `npm run build` (rapid-llm-proxy) — exit 0; `dist/measurement-span.{js,d.ts}` emitted; `dist/index.d.ts` carries the 6 re-exports.
- `node --test tests/integration/measurement-span.test.mjs` — exit 0, 6/6 pass.
- Acceptance greps: exactly ONE literal `JSON.parse(` (single-parser invariant); `renameSync` present (atomic archive); `sanitizeTaskId`/`path.basename` present (traversal safety); `grep -c "console\."` == 0.
- Operator smoke (temp data dir): `measurement-start.mjs --task-id smoke-68 --goal "…"` wrote `active-measurement.json`; `measurement-stop.mjs` produced `.data/measurements/smoke-68.json` with `ended_at` and removed the active file; a second stop printed "no active measurement span" (idempotent). No live `.data/active-measurement.json` existed beforehand, so nothing was clobbered.

## How an Operator Runs It (against coding's live .data)

```bash
# coding sets LLM_PROXY_DATA_DIR=<coding>/.data for the daemon; the CLIs honour it.
node scripts/measurement-start.mjs --task-id <task_id> --goal "<goal sentence>"
# … work happens; the proxy write path (Plan 68-03) stamps rows with the active task_id …
node scripts/measurement-stop.mjs
# → .data/measurements/<task_id>.json with ended_at; .data/active-measurement.json removed
```

If the proxy checkout is not at the default path, set `LLM_PROXY_DIST_DIR` to its `dist/`.

## Threat Model Disposition

- **T-68-02-01 (Tampering / archive filename from task_id):** mitigated — `sanitizeTaskId` whitelist + `path.basename` at the rename target; traversal subtest asserts `'../../etc/passwd'` → `passwd` inside the data dir and no escape; a pure-traversal id throws.
- **T-68-02-02 (DoS / getActiveMeasurement parse):** mitigated — single `JSON.parse` in try/catch returning null + non-fatal stderr; never throws on the proxy hot path. Subtest (c) proves it.
- **T-68-02-03 (Tampering / concurrent start/stop race):** mitigated — `stopMeasurement` archives via temp-write + `fs.renameSync` (atomic) then removes the active file; overwrite-on-start warns rather than silently clobbering. Residual concurrent-start-during-stop is operator-driven single-workflow, accepted as documented.
- **T-68-02-04 (Information Disclosure / span contents):** accepted — spans live under the operator's own `.data`, same trust zone as token-usage.db.
- **T-68-02-SC (npm installs):** accepted — no new packages (node:fs/path/url/process only); no package-legitimacy checkpoint required.

## Deviations from Plan

**1. [Rule 1 - Test correctness] Traversal subtest assertion corrected to match the implementation contract.**
- **Found during:** Task 2 (first test run).
- **Issue:** The initial test asserted `startMeasurement({task_id:'../../etc/passwd'})` must THROW, but `sanitizeTaskId` uses `path.basename` first, collapsing it to the safe id `passwd` — so it does not throw. The plan explicitly permits "either throws OR yields only a sanitized basename file inside archiveDir."
- **Fix:** Rewrote subtest (f) to assert the documented load-bearing invariant — traversal collapses to a safe basename, the active + archive files stay inside the data dir, nothing escapes above it — and added a separate assertion that a pure-traversal id (`'../..'` → basename `'..'`) DOES throw.
- **Files modified:** `tests/integration/measurement-span.test.mjs`.
- **Commit:** `7505ba6` (rapid-llm-proxy).

Otherwise plan executed as written.

## Cross-Repo Commits

**rapid-llm-proxy (branch main):**
- `3cdf4ee` feat(68-02): add measurement-span lifecycle module (TELEM-02)
- `7505ba6` test(68-02): barrel-export measurement-span + lifecycle integration test (TELEM-02)

**coding (branch main):**
- `a326e4e41` feat(68-02): operator CLIs for measurement-span start/stop (TELEM-02)

## Self-Check: PASSED

- FOUND: `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts`
- FOUND: `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/measurement-span.test.mjs`
- FOUND: `/Users/Q284340/Agentic/coding/scripts/measurement-start.mjs`
- FOUND: `/Users/Q284340/Agentic/coding/scripts/measurement-stop.mjs`
- FOUND: `.planning/phases/68-foundational-token-attribution-storage/68-02-SUMMARY.md`
- FOUND commits (rapid-llm-proxy): `3cdf4ee`, `7505ba6`
- FOUND commit (coding): `a326e4e41`
