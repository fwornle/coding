---
phase: 64-worker-hygiene-cli-version-pinning-stderr-throttling
plan: 01
subsystem: rapid-llm-proxy worker pool
tags: [GUARD-02, worker-pool, cli-version-pinning, drift-recycle, prompt-cache-hygiene]
requires:
  - "Phase 62 ClaudeWorker deps seam (spawn/claudeCli/buildEnv) + needsRecycle/isStale signals"
  - "Phase 63 WorkerPool _reapStale + _disposeAndDrop drain+respawn machinery"
provides:
  - "ClaudeWorker._bootVersion: boot-time claude CLI version capture (deps.readVersion seam, degrade-open)"
  - "WorkerPool._currentVersion: process-level current-version snapshot (injectable reader, coarse lazy refresh)"
  - "WorkerPool drift-flag-at-reuse: drifted workers funnel through the existing _reapStale drain+respawn path"
affects:
  - "rapid-llm-proxy persistent worker pool reuse path (complete())"
tech-stack:
  added: ["node:child_process execFileSync (best-effort --version probe)"]
  patterns: ["injectable deps/opts reader with degrade-open default", "reuse existing needsRecycle signal — no parallel recycle mechanism", "coarse lazy snapshot refresh — O(1) string-equality on the hot path"]
key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs
decisions:
  - "Field/seam names: _bootVersion (worker), deps.readVersion (worker), opts.readVersion + _currentVersion (pool) — D-01 Claude's-Discretion."
  - "Version representation: the raw trimmed `claude --version` stdout string; only ever compared for string-equality drift, so format is irrelevant."
  - "Refresh cadence (D-03): capture-once at construction + lazy re-probe at most once per DEFAULT_VERSION_REFRESH_MS (5 min, env LLM_PROXY_WORKER_VERSION_REFRESH_MS) gated at the top of complete(); the per-request drift check is a pure string compare — never an exec."
  - "Degrade-open (D-04): a falsy worker boot version OR a falsy pool snapshot disables drift detection for that worker (never recycled), so a failed probe never blocks boot or spuriously recycles."
metrics:
  duration: "~1 commit, single wave"
  tasks_completed: 4
  files_modified: 2
  tests: "53 unit tests, 0 fail"
  completed: 2026-06-21
---

# Phase 64 Plan 01: GUARD-02 CLI Version Pinning + Drift Recycle Summary

Pin the `claude` CLI version at worker boot and recycle a worker through the existing drain+respawn path when the binary drifts from its boot version, so prompt-cache assumptions don't silently rot after an operator upgrades `claude` under a long-lived worker — proven by a simulated version change in the unit suite via an injected reader.

## What Was Built

**Task 1 — Boot-version capture on ClaudeWorker (degrade-open).**
- Added a `deps.readVersion` seam to the `ClaudeWorker` constructor, alongside the existing `deps.spawn`/`claudeCli`/`buildEnv` seams.
- Default reader: `defaultReadClaudeVersion(claudeCli)` — a synchronous, 2s-timeout-capped `execFileSync(claudeCli, ['--version'])` wrapped in try/catch returning `undefined` on any error (missing binary, non-zero exit, hung exec).
- Captured into `this._bootVersion` in the recycle-bookkeeping block, BEFORE the subprocess spawn but with NO `await` — boot stays synchronous and unconditional. Any throw leaves `_bootVersion` null, disabling drift-recycle for that worker.

**Task 2 — Pool current-version snapshot + drift-flag-at-reuse.**
- `WorkerPool` now holds `_currentVersion`, captured once at construction from `opts.readVersion` (default: same `claudeCli --version` probe) via `_readVersionSafe()` (degrade-open).
- `_versionRefreshMs` (default `DEFAULT_VERSION_REFRESH_MS` = 5 min, env `LLM_PROXY_WORKER_VERSION_REFRESH_MS`) governs a COARSE lazy re-probe: `_maybeRefreshVersionSnapshot()` is called at the top of `complete()` and only re-reads when the window has elapsed since `_lastVersionProbeAt`. The version reader therefore runs at most ~once per window regardless of request rate.
- `refreshVersionSnapshot()` is public so the unit suite (and operators) can drive the cadence deterministically.
- `_isVersionDrifted(worker)`: O(1) string equality — true only when BOTH `worker._bootVersion` AND `_currentVersion` are truthy and differ (degrade-open on either falsy).
- `_flagDriftedWorkers(workers)` sets `needsRecycle = true` + `isStale = true` on drifted workers, called in `complete()` BEFORE the existing `_reapStale(key, workers)` so the SAME reuse drains them and a fresh worker booted against the new version serves the next request. No parallel recycle mechanism (D-02).
- `_spawnWorker` threads `readVersion: this._readVersion` into the real `ClaudeWorker` so the worker's `_bootVersion` and the pool snapshot share a representation.

**Task 3 — Unit tests (simulated drift, no real CLI).**
- `SC-1 drift recycle`: a worker booted at "1.0.0" is disposed and a fresh "2.0.0" worker spawned at the second acquire after a mutable version cell is flipped and the snapshot refreshed.
- `degrade-open`: a worker with a null `_bootVersion` is never recycled even when the snapshot has a value.
- `no-drift control`: unchanged version across acquires reuses the original worker (no dispose, no respawn).
- `no per-request exec`: the version reader is NOT invoked on the per-request path (drift is a cached-snapshot string compare).
- Plus three Task-1 worker-level tests (capture, throwing-probe degrade-open, absent-default degrade-open).

**Task 4 — Commit to the rapid-llm-proxy repo (local-only).**
- Committed `proxy-bridge/worker-pool.mjs` + `tests/unit/worker-pool.test.mjs` to the standalone `rapid-llm-proxy` git repo. NOT pushed (Phase-63 cross-repo convention). No coding-repo files in the commit.

## Key Decisions

- **Names (D-01, Claude's-Discretion):** `_bootVersion` (worker field), `deps.readVersion`/`opts.readVersion` (injectable reader), `_currentVersion` (pool snapshot), `DEFAULT_VERSION_REFRESH_MS` (cadence constant).
- **Snapshot representation (D-03):** raw trimmed `--version` stdout string; only ever string-compared for drift, so the exact format is irrelevant. Refresh is capture-once + lazy coarse re-probe gated in `complete()` — never per-request.
- **Degrade-open (D-04):** falsy boot version OR falsy snapshot ⇒ no drift flag. A failed probe never blocks/crashes boot and never spuriously recycles every worker against a phantom version.
- **Reuse the existing recycle path (D-02):** drift sets the same `needsRecycle`/`isStale` signals the threshold-driven recycle uses, and is ordered before `_reapStale` so the existing drain+respawn disposes the worker on the same reuse.

## Deviations from Plan

None — plan executed exactly as written. Field/seam names and the snapshot cadence were planner/executor discretion (D-01/D-03) and are documented above.

## Verification

- `node --test tests/unit/worker-pool.test.mjs` in `/Users/Q284340/Agentic/_work/rapid-llm-proxy` → **53 tests, 0 fail** (was 46 baseline; +7 new GUARD-02 cases).
- `worker-pool.mjs` contains `_bootVersion` (worker) + `_currentVersion` (pool snapshot) + drift-flag-at-reuse funnelling through `_reapStale`.
- No `claude --version` exec on the per-request path — the `no per-request exec` test proves the reader is not called per request; the only version read in `complete()` is the self-throttling lazy `_maybeRefreshVersionSnapshot()`.
- Boot spawn remains synchronous and unconditional (no `await` before `spawnImpl(...)`).
- GUARD-02 committed to the rapid-llm-proxy repo only (`cc4a0b6`), local-only, no coding-repo files.

## Commit

- `cc4a0b6` (rapid-llm-proxy repo, local-only): `feat(worker-pool): GUARD-02 CLI version pinning + drift recycle`

## Self-Check: PASSED

- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs (contains `_bootVersion`, `_currentVersion`, `readVersion: this._readVersion`)
- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs (contains the GUARD-02 drift describe block)
- FOUND: proxy-repo commit cc4a0b6 referencing GUARD-02
- Unit suite: 53 pass / 0 fail
</content>
</invoke>
