---
phase: 78-autonomous-cross-agent-runner
verified: 2026-07-13
status: passed
requirements: [RUN-02, RUN-03, RUN-04]
method: live cross-agent smoke (78-05) + operator sign-off
operator_signoff: approved 2026-07-13
---

# Phase 78 Verification — Autonomous Cross-Agent Runner

**Verdict: `passed`** — RUN-02/03/04 satisfied via the live 78-05 cross-agent smoke gate, operator-approved.

## Evidence (live)

The runner engine (`lib/experiments/experiment-runner.mjs`, `scripts/experiment-run.mjs`) was exercised end-to-end on **real agents** via `config/experiments/smoke-cross-agent.yaml` (experiment `exp-3ec6afa7a1c5`, 2026-07-13). This closes the gap the milestone audit flagged (engine built + exercised on 36 prior Runs, but never verified through its own designated gate).

| REQ | Evidence | Verdict |
|-----|----------|---------|
| **RUN-02** (launch agent autonomously, wrap in measured span tagged variant/repeat/task_hash) | claude + opencode + copilot each launched unattended; a measurement span opened/closed per cell; `writeRun` recorded `variant`/`repeat`/`task_hash` per cell | **satisfied** |
| **RUN-03** (unattended to completion/timeout/abort; scored Run per cell; terminals recorded) | 3 cells → 3 Runs, all `terminal_state=complete`, each scored (`not_scored=trivial`); `readRuns` 36→39; no operator steering | **satisfied** |
| **RUN-04** (copilot gated on headless-drivability probe; recorded, never silently absent) | copilot probe ran live → `true`; copilot cell executed and recorded a Run (never silently absent) | **satisfied (run-branch)** |

## Blast radius (D-02): zero

`git status` on the live checkout after the run: **no `HELLO.txt`, no agent source edits**. All cell edits confined to isolated sandbox worktrees (`restoreForCell inPlace:false`). Trust boundary "agents → live checkout" held.

## Documented residuals (non-blocking, operator-acknowledged)

1. **Copilot cell empty due to a provider 500** — the copilot LLM endpoint returned `500` on all attempts; the runner correctly launched/measured/recorded the cell (`complete`, 0 tokens), proving the run-branch and recording behavior. A re-run when the provider recovers yields a working copilot cell. Not a runner defect.
2. **RUN-04 skip-branch unit-only** — the probe passed in this environment, so the negative skip-branch (`copilot-headless-unsupported` recorded skip) was not live-exercised; it remains unit-tested. Forcing it needs an environment where copilot is genuinely undriveable.
3. **Mastra omitted** — frozen `KNOWN_AGENTS` enum; 3-agent smoke satisfies SC#4's "≥2 agents." Enum extension is a documented follow-up.
4. **Baseline snapshot hygiene** — `smoke-spec` references a gc'd `lib/km-core` submodule commit; restore proceeded best-effort. Refresh the baseline in a follow-up.

## Sign-off

Operator approved the 78-05 human-verify checkpoint on 2026-07-13: one scored Run landed per cell with terminal states recorded and the live tree clean.
