---
id: v73-perf-measurement-exploration
created: 2026-06-04
status: ready-for-milestone-planning
tags: [v7.3, performance, measurement, milestone-proposal, exploration]
feeds_into: /gsd-new-milestone v7.3
---

# v7.3 Performance Measurement System — Exploration Synthesis

> Source: `/gsd-explore` session 2026-06-04. Captures the seven architectural
> decisions that shape v7.3 and the alternatives that were considered and
> rejected. Hand this to `/gsd-new-milestone` as scoping input.

## Goal

Extend `bin/coding` to measure **token consumption** (main + sub-agents),
**time-to-delivery**, **route quality** (steps, loops, D-tours), and **outcome
success** for any task run through coding's supported agents. Findings stream
into a new **km-core-backed knowledge base** of `Experiment / Run / Route /
Decision / Outcome / Report` entities and surface in a new **Performance**
dashboard tab (slotted after **Tokens**).

The ultimate purpose is to recommend, evidence-backed, to dev teams:
*for task type X at complexity Y, use agent/model Z with spec-level W.*

**Policy automation is explicitly v7.4** — see [v74-policy-engine seed].

## Scope

**In scope for v7.3:**
- Measurement infrastructure (snapshot/restore, telemetry capture, replay)
- KB schema (km-core ontology for experiments)
- Dashboard "Performance" tab with query-builder + Report views
- Cross-agent reach: Claude Code + GitHub Copilot
- Goal-anchored route metrics (syntactic + semantic)
- Unified 5-dimension success rubric with LLM-judge synthesis

**Out of scope (deferred to v7.3 or later):**
- Auto-routing of tasks to agents/models
- Policy engine in `bin/coding`
- OpenCode and Mastra adapters (add via same contract post-MVP)
- Cost-per-task optimisation recommendations (downstream of policy work)

## Decisions

### D1 — Reproducibility ceiling: agent benchmarking

Snapshot+restore everything internal **and** record+replay external state.
N=1 runs become statistically meaningful (modulo provider non-determinism).

- **Internal (pinned, restored byte-for-byte):** git SHA, workspace dirty
  state, `.data/knowledge-graph/` KB state, `processOverrides` routing config,
  MCP server inventory + versions, prompt text, `.planning/` state, env vars
  affecting agent behaviour, agent binary version (claude-code, copilot
  extension).
- **External (recorded + replayed via fixtures):** all LLM provider responses
  via `rapid-llm-proxy` interception, `WebSearch`/`WebFetch` results, remote
  MCP server replies, NTP-offset/frozen clock.

*Rejected:* "workflow benchmarking" (record-only, accept external drift as
noise) — would have been cheaper but findings depend on N≥3-5 repeats with
variance reporting, weakening conclusions. *Rejected:* "hybrid record-only
external" — useful forensics but doesn't enable true model-vs-model
comparison.

### D2 — Unit of comparison: single Run, queryable

Every `Run` is stored independently in the km-core KB with rich tags:
`{task_hash, task_class, agent, model, framework, spec_level, snapshot_id,
trace_id, ...}`. Comparisons are **queries** over the KB. Curated saved
queries become first-class **`Report`** entities (pointing at the query and
a stable results snapshot, so findings are shareable and don't bit-rot).

*Rejected:* "Variant cell" (1 task × 1 config × N runs) and
"Comparison matrix" (1 task × M configs × N runs) — locked us into a
predefined experiment shape and prevented opportunistic ad-hoc runs from
contributing to findings. Single-Run gives maximum flexibility at the cost
of requiring **tagging discipline** and a curated **task taxonomy**.

**Implications:**
- A **task taxonomy** is required (`refactor`, `bugfix`, `new-feature`,
  `migration`, `debug`, `docs`, ...). Without it `WHERE task_class=X`
  returns nothing useful.
- Tag enforcement must happen at run-end (not optional metadata).

### D3 — Intent anchor: one-sentence goal at run start

Both /gsd and freeform runs carry a `goal_sentence` field on the Run.

- **/gsd runs**: derived automatically from `PLAN.md` goal / requirement
  statements — no user input needed.
- **Freeform runs**: at "Start measurement" the dashboard/CLI prompts:
  *"In one sentence, what should be true when this is done?"*

The goal sentence is shared infrastructure: both D2-route-quality and
D5-success-scoring read from it.

*Rejected:* "Agent's first stated approach" — garbage-in if the agent's
initial plan is itself bad. *Rejected:* "No intent anchor — pattern-detect
only" — would have left success scoring stranded for freeform runs.

### D4 — Route quality: syntactic + semantic, both stored

Two complementary route-quality axes computed per Run:

- **Syntactic heuristics** (zero LLM, deterministic, cheap): loop count,
  edit-revert count, read-unused-file count, redundant-read count,
  abandoned-tool-call count, total step count, wallclock per step.
- **Semantic — `goal_aligned_ratio`** (LLM-judge, Haiku via `taskType`
  routing): each meaningful trace event scored toward/neutral/away from
  the goal sentence. Ratio + rationale stored per Run.

The proxy interception path means LLM-judge calls are themselves measured
(meta-overhead).

### D5 — Unified success rubric

Fixed 5-dimension schema applied to every Run regardless of source:

```
{
  goal_achieved:   0.0-1.0,
  code_quality:    0.0-1.0,
  test_coverage:   0.0-1.0,
  regressions:     0|1,
  spec_drift:      0.0-1.0
}
```

Evidence feeding each dimension **varies per run**:

- `goal_achieved` — /gsd: `VERIFICATION.md` result + tests + goal-vs-diff.
  Freeform: goal-vs-diff only.
- `code_quality` — code-review findings count + linter output + diff size.
- `test_coverage` — test pass rate + new-tests-for-new-code ratio.
- `regressions` — broken tests not introduced by the run's own edits.
- `spec_drift` — for /gsd runs, divergence from PLAN.md task list.
  Freeform runs get this dimension nulled or scored against the goal
  sentence alone.

**LLM-judge synthesises** per-dimension scores from whatever evidence is
present, with a rationale string. User can **override** any dimension in
the dashboard (corrected score stored separately from judged score).

*Rejected:* "Two scores stored (structured + judged)" — would have meant
queries always pick which axis, and cross-source comparison would be
impossible. *Rejected:* "User marks outcome only" — brutal simplicity at
the cost of losing all forensic structure.

### D6 — Cross-agent reach: per-agent ingestion paths

Each supported coding agent has a distinct telemetry surface and
ingestion path into `.observations/token-usage.db`. The per-agent
adapter contract (see
[v73-token-attribution-contract](v73-token-attribution-contract.md))
provides one row shape for all agents; each adapter reads its agent's
native source and emits rows.

| Agent | Source | Granularity tier | Adapter strategy |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<project-slug>/<session-uuid>.jsonl` — per-assistant-message `usage` block with `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `server_tool_use.{web_search_requests, web_fetch_requests}` (verified by direct sample) | `per-turn` | New JSONL adapter under `lib/lsl/adapters/` mirroring the `lib/lsl/live/copilot-events-tail.mjs` pattern; live-tail for in-progress sessions + sweep for completed ones. Reuses `claude-jsonl-tree.mjs` walking primitives. |
| Copilot CLI | `~/.copilot/session-state/<uuid>/events.jsonl` — `session.shutdown.modelMetrics.<model>.usage` (verified). Per-turn boundary events (`assistant.turn_start`/`assistant.turn_end`) exist; per-call usage payload between them is a milestone Phase 1 verification task. | `per-session-aggregate` (potential upgrade to `per-turn`) | Extend `lib/lsl/adapters/copilot-events.mjs` (already walks sessions for sub-agent bookends). |
| OpenCode | Project config at `~/.config/opencode/opencode.json` sets `"model": "github-copilot/claude-opus-4.6"` and `"enabled_providers": ["github-copilot"]` — OpenCode's LLM calls route through Copilot's OAuth path (`~/.local/share/opencode/auth.json`, the same file `@rapid/llm-proxy/src/providers/copilot-provider.ts:20` reads). | `per-llm-call` | Configure OpenCode to point its model endpoint at `host.docker.internal:12435`'s OpenAI-compatible front; proxy logs per call via the existing `attachTokenLogger` path with `process="opencode"`. |
| Mastra | `.opencode/mastra.json` confirms Mastra is integrated in this project. The instrumentation surface (per-step middleware vs observer hooks vs framework callbacks) is a milestone Phase 1 read of that config. The forward-compat NDJSON shape at `lib/lsl/adapters/mastra-ndjson.mjs` documents the WOULD-BE schema. | TBD | Phase 1 deliverable. |

**VS Code Copilot Chat is out of milestone scope** — `state.vscdb`
LevelDB is opaque, no stable per-call telemetry surface. User decision
recorded via AskUserQuestion at scoping time.

**Server-initiated Copilot calls** (where something inside coding posts
to `/api/complete` with `provider=copilot`, e.g., `wave-analysis-*`
routing via `processOverrides`) already land tokens in `token_usage.db`
through the proxy's `attachTokenLogger`. The milestone tags these rows
with the active `task_id` so they aggregate into the same Performance
view as user-driven agent runs.

### D7 — Policy automation: v7.3, gated on data

Explicitly deferred. v7.3 trigger condition: v7.3 KB has ≥~50 completed
Runs across ≥3 task_classes with at least 2 agents and 2 models per class.
Until then there is no data to derive policies from. See
[v74-policy-engine seed].

## Open prereqs before milestone planning

1. **Copilot CLI events.jsonl event-vocabulary verification** — list distinct
   `type:` values, check whether per-turn or per-call usage payloads exist
   between `assistant.turn_start` and `assistant.turn_end`. Determines
   whether Copilot's granularity tier is `per-session-aggregate` or
   `per-turn`. Milestone Phase 1 task.
2. **Mastra instrumentation surface read** — read `.opencode/mastra.json`
   and identify per-step middleware/observer hooks. Determines Mastra's
   granularity tier and adapter strategy. Milestone Phase 1 task.
3. **Task taxonomy v0** — minimal list (refactor, bugfix, new-feature,
   migration, debug, docs) with definitions; can evolve, but must exist
   before any Run is tagged. Phase 1 of the milestone.
4. **km-core ontology design** — `Experiment`, `Run`, `Route`, `Step`,
   `Decision`, `Outcome`, `Report` entities + relations. Phase 5 of the
   milestone shape sketch.

## Proposed phase shape (sketch — for /gsd-new-milestone)

Rough sequencing, not committed:

1. Snapshot/restore infrastructure (internal state)
2. External-fixture record/replay through `rapid-llm-proxy`
3. **[FOUNDATIONAL — DO NOT SLIP]** `.observations/token-usage.db` schema extension + measurement-span propagation — add columns `agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `reasoning_tokens`; add `.data/active-measurement.json` contract; teach `attachTokenLogger` to read it
4. Per-agent token adapters — Claude JSONL (with per-reasoning-step emission for extended-thinking), Copilot events.jsonl extension, OpenCode proxy-route configuration, Mastra surface investigation + instrumentation
5. km-core schema + Run-write path — `Experiment`, `Run`, `Route`, `Step`, `Decision`, `Outcome`, `Report` entities sourced from `token_usage` queries
6. Route reconstruction (syntactic heuristics)
7. LLM-judge route + rubric scoring
8. Dashboard "Performance" tab — reuses the Tokens-tab Evolution chart with task-anchored filters; `per-reasoning-step` rows render as stacked sub-bands under parent turns
9. `Report` entity + saved-query workflow

> **Phase 3 is the dependency anchor.** Phases 4-9 each read or write
> `token_usage` rows with the new columns and consult
> `.data/active-measurement.json`. Slipping Phase 3 cascades into every
> subsequent phase. The milestone roadmap MUST schedule Phase 3 as the
> first non-spike work item and gate Phase 4 entry on its verification
> passing. No "we'll bolt on the columns later" — the columns are part
> of the row contract every adapter writes.

## Cross-refs

- [Memory: project_v73_perf_measurement](../../.claude/projects/-Users-Q284340-Agentic-coding/memory/project_v73_perf_measurement.md)
- [Memory: feedback_perf_measurement_requirements](../../.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_perf_measurement_requirements.md)
- [Note: v73-token-attribution-contract](v73-token-attribution-contract.md) — storage + measurement-span + per-agent contracts
- [Spike: copilot-proxy-interception](../spikes/copilot-proxy-interception.md)
- [Seed: v74-policy-engine](../seeds/v74-policy-engine.md)
- [Todo: start-v73-milestone](../todos/pending/start-v73-milestone.md)
