# Phase 72: Syntactic Route Quality - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Every coding-agent run carries a one-sentence `goal_sentence` and a set of **deterministic, zero-LLM** syntactic route-quality metrics (loop count, edit-revert count, redundant/unused read count, abandoned tool-call count, total step count, wallclock per step), so route inefficiency is measurable per run **without** judge cost. (ROUTE-01, ROUTE-02)

**In scope:**
- `goal_sentence` capture per Run — auto-derived for /gsd runs, prompted for freeform runs (ROUTE-01).
- A **cross-agent normalized route trace** (Claude + Copilot + OpenCode) that feeds the heuristics.
- Deterministic computation of the six syntactic heuristics, **strict/high-precision**, computed at run-close.
- Storing the heuristics on the Run (flat, queryable) + one Route summary node per Run, in the dedicated experiment store Phase 71 built.

**Out of scope (other phases / deferred):**
- Semantic `goal_aligned_ratio` (LLM-judge scoring trace events toward/away from the goal) → Phase 73 (ROUTE-03).
- 5-dimension success scoring → Phase 73 (SCORE-01/02).
- Per-Step entity population (one node per tool call) — Phase 72 stores aggregates only; the Step class stays a stub.
- Performance dashboard "Performance" tab / Report entity → Phase 74.
- Any change to the Phase-68 `token_usage` schema, the `getActiveMeasurement()`/span contract, or the Phase-71 Run-write keying — consumed as-is.

</domain>

<decisions>
## Implementation Decisions

### Trace data source
- **D-01 (LOCKED):** **Cross-agent normalized trace.** Phase 72 defines ONE normalized route-trace schema (ordered tool-call events with timestamps + outcome) and adapts each agent's native trace into it — Claude session JSONL, Copilot `events.jsonl`, OpenCode — so all four agents get route metrics from v0. NOT Claude-only. NOT the summarized LSL/observation stream (lacks raw per-tool-call fidelity).
- **D-02 (LOCKED):** **Per-heuristic graceful degradation, null the rest.** For each Run, compute every heuristic the source agent's trace can support; write the heuristics it cannot as explicit **`null`** (NOT `0`). The Run schema stays uniform across agents; queries filter on non-null. Coarser agents (e.g. Copilot per-session aggregate) yield total-step/wallclock but `null` for edit-revert/redundant-read; Claude yields all six. Mirrors Phase 71 D-13 ("all fields written, null where no source").

### goal_sentence capture
- **D-03 (LOCKED):** **/gsd runs auto-derive from PLAN.md.** Use the active phase's `PLAN.md` `**Goal**:` line — the most run-specific target. **Fallback:** the ROADMAP phase `**Goal**:` when no PLAN.md exists (e.g. early in a phase). Zero-LLM extraction.
- **D-04 (LOCKED):** **Freeform runs prompt at start, editable at close.** Prompt for the one-sentence goal when `startMeasurement` runs; let the operator correct/refine it at `stopMeasurement` before the Run is written (goals often clarify as the run unfolds).
- **D-05 (DERIVED, carried from Phase 71 D-06):** **Headless freeform runs quarantine, never block.** A cron/autonomous freeform run with no human to prompt writes the Run with `goal_sentence` empty + a pending flag, **EXCLUDED from route-alignment queries** until filled. Never hang the close waiting for input.

### Heuristic definitions
- **D-06 (LOCKED):** **Strict / high-precision calibration** for the four fuzzy heuristics (loop, edit-revert, redundant/unused read, abandoned tool-call). Count only **unambiguous** cases (e.g. edit-revert = file content provably returns to an earlier byte-state; redundant read = exact same file re-read with no edit between). A non-zero count must be real signal — zero-LLM metrics lose trust fast on false positives.
- **D-07 (LOCKED):** **One step = one tool call** (Edit/Read/Bash/…); parallel calls issued in the same turn count **separately**. `total_step_count` = number of tool-call events; `wallclock_per_step` = gap between consecutive tool events. Most precise and most comparable across agents.
- **D-08 (DERIVED guardrail):** Each of the six heuristics ships with a **documented, testable definition backed by golden-trace fixtures**, so the strict calibration (D-06) is auditable and regression-tested — not vibes.

### Storage shape
- **D-09 (LOCKED):** **Flat metrics on the Run + one Route summary node.** Write the six heuristics as flat metric properties **on the Run** (directly queryable alongside its Phase-71 tags — satisfies ROUTE-02 SC3), AND populate **exactly one Route entity per Run** carrying the same heuristic summary + the `goal_sentence`. No per-Step node explosion. The Route node gives Phase 73's semantic judge a place to attach `goal_aligned_ratio`.

### Claude's Discretion (delegated to research/planning with guardrails)
- **Normalized-trace schema shape + where normalization lives**, and whether to **reuse the Phase-69/70 adapter ingestion** (which already reads Claude session JSONL + Copilot `events.jsonl`) as the trace feed vs a separate normalized-trace reader. Guardrail: cross-agent (D-01), per-heuristic null (D-02).
- **The exact strict definition of each heuristic** — what precisely constitutes a "loop", an "abandoned tool-call", whether errored/denied tool calls count toward steps. Guardrail: strict/high-precision (D-06), step = one tool call (D-07), fixture-tested (D-08).
- **When/where heuristics compute** — the Phase-71 coding-side close orchestrator (D-07 of Phase 71) is the expected home; an on-demand recompute is allowed since Run re-close is idempotent (Phase 71 D-14).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (acceptance source)
- `.planning/REQUIREMENTS.md` — ROUTE-01, ROUTE-02 (this phase); ROUTE-03 + SCORE-01/02 are Phase 73 (downstream awareness only).
- `.planning/ROADMAP.md` §"Phase 72: Syntactic Route Quality" — goal + 3 success criteria; depends on Phase 71.
- `.planning/notes/v73-perf-measurement-exploration.md` — design rationale: **D3** (`goal_sentence` as the run's target; Phase 72), the route/step KB sketch, and the syntactic-vs-semantic split (72 deterministic, 73 judge).

### Phase 71 substrate (the experiment store + Run/Route stubs this phase populates — consume as-is)
- `.planning/phases/71-experiment-kb-task-taxonomy/71-CONTEXT.md` — the dedicated experiment GraphKMStore (D-01), the `Experiment/Run/Route/Step/Decision/Outcome/Report` ontology (D-02), Route/Step ship **schema-only** awaiting Phase 72 data (D-12), Run keyed by `task_id` + idempotent re-close with refreshable totals (D-14), coding-side close orchestrator (D-07) where heuristic computation hooks in.
- `.data/ontologies/experiment-ontology.json` — the Route/Step classes Phase 72 instantiates (created during Phase 71 execution; verify on disk before planning — it carries the property surface heuristics attach to).

### Trace feeds (the per-agent sources the normalized trace adapts — D-01)
- `.planning/phases/69-claude-copilot-token-adapters/69-CONTEXT.md` — Claude session JSONL tailing (`tool_use`/`tool_result` events + timestamps) and Copilot `events.jsonl` ingestion; the host-side reader patterns. This is where Claude's rich edit/read/abandon detail lives.
- `.planning/phases/70-opencode-mastra-token-adapters/70-CONTEXT.md` — OpenCode trace source + the "proxy stays generic" principle (route/trace knowledge stays coding-side, not in the rapid-llm-proxy submodule).

### Measurement-span / goal_sentence surface (where ROUTE-01 attaches)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts` — `SpanRecord` already carries an optional `goal_sentence` field; `startMeasurement` (freeform prompt site, D-04), `stopMeasurement` (close + edit-at-close site, D-04), `getActiveMeasurement()` single reader.
- `.data/measurements/<task_id>.json` — archived span files the Run-write reads; `goal_sentence` lands here at close.

### Project conventions
- `CLAUDE.md` — km-core `ontologyDir` rule for any CLI touching the experiment store (acceptance grep mandatory), `no-console-log` (use `process.stderr.write`), rapid-llm-proxy submodule build pipeline, launchd conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-71 coding-side close orchestrator** — the expected host for heuristic computation: it already wires `stopMeasurement()` → derive/enforce → Run-write. Phase 72 extends it to also compute heuristics + write the Route node.
- **Phase-69/70 adapters** — already read Claude session JSONL (`tool_use`/`tool_result` + timestamps) and Copilot `events.jsonl`; strong candidates to feed the D-01 normalized trace (reuse vs separate reader = Claude's discretion).
- **`SpanRecord.goal_sentence`** (rapid-llm-proxy `measurement-span.ts`) — the field already exists; ROUTE-01 just needs to populate it (PLAN.md-derived or prompt) rather than add schema.
- **Experiment store + Route/Step ontology stubs** (Phase 71) — the write target; Route is instantiated per Run (D-09), Step stays a stub.

### Established Patterns
- **Zero-LLM determinism** — Phase 72 mirrors Phase 71's D-11 keyword-heuristic ethos: cheap, transparent, fixture-testable. No per-run LLM dependency (that's Phase 73).
- **All fields written, null where no source** (Phase 71 D-13) → directly reused as D-02 (per-heuristic null).
- **Idempotent Run re-close with refreshable totals** (Phase 71 D-14) → heuristics are recomputable on a later refresh, so a late-arriving/normalized trace can backfill.
- **Proxy stays generic** (Phase 70) → all trace/route logic lives coding-side; the rapid-llm-proxy submodule gains no route knowledge.

### Integration Points
- Normalized trace reader → consumed by the heuristic computer inside the Phase-71 close orchestrator.
- Heuristic computer → writes six flat metrics on the Run + one Route node (D-09) into the experiment store.
- `goal_sentence` → sourced from PLAN.md `**Goal**:` (/gsd, D-03) or the `startMeasurement` prompt / `stopMeasurement` edit (freeform, D-04); stored on `SpanRecord` → Run + Route.

</code_context>

<specifics>
## Specific Ideas

- The whole phase is the **deterministic floor** under Phase 73's judge: it must be trustworthy enough that a non-zero count is actionable, which is why **strict/high-precision** (D-06) + **fixture-tested definitions** (D-08) are the load-bearing decisions, not the storage shape.
- **Cross-agent from v0** (D-01) is a deliberate reach beyond Claude-only — accepting that coarser agents legitimately yield `null` heuristics (D-02) rather than fabricating signal. Honest gaps over false precision.
- The single Route node per Run (D-09) exists specifically to give Phase 73 a node to hang `goal_aligned_ratio` on — a forward-compatibility decision, not a Phase-72 need.
- A live verification (mirroring Phase 69/70/71) is expected: prove a real /gsd run close lands a Run with a PLAN.md-derived `goal_sentence`, the six heuristics (strict) + a Route node, and that a coarser-agent run writes `null` for the unsupported heuristics rather than `0`.

</specifics>

<deferred>
## Deferred Ideas

- **Semantic `goal_aligned_ratio`** (LLM-judge scoring each trace event toward/neutral/away from the goal) — Phase 73 (ROUTE-03); reads this phase's `goal_sentence` + Route trace.
- **5-dimension success scoring** — Phase 73 (SCORE-01/02).
- **Per-Step entity population** (one node per tool call) — out of scope (D-09 stores aggregates); revisit only if a per-step drill-down is needed in the Phase-74 dashboard.
- **Performance dashboard rendering of route metrics** — Phase 74.

### Reviewed Todos (not folded)
All phase-matched todos are weak generic-keyword matches (score 0.6 on "phase"/"plan"/"run"/"per") and none concern route quality, goal sentences, or trace heuristics:
- `2026-05-23-orphan-digest-observation-refs.md` — digest/observation data-integrity gap. Observation pipeline, not route metrics.
- `2026-06-10-okm-express-api-contract-bridge.md` — OKM Express ↔ unified-viewer API contract mismatch. Cross-system API gap.
- `2026-06-14-vkb-legend-static-cross-domain-bleed.md` — VKB sidebar legend rendering. Unified-viewer UI.
- `2026-06-17-hierarchy-wire-up-and-writer-enforcement.md` — hierarchy/writer enforcement. Observation-KB, not the experiment store.

</deferred>

---

*Phase: 72-syntactic-route-quality*
*Context gathered: 2026-06-24*
