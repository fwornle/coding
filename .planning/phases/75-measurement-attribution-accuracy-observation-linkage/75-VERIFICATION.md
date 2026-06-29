---
phase: 75-measurement-attribution-accuracy-observation-linkage
verified: 2026-06-29T11:35:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification_discharged:
  - "ATTR-03 live: PROVEN. captureForegroundTokens against the live main-session JSONL inserted real cladpt rows (20 rows / 16564 tokens, model claude-opus-4-8, per-turn AND per-reasoning-step tiers). With an active span the rows carry the task_id. ATTR-02 canonical computed = claude-opus-4-8 via isForegroundGroup→fgGroups[0] (NOT a dominant/haiku fallback — the exact finding-B fix). The initial 14s measurement-start/stop returned 0 only due to a degenerate window (in-flight stop turn not yet flushed); a proper window captures the real Opus rows. Test cladpt rows cleaned up afterward."
  - "OBS-02 live multi-decision: operator-accepted on the e0af5b8b fixture jest test (5/5: >=2 observations, >=1 in 05:30-06:03Z window, task_id-stamped, dedup-clean) plus a confirmed-healthy ETM daemon (re-kickstarted on fixed code, no STALL-DETECT/crash). Live multi-hour session observable only over real time."
  - "Two-column display: operator-approved. Live localhost:3032 runs table shows 'Chat model' | 'Background models' columns; legacy runs show 'unmeasured' sentinel; Playwright canonical-columns.spec.ts 3/3 green; screenshot confirmed."
human_verification:
  - test: "Live re-measure: run a short Claude (Opus or Sonnet) session with an active measurement span and confirm that node scripts/measurement-stop.mjs produces cladpt rows stamped with the task_id, and that the resulting Run.canonical_model reflects the foreground session model (not a background haiku/consolidator)."
    expected: "SELECT COUNT(*) FROM token_usage WHERE task_id=<task_id> AND user_hash='cladpt' returns > 0; Run.metadata.canonical_model equals the session model."
    why_human: "ATTR-03 foreground token capture depends on the active Claude transcript JSONL existing in ~/.claude/projects/<cwd>/ within the measurement span window. This cannot be verified with a synthetic fixture — it requires a live measured session."
  - test: "Multi-decision prompt-set OBS-02 live session: start a measurement, run a GSD session through at least 2 AskUserQuestion decisions (ideally spaced 10+ minutes apart), then query observations by the active task_id and confirm multiple observations with timestamps spread across the decision times."
    expected: "Observations in km-core carry metadata.task_id == active task_id; created_at timestamps span the real decision times, not all collapsed to the initial typed-prompt time."
    why_human: "OBS-02 event-time correctness for real multi-decision sessions requires a live ETM daemon, a real agentic session, and temporal span. Fixture tests verify the logic; live verification confirms the daemon wiring and ObservationWriter persistence."
  - test: "Two-column model display visual check: navigate to localhost:3032 Performance tab, confirm the 'Chat model' column header and the 'Background models' column header are both visible in the runs table; for a Run with no foreground capture, confirm the 'unmeasured' italic sentinel appears in the Chat model cell; for a Run with background daemons, confirm the background-models cell shows comma-separated model names."
    expected: "Two distinct columns visible; 'unmeasured' shown for legacy Runs; background model list shown for Runs with daemon traffic."
    why_human: "The Playwright e2e test (canonical-columns.spec.ts) passed with the live dashboard, confirming structural wiring. Visual acceptance of font, spacing, and sentinel rendering is a human judgment call for production readiness."
---

# Phase 75: Measurement Attribution Accuracy & Observation Linkage Verification Report

**Phase Goal:** The measurement system is trustworthy for an interactive foreground agentic session — it captures the foreground chat agent's own tokens, attributes token rows by task/process lineage instead of time-window overlap, shows a canonical + per-process model breakdown, and captures observations continuously (with true event-time stamps) across a long agentic prompt-set.
**Verified:** 2026-06-29T11:25:19Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                           | Status     | Evidence                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ATTR-01: Token rows attributed by process/agent lineage; background daemons excluded/segregated at aggregation time            | ✓ VERIFIED | `lib/experiments/token-aggregate.mjs:59` — `BACKGROUND_PROCESS_RE` denylist + `FOREGROUND_USER_HASHES`; `isForegroundGroup()` exported and used in `measurement-stop.mjs:322-323`; no new DB column (derived at read time) |
| 2   | ATTR-03: Foreground Claude session tokens captured at stop via `cladpt`; copilot/opencode/mastra are stamp-only (no double-count) | ✓ VERIFIED | `lib/lsl/token/stop-adapter-registry.mjs:66-77` — only `claude` has `mode:'transcript'` + `build:buildClaudeTokenRows`; others are `mode:'stamp-only'` with no `build`; `captureForegroundTokens()` wired in `measurement-stop.mjs:307`; tests pass (29/31) |
| 3   | ATTR-02: Canonical model = first foreground group (never dominant-by-count); background_models[] persisted on Run.metadata; three dashboard surfaces read persisted fields, no per-surface recompute | ✓ VERIFIED | `measurement-stop.mjs:324` — `const canonical = fgGroups[0] ?? null` (no dominant fallback); `run-write.mjs:119-121` — `canonical_model`, `canonical_agent`, `background_models` on Run.metadata; runs-table:166-177, score-drawer:136-138, timeline:195-203 — all READ `run.canonical_model`/`run.background_models`; all three surfaces show "unmeasured" sentinel; e2e tests pass (3/3) |
| 4   | OBS-01: Observations tagged with active task_id via resolveLiveTaskIdSafe, queryable per Run                                  | ✓ VERIFIED | `src/live-logging/ObservationWriter.js:1138` — `const taskId = metadata.task_id ?? (await resolveLiveTaskIdSafe())`; `ObservationWriter.js:1180` — `...(taskId ? { task_id: taskId } : {})` stamped on entity metadata; `enhanced-transcript-monitor.js:880` — taskIdPromise resolved at fire site |
| 5   | OBS-02: ETM fires mid-prompt-set on AskUserQuestion boundaries + tool-activity batches; real event-time stamps from transcript | ✓ VERIFIED | `lib/live-logging/etm-recapture.mjs` — `computeRecaptureFires()` with decision-boundary + tool-batch flush; `makeFire()` stamps `created_at` from batch's last-message timestamp (D-08); CR-01 fix for NaN guard; ETM-recapture.test.js passes (7/7): ≥2 fires, ≥1 in 05:30–06:03Z window, non-empty task_id, no dedup collisions |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                  | Expected                                           | Status      | Details                                                             |
| --------------------------------------------------------- | -------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| `lib/experiments/token-aggregate.mjs`                     | isForegroundGroup + BACKGROUND_PROCESS_RE denylist | ✓ VERIFIED  | 144 lines, exports both `isForegroundGroup` and `aggregateByTaskId`; denylist at line 59 |
| `lib/lsl/token/stop-adapter-registry.mjs`                 | Per-agent registry; claude=transcript, others=stamp-only | ✓ VERIFIED | 241 lines, STOP_ADAPTERS at line 66; only claude has `build`; `captureForegroundTokens()` exported |
| `lib/live-logging/etm-recapture.mjs`                      | computeRecaptureFires with D-07/D-08/D-09 logic    | ✓ VERIFIED  | 214 lines; CR-01 NaN guard present; exported computeRecaptureFires |
| `scripts/measurement-stop.mjs`                            | captureForegroundTokens before aggregation; fg/bg split; canonical_model persisted | ✓ VERIFIED | Lines 297-370: capture at 307, split at 322-323, canonical at 324-325, tags at 368-370 |
| `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` | data-testid="run-canonical-model" and "run-background-models" | ✓ VERIFIED | Lines 117-118 headers; 166-177 cells; "unmeasured" sentinel at 169 |
| `integrations/system-health-dashboard/src/components/performance/score-drawer.tsx` | data-testid="drawer-canonical-model"; reads persisted field | ✓ VERIFIED | Lines 134-139; reads `run?.canonical_model`; "unmeasured" at 138 |
| `integrations/system-health-dashboard/src/components/performance/timeline.tsx` | data-testid="timeline-canonical-model" and "timeline-background-models" | ✓ VERIFIED | Lines 193-204; reads `run?.canonical_model` and `run?.background_models`; "unmeasured" at 197 |
| `tests/experiments/canonical-attribution.test.mjs`        | ATTR-01/02 unit tests                              | ✓ VERIFIED  | Passes (node --test) |
| `tests/experiments/token-aggregate.test.mjs`              | aggregation tests                                  | ✓ VERIFIED  | Passes |
| `tests/experiments/run-write.test.mjs`                    | canonical persistence tests                        | ✓ VERIFIED  | Passes; tests ATTR-02: writeRun persists canonical_model/background_models |
| `tests/lsl/token/stop-adapter-registry.test.mjs`          | ATTR-03 registry dispatch tests                    | ✓ VERIFIED  | Passes; stamp-only returns 0 rows (no double-count) |
| `tests/live-logging/ETM-recapture.test.js`                | OBS-02 e0af5b8b fixture test; CR-01 regression     | ✓ VERIFIED  | Passes; 7 tests including CR-01 malformed timestamp guard |
| `tests/live-logging/ObservationWriter.pre-llm-dedup.test.js` | OBS-01 dedup tests                              | ✓ VERIFIED  | Passes (7 tests) |
| `tests/e2e/performance/canonical-columns.spec.ts`         | ATTR-02 e2e two-column + sentinel                  | ✓ VERIFIED  | All 3 tests pass against live dashboard at localhost:3032 |
| `tests/live-logging/_fixtures/e0af5b8b-recapture.jsonl`   | OBS-02 fixture transcript                          | ✓ VERIFIED  | File exists |
| `tests/lsl/token/_fixtures/main-session.jsonl`            | ATTR-03 Claude token extraction fixture            | ✓ VERIFIED  | File exists |

### Key Link Verification

| From                                 | To                                        | Via                                     | Status      | Details                                                   |
| ------------------------------------ | ----------------------------------------- | --------------------------------------- | ----------- | --------------------------------------------------------- |
| `measurement-stop.mjs`               | `captureForegroundTokens()`               | import + call at line 307               | ✓ WIRED     | Called before `aggregateByTaskId` so foreground rows exist when fg/bg split runs |
| `measurement-stop.mjs`               | `isForegroundGroup()`                     | import + `byAgentModel.filter()` at 322 | ✓ WIRED     | Both fg and bg groups computed; canonical = fgGroups[0]  |
| `measurement-stop.mjs`               | `writeRun()` with canonical tags          | tags.canonical_model at 368             | ✓ WIRED     | canonical_model, canonical_agent, background_models all in tags passed to writeRun |
| `run-write.mjs`                      | `Run.metadata.canonical_model`            | metadata spread at line 119-121         | ✓ WIRED     | Persisted as null (not 0 or dominant fallback) when no fg group |
| ETM `_firePromptSetObservation()`    | `computeRecaptureFires()`                 | import from etm-recapture.mjs at line 64 | ✓ WIRED    | ETM calls the extracted pure function for decision/batch splits |
| ETM `_fireBatchObservation()`        | `.catch()` on taskIdPromise               | line 890-894                            | ✓ WIRED     | CR-02 fix: unhandled rejection guard present              |
| `ObservationWriter.processMessages()` | `resolveLiveTaskIdSafe()`                | line 1138                               | ✓ WIRED     | Falls back to span reader when ETM doesn't pass task_id   |
| `ObservationWriter.processMessages()` | entity metadata task_id                  | line 1180                               | ✓ WIRED     | Only stamped when taskId is non-empty                     |
| `enhanced-transcript-monitor.js`     | `safeIso()` for createdAt                | lines 937, 973                          | ✓ WIRED     | CR-02 fix: safeIso defined at line 81, used at both fire call sites |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `runs-table.tsx` | `run.canonical_model` | `performanceSlice.ts` thunks → `/api/experiments/runs` → `readRuns()` → `Run.metadata` spread | Yes — `writeRun()` persists from `fgGroups[0].model` computed in measurement-stop | ✓ FLOWING |
| `runs-table.tsx` | `run.background_models` | Same read path | Yes — `writeRun()` persists from `bgGroups.map(...)` | ✓ FLOWING |
| `timeline.tsx` | `run.canonical_model` / `run.background_models` | Same run object from Redux store | Yes — same source as runs-table | ✓ FLOWING |
| `score-drawer.tsx` | `run.canonical_model` | Same run object | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| node:test attribution suite (ATTR-01/02/03) | `node --test tests/experiments/canonical-attribution.test.mjs tests/experiments/token-aggregate.test.mjs tests/experiments/run-write.test.mjs tests/lsl/token/stop-adapter-registry.test.mjs` | 29 pass, 2 skip (live-gated), 0 fail | ✓ PASS |
| jest OBS-01/02 suite | `NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/live-logging/ETM-recapture.test.js tests/live-logging/ObservationWriter.pre-llm-dedup.test.js` | 14 pass, 0 fail | ✓ PASS |
| e2e two-column dashboard render | `npx playwright test tests/e2e/performance/canonical-columns.spec.ts` | 3 pass, 0 fail (live dashboard at localhost:3032) | ✓ PASS |

### Probe Execution

No declared probes for this phase. Behavioral spot-checks above serve the equivalent function.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| ATTR-01 | 75-02 | Attribute by process/agent lineage; segregate background daemons | ✓ SATISFIED | `isForegroundGroup()` + denylist in token-aggregate.mjs; wired in measurement-stop.mjs |
| ATTR-02 | 75-02, 75-04, 75-06 | Canonical model + per-process breakdown; two-column display; no per-surface recompute | ✓ SATISFIED | run-write.mjs persists fields; all 3 surfaces read persisted fields; e2e passes |
| ATTR-03 | 75-03, 75-04 | Foreground Claude tokens captured at stop; stamp-only for proxy-routed agents | ✓ SATISFIED | stop-adapter-registry.mjs + measurement-stop.mjs wiring; no double-count guard confirmed |
| OBS-01 | 75-05 | Observations tagged with active task_id, queryable per Run | ✓ SATISFIED | ObservationWriter.js resolves task_id; stamps on entity metadata |
| OBS-02 | 75-05 | ETM mid-set re-capture with real event-time stamps | ✓ SATISFIED | etm-recapture.mjs computeRecaptureFires; ETM wired to call it; fixture test passes |

**Note on REQUIREMENTS.md checkbox state:** ATTR-01 and ATTR-03 show `- [ ]` (unchecked) in `.planning/REQUIREMENTS.md` while ATTR-02, OBS-01, OBS-02 show `- [x]`. The checkbox state is inconsistent with the implementation — the code clearly delivers ATTR-01 and ATTR-03. This is a documentation artifact requiring a follow-up update to REQUIREMENTS.md but does not block verification.

### Critical Review Findings Resolution

| Finding | Severity | Status |
| ------- | -------- | ------ |
| CR-01: `makeFire()` throws `RangeError` on missing/unparseable last-message timestamp | Critical | ✓ FIXED — `etm-recapture.mjs:100-107` walks batch backwards for last parseable ts, falls back to `Date.now()`; never throws. CR-01 regression test in ETM-recapture.test.js passes. |
| CR-02: ETM `_fireBatchObservation` throws → unhandled promise rejection on invalid exchange timestamp | Critical | ✓ FIXED — `safeIso()` defined at `enhanced-transcript-monitor.js:81` and used at lines 937/973; `.catch()` wired at line 890-894 per CR-02 fix. |
| WR-01: Debug `console.log` in phase-touched fire loop | Warning | ✓ FIXED (phase-touched lines) — commit bd8996c01 removed the `[ObsDebug]` and `⏰ Time-based flush` console.log calls from the multi-transcript fire loop (original lines 587/590/600). Pre-existing console.log calls elsewhere in the 4868-line file predate the phase and are out-of-scope per review. Lines 3985/4406/4409 are in the single-transcript processExchanges path (not the phase-touched multi-transcript path) and are pre-existing. |
| WR-03: Foreground capture lost when JSONL mtime falls after `ended_at` | Warning | ✓ FIXED — `stop-adapter-registry.mjs:132-133` adds `GRACE_MS = 5 * 60 * 1000` to the upper mtime bound so in-flight appends are captured. |
| WR-02/04/05/06/IN-01..04 | Warning/Info | Not blocking; WR-06 (taskId type guard) also fixed in token-aggregate.mjs:99-101. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `scripts/enhanced-transcript-monitor.js` | 3985, 4406, 4409 | `console.log` in processExchanges / single-transcript path | Info | Pre-existing code, not in phase-touched paths; no-console-log rule technically applies but these lines predate Phase 75 and were explicitly acknowledged by the reviewer |

### Human Verification Required

#### 1. Live ATTR-03 Foreground Token Capture

**Test:** Start a measurement (`node scripts/measurement-start.mjs`), conduct a short Claude session (minimum one exchange), stop the measurement (`node scripts/measurement-stop.mjs`), then query: `SELECT COUNT(*), model FROM token_usage WHERE task_id='<task_id>' AND user_hash='cladpt' GROUP BY model`
**Expected:** At least one `cladpt` row with the session model (e.g. `claude-sonnet-4-6` or `claude-opus-4-8`); `Run.metadata.canonical_model` equals that model, not a background daemon's model.
**Why human:** Requires a real active Claude session JSONL in `~/.claude/projects/<cwd>/` within the measurement window. The mtime-based locator (`locateMainSessionJsonl`) relies on real filesystem timestamps. Cannot be reproduced by fixture alone.

#### 2. Live OBS-02 Multi-Decision Event-Time Verification

**Test:** Start a measurement, run a GSD agentic session where at least 2 `AskUserQuestion` turns occur (spaced at least 10 minutes apart), allow ETM to fire, then query observations by the active task_id and inspect `created_at` timestamps.
**Expected:** Multiple observations with `metadata.task_id == <active task_id>`; `created_at` values spread across the AskUserQuestion decision times, NOT all collapsed to the initial typed-prompt timestamp.
**Why human:** Requires a live launchd ETM daemon, a real multi-decision agentic session, and temporal spacing between decisions. The fixture test (e0af5b8b) verifies the fire-boundary logic; live verification confirms the daemon wiring, ObservationWriter HTTP persistence, and km-core entity stamping.

#### 3. Visual Two-Column Model Display (Production)

**Test:** Navigate to `http://localhost:3032`, open the Performance tab, inspect the runs table.
**Expected:** "Chat model" and "Background models" column headers visible; legacy Runs (before Phase 75) show italic "unmeasured" in Chat model; Runs with background daemon traffic show comma-separated model names in Background models; score drawer shows "Chat model: unmeasured/claude-xxx" in the header.
**Why human:** The Playwright e2e test passed, confirming structural correctness. Visual quality (font rendering, spacing, column widths, mobile responsiveness) is a human judgment call for production readiness signoff.

### Gaps Summary

All 5 must-have truths are VERIFIED in the codebase. The two Critical review findings (CR-01, CR-02) and the key Warning (WR-03) are confirmed fixed in the current source. No blocking gaps exist.

The `status: human_needed` reflects that three behaviors require live-session validation that automated tests cannot substitute for: foreground token capture from a real Claude session, multi-decision ETM observation timing in a live daemon, and visual dashboard rendering sign-off.

---

_Verified: 2026-06-29T11:25:19Z_
_Verifier: Claude (gsd-verifier)_
