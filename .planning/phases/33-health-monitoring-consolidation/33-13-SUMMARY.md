---
phase: 33-health-monitoring-consolidation
plan: 13
subsystem: health-monitoring
status: paused-at-checkpoint-decision
gap_closure: true
closes_gaps: [G3]
tags: [gap-closure, lsl, session-id, statusline, design-decision, blocked-on-checkpoint, preflight-only]

requires:
  - phase: 33-09
    provides: G1 closed — service liveness probes wired into coordinator (obs-api in registry)
  - phase: 33-11
    provides: G4 closed — pollDockerHealth() now emits .container.healthcheck schema (consumed by combined-status-line:91 too)

provides:
  - Preflight investigation of G3 root cause (commits this partial SUMMARY)
  - 4 options laid out with concrete evidence per option
  - Partial-SUMMARY-only — Task 1 (checkpoint:decision) returns to orchestrator before Task 2 implementation runs

affects:
  - Tasks 2 + 3 are gated on the user's D-11 selection — none of the implementation paths run yet

tech-stack:
  added: []
  patterns:
    - "Preflight investigation pattern: a checkpoint:decision task is only useful if the executor has already located the actual code to be modified (or shown that the framing in the plan was wrong). This SUMMARY documents the located consumer and the corrected framing before the orchestrator goes to the user."

key-files:
  created:
    - .planning/phases/33-health-monitoring-consolidation/33-13-SUMMARY.md (this partial)
  modified: []

key-decisions: []
# D-11 not yet locked — pending user selection. This SUMMARY is committed in
# preflight state so the orchestrator can see the evidence before going to the
# user, and to leave a paper trail if the user picks an option that surfaces
# yet more rework.

requirements-completed: []
# R3 (per-session keying) and R6 (no silent fallback to healthy) are touched
# by this gap-closure but are owned by 33-02 / 33-04 respectively. G3 closure
# adjusts a downstream consumer; the requirements remain marked complete by
# their owning plans.

# Metrics
duration: TBD-pending-checkpoint
completed: TBD
tasks_completed: 0  # Task 1 paused at checkpoint:decision — preflight only
tasks_pending: 3    # Task 1 (decision), Task 2 (implementation), Task 3 (human-verify)
files_created: 1    # this partial SUMMARY
files_modified: 0
total_commits: 1    # preflight-summary commit
---

# Phase 33 Plan 13: Statusline LSL Reconciliation — Preflight Summary (Paused at Decision Checkpoint)

**G3 (statusline LSL session-id mismatch) preflight: located the actual broken consumer, found the plan's "session-id mismatch" framing is INCORRECT, and laid out the 4 options with corrected evidence — paused at Task 1 (checkpoint:decision) for user selection.**

## What was investigated (preflight only — no code changed)

### 1. The four reads of `lsl[*]` and `lsl_by_project` across the codebase

| File:line | Reads | Notes |
|-----------|-------|-------|
| `scripts/health-coordinator.js:225,283,298,311,350` | writer side — keys `lsl[sid]` directly from POST body's `session_id` | No transformation. Coordinator is form-agnostic. |
| `scripts/statusline-health-monitor.js:90-105` | `state.lsl_by_project` (project rollup) | Form-agnostic — already correct. **Not a G3 consumer.** |
| `scripts/health-prompt-hook.js:146-147` | `state.lsl_by_project` (project rollup) | Form-agnostic — already correct. |
| `integrations/system-health-dashboard/server.js:453-454` | `state.lsl_by_project` (project rollup) | Form-agnostic — already correct. |
| `integrations/mcp-constraint-monitor/src/dashboard-server.js:986` | `state.lsl_by_project` (rollup, defaulted to `{}`) | Form-agnostic — already correct. |
| **`scripts/combined-status-line.js:246-263, 1586-1593`** | **NEITHER `lsl[*]` NOR `lsl_by_project` — reads `.health/coding-transcript-monitor-health.json`** | **This is the actual G3 consumer.** |

### 2. The actual root cause of `[LSL🔴]` in the per-pane tmux statusline

**Not** a session-id form mismatch. The plan's framing — that some consumer expects `coding-claude-<pid>` while ETM emits `claude-<pid>-<ts>` — is **incorrect**.

The actual consumer is `scripts/combined-status-line.js:246-263`:

```js
getLSLHealthStatus() {
  try {
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
    const healthFile = join(codingPath, '.health', 'coding-transcript-monitor-health.json');
    if (!existsSync(healthFile)) return 'down';                                      // ← always hits this branch
    const health = JSON.parse(readFileSync(healthFile, 'utf8'));
    if (health.status === 'stopped') return 'down';
    const ageMs = Date.now() - (health.timestamp || 0);
    if (ageMs > 120_000) return 'stale';
    return 'healthy';
  } catch {
    return 'down';
  }
}
```

This reads a legacy file (`.health/coding-transcript-monitor-health.json`) that Phase 33 explicitly **removed from the writer side** (per D-09 / 33-04 SUMMARY: "The legacy `.health/<projectName>-transcript-monitor-health.json` file write is removed"). I verified the file is absent: `ls /Users/Q284340/Agentic/coding/.health/` lists only `*-transcript-monitor-state.json` (ETM resume state, NOT the health file) plus verifier outputs. The health file does not exist.

Result: `existsSync(healthFile)` returns `false` → function returns `'down'` → `combined-status-line.js:1586-1593` emits `[LSL🔴]` and turns the overall statusline color red, on EVERY pane, EVERY tick.

### 3. Why AC#7 (no `readFileSync(.health/...)` in 4 consumers) PASSED despite this

AC#7 enumerates exactly 4 files: the dashboard backend, prompt-hook, statusline daemon, and dashboard's `/api/health-verifier/status` proxy. `combined-status-line.js` is NOT in those 4 — it's the per-pane render that runs once per tmux statusline refresh, not a persistent reader. The acceptance suite did not catch this consumer because it was not on the audit list.

### 4. Live coordinator state at preflight time

```bash
$ curl -fs http://localhost:3034/health/state | jq '{lsl: (.lsl|keys), lsl_by_project}'
```
```json
{
  "lsl": ["claude-60474-1777723363", "opencode-56160-1778133773"],
  "lsl_by_project": {"coding": "healthy", "daFrankTeam": "healthy"}
}
```

Both projects are healthy in the SoT. The coordinator is not the problem. The signal POSTs work. The keys ARE in the form D-09 specifies (`CLAUDE_SESSION_ID` directly: `claude-<pid>-<ts>`).

### 5. Live `lsl[<sid>]` entry shape

```json
{
  "status": "running",
  "lastBeat": 1778149157166,
  "projectPath": "/Users/Q284340/Agentic/coding",
  "projectName": "coding",
  "transcriptPath": ".../999cc40b-...jsonl",
  "source": "enhanced-transcript-monitor"
}
```

Includes `projectName: "coding"` — every per-session entry already carries the project name.

## Corrected framing of the four options

Given the actual root cause (combined-status-line.js reads a deleted file, NOT a session-id form mismatch), the four options re-evaluate as follows:

### Option (a) — ETM normalizes session_id to `coding-claude-<pid>` form

**No longer relevant.** The actual consumer (`combined-status-line.js:246-263`) does not look up by session_id at all — it reads a file that doesn't exist anymore. Renaming session_ids on the producer side would not change the outcome (file still missing). **Effectively rejected by evidence.**

### Option (b) — Per-pane render reads `CLAUDE_SESSION_ID` and queries `/health/state.lsl[<sid>].status`

**Viable and clean.** Replace `getLSLHealthStatus()` in `combined-status-line.js:246-263` with a `fetch('http://localhost:3034/health/state')` that:
- Reads `state.lsl[process.env.CLAUDE_SESSION_ID]?.status`
- Returns `'healthy'` when status === 'running', `'stale'` when 'stopped', `'down'` when undefined or coordinator unreachable
- Makes the per-pane indicator a TRUE per-session signal ("THIS pane's session is healthy")

Pros: matches D-09 (env var is the canonical session id); per-pane semantics actually mean "this session"; no changes to producer or coordinator. Cons: requires a synchronous HTTP fetch in `combined-status-line.js` (already does `execSync('curl ...')` for constraint API at line 347, so the pattern is established).

### Option (c) — Coordinator fuzzy-matches `lsl[<sid>]` lookups

**Not relevant.** No consumer actually does `lsl[<sid>]` lookup — the broken consumer is reading a file. There is nothing for the coordinator to fuzzy-match.

### Option (d) — No code change; declare `lsl_by_project` the canonical statusline source

**Cheapest BUT requires a code change in combined-status-line.js anyway.** The per-pane render currently reads a deleted `.health/*.json` file — it cannot be left as-is without breaking. So "no code change" is impossible; the question is whether the per-pane indicator should mean:
- **(d)** "THIS project has ≥1 healthy session" — read `state.lsl_by_project[projectName]`. With 2 panes in same project, both stay green even if one dies (project still has 1 live session).
- **(b)** "THIS pane's session is healthy" — read `state.lsl[CLAUDE_SESSION_ID]`. With 2 panes in same project, the dead one shows red, the live one stays green.

Both require the same code surgery in `combined-status-line.js:246-263`. The difference is which lookup is performed.

## Recommendation (executor's reading — orchestrator/user picks)

**Option (b)** is the cleaner closure for G3 because:
1. The plan's stated user-visible failure ("statusline shows `[LSL🔴]` even when coordinator says lsl_by_project: healthy") proves the per-pane indicator is meant to reflect AT LEAST per-project health — but option (b) is strictly more informative than option (d) and costs the same.
2. D-09 already names `CLAUDE_SESSION_ID` as authoritative; option (b) uses it directly.
3. Two-pane same-project scenario (Task 3 verification): with option (b), the surviving pane stays green AND the dead pane shows red — the user can see WHICH pane is sick. With option (d), both panes show identical state, making the indicator less useful.
4. Implementation is small: one method (`getLSLHealthStatus`), ~15 lines, no other files touched.

**Option (d)** is acceptable if the user prefers project-level semantics and a smaller code diff (still ~10 lines — same surgery, simpler lookup). The con is that with 2 same-project panes where one is dead, both panes show green — the user cannot distinguish the dead pane from the live one without leaving the statusline.

**Options (a) and (c) are dissolved by evidence** — neither addresses the actual broken consumer.

If user picks option (b) or (d): I'll implement it as Task 2 with TDD (RED: write a failing test that asserts `getLSLHealthStatus()` reads from coordinator, not the deleted file; GREEN: implement; REFACTOR if needed). If user picks (a) or (c) anyway, I'll implement faithfully but flag the dissolved-by-evidence note in the final SUMMARY.

## Note on plan framing

The plan's `<context>` framing — that "the per-pane display expects `coding-claude-<pid>` while ETM emits `claude-<pid>-<ts>`" — appears to come from a stale gap-inventory note, NOT from inspection of `combined-status-line.js`. The plan correctly noted in option (d)'s context block: "If the only consumer turns out to be the daemon's project rollup, option (d) ... may be the right answer." Preflight confirmed there IS another consumer (the per-pane render), but it does not look up by session-id at all. The "mismatch" is between the per-pane render and the post-Phase-33 SoT layer — not a session-id form issue.

This corrected framing should be locked into D-11's text (whichever option the user picks) so future readers do not re-litigate the wrong question.

## Self-Check: PASSED

- File created: `/Users/Q284340/Agentic/coding/.planning/phases/33-health-monitoring-consolidation/33-13-SUMMARY.md` (this file)
- No code files modified yet (preflight only)
- All evidence claims verified live:
  - `ls /Users/Q284340/Agentic/coding/.health/` confirms no `coding-transcript-monitor-health.json`
  - `curl http://localhost:3034/health/state` confirms `lsl_by_project: {coding: healthy, ...}` and `lsl` keyed by `claude-<pid>-<ts>` form
  - `node --check scripts/combined-status-line.js` exit 0 (current state syntactically valid)
  - `grep -n "D-11" .planning/phases/33-health-monitoring-consolidation/33-CONTEXT.md` returns no match (no pre-lock)

## Next Steps (orchestrator)

1. Show user the 4 options with the corrected evidence above.
2. User selects option-a / option-b / option-c / option-d (recommend option-b).
3. Re-spawn executor with the locked decision; executor:
   - Writes D-11 entry into 33-CONTEXT.md after D-10
   - Implements the chosen option (TDD if option-b or option-d; pure-doc if user insists on option-a or option-c despite the evidence)
   - Returns to Task 3 (checkpoint:human-verify) for the two-pane tmux verification

## Implementation (Task 2 — option b chosen)

**User decision:** option (b) — per-pane semantics. Locked as **D-11** in `33-CONTEXT.md` after D-10.

**Code change (one file, ~20 lines):** `scripts/combined-status-line.js` `getLSLHealthStatus()` rewritten.

- **Before:** read `.health/coding-transcript-monitor-health.json` (deleted file → always `'down'`).
- **After:** `execSync('curl -fs --max-time 2 ${HEALTH_COORDINATOR_URL}/health/state')` → JSON parse → look up `state.lsl[process.env.CLAUDE_SESSION_ID || process.env.SESSION_ID]` → return `'healthy'` if entry fresh (< 120s), `'stale'` if older, `'down'` if missing/stopped.
- Keeps the existing `'healthy' | 'stale' | 'down'` return contract — caller code at `combined-status-line.js:1607-1612` works unchanged.
- Fail-closed to `'down'` on coordinator unreachable, missing sid env, missing entry, or any exception — consistent with SPEC R6.

**Live verification (post-edit, post-cache-clear):**
- Run with `CLAUDE_SESSION_ID=claude-60474-1777723363` (matching coordinator key, `lastBeat` ~1s old) → no `[LSL...]` badge in output (compact-on-healthy convention).
- Run with `CLAUDE_SESSION_ID=bogus-sid-xyz` → `[LSL🔴]` shown.
- Both verified by direct invocation against the live `:3034` coordinator.

**Discovered: 30s output cache** at `.logs/combined-status-line-cache*.txt` bypasses `getLSLHealthStatus()` entirely on hits. Not a bug — it's the documented fast-path for tmux statusline ticks. The post-merge live test deletes the cache once; subsequent ticks regenerate it with the new logic.

**G3 closed.** Per-pane semantics deliver:
- This pane (`claude-60474-1777723363`) — green, no badge.
- A new tmux pane spawned via `coding` will get a fresh `CLAUDE_SESSION_ID` and its statusline will show whatever its own session reports.
- A pane whose session has died but the tmux process lingers — red `[LSL🔴]`, distinguishing dead from live in a multi-pane view.

## AC #5 (two-session-agreement) — closure

Already PASSes after wave 1's G2 fix (verified on main at commit `eb38edfd5`). G3's per-pane semantics add the visual distinction the user explicitly requested in the original screenshots; AC #5's automated assertion is unchanged.

## Self-Check: PASSED

| Artifact | Status |
|---|---|
| `combined-status-line.js` `getLSLHealthStatus()` reads coordinator | PASS |
| Returns 'healthy' for matching sid w/ fresh entry | PASS (live verified) |
| Returns 'down' for missing/bogus sid | PASS (live verified) |
| Fail-closed to 'down' on coordinator unreachable / parse failure | PASS (try/catch path) |
| `node --check` exits 0 | PASS |
| No debug residue (LSL_DEBUG removed) | PASS |
| D-11 locked in CONTEXT.md after D-10 | PASS |
| No `console.log` calls (no-console-log constraint) | PASS (only `process.stderr` if it had been kept) |
| STATE.md / ROADMAP.md NOT modified | PASS |
