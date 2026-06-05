---
id: v74-policy-engine
created: 2026-06-04
planted_date: 2026-06-04
trigger_condition: v7.3 KB has ≥50 completed Runs across ≥3 task_classes with at least 2 agents and 2 models per class
status: seeded
tags: [v7.4, policy-engine, auto-routing, future-milestone]
seeded_from: /gsd-explore v7.3 perf measurement, 2026-06-04
---

# Seed — v7.4 Execution Policy Engine

> Forward-looking placeholder. The work this seed describes is **explicitly
> deferred** from v7.3 (see [v73-perf-measurement-exploration] D7). Surface
> this seed for milestone planning **only when the trigger condition is met**
> — premature start risks deriving policies from too few data points.

## The dream

`bin/coding` (and the GSD skills it dispatches) consults the v7.3 km-core
KB before starting a task and **automatically chooses**:

- which **agent** to launch (Claude / Copilot / OpenCode / Mastra)
- which **model** to route to via `rapid-llm-proxy`'s `processOverrides`
- which **framework** to wrap it in (raw chat / `/gsd-quick` / full
  `/gsd-plan-phase`)
- what **spec level** to recommend the user provide before starting
  (one-liner / SPEC.md / SPEC.md + ADR refs)

Recommendation is **evidence-backed by saved `Report` entities in the KB**
("for task_class=refactor with complexity≤medium, sonnet+GSD-quick won on
goal_achieved×cost in 87% of n=23 historical Runs").

## Trigger condition

Don't start v7.4 milestone planning until **all** are true:

- v7.3 KB has **≥50 completed Runs**
- Runs cover **≥3 task_classes** (refactor, bugfix, new-feature minimum)
- Each task_class has **≥2 agents × ≥2 models** of comparison data
- Success rubric scores are stable (LLM-judge agreement with
  user-overrides ≥80% on a random sample)

Below this threshold, derived policies overfit to anecdote.

## Likely policy shapes (sketches — to be evidence-tested in v7.4)

These are *hypotheses to test*, not commitments:

- **Cost-aware routing.** "For `bugfix` complexity≤small, route to Haiku
  through GSD-quick; for complexity≥large, route to Sonnet through full
  GSD-plan-phase."
- **Spec-level recommender.** "For `migration` tasks, user-supplied
  one-liners produce 60% spec_drift; gently nudge the user toward SPEC.md
  before starting."
- **Agent specialisation.** "Copilot dominates `docs`/`small-edits`;
  Claude dominates `refactor`/`debug` (per n=N runs in KB)."
- **Mid-run intervention.** "When syntactic loop_count crosses N during a
  freeform run, suggest pausing for GSD plan."

## What v7.3 must ship to make v7.4 possible

(Already captured in [v73-perf-measurement-exploration], here for the
forward link.)

- Task taxonomy (`task_class`)
- Spec-level tag (`spec_level`)
- Complexity tag (TBD how — maybe diff-size proxy or LLM-judged
  pre-estimate)
- `Report` entities as the unit policies consult
- Per-Run rationale strings so the engine can show *why* it's
  recommending what it's recommending

## Cross-refs

- [Note: v73-perf-measurement-exploration](../notes/v73-perf-measurement-exploration.md) — D7
- [Memory: project-v73-perf-measurement](../../.claude/projects/-Users-Q284340-Agentic-coding/memory/project_v73_perf_measurement.md)
