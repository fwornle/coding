---
phase: 85-experiment-control-center
verified: 2026-07-09T02:53:18Z
status: passed
score: 12/12 D-decisions verified
overrides_applied: 0
---

# Phase 85: Experiment Control Center Verification Report

**Phase Goal:** Experiments can be launched, re-run (same snapshot_id + param overrides via `rerun_of`), monitored (progress-file polling), and cancelled from the performance dashboard through new detached-run trigger APIs (POST /api/experiments/run, run-status, run-cancel) and an experiment-launcher UI.

**Verified:** 2026-07-09T02:53:18Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to D-01..D-12)

| # | Truth (D-decision) | Status | Evidence |
|---|---|---|---|
| 1 | D-01: vkb-server API surface delegates spawn/kill to host coordinator :3034 (container has no agent CLIs) | VERIFIED | `lib/vkb-server/api-routes.js:1065` `_coordinatorPost('/experiments/run', ...)`; `scripts/health-coordinator.js:2668-2694` `POST /experiments/run` delegates to `runExperiment` from `experiment-executor.mjs`. Live-curled: coordinator responds 200 on `:3034/health`, rejects malformed bodies with clean errors. |
| 2 | D-02: strict 409 concurrency guard, no queueing, names the holder | VERIFIED | `api-routes.js:951-999` dual-source guard (interactive span + live run scan) + host-side re-check (`json.slot_busy` at line 1072); `scripts/health-coordinator.js` experiment-executor seam re-validates with real host pid visibility. Both sources return holder-naming 409 JSON. |
| 3 | D-03: native progress emitter, never-throw, per-cell-transition | VERIFIED | `lib/experiments/run-progress.mjs` — `writeProgress`/`readProgress`, atomic tmp+rename (line 71-74), try/catch → stderr only, never throws. `experiment-runner.mjs:110-117` `emitProgress` no-ops when `runDir` falsy (byte-identical existing behavior preserved) and wraps in defensive try/catch. |
| 4 | D-04: full per-cell matrix granularity in progress.json + run-status serves verbatim | VERIFIED | Live artifact `.data/experiments/runs/rmrcu6xa9/progress.json` inspected directly: run header (`run_id, spec, snapshot_id, pid, done, total, overall`) + `cells[]` with `variant, rep, state, task_id, started_at, ended_at` — exact D-04 contract. `handleRunStatus` (api-routes.js:1139) serves the file with `JSON.parse(raw)` verbatim, graceful `{overall:'unknown',cells:[]}` on ENOENT (curl-verified live: `run-status/nonexistent1` → exactly this shape). |
| 5 | D-05: re-run mints new run_id, all cells re-execute, `rerun_of` on Run records, task_hash constant | VERIFIED | `experiment-runner.mjs:98-101` `composeTaskId(expId, cell, rep)` — called on the ORIGINAL `cell`, not `effectiveCell` (line 712), so task_hash is provably unaffected by overrides. `run-write.mjs:135-136` `rerun_of: t.rerun_of ?? null` (null-preserved metadata). Unit test `composeTaskId: an overridden cell task_id === the no-override task_id (task_hash constant, D-05)` passes. WR-01 fix (commit f7d907376) closes the launcher→API gap that previously dropped `rerun_of`; verified in code at `api-routes.js:1035-1043` (folds top-level `rerun_of` into `overrides.rerun_of` with run_id-shape validation). |
| 6 | D-06: overridable params = CLI-narrowing set + per-variant model/agent | VERIFIED | `experiment-runner.mjs:153-169` `applyVariantOverride(cell, variantOverrides)` mutates only `model`/`agent` on the effective cell; `_validateOverrides` (api-routes.js:1218+) validates `repeats`, `timeout`, `variants`, `variantOverrides` keys. Launcher UI (`experiment-launcher.tsx`) exposes all these fields including per-variant model/agent inputs. |
| 7 | D-07: mutated variant gets derived auto-suffixed name, original preserved as base_variant | VERIFIED | `experiment-runner.mjs:131-137` `deriveVariantName` — stable `agent-then-model` `@`-joined suffix; `applyVariantOverride` returns `baseVariant: original` only when overridden (null otherwise — byte-identical for non-overridden cells). Unit tests for all 4 suffix combinations pass. `run-write.mjs:136` persists `base_variant` null-preserved. |
| 8 | D-08: hard kill (SIGTERM→SIGKILL) on process GROUP, abort recorded, resumable | VERIFIED | `lib/experiments/run-launch.mjs:246-286` `cancelRun` — `killFn(-pid, 'SIGTERM')` then unref'd escalation timer `killFn(-pid, 'SIGKILL')` after grace. CR-02 fix (commit 9615aacf0) added `pidLooksLikeRunner` ownership check in `experiment-executor.mjs:308-337` — reads the run's own `run.json`, refuses (`pid_mismatch` → 409) when the requested pid doesn't match. Live-curled: cancel with a mismatched pid returns exactly the expected refusal message. |
| 9 | D-09: spec picker + resolved matrix preview BEFORE launch, no in-dashboard editor | VERIFIED | `handleSpecList` (api-routes.js:1167) reuses `resolveExperimentSpec` server-side, returns `variantCount`/`cellCount`/`variants` per spec; malformed specs listed with `{error}`, not fatal. Live-curled `GET /api/experiments/specs` returns real resolved data (3 specs, correct cell counts). `experiment-launcher.tsx` renders the preview; no YAML-editing surface exists in the component (grep confirms no editor/textarea for spec content). |
| 10 | D-10: monitoring panel = cell grid + header, 5s polling | VERIFIED | `run-monitor.tsx:47` `setInterval(() => dispatch(fetchRunStatus(activeRunId)), 5000)`; renders run header + per-cell grid with state chips/abort reasons (per D-04 progress.json shape). Cancel button (line 78) dispatches `cancelRun` immediately — no graceful-finish delay logic present. |
| 11 | D-11: Re-run button on completed run pre-fills launcher (spec + snapshot_id + rerun_of + D-06 fields) | VERIFIED | `runs-table.tsx:356-381` Re-run button gated to COMPLETED experiment runs only, dispatches `setLauncherPrefill(buildRerunPrefill(run, specList))`, scrolls launcher into view. `experiment-launcher.tsx:65-79` consumes the prefill (spec, rerunOf, variantOverrides, captureRawBodies) and clears it after apply. 85-06 round-3/4 fixes (commit e48b77702) added a highlight ring + confirmation banner after live-gate feedback that the pre-fill was invisible off-screen. |
| 12 | D-12: capture_raw_bodies wired from spec/launcher into span meta, default OFF | VERIFIED | Full chain traced in code: launcher checkbox (`experiment-launcher.tsx:329`) → `api-routes.js` overrides → `run-launch.mjs` argv → `scripts/experiment-run.mjs:170` presence-flag parse → `experiment-runner.mjs:514` `--capture-raw-bodies` forwarded to `runCell`'s measurement-start invocation → `measurement-start.mjs:195` `span.meta.capture_raw_bodies=true`. **Independently confirmed on disk** (not just SUMMARY claim): `.data/measurements/compare-fizzbuzz-v9-rmrcu6xa9.../` (capture ON run) contains `raw-bodies.jsonl.gz` and its archived JSON has `"capture_raw_bodies": true`; the paired `.../rmrcuat7g.../` (capture OFF run) has NO raw-bodies file and no such field — this is the exact "paired proof" SUMMARY 85-06 claims, verified directly against the filesystem rather than trusted from narrative. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `lib/experiments/run-progress.mjs` | atomic never-throw writeProgress/readProgress | VERIFIED | 97 lines, exports both, tmp+rename atomic write confirmed by reading source |
| `lib/experiments/experiment-runner.mjs` | progress-emitter hooks + variant override application | VERIFIED | 740 lines; `applyVariantOverride`, `deriveVariantName`, `emitProgress`, `captureRawBodies` threading all present |
| `lib/experiments/run-write.mjs` | rerun_of/base_variant Run metadata | VERIFIED | 240 lines; null-preserved fields at line 135-136 |
| `lib/experiments/run-launch.mjs` | detached spawn + process-group cancel + pid liveness | VERIFIED | 286 lines; `buildRunArgv`, `launchRun`, `cancelRun`, `isRunAlive` all exported and implemented |
| `lib/experiments/experiment-executor.mjs` | host executor seam (run/cancel delegation, containment, pid-ownership) | VERIFIED | 382 lines; `resolveRunDir` containment (CR-01), pid-ownership check (CR-02), both live-curl-proven |
| `lib/vkb-server/api-routes.js` (4 routes) | handleExperimentRun/handleRunStatus/handleRunCancel/handleSpecList | VERIFIED | All 4 registered (lines 116-119), all 4 implemented with correct contracts, all 4 curl-tested live |
| `scripts/health-coordinator.js` | POST /experiments/run + /experiments/cancel host endpoints | VERIFIED | Lines 2649-2737; origin gate + CR-01 input validation present and live-tested |
| `integrations/.../experiment-launcher.tsx` | spec picker + matrix preview + overrides + capture checkbox + re-run pre-fill | VERIFIED | 368 lines (min_lines: 60 exceeded); all D-09/D-11/D-12 fields present |
| `integrations/.../run-monitor.tsx` | run header + cell grid + 5s poll + Cancel | VERIFIED | 161 lines (min_lines: 50 exceeded); 5s setInterval + immediate cancelRun dispatch confirmed |
| `integrations/.../runs-table.tsx` | Re-run button row action | VERIFIED | Re-run button gated to completed runs, dispatches prefill + scrollIntoView |
| `integrations/.../performanceSlice.ts` | fetchSpecList/launchExperiment/fetchRunStatus/cancelRun thunks | VERIFIED | All 4 thunks present (createAsyncThunk), plus setLauncherPrefill reducer |
| `tests/e2e/performance/experiment-control.spec.ts` | Playwright structure gate | VERIFIED | 146 lines, 4 tests; re-ran live against localhost:3032 — 4/4 pass (1 flaked once under parallel worker contention, passed clean in isolation) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `run-launch.mjs` | `scripts/experiment-run.mjs` | `spawn(process.execPath, [...], {detached:true}).unref()` | WIRED | Confirmed in source; run.json artifacts on disk show real host pids from real detached spawns (25 run-dirs found under `.data/experiments/runs/`) |
| `run-launch.mjs` | runner process group | `process.kill(-pid, sig)` | WIRED | SIGTERM at line 267, SIGKILL escalation at line 278, both on negated pid |
| `health-coordinator.js` | `run-launch.mjs` (via `experiment-executor.mjs`) | `launchRun`/`cancelRun` delegation | WIRED | `getExperimentExecutor()` dynamic import, `runExperiment`/`cancelExperiment` calls confirmed |
| `api-routes.js handleExperimentRun` | coordinator `:3034` | `_coordinatorPost` fetch delegate | WIRED | Live-curled coordinator responds; container never spawns in-process |
| `api-routes.js handleRunStatus` | `.data/experiments/runs/:runId/progress.json` | verbatim file read | WIRED | Live-curled against a real run_id — returns exact file contents |
| `run-monitor.tsx` | `/api/experiments/run-status/:runId` | 5s poll `setInterval` | WIRED | Confirmed in source, `fetchRunStatus` thunk dispatch on interval |
| `runs-table.tsx` | `experiment-launcher.tsx` | `setLauncherPrefill` + `rerun_of` | WIRED | Confirmed both directions — dispatch on Re-run click, consumption in launcher's `useEffect` |
| launcher capture checkbox | proxy `rawBodyCaptureEnabled` gate | `capture_raw_bodies` presence-flag chain | WIRED, DATA FLOWING | Full 6-hop chain traced in source AND independently confirmed via two real archived runs (ON has raw-bodies.jsonl.gz + meta flag true; OFF has neither) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `run-monitor.tsx` cell grid | `progress` (Redux state via `fetchRunStatus`) | `GET /api/experiments/run-status/:runId` → verbatim progress.json read | Yes — live-curled against a real completed run, structure matches D-04 exactly | FLOWING |
| `experiment-launcher.tsx` matrix preview | `specList` (Redux state via `fetchSpecList`) | `GET /api/experiments/specs` → `resolveExperimentSpec` server-side | Yes — live-curled, returned 3 real specs with correct cellCount/variants | FLOWING |
| span.meta.capture_raw_bodies | `captureRawBodies` boolean threaded runner→runCell→measurement-start | presence-flag chain, traced end-to-end | Yes — independently confirmed via two paired archived measurement runs (ON vs OFF) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| D-09 spec preview returns resolved matrix | `curl localhost:3032/api/experiments/specs` | Real resolved specs (compare-fizzbuzz.yaml: 3 variants, 3 cells; example-experiment.yaml: 4 variants, 8 cells) | PASS |
| D-04 run-status graceful-empty on unknown run | `curl localhost:3032/api/experiments/run-status/nonexistent1` | `{"runId":"nonexistent1","overall":"unknown","cells":[]}` | PASS |
| D-04 run-status rejects traversal runId | `curl .../run-status/..%2F..%2Fetc` | HTTP 400 | PASS |
| CR-01 coordinator rejects invalid run_id | `curl :3034/experiments/run -d '{"run_id":"../../etc",...}'` | `{"ok":false,"error":"invalid run_id"}` | PASS |
| CR-01 coordinator rejects out-of-tree run_dir | `curl :3034/experiments/run -d '{"run_dir":"../../../../tmp/pwn",...}'` | `{"ok":false,"error":"run_dir escapes .data/experiments/runs/"}` | PASS |
| CR-02 coordinator refuses pid without matching run.json | `curl :3034/experiments/cancel -d '{"pid":1,...}'` | `{"ok":false,"success":false,"message":"no run.json for run_dir=...; refusing to signal pid 1"}` | PASS |
| D-12 paired proof (independent re-verification of SUMMARY claim) | `find .data/measurements/*rmrcu6xa9*/` vs `*rmrcuat7g*/` | ON run has `raw-bodies.jsonl.gz` + `capture_raw_bodies:true`; OFF run has neither | PASS |
| Full experiments unit test suite | `node --test tests/experiments/*.test.mjs` | 347 pass / 0 fail / 2 skipped (live-gated) | PASS |
| Playwright experiment-control e2e | `npx playwright test --project performance` | 4/4 experiment-control tests pass (against live localhost:3032) | PASS |

### Probe Execution

No dedicated `scripts/*/tests/probe-*.sh` probes declared for this phase; the phase's own live-verification gate (85-06) plus this verifier's direct curl/filesystem checks above serve the equivalent role. N/A.

### Requirements Coverage

Phase 85 has no REQUIREMENTS.md IDs; its acceptance surface is the CONTEXT.md D-01..D-12 decision set, fully covered in the Observable Truths table above.

| Decision | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| D-01 | 85-02, 85-03, 85-06 | SATISFIED | Host-delegation seam live, container-never-spawns confirmed |
| D-02 | 85-03, 85-04, 85-06 | SATISFIED | Dual-source + host-side re-check guard, holder-naming |
| D-03 | 85-01 | SATISFIED | Atomic never-throw emitter |
| D-04 | 85-01, 85-04 | SATISFIED | Per-cell granularity confirmed on real progress.json |
| D-05 | 85-01 | SATISFIED | task_hash constancy proven by code path + unit test |
| D-06 | 85-01, 85-05 | SATISFIED | Override map threading confirmed |
| D-07 | 85-01 | SATISFIED | Derived name + base_variant confirmed |
| D-08 | 85-02, 85-03, 85-06 | SATISFIED | Group SIGTERM→SIGKILL + pid-ownership guard (CR-02) live-proven |
| D-09 | 85-04, 85-05 | SATISFIED | Live-curled spec preview, no in-dashboard editor |
| D-10 | 85-05 | SATISFIED | 5s poll + immediate cancel confirmed in source |
| D-11 | 85-05, 85-06 | SATISFIED | Pre-fill + visibility fix (round-3/4) confirmed |
| D-12 | 85-01, 85-05, 85-06 | SATISFIED | Full chain traced + independently confirmed paired proof on disk |

No orphaned requirements — all D-decisions declared across the 6 plans' `requirements:` frontmatter, none missing.

### Anti-Patterns Found

No debt markers (`TBD`/`FIXME`/`XXX`) or stub patterns (`TODO`/`HACK`/`PLACEHOLDER`, empty handlers, static-empty returns) found in the core artifacts scanned: `experiment-executor.mjs`, `run-launch.mjs`, `run-progress.mjs`, `api-routes.js` (experiment routes), `health-coordinator.js` (experiment endpoints), `experiment-launcher.tsx`, `run-monitor.tsx`. The apparent "placeholder" grep hits in `experiment-launcher.tsx` are legitimate HTML `placeholder` input attributes, not stub markers.

**Pre-existing, correctly out-of-scope, logged in `deferred-items.md`:** stale `tsc --noEmit` diagnostics in `token-usage.tsx` / `node-details-sidebar.tsx` (files this phase did not touch) and a `caniuse-lite` staleness warning. Neither affects the phase goal.

**Deferred code-review findings (WR-02, WR-04, WR-05, WR-06 + 4 info), all WARNING/INFO severity, none blocking the phase goal:**
- WR-02 (variant override value validation) — an invalid `agent`/`model` override wastes one cell (recorded as `abort` with a reason), not a silent success; annoyance, not a functional break.
- WR-04 (coordinator origin gate breadth) — mitigated in practice by the CR-01/CR-02 input-validation hardening (the REVIEW's own suggested mitigation — "combine the origin gate with the input validation" — is now true in code, verified above).
- WR-05/WR-06 (pid-liveness EPERM inconsistency / container-side scan redundancy) — the host-side re-check (`slot_busy` path, `api-routes.js:1068-1078`) is authoritative and correctly gates D-02; the container-side scan is redundant-but-harmless as the reviewer notes, not a functional gap.
- 4 info-level items (no-timeout fetch, unknown-key silent forward, run_id collision window, unused `failed` terminal state) — hardening opportunities, not defects in current behavior.

These are reasonable to leave open per the reviewer's own `deferred_count: 8` classification and do not block phase goal achievement — none are must-haves per the D-01..D-12 acceptance surface, and none contradict any Observable Truth verified above.

### Human Verification Required

None. The phase's live human-verify gate (85-06) already ran and was APPROVED after 4 rounds of checkpoint-feedback fixes (documented in 85-06-SUMMARY.md, commits `3b7076ee8` through `55501c057`). This verifier additionally re-confirmed the live system independently (curl probes against the running dashboard :3032 and coordinator :3034, direct filesystem inspection of real run artifacts from the cited paired D-12 proof) rather than relying on the human-verify narrative alone.

### Gaps Summary

No gaps block the phase goal. All 12 D-decisions (D-01 through D-12) are verified in the actual codebase — not merely claimed in SUMMARY.md — through a combination of: source-code inspection of the exact mechanisms (containment checks, atomic writes, pid-ownership guards, override threading), the full 347-test unit suite (0 failures), a live Playwright e2e run against the actual running dashboard (4/4 pass), and direct adversarial curl probes against the live coordinator that independently reproduced the 3 critical security fixes' rejection behavior (path traversal, run_dir escape, pid-mismatch on cancel) — plus direct filesystem inspection of the two paired D-12 proof-run artifacts cited in 85-06-SUMMARY.md, which check out exactly as claimed (ON run has `raw-bodies.jsonl.gz` + `capture_raw_bodies:true`; OFF run has neither).

The 8 deferred code-review findings (WR-02/04/05/06 + 4 info) are legitimate hardening follow-ups, not phase-goal blockers — they were explicitly triaged and deferred by the reviewer with justification, and none of them contradict or undermine any of the 12 verified D-decisions.

---

_Verified: 2026-07-09T02:53:18Z_
_Verifier: Claude (gsd-verifier)_
