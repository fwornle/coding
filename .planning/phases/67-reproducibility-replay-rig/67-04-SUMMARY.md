---
phase: 67-reproducibility-replay-rig
plan: 04
subsystem: repro
tags: [repro, snapshot, kb-capture, km-core, security, tdd]
requires:
  - lib/repro/git-state.mjs (Plan 03 — captureGitState)
  - lib/repro/env-allowlist.mjs (Plan 03 — captureEnvAllowlist, SECRET_DENY_RE)
  - lib/repro/mcp-inventory.mjs (Plan 03 — captureMcpInventory)
provides:
  - "captureKb(dataDir, destDir) — byte-exact filesystem KB copy (D-02)"
  - "hydrateSandbox(exportPath, sandboxDataDir) — sandbox restore from JSON export"
  - "captureSnapshot(task_id, opts) — full RunSnapshot dir + manifest (SC-1)"
  - "sanitizeTaskId(id) — traversal-safe snapshot-path id"
affects:
  - "Plan 05+ restore-snapshot.mjs (consumes RunSnapshot dir + manifest)"
tech-stack:
  added: []
  patterns:
    - "filesystem-copy-only KB capture (no 2nd store on single-owner LevelDB — Pitfall 5)"
    - "best-effort fail-soft capture (never throws whole capture on one item)"
    - "lazy km-core import so capture path loads with km-core absent"
    - "secret-gated config copy (deny-regex on key names before cp)"
key-files:
  created:
    - lib/repro/kb-capture.mjs
    - lib/repro/capture-snapshot.mjs
    - tests/repro/kb-capture.test.mjs
    - tests/repro/capture-snapshot.test.mjs
  modified: []
decisions:
  - "sanitizeTaskId implemented locally (defensive basename + [A-Za-z0-9._-]) — the proxy dist measurement-span.ts is NOT present in this worktree, so the plan's fallback 'basename-guard defensively' path was taken rather than a dist-import"
  - "hydrateSandbox imports GraphKMStore via dynamic import so kb-capture.mjs (and the capture-only path) loads with km-core absent; capture never depends on a store"
  - "planning captured as a planning/ directory copy (fs.cpSync) rather than planning.tar — no tar dependency, same restore fidelity; plan permitted either"
metrics:
  duration: ~6m
  completed: 2026-07-02
---

# Phase 67 Plan 04: KB Capture + RunSnapshot Assembly Summary

Filesystem-copy-only KB capture (byte-exact leveldb + atomic JSON export, never a second
store on the single-owner DB) plus `captureSnapshot(task_id)` that assembles every SC-1
internal-state item into one traversal-safe, secret-safe `.data/run-snapshots/<task_id>/`
directory with a manifest carrying `clock_base` and an honest per-channel capability map.

## What Was Built

### Task 1 — `lib/repro/kb-capture.mjs` (commit 9f0ebb48f)
- `captureKb(dataDir, destDir)`: copies live `knowledge-graph/leveldb/` → `kb/leveldb/`
  (byte-exact, `fs.cpSync`) and `knowledge-graph/exports/general.json` →
  `kb/exports/general.json` (`fs.copyFileSync`). Returns
  `{ levelDbCaptured, exportCaptured, caveat }`. Pure `node:fs` — **no static km-core
  import**, so it can never open a store on the live single-owner DB (Pitfall 5 /
  T-67-04-02). Best-effort per artifact (missing → `false` flag, never throws).
- `caveat`: honest string (T-67-04-04 / Pitfall 1) — the leveldb copy is byte-exact only
  for its point-in-time read; the atomic JSON export is the canonical restore source.
- `hydrateSandbox(exportPath, sandboxDataDir, opts)`: restore side. Stages the captured
  export into the sandbox exportDir, **lazily** imports `GraphKMStore`, constructs it with
  a **mandatory `ontologyDir`** (CLAUDE.md km-core rule — else `resolveEntities` throws),
  `open()`s (patched `hydrate()` restores from the JSON export), and `close()`s in a
  `finally` (single-owner handle release).

### Task 2 — `lib/repro/capture-snapshot.mjs` (commit 63668c4bb)
- `captureSnapshot(task_id, { repoRoot, dataDir, prompt })`: composes `captureGitState`,
  `captureEnvAllowlist`, `captureMcpInventory` (Plan 03) + `captureKb` (Task 1) into one
  dir under `<repoRoot>/.data/run-snapshots/<sanitizeTaskId(task_id)>/`. Writes:
  `git-sha.txt`, `dirty.patch`, `untracked/` (list + best-effort file copies),
  `submodules.json`, `kb/`, `env-allowlist.json`, `mcp-inventory.json`,
  `llm-settings.json` (secret-gated), `agent-version.txt` (`claude --version` +
  `process.version`), `planning/` (`.planning/` copy), `prompt.txt`, `manifest.json`.
- `manifest.json`: `{ snapshot_id, task_id, created_at, clock_base, git_sha, kb_caveat,
  llm_settings_captured, [llm_settings_omitted_reason], channels }` where `channels` =
  `{ llm:'record', WebSearch:'record-only', WebFetch:'record-only', MCP:'record-only',
  clock:'virtualized' }`. `clock_base = Date.now()` recorded before any capture I/O
  (Pattern 3 span-open baseline).
- `sanitizeTaskId(id)`: `path.basename` + keep `[A-Za-z0-9._-]` (else `_`), strips leading
  dots, `unknown` fallback — `'../evil'` → `'evil'`, dir stays under run-snapshots
  (T-67-04-01).
- Secret gate (FLAG T-67-03-04 / T-67-04-03): `llm-settings.json` is copied **only** after
  a recursive deny-regex (`SECRET_DENY_RE` = `/KEY|TOKEN|SECRET|PASSWORD/i`) confirms no
  secret-shaped key; otherwise omitted and the reason is recorded in the manifest.
- Every step is best-effort (`try/catch` + `process.stderr.write`) so a partial environment
  still yields a manifest — verified by a true-negative test with a bogus dataDir.

## Deviations from Plan

None affecting behavior. One environmental adaptation:

**1. [Rule 3 - Blocking] `_work/rapid-llm-proxy` / `measurement-span.ts` absent in worktree**
- **Found during:** Task 2 (both `sanitizeTaskId` import and the interface reads).
- **Issue:** The plan referenced importing `sanitizeTaskId` from the proxy dist
  (`measurement-span.ts:83`), but `_work/rapid-llm-proxy` is not populated in this worktree.
- **Fix:** Took the plan's explicit fallback — implemented a defensive local
  `sanitizeTaskId` (basename + `[A-Za-z0-9._-]`), matching the documented contract. No
  behavior change; acceptance criterion (`grep -c sanitizeTaskId >= 1`) satisfied (5 hits).
- **Files:** lib/repro/capture-snapshot.mjs
- **Commit:** 63668c4bb

## TDD Gate Compliance

Both tasks followed RED → GREEN. Because km-core is not installed in this worktree, each
task's test + implementation were validated together as a single verified unit and
committed once per task (RED confirmed via `ERR_MODULE_NOT_FOUND` before implementation for
both). Commits are `feat(...)` (GREEN); the RED step was executed and observed but not
separately committed — noted here for gate transparency.

## Verification

- `node --test tests/repro/kb-capture.test.mjs tests/repro/capture-snapshot.test.mjs` →
  **14 pass / 0 fail**.
- `grep -v '^\s*//' lib/repro/kb-capture.mjs | grep -A3 -i 'captureKb' | grep -i GraphKMStore`
  → empty (capture opens no store).
- `grep -c ontologyDir lib/repro/kb-capture.mjs` → 5 (>= 1).
- `grep -c sanitizeTaskId lib/repro/capture-snapshot.mjs` → 5 (>= 1).
- Composition confirmed: captureGitState / captureEnvAllowlist / captureMcpInventory /
  captureKb all referenced in capture-snapshot.mjs.
- No `console.*` in either module (no-console-log / CLAUDE.md).
- `.data/run-snapshots/` already gitignored (Plan 03) — no snapshot artifacts leak into git
  or the worktree (tests use throwaway temp repoRoots).

## Known Stubs

None. All artifacts are wired to real capture primitives; no placeholder/mock data flows
to a consumer. The harness channels (`WebSearch`/`WebFetch`/`MCP`) are honestly marked
`record-only` in the manifest per D-06/D-08 — this is a documented capability boundary, not
a stub (replay of those channels is resolved/hard-failed in a later plan).

## Self-Check: PASSED
- lib/repro/kb-capture.mjs — FOUND
- lib/repro/capture-snapshot.mjs — FOUND
- tests/repro/kb-capture.test.mjs — FOUND
- tests/repro/capture-snapshot.test.mjs — FOUND
- commit 9f0ebb48f — FOUND
- commit 63668c4bb — FOUND
