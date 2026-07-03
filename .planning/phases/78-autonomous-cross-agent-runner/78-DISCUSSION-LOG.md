# Phase 78: Autonomous Cross-Agent Runner - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 78-autonomous-cross-agent-runner
**Areas discussed:** Launch mechanism + sandbox, Done/timeout/abort, Copilot headless spike, Matrix orchestration, Agent scope, Timeout default

---

## Launch mechanism + sandbox (RUN-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Thin adapter over `config/agents/*.sh` | Reuse per-agent launch scripts via a small headless adapter; cwd = restored sandbox worktree, `LLM_PROXY_DATA_DIR` = sandbox `.data`. | ✓ |
| New standalone driver layer | Fresh per-agent driver module independent of `config/agents/*.sh`. | |
| Shell out to `bin/coding` non-interactively | Invoke the interactive launcher in a headless mode per cell. | |

**User's choice:** Thin adapter over `config/agents/*.sh` (Recommended)
**Notes:** Least new surface; keeps agent invocation in one place; agent edits + token rows stay in the isolated sandbox (D-01/D-02/D-03).

---

## Done / timeout / abort (RUN-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Process exit; timeout kills+records; test_command scores | exit(0)=complete; wall-clock timeout→`timeout`; non-zero/killed→`abort`; test_command runs after for scoring only. | ✓ |
| test_command passing is the completion gate | Run is done only when its test_command passes. | |
| Agent writes a sentinel/marker | Completion via an explicit done-marker file. | |

**User's choice:** Process exit; timeout kills+records; test_command scores (Recommended)
**Notes:** All three terminal states recorded on the Run, never dropped (D-04/D-05).

---

## Copilot headless spike (RUN-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal one-turn probe, skip-with-reason on the cell | "Can Copilot run one headless turn and exit 0?"; recorded-skip on failure. | ✓ |
| Fuller end-to-end drive attempt | Attempt a real headless drive before deciding. | |
| Assume unsupported now, hard-skip with static reason | Static skip given the known injection limitation. | |

**User's choice:** Minimal one-turn probe, skip-with-reason on the cell (Recommended)
**Notes:** Matches the `copilot+headless` gate already seeded in `experiment-spec.mjs`; skip is recorded, never silently absent (D-07/D-08).

---

## Matrix orchestration (SC#4)

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential, idempotent cell key, inline scoring | One cell at a time; key = task_hash+variant+repeat; re-run skips completed cells; judge/score inline. | ✓ |
| Parallel across sandboxes | Concurrent isolated sandboxes for speed. | |
| Sequential, scoring as a separate later pass | Run all, then score in a second pass. | |

**User's choice:** Sequential, idempotent cell key, inline scoring (Recommended)
**Notes:** Deterministic ordering, resumable, exactly one Run per cell (D-09/D-10/D-11).

---

## Agent scope (SC#4 "≥2 agents")

| Option | Description | Selected |
|--------|-------------|----------|
| Claude + OpenCode required; Mastra best-effort | Two most drivable CLIs guaranteed; Mastra recorded-skip if headless unreliable; Copilot probe-gated. | ✓ |
| Claude + OpenCode + Mastra all required | All three must complete the matrix. | |
| Claude only required; others best-effort | Only Claude end-to-end. | |

**User's choice:** Claude + OpenCode required; Mastra best-effort (Recommended)
**Notes:** Bounds verification risk while satisfying SC#4's ≥2 agents (D-12).

---

## Timeout default (RUN-03)

| Option | Description | Selected |
|--------|-------------|----------|
| 20 min default, per-spec override | 20-minute per-cell ceiling, configurable. | ✓ |
| 10 min default | Tighter ceiling. | |
| Leave to planner (Claude's Discretion) | No locked number. | |

**User's choice:** 20 min default, per-spec override (Recommended)
**Notes:** Bounded so a hung agent can't stall the matrix; overridable per spec/CLI (D-06).

---

## Claude's Discretion

- Runner module layout (`lib/experiments/experiment-runner.mjs` + `scripts/experiment-run.mjs`) and the adapter shape over `config/agents/*.sh`.
- Precise per-agent headless flags for claude/opencode/mastra (researcher confirms each CLI's non-interactive mode).
- Timeout implementation (spawn + timer + SIGTERM→SIGKILL) and exact terminal-state enum wording.
- The exact headless prompt/handoff (how `goal_sentence` + sandbox context reach the agent).
- The one-turn Copilot probe's trivial prompt + success assertion.
- Completed-cells ledger location (manifest vs Run-KB query).

## Deferred Ideas

- Parallel cell execution across sandboxes → later performance optimization.
- Separate (batch) scoring pass → future utility; this phase scores inline.
- Framework/approach closed-enum → still deferred (Phase 77 D-05).
- Success gate / N-repeat variance / ranked report (CMP-01/02/03) → Phase 79.
- Auto-routing / policy engine → v7.6.
- Three low-relevance todos reviewed but not folded (API contract bridge, sub-agent dashboard observability gap, LSL timeline cap) — see CONTEXT.md Reviewed Todos.
