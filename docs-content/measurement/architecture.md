# Measurement Architecture

## Overview

This page explains how a single experiment is measured end-to-end — from a plain-English description to a ranked comparison the dashboard reads live. The pipeline is a **thin skill wrapper** over two CLIs (`experiment-run.mjs`, `experiments-compare.mjs`); all the measurement logic lives in `lib/experiments/` and is shared by both the CLI and the dashboard API so the two can never drift.

![Experiment run — describe → run → compare → dashboard](../images/experiment-run-sequence.png)

---

## The measurement span

Each run is wrapped in a **measurement span** keyed by a `task_id`:

- **`measurement-start.mjs`** opens the span and writes `.data/active-measurement.json`. On top of that span, every cell also binds its tokens **per-request** so capture is robust even when the cell isn't the only thing routing through the proxy (Phase 84):
    - **claude** carries an `x-task-id` header on each call;
    - **opencode** splices an `OPENCODE_CONFIG_CONTENT` provider config that binds *both* of its wires — the anthropic provider via `/v1` + `x-task-id`, the openai/copilot providers via a task-scoped `/v1/opencode/t/<taskId>` base-URL path;
    - **mastra** routes via `ANTHROPIC_BASE_URL`; **copilot** uses the BYOK task-scoped seam.
  The shared `rapid-llm-proxy` (port **12435**) stamps every `token_usage` row with that `task_id`; the ambient `active-measurement.json` span is the *fallback* for any call that doesn't carry its own binding. Wire rows are the **primary** token source for all agents — the `cladpt`/`copadt` transcript adapters no longer capture here; at close they run in **reconcile** mode (verify wire rows, fill gaps: reasoning tokens, cache split).
- The agent then drives the goal inside a restored **sandbox** snapshot (`snapshot_id`, default `smoke-spec`) so runs are reproducible and isolated.
- **`measurement-stop.mjs`** closes the span: it aggregates tokens from `token-usage.db WHERE task_id = ?`, runs the **evidence harness** (the objective `test_command` gate), invokes the **Haiku judge** for the 5-dimension rubric, and persists the results.

### Roles, foreground/background, and the ambient panel

A run's tokens are classified into three **role lanes** — **foreground development**, **knowledge capture**, and **infrastructure** — so a reader sees not just *how much* a run cost but *what kind* of work it did. `token-aggregate.mjs` separates the measured **foreground** session from concurrent **background** daemons (`consolidator-*`, `health-coordinator`, `observation-writer`, …): a daemon denylist **overrides** the adapter hash, so an `observation-writer` row carrying `cladpt` still classifies as background and never inflates the run's cost. The dominant foreground group becomes the run's `canonical_agent` / `canonical_model`. (This classifier is agent-agnostic — it keys on the process/role, not on a hardcoded per-agent hash.)

**Agent-agnostic lane totals.** Only agents that task-stamp their background work (opencode tags ~100%; claude/copilot/mastra barely tag) would otherwise show `0/0` Knowledge and Infrastructure lanes. To make the lanes meaningful for *every* agent, the run timeline folds **time-window-matched ambient rows** into the role lanes. Those rows are concurrent background traffic that ran during the run's window but is **not** attributed to it (empty/foreign `task_id`); the backend already excludes the run's own `task_id`, so the fold is additive, never double-counted. Sandboxed experiment cells are left untouched — no foreign window-join into a throwaway worktree.

**The Ambient activity panel.** Below each run's timeline, a collapsible **"Concurrent background activity"** panel honestly surfaces those in-window, unattributed processes (per process: role, calls, tokens, models). It is never a causation claim — just "this was happening at the same time" — and it makes the knowledge-capture + infrastructure spend that the task-exact stats deliberately exclude *visible* instead of hidden.

---

## The data model

Three linked entities are written to the dedicated experiment store (`.data/experiments/leveldb`, kept separate from the knowledge graph to avoid churn):

| Entity | Key fields | Purpose |
|--------|-----------|---------|
| **Run** | `task_id`, `task_hash`, `task_class`, `agent`/`model`/`framework`/`env`, `variant`, `repeat`, `terminal_state`, 6 route heuristics | one execution of the goal by one variant |
| **Score** | `gate_passed` (true/false/null), 5-dim rubric (`goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift`), `goal_aligned_ratio` | objective gate + quality signal |
| **Outcome** | `totalTokens`, `inputTokens`, `outputTokens`, `reasoningTokens` | the cost totals |

Key discipline — **null is not zero (D-09):** a metric that could not be computed is stored `null` and *excluded* from stats, never coerced to `0`. This keeps means honest and prevents a missing rubric from dividing the composite by zero (such a variant routes to **unscored** instead).

### `task_hash` closes the loop

The runner derives `task_hash = sha256(goal_sentence)` at close. The `/experiment` skill re-derives the *same* hash (it owns the goal sentence) and passes it straight to the compare step — so `run → compare → dashboard` is mechanically closed with no stdout scraping.

---

## Comparison & the dashboard

`experiments-compare.mjs` calls `buildComparison(rows, {taskHash, rankBy})` from `lib/experiments/compare.mjs`:

1. **read** all runs for the `task_hash` (join Run → Score → Outcome),
2. **classify** each variant into the honesty-spine group (ranked/failed/ungated/unscored),
3. **aggregate** each ranked variant's successful runs into `{mean, stddev, median, min, max, n}`,
4. **rank** by `--rank-by` (`composite` default, or `tokens` / `wallclock` / `score`),
5. **write** `.data/experiments/reports/<task_hash>.json`.

That exact JSON is what the dashboard's **Comparison** tab reads via `GET /api/experiments/comparison` — and the endpoint calls the *same* `buildComparison`, guarded by a deep-equality test, so the CLI table and the dashboard can never disagree.

**Service ports involved:** dashboard `:3032` · dashboard API `:3033` · vkb `:8080` · llm-proxy `:12435`. The proxy, obs-api, and ETM run as auto-respawning launchd daemons (`com.coding.*`).
