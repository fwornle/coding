---
phase: 83-token-reconciliation-layer
plan: 09
subsystem: token-reconciliation
tags: [reconcile, fuzzy-matching, wire-capture, copilot, byok, proxy]
gap_closure: true
requires:
  - "83-08 reconcile machinery (matchWireRow/reconcileRow/reconcileBatches/snapshotWireRowIds)"
provides:
  - "CR-01: fuzzy matcher scoped to the pre-loop wire snapshot minus already-consumed rows"
  - "CR-02: copilot BYOK wire rows carry user_hash='copadt' at the proxy source"
affects:
  - "proxy-down capture integrity (golden property 2)"
  - "copilot unmatched_wire metric meaningfulness (D-12)"
tech-stack:
  added: []
  patterns:
    - "Optional-Set opts guards (candidateWireIds/consumedWireIds) — absent = byte-identical legacy behavior"
    - "Conditional row field via object spread (stamp when present, omit to keep default)"
key-files:
  created: []
  modified:
    - lib/lsl/token/reconcile.mjs
    - lib/lsl/token/stop-adapter-registry.mjs
    - tests/token-adapters/reconcile-mode.test.js
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/agent-envelope-passthrough.test.mjs
decisions:
  - "CR-02 fixed via Option A (stamp adapter hash at proxy source) — root-cause provenance fix, keeps coding side symmetric with claude"
  - "Scoping Sets are optional so direct matchWireRow unit path + interactive path stay unchanged"
requirements: [D-02, D-04, D-05, D-12]
metrics:
  duration: ~25m
  completed: 2026-07-07
  tasks: 3
  files_changed: 5
---

# Phase 83 Plan 09: Reconcile Gap-Closure (CR-01 fuzzy scoping + CR-02 copilot copadt) Summary

Closed the two NEW verified BLOCKERs from 83-VERIFICATION.md: the fuzzy matcher could consume a loop-inserted fallback row (silently dropping proxy-down turns) and could double-consume one wire row; and copilot `unmatched_wire` was structurally 0 because BYOK wire rows defaulted to the machine hash instead of `copadt`.

## What Was Built

**CR-01 (coding) — fuzzy candidates scoped to the pre-loop wire snapshot.**
`reconcile.mjs` `fuzzyMatch` gained two OPTIONAL guards at the top of the candidate loop: skip a candidate absent from `opts.candidateWireIds` (the pre-loop snapshot Set) and skip a candidate present in `opts.consumedWireIds` (already-matched rows). Both are no-ops when the opt is absent (`instanceof Set` presence check), so the direct `matchWireRow` unit path and the interactive path are byte-behavior-identical. The request-id probe and `FUZZY_CANDIDATES_SQL` are untouched (probe stays unscoped — safe by the partial-unique index). `stop-adapter-registry.mjs` `reconcileBatches` builds an augmented `reconcileOpts` once before the loop, threading `candidateWireIds: wireRowIds` (pre-loop PK snapshot) and `consumedWireIds: matchedWireRowIds` (the live matched-PK Set, by reference so each iteration sees earlier matches), and passes it as the 4th arg of `reconcileRow`.

**CR-02 (proxy — separate repo) — copadt provenance at the source.**
`proxy-bridge/server.mjs` `/api/complete` `logTokenCall` now stamps `user_hash: adapterUserHash(body.agent)` when `body.agent` is a non-empty string (mirroring the `/v1/messages` tap at :2217), and omits the field otherwise so direct `/api/complete` callers keep the machine `USER_HASH`. Copilot BYOK traffic reaches this site via the `/v1/copilot` shim (`body.agent='copilot'`) → wire rows now carry `copadt`, making the coding-side copadt-keyed `snapshotWireRowIds` non-empty. `src/token-usage.ts` was NOT edited (logCall already honors `row.user_hash ?? USER_HASH`) — no dist/docker build required; the `.mjs` change is live after a daemon restart.

**CR-02 (coding) — regression lock.**
Added two copilot tests to `reconcile-mode.test.js` seeding copadt wire rows (the production shape after the proxy fix): a matched + orphan pair asserts `unmatched_wire === 1`; an all-matched span asserts `0` (not vacuous).

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes, no architectural changes, no auth gates.

## TDD Gate Compliance

- **Task 1 (CR-01):** RED `test(9e273e3d4)` — proxy-down (matched=1 vs 0) + double-consumption (matched=2 vs 1) failed against current code → GREEN `feat(d40a4aaca)` both pass.
- **Task 2 (CR-02 proxy):** RED `test(4b68681)` — copilot got machine hash `'unknown'` vs `'copadt'` → GREEN `feat(9f9ab3d)` all 4 envelope tests pass.
- **Task 3 (CR-02 coding):** test-only regression lock on already-correct `snapshotWireRowIds` behavior (no implementation to add); passes on first run `test(251f0f906)`. No RED phase applicable — this task locks the contract exercised by the copadt production shape delivered by Task 2.

## Verification

Coding repo (no build):
- `reconcile-mode.test.js` — 15 pass / 0 fail (11 existing + proxy-down + double-consumption + copilot-orphan + copilot-healthy)
- `reconcile-matcher.test.js` — 18 pass / 0 fail (unchanged)
- `token-db-dedup-merge.test.js` — 4 pass / 0 fail
- `reconciliation-route.test.js` — 5 pass / 0 fail
- Greps: `candidateWireIds`/`consumedWireIds` in reconcile.mjs (FUZZY-SCOPED); `candidateWireIds: wireRowIds` + `consumedWireIds: matchedWireRowIds` in stop-adapter-registry.mjs (OPTS-THREADED); `proxy-down` present in tests.

Proxy repo (separate commit, no dist build):
- `agent-envelope-passthrough.test.mjs` — 4 pass / 0 fail (new copilot→copadt / opencode→opcadt / omitted→machine)
- Grep: `adapterUserHash(body.agent)` present in server.mjs; no `.ts` change in the diff.
- Daemon: coordinator `location=open` confirmed on :3034, then `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (rc=0) → DAEMON-RUNNING + PROXY-ALIVE (:12435/health).

## Commits

Coding repo (this worktree):
- `9e273e3d4` test(83-09): add failing CR-01 fuzzy-scoping tests
- `d40a4aaca` feat(83-09): scope fuzzy candidates to pre-loop wire snapshot (CR-01)
- `251f0f906` test(83-09): lock copilot copadt orphan unmatched_wire contract (CR-02)

rapid-llm-proxy repo (separate, own commits on main):
- `4b68681` test(83-09): add failing CR-02 copadt user_hash row-contract test
- `9f9ab3d` feat(83-09): stamp copadt on /api/complete BYOK wire rows (CR-02)

## Out of Scope (unchanged, documented follow-ups)

WR-06 (copilot production wire rows carry `tool_call_id=''` → match via fuzzy, not request-id) remains a follow-up; the CR-01 fuzzy-scoping makes that safe and the metric meaningful without fixing WR-06. WR-01..WR-08 / IN-01..IN-12 review warnings were not touched.

## Self-Check: PASSED

All modified files present on disk; all 4 coding commits + 2 proxy commits verified in their respective git logs.
