# Phase 73: Semantic Route Judge & Success Scoring - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Every coding-agent Run gains **semantic** quality signals, computed by an LLM-judge (Haiku via `taskType` routing through the proxy) and stored on a dedicated `Score` entity:

1. A `goal_aligned_ratio` — the judge scores each consequential trace event toward/neutral/away from the Run's `goal_sentence`; ratio + per-event labels + rationale stored. (ROUTE-03)
2. A fixed **5-dimension success rubric** (`goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift`) synthesized by the judge from whatever evidence is present, with a rationale string. (SCORE-01)
3. A user-override path: any rubric dimension is correctable, with the corrected value stored **separately** from the judged value. (SCORE-02)

**In scope:**
- One LLM-judge call at run-close returning BOTH the `goal_aligned_ratio` and the 5-dim rubric (structured output), the judge call itself measured via the proxy (Phase 68).
- A **lean deterministic evidence harness** that reads already-on-disk artifacts and feeds them to the judge.
- A new `Score` ontology class + `Run--scored-->Score` relation in the experiment store; judged + `corrected_*` fields.
- A minimal REST PATCH endpoint to set a per-dimension override (storage contract for SCORE-02).
- A recompute-score CLI (re-judge a Run idempotently).

**Out of scope (other phases / deferred):**
- The "Performance" dashboard tab and the override **UI controls** → Phase 74 (this phase ships storage + PATCH API only).
- The `Report` entity + saved-query workflow → Phase 74.
- Per-Step entity population (Step stays a stub — Phase 72 decision).
- Changing the rubric schema (the 5 dimensions are LOCKED by the v73 exploration note D5 + ROADMAP SC#2 — not a discussion item).
- Changing the Phase-72 syntactic heuristics / Route node, the Phase-71 Run/Outcome write keying, or the Phase-68 `token_usage` schema — all consumed as-is.

</domain>

<decisions>
## Implementation Decisions

### Evidence gathering (for the 5-dim rubric)
- **D-01 (LOCKED):** **Lean deterministic evidence harness.** Gather only cheap, already-on-disk evidence and feed it as structured context to the judge: the active phase's `VERIFICATION.md` verdict, `REVIEW.md` findings count (if present), a test pass/fail summary (parsed from existing output, NOT freshly run), `git diff` stat, and the `PLAN.md` task list (for `spec_drift`). **Do NOT run new tests / linters / code-review at scoring time.** A dimension with no available evidence is written **`null`** (NOT guessed, NOT zero) — carries Phase 72 D-02 null-not-zero. The full active harness (run tests+linter+review at scoring time) was considered and **deferred as too heavy for v0**.

### goal_aligned_ratio (ROUTE-03)
- **D-02 (LOCKED):** **Consequential events only, `toward/(toward+away)`.** The judge scores only state-changing/acting trace events (Edit/Write/Bash/Task-class tool calls), **skipping pure Reads/navigation** so read-heavy runs aren't diluted. Ratio = `toward / (toward + away)`; **neutral events are excluded from the denominator**. Per-event toward/neutral/away labels + an overall rationale string are stored. The input is the Phase-72 **normalized cross-agent route trace** (the `RouteEvent[]` the judge reads).

### Judge invocation (ROUTE-03 + SCORE-01)
- **D-03 (LOCKED):** **Synchronous at run-close, ONE judge call, recompute CLI.** A single Haiku call (via `taskType` routing through the proxy `/api/complete`) returns BOTH the `goal_aligned_ratio` AND the 5-dim rubric in one structured response. Idempotent re-judge keyed by `task_id` (overwrites the **judged** fields, **preserves overrides** — D-06). Judge failure or proxy-unreachable → all judged fields `null` + a `pending` flag, **never blocks close** (carries Phase 72 D-05 quarantine). Re-runnable via a `recompute-score` CLI mirroring `scripts/experiments-recompute-route.mjs`. The judge call is itself token-measured via the proxy (Phase 68 meta-overhead).
- **D-04 (LOCKED):** **Trivial-run guard.** Runs with ~0 consequential events (pure-read / empty / no-op) **skip the judge call entirely**; scores are written `null` with a distinct `not_scored: "trivial"` marker — separate from judge-failure `pending` — to save Haiku calls and keep cross-run averages clean.

### Storage shape (SCORE-01 / SCORE-02)
- **D-05 (LOCKED):** **New `Score` entity.** Add a `Score` class to the experiment ontology with `Run--scored-->Score`. The Score node holds: `goal_aligned_ratio` + per-event labels + ratio rationale, AND the 5 judged rubric dimensions (`goal_achieved` 0–1, `code_quality` 0–1, `test_coverage` 0–1, `regressions` 0|1, `spec_drift` 0–1) + rubric rationale. **This deliberately supersedes Phase 72 D-09's note** that `goal_aligned_ratio` would attach to the Route node — the **Route** node keeps the syntactic heuristics + `goal_sentence`; the **Score** node is the single semantic/scoring home. (Idempotent write mirrors Phase 71's `writeRun` Run+Outcome pattern.)
- **D-06 (LOCKED):** **Overrides stored separately as `corrected_*` field pairs.** Each rubric dimension has a parallel `corrected_<dim>` field (`null` until overridden) plus an `overridden_by` / `overridden_at` stamp. The **judged** fields are never mutated by an override and never overwritten by a re-judge into the corrected slots — satisfies SCORE-02 "stored separately from the judged score." Queries/averages decide which to read (corrected-wins-if-present is the expected convention; lock in planning).
- **D-07 (LOCKED):** **Storage + PATCH API in Phase 73; override UI in Phase 74.** Phase 73 ships the `Score` entity and a minimal REST PATCH endpoint that sets a per-dimension override (writing `corrected_*` + stamp). The actual override **controls render in Phase 74's Performance tab**. SCORE-02's storage contract is fully testable now via the API without front-running the dashboard UI.

### Rubric schema (carried/LOCKED — not re-discussed)
- The 5 dimensions and their ranges are fixed by `.planning/notes/v73-perf-measurement-exploration.md` §D5 and ROADMAP SC#2: `goal_achieved` (0–1), `code_quality` (0–1), `test_coverage` (0–1), `regressions` (0|1), `spec_drift` (0–1). For **freeform** runs, `spec_drift` is `null` or scored against the goal sentence alone (no PLAN.md). The rejected alternatives ("two scores stored — structured + judged", "user marks outcome only") stay rejected.

### Claude's Discretion (delegated to research/planning, with guardrails)
- The exact **judge prompt + structured-output schema** for the single call returning ratio + per-event labels + rubric + rationales. Guardrail: one call (D-03), consequential-event ratio (D-02), evidence from D-01.
- The precise **"consequential event" tool-name set** (which native tool names per agent count as acting vs navigation) — fixture-test it like Phase 72 D-08. Guardrail: skip pure Reads (D-02).
- The **trivial-run threshold** value (D-04) and whether `goal_aligned_ratio` is also **mirrored flat on the Run** for one-hop queryability (allowed, like the Phase-72 heuristics).
- The **`taskType` string** used to route the judge to claude-haiku (must resolve to Haiku per CLAUDE.md); reuse the canonical host-side `/api/complete` client shape from `scripts/backfill-raw-observations.mjs`.
- **corrected-vs-judged read precedence** in queries (D-06).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (acceptance source)
- `.planning/REQUIREMENTS.md` — ROUTE-03, SCORE-01, SCORE-02 (this phase's acceptance items).
- `.planning/ROADMAP.md` §"Phase 73: Semantic Route Judge & Success Scoring" — goal + 3 success criteria; depends on Phase 72 (trace + goal_sentence) and Phase 68 (judge calls measured).
- `.planning/notes/v73-perf-measurement-exploration.md` §D4 (syntactic+semantic route quality) and §D5 (the LOCKED 5-dimension rubric schema, per-dimension evidence sources, and the rejected alternatives). **The rubric schema lives here — do not redesign it.**

### Phase 72 substrate (the trace + Route node the judge consumes)
- `.planning/phases/72-syntactic-route-quality/72-CONTEXT.md` — the normalized cross-agent route trace (D-01), null-not-zero degradation (D-02), the Route node + `goal_sentence` (D-09), headless/quarantine (D-05). Note: this phase's D-05 **supersedes** 72 D-09's "ratio on Route" remark.
- `lib/lsl/route/route-event.mjs` — the `RouteEvent` shape (seq, tool_name, target_path, started_at, outcome) the ratio judge scores.
- `lib/lsl/route/build-trace.mjs` + `lib/experiments/route-trace-resolve.mjs` — `buildNormalizedTrace(span, {dominantAgent, __seam})`: how the judge obtains the per-run trace (agent normalization + Claude session-window seam landed 2026-06-28, commit 9eb5163c5).

### Phase 71 substrate (the experiment store this phase extends)
- `.planning/phases/71-experiment-kb-task-taxonomy/71-CONTEXT.md` — the dedicated experiment GraphKMStore, the `Experiment/Run/Route/Step/Decision/Outcome/Report` ontology, Run keyed by `task_id` + idempotent re-close (D-14), coding-side close orchestrator (D-07).
- `.data/ontologies-experiment/experiment-ontology.json` — **add the `Score` class here** (currently: Experiment/Run/Route/Step/Decision/Outcome/Report — NO Score class yet). Verify on disk before planning.
- `lib/experiments/run-write.mjs` — the idempotent `writeRun` (Run + Outcome stub + `produces`/`tookRoute` edges); the `Score` write + `scored` edge hook alongside this, same provenance-stamp/strict-path pattern.

### Close orchestrator + judge client (where this phase wires in)
- `scripts/measurement-stop.mjs` — the run-close orchestrator. Phase 72 computes heuristics here; the judge call (D-03) + evidence harness (D-01) hook in right after, before/within the Score write.
- `scripts/experiments-recompute-route.mjs` — the pattern to clone for the `recompute-score` CLI (D-03), including the agent-normalization + seam wiring.
- `scripts/backfill-raw-observations.mjs:40,95` — the canonical host-side `/api/complete` client (proxy port 12435, `{ process, messages, taskType }` body). Reuse this shape for the judge call.

### Project conventions
- `CLAUDE.md` — km-core `ontologyDir` rule (mandatory for any CLI touching the experiment store — acceptance grep), the LLM proxy endpoint contract (`POST /api/complete` on **12435**, NOT OpenAI shape, `taskType` routes to claude-haiku), `no-console-log` (use `process.stderr.write`), and the now-installed `com.coding.lsl-lock-sweeper` daemon.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/experiments/run-write.mjs` — `writeRun(store, {span, taskClass, pending, tags, totals, heuristics})`: idempotent entity write (lookup-by-`task_id` → mint-or-reuse id → strict putEntity with ProvenanceStamp → produces/tookRoute edges). The `Score` write + `scored` edge follows this template verbatim.
- `scripts/experiments-recompute-route.mjs` — full recompute CLI (resolve span → aggregate → normalize agent → build trace → recompute → re-write). The `recompute-score` CLI is a near-clone with the judge step swapped in.
- `lib/experiments/route-trace-resolve.mjs` + `lib/lsl/route/build-trace.mjs` — produce the `RouteEvent[]` the ratio judge consumes; already agent-aware (claude/copilot/opencode) after the 2026-06-28 seam fix.
- `scripts/backfill-raw-observations.mjs` — `callProxy(body)` → `POST /api/complete` with `AbortSignal.timeout`; the judge client.
- `lib/experiments/store.mjs` — `openExperimentStore()` (constructs GraphKMStore WITH `ontologyDir` — mandatory).

### Established Patterns
- **Null-not-zero + pending quarantine** (Phase 72 D-02 / D-05): unsupported/absent → explicit `null`; can't-score-now → `pending`. This phase adds a THIRD distinct marker, `not_scored: "trivial"` (D-04) — keep all three distinguishable in storage and queries.
- **Idempotent re-write keyed by `task_id`** (Phase 71 D-14): re-judge overwrites judged fields only; never duplicates the Score node, never clobbers `corrected_*`.
- **Single host-side proxy client + `taskType` routing** (CLAUDE.md): judge calls go through the same `/api/complete` path that auto-attributes their token cost (Phase 68).

### Integration Points
- `scripts/measurement-stop.mjs` close path: after `computeHeuristics`/`writeRun`, gather evidence (D-01) → call judge (D-03/D-04) → `writeScore` + `scored` edge.
- Experiment ontology JSON: new `Score` class + `Run.relationships.scored`.
- A minimal REST PATCH endpoint (D-07) — locate the existing experiment/obs REST surface during research; reuse it rather than standing up a new server.

</code_context>

<specifics>
## Specific Ideas

- The judge is **one** structured call, not two — the user explicitly chose a single call returning ratio + rubric together (cost + consistency).
- "Consequential events" framing matters to the user: the ratio should reflect *acting* (Edit/Write/Bash/Task), not *looking* (Read/navigation).
- Overrides must be **forensically separable** from judged values — the user picked a dedicated `Score` entity (over extending `Outcome` or flat-on-Run) specifically for clean judged-vs-corrected separation.

</specifics>

<deferred>
## Deferred Ideas

- **Performance dashboard tab + override UI controls + `Report` entity** → Phase 74. Phase 73 ships only the Score storage + PATCH API.
- **Full active evidence harness** (run tests + linter + code-review at scoring time) — considered for richer rubric grounding, deferred as too heavy/slow for v0 (D-01 reads on-disk artifacts only).

### Reviewed Todos (not folded)
The `cross_reference_todos` step surfaced 4 weak keyword-only matches (score 0.6, matched on generic tokens like "phase"/"run"/"both"); none relate to semantic judging or scoring, so none were folded:
- `2026-05-23-orphan-digest-observation-refs.md` — KB data-integrity (digests referencing missing observations); unrelated.
- `2026-06-10-okm-express-api-contract-bridge.md` — OKM ↔ viewer API path mismatch; unrelated.
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — worktree sub-agent observations not reaching dashboard; unrelated.
- `2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md` — unified-viewer filter/ontology bug; unrelated.

</deferred>

---

*Phase: 73-semantic-route-judge-success-scoring*
*Context gathered: 2026-06-28*
