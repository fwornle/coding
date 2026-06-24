# Phase 72: Syntactic Route Quality - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 72-syntactic-route-quality
**Areas discussed:** Trace data source, goal_sentence capture, Heuristic definitions, Storage shape

---

## Trace data source

| Option | Description | Selected |
|--------|-------------|----------|
| Claude session JSONL | Claude-only; richest signal, reuses Phase-69 tailer | |
| Cross-agent normalized | One normalized schema fed by Claude JSONL + Copilot events.jsonl + OpenCode | ✓ |
| LSL / observations | Agent-agnostic but summarized — lacks raw per-tool-call fidelity | |

**User's choice:** Cross-agent normalized
**Notes:** Reach across all four agents from v0; accepts coarser agents yielding partial metrics.

### Coarse-trace handling (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Per-heuristic, null the rest | Compute what each trace supports; explicit `null` for the rest; uniform schema | ✓ |
| Lowest common denominator | Only emit heuristics computable across all agents (steps + wallclock) | |
| Claude full, others total-only | Tiered with a `trace_fidelity` tag | |

**User's choice:** Per-heuristic, null the rest
**Notes:** Null (not 0) keeps the Run schema uniform and honest; mirrors Phase 71 D-13.

---

## goal_sentence capture

### /gsd derivation source

| Option | Description | Selected |
|--------|-------------|----------|
| PLAN.md **Goal:** line | Most run-specific; fallback to ROADMAP phase goal | ✓ |
| ROADMAP phase goal | Stable but coarser — one goal shared across a phase's runs | |
| Synthesized from context | Phase name + plan title; more label than goal | |

**User's choice:** PLAN.md **Goal:** line
**Notes:** Closest to what the run actually attempted; ROADMAP fallback when no PLAN.md.

### Freeform capture behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt at start, editable at close | Capture at startMeasurement, refine at stopMeasurement | ✓ |
| Prompt at start only | Immutable; matches ROUTE-01 literal wording | |
| Optional, quarantine if blank | Don't block start; pending flag if empty | |

**User's choice:** Prompt at start, editable at close
**Notes:** Goals clarify as the run unfolds. Headless freeform (no human) falls back to Phase-71 D-06 quarantine — captured as derived decision D-05.

---

## Heuristic definitions

### Calibration

| Option | Description | Selected |
|--------|-------------|----------|
| Strict / high-precision | Only unambiguous cases; non-zero count = real signal | ✓ |
| Broad / high-recall | Flag anything plausibly inefficient; noisier | |
| You decide per-heuristic | Research picks precision/recall per heuristic | |

**User's choice:** Strict / high-precision
**Notes:** Zero-LLM metrics lose trust fast on false positives.

### Step unit

| Option | Description | Selected |
|--------|-------------|----------|
| One tool call | Each invocation = one step; parallel calls counted separately | ✓ |
| One assistant turn | Each model turn = one step regardless of tool fan-out | |
| Tool call, parallel = one | Parallel calls collapse to a single step | |

**User's choice:** One tool call
**Notes:** Most precise + agent-comparable. Derived guardrail D-08: each heuristic gets a documented, fixture-tested definition.

---

## Storage shape

| Option | Description | Selected |
|--------|-------------|----------|
| Flat metrics on Run + Route summary | Six props on Run (queryable) + one Route node per Run with summary + goal_sentence | ✓ |
| Flat metrics on Run only | Leaves Route/Step stubs empty; Phase 73 must add a Route node later | |
| Full Route + per-Step nodes | Richest but a per-tool-call node explosion | |

**User's choice:** Flat metrics on Run + Route summary
**Notes:** Meets ROUTE-02 SC3 now and gives Phase 73 a Route node to attach goal_aligned_ratio to. No per-Step explosion.

---

## Claude's Discretion

- Normalized-trace schema shape + where normalization lives; reuse Phase-69/70 adapter ingestion vs separate reader (guardrail: cross-agent D-01, per-heuristic null D-02).
- Exact strict definition of each heuristic incl. whether errored/denied calls count toward steps/abandoned (guardrail: D-06/D-07/D-08).
- When/where heuristics compute (close-time in Phase-71 orchestrator expected; on-demand recompute allowed via idempotent re-close).

## Deferred Ideas

- Semantic `goal_aligned_ratio` + 5-dimension success scoring → Phase 73.
- Per-Step entity population → out of scope; revisit for Phase-74 dashboard drill-down if needed.
- Performance dashboard rendering of route metrics → Phase 74.
