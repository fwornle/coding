---
phase: 88-experiment-harness-agent-invocation-alignment-and-pre-flight
verified: 2026-07-22T08:40:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 88: Experiment Harness — Agent-Invocation Alignment & Pre-flight Gate Verification Report

**Phase Goal:** A multi-agent `/experiment` run produces a genuine N-way comparison — each cell invokes
its agent through the SAME proxy-routing/env/model seam as `bin/coding --<agent>`, a per-agent
pre-flight gate records a clean `skip:<reason>` up front instead of a mid-run abort, and the copilot
drivability probe + ambient sessions do not pollute the Runs view.
**Verified:** 2026-07-22T08:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | opencode experiment cell resolves its model to a live-catalog id (dash→dot, `rapid-proxy/` prefix kept) | VERIFIED | `lib/experiments/agent-routing.mjs:57-68` `resolveCellModel` regex `/-(\d+)-(\d+)$/` → `-$1.$2`; both specs now say `rapid-proxy/claude-haiku-4.5` (grep confirmed); `agent-routing.test.mjs` asserts prefix is kept (13/13 pass) |
| 2 | copilot experiment cell resolves `auto`/empty to the measured-default catalog id (no bare 500) | VERIFIED | `COPILOT_MEASURED_DEFAULT_MODEL='claude-haiku-4-5'` (single export), `resolveCellModel('copilot','auto')` → default; live rv88a copilot cell completed with 57,158 tokens (was a 500 abort pre-fix) |
| 3 | Cell model resolution + interactive-shell defaults share ONE source of truth (no third hand-duplicated copy) | VERIFIED | `scripts/launch-agent-common.sh:483` shells out to `node lib/experiments/agent-routing.mjs default copilot` (fail-soft `\|\| echo claude-haiku-4-5`); `experiment-runner.mjs:76,228-257` `configureProxyRoutingEnv` delegates to `buildAgentRoutingEnv`; `grep -c "case 'copilot'" experiment-runner.mjs` → 0 (no inline switch survives) |
| 4 | Per-agent pre-flight validates proxy-reachable + resolved-model round-trip via `POST /api/complete`, before the cell burns a run | VERIFIED | `lib/experiments/agent-headless.mjs:264-297` `preflightAgent` — `preflightBody` maps agent→provider/model, `fetch` to `http://127.0.0.1:${port}/api/complete`, bound by `AbortController(timeoutMs)`; wired into `runMatrix` at `experiment-runner.mjs:743-744` (`preflight(cell.agent,{model:launchModel,port})`) before `runCell` |
| 5 | A cell that fails pre-flight lands a clean recorded `skipped:<reason>` Run up front — never a mid-run abort, never a hard required-agent failure | VERIFIED | `experiment-runner.mjs:745-758` — `pf.ok===false` → `writeSkipRun` (same RUN-04 path), `summary.push({status:'skipped',...})`, `continue` (no launch); test `runMatrix: a failed pre-flight on a REQUIRED agent is a recorded skip — NOT a required-agent failure` passes |
| 6 | Pre-flight is fail-soft and bounded — a hung/errored round-trip skips the variant rather than hanging the matrix | VERIFIED | `preflightAgent` wraps the fetch in try/catch/finally, `AbortController` armed at `PREFLIGHT_TIMEOUT_MS` (aliases `COPILOT_PROBE_TIMEOUT_MS`, 90s), never throws (mirrors `probeCopilotHeadless`); unreachable/aborted → `{ok:false, reason:'preflight:<agent>-unreachable'}` |
| 7 | The pre-flight probe + copilot drivability probe create NO Runs-table row (suppression by construction) | VERIFIED | `preflightBody` sets `process:'experiment-preflight'` and NO `task_id` on every body → neutral `token_usage` row excluded from experiment Runs (composite task_ids) and ambient passes by construction; dashboard screenshot (`88-rv88a-runs.png`) confirms no new probe row for rv88a — the only "Reply with the single word OK" row visible is the 16h-old pre-fix one |
| 8 | Dead `EXPERIMENT_PREFLIGHT` sentinel is removed | VERIFIED | `grep -rn EXPERIMENT_PREFLIGHT lib/ scripts/` → 0 matches |
| 9 | A real cross-agent experiment is RE-RUN unattended (not driven interactively) and all three cells execute-or-clean-skip (no silent abort) | VERIFIED | `tests/experiments/_reverify/88-rv88a.log` raw lines: all 3 `[experiment-run] ... status=ran terminal_state=complete`, `matrix complete: 3 cell(s)`; `node tests/experiments/_reverify/assert-cells.mjs` → exit 0 (re-ran live during this verification, same result: claude 11,183 / opencode 28,331 / copilot 57,158 tokens, terminal=complete) |
| 10 | Result confirmed in the dashboard Runs view (e2e), not DB-query-only, with operator sign-off | VERIFIED | `tests/experiments/_reverify/88-rv88a-runs.png` (viewed directly) shows the 3 `compare-fizzbuzz-v9-rv88a--{claude,opencode,copilot}` rows with matching token counts; reverify notes record `Operator sign-off: APPROVED (2026-07-22)` |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/experiments/agent-routing.mjs` | `resolveCellModel` + `buildAgentRoutingEnv` + `COPILOT_MEASURED_DEFAULT_MODEL`, single source of truth | VERIFIED | Exists, exports confirmed, 8,983 bytes, delegated-to by both runner and shell |
| `lib/experiments/agent-headless.mjs` | `preflightAgent` bounded fail-soft `/api/complete` round-trip | VERIFIED | `export async function preflightAgent` present; 4 references to `/api/complete`; `probeCopilotHeadless` kept exported (backward-compat) but no longer called by the runner |
| `lib/experiments/experiment-runner.mjs` | pre-flight wired per-cell, `writeSkipRun` on failure, leaky `probeCopilot()` gate removed | VERIFIED | `preflight(cell.agent,...)` call at line 744; `grep -c "probeCopilot("` → 0 |
| `scripts/launch-agent-common.sh` | copilot measured default sourced from JS helper (not hand-duplicated) | VERIFIED | Line 483 shells to `node lib/experiments/agent-routing.mjs default copilot`; `bash -n` syntax clean |
| `config/experiments/compare-fizzbuzz.yaml`, `compare-avenues-help-v1.yaml` | opencode model fixed to dotted live-catalog id | VERIFIED | Both specs contain `rapid-proxy/claude-haiku-4.5` (grep confirmed) |
| `tests/experiments/agent-routing.test.mjs` | new test file for resolver + env-map contract | VERIFIED | 13 tests, all pass |
| `tests/experiments/_reverify/{88-reverify-notes.md, assert-cells.mjs, 88-rv88a.log, 88-rv88a-runs.png}` | live unattended re-run proof | VERIFIED | All 4 files present; log/screenshot/script cross-checked independently (not just re-reading claims) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `experiment-runner.mjs configureProxyRoutingEnv` | `agent-routing.mjs buildAgentRoutingEnv` | delegation (import + call) | WIRED | Line 76 import, line 257 `return buildAgentRoutingEnv(...)`; former inline `switch` fully removed |
| `experiment-runner.mjs runMatrix` | `agent-headless.mjs preflightAgent` | injectable `preflight` param, called per cell | WIRED | Line 72 import, line 679 default param `preflight = preflightAgent`, line 744 invocation |
| `runMatrix` pre-flight failure | `writeSkipRun` (RUN-04 recorded-skip path) | direct call on `pf.ok===false` | WIRED | Lines 745-751, wrapped in try/catch (non-fatal on write error), still `continue`s the loop |
| `scripts/launch-agent-common.sh` | `lib/experiments/agent-routing.mjs` (CLI mode) | `node ... default copilot` subprocess | WIRED | Line 483, fail-soft fallback to literal on missing node/helper |
| `preflightAgent` request body | proxy `token_usage` suppression | `process:'experiment-preflight'`, no `task_id` | WIRED (by construction, live-confirmed) | Screenshot shows no new probe row for rv88a |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `runMatrix` pre-flight decision | `pf.ok` | live `fetch` to `127.0.0.1:${port}/api/complete` (not injected in production path — `preflight = preflightAgent` default) | Yes — rv88a log shows real HTTP round-trips gating real launches (all 3 passed pre-flight, all 3 launched, all 3 completed with real non-zero tokens) | FLOWING |
| `88-rv88a-runs.png` dashboard rows | Runs table `tokens` column | obs-api / experiments store, populated by real `writeRun` calls during the live rv88a run | Yes — token counts in screenshot (11,183 / 28,331 / 57,158) match the raw log's `writeRun ... totalTokens=` lines exactly | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| agent-routing unit contract | `node --test tests/experiments/agent-routing.test.mjs` | 13 pass / 0 fail | PASS |
| headless + runner pre-flight contract | `node --test tests/experiments/agent-headless.test.mjs tests/experiments/experiment-runner.test.mjs` | 50 pass / 0 fail | PASS |
| dead sentinel removed | `grep -rn EXPERIMENT_PREFLIGHT lib/ scripts/` | 0 matches | PASS |
| no duplicated copilot routing switch | `grep -vE '^\s*//' experiment-runner.mjs \| grep -c "case 'copilot'"` | 0 | PASS |
| reverify disposition assertion (re-run live during this verification) | `node tests/experiments/_reverify/assert-cells.mjs` | exit 0, all 3 cells `terminal=complete`, tokens>0 | PASS |
| raw log cross-check (independent of assert-cells.mjs parsing) | `grep "\[experiment-run\]" 88-rv88a.log` | 3× `status=ran terminal_state=complete` + `matrix complete: 3 cell(s)` | PASS |
| commit hashes in SUMMARYs exist in git history | `git cat-file -e <hash>` × 7 | all 7 OK | PASS |

### Probe Execution

Not applicable — this phase's "probe" concept (`preflightAgent`) is the artifact under test, not a `scripts/*/tests/probe-*.sh` migration-style probe. Covered under Behavioral Spot-Checks above via the unit test suites and the live `assert-cells.mjs` re-run.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ALIGN-01 | 88-01 | Agent-invocation alignment, single source of truth for routing env + model resolution | SATISFIED | `agent-routing.mjs`, delegation in runner + shell launcher, both specs corrected |
| PREFLIGHT-01 | 88-02 | Per-agent pre-flight validation gate, fail-soft, bounded | SATISFIED | `preflightAgent`, wired into `runMatrix`, `writeSkipRun` on failure |
| SUPPRESS-01 | 88-02 | Probe/ambient suppression — no Runs-view pollution | SATISFIED | Neutral `process:'experiment-preflight'`/no-`task_id` body construction; leaky `probeCopilot()` removed; screenshot confirms no new row |
| REVERIFY-01 | 88-03 | Real unattended re-run proving execute-or-clean-skip, e2e dashboard confirmation | SATISFIED | `88-rv88a.log`, `assert-cells.mjs` exit 0, `88-rv88a-runs.png`, operator APPROVED sign-off |

No REQUIREMENTS.md file exists as a separate artifact in this project (requirements are tracked inline in ROADMAP.md); no orphaned requirements found — all 4 IDs declared in ROADMAP.md Phase 88 section are claimed and satisfied by the three plans.

### Anti-Patterns Found

None. Scanned all 4 primary modified files (`lib/experiments/agent-routing.mjs`, `lib/experiments/agent-headless.mjs`, `lib/experiments/experiment-runner.mjs`, `scripts/launch-agent-common.sh`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches. No empty-implementation or hardcoded-empty-data patterns found in the pre-flight/routing code paths.

### Scope Fence Check

Confirmed OUT-of-scope items did NOT leak in:
- No distinct failed/aborted Run UI state added (dashboard unchanged — `git status` shows no dashboard files touched).
- No sandbox `node_modules` changes.
- No CLI-vs-UI launch-panel reconciliation work.
- No per-variant diff viewer.
All three plans stayed confined to `lib/experiments/`, `scripts/launch-agent-common.sh`, `config/experiments/*.yaml`, and `tests/experiments/`.

### Human Verification Required

None outstanding. The one human-verify checkpoint the phase required (dashboard e2e confirmation, Plan 88-03 Task 3) was already completed and operator-approved (2026-07-22) with a saved screenshot independently reviewed during this verification — not merely cited from SUMMARY.md.

### Gaps Summary

No gaps found. All three P0 deliverables (agent-invocation alignment, pre-flight gate, probe/ambient suppression) exist in the codebase, are unit-tested (63 passing tests across the three areas), are wired end-to-end (no orphaned exports, no duplicated routing logic), and are proven live by a real unattended cross-agent re-run whose raw log and dashboard screenshot were independently re-inspected (not merely trusted from SUMMARY.md). The disposition-assertion script was re-executed live during this verification pass and reproduced the same exit-0 result.

---

_Verified: 2026-07-22T08:40:00Z_
_Verifier: Claude (gsd-verifier)_
