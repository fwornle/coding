# Phase 75: Measurement Attribution Accuracy & Observation Linkage - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the v7.4 measurement rig trustworthy for an **interactive foreground agentic session**. The `exp-dash-start-control` dogfood run reported 1.24M tokens / model `haiku` / score 0.933 for an **Opus** session — all of it concurrent background daemon/consolidator traffic, none of it the Opus session. This phase corrects that. Five locked requirements (no scope to change WHAT):

- **ATTR-01** — attribute a token row to a measurement only when it belongs to the measured task's process/agent lineage, not time-window overlap alone; segregate background daemons.
- **ATTR-02** — one canonical model/agent per Run + a per-process model breakdown, shown as two columns (chat model | background-service models) consistently across runs table, score drawer, timeline.
- **ATTR-03** — capture the foreground interactive agent's own session tokens into `token_usage` stamped with the active `task_id` (the agent bypasses the proxy, so its usage is otherwise invisible).
- **OBS-01** — observations/digests/insights produced during a measurement are tagged with the active `task_id` and queryable per Run.
- **OBS-02** — ETM captures observations *throughout* a long agentic prompt-set (not only at start) and stamps each with its **real event time**.

**Out of scope:** changing the rubric/judge/Score-write keying or the `token_usage` schema *shape* (extend, don't redesign); reproducibility/replay rig (Phase 67); dashboard query-builder/report features (Phase 74, shipped).
</domain>

<decisions>
## Implementation Decisions

### ATTR-01 — Lineage signal & background handling
- **D-01: Both stamp + denylist guard.** The **positive** lineage signal is an explicit `task_id` stamped at the foreground capture seam (the agent's own rows from ATTR-03 carry the active task_id). A **process denylist** (`consolidator-*`, `health-coordinator`, `observation-writer`, and other known non-task daemons) is applied as a defensive filter so any in-window row without a real foreground lineage is classified background. Belt-and-suspenders: positive attribution where we control the seam, denylist catches the rest. Replaces TELEM-03's "in-window → task_id" blanket rule.
- **D-02: Background rows kept but segregated, not dropped.** Concurrent background-daemon rows inside the window stay associated with the Run but are **flagged as background** (e.g. a `lineage`/`is_background` discriminator on the row or aggregate). The Run's headline cost reflects **foreground only**; the segregated background rows feed ATTR-02's "background-service models" column. Nothing is lost — the operator can still see what ran concurrently. **For research:** decide whether the discriminator lives on the `token_usage` row (new column) or is derived at aggregation time from the denylist + task_id — prefer the least-invasive that still survives re-aggregation.

### ATTR-03 — Foreground token capture
- **D-03: Batch at measurement-stop.** On `measurement-stop`, read the active agent session transcript, build token rows, stamp each with the task_id, and `insertTokenRowDeduped()`. Reuses the existing extraction (`buildClaudeTokenRows()`), one wiring point, idempotent dedup. The requirement explicitly permits the "stop/close (or a live) path" — live-streaming is **deferred** (see Deferred Ideas).
- **D-04: All four foreground agents in scope, via a per-agent adapter registry.** Capture own-tokens for Claude Code, Copilot CLI, OpenCode, and Mastra — matching the v7.4 "cross-agent" framing. Only `buildClaudeTokenRows()` exists today; the other three need `buildXTokenRows` adapters. **For research (critical):** not all four bypass the proxy — Claude Code calls Anthropic directly (definitely bypasses, definitely needs the adapter). OpenCode/Mastra may already route through the rapid-llm-proxy and thus already be in `token_usage` (in which case they need task_id stamping, not a new transcript adapter). **Confirm per agent which path applies before building** — building a transcript adapter for an agent already captured by the proxy would double-count. Structure the stop-path wiring as an adapter registry keyed by agent so each agent is a drop-in.

### ATTR-02 — Canonical model rule
- **D-05: Canonical = the foreground chat agent.** The one canonical model/agent for a Run is the agent/model that actually ran the measured session (from the ATTR-03 foreground capture) — Opus for an Opus run. Background-service models **never** become canonical. This is the direct fix for finding B (the dashboard would have shown Opus, not haiku). Replaces today's "dominant-by-token-count" selector (`byAgentModel[0]` in `measurement-stop.mjs`). **Note:** legacy Runs with no ATTR-03 foreground capture will have an empty/unknown canonical until re-measured — acceptable; this phase is forward-looking. **For research:** decide the empty-canonical display (e.g. "—" / "unmeasured") rather than silently falling back to dominant.
- **D-06: Compute once at stop, persist on the Run entity.** `measurement-stop` computes canonical (foreground) + the background-service model list **once** and writes both onto `Run.metadata` (e.g. `canonical_model` + `background_models[]`). Runs table, score drawer, and timeline all **read these fields** — no per-surface recomputation. Per-surface recomputation is exactly how the dominant-vs-first-row divergence arose, so it is rejected.

### OBS-02 — Observation re-capture & timestamps
- **D-07: Re-capture on AskUserQuestion decisions + significant tool-activity batches.** ETM no longer snapshots only at prompt-set start. New observations are emitted on (a) each `AskUserQuestion` operator decision (the natural steering boundary finding D names) and (b) significant tool-activity batches between decisions (so a long question-less stretch of agent work still yields observations). No arbitrary periodic timer in this phase. **For research:** define "significant tool-activity batch" concretely (count/size/time threshold) and the dedup strategy so re-capture doesn't re-emit the same exchange.
- **D-08: Stamp each observation with the triggering exchange timestamp.** Each observation's event time = the timestamp of the transcript exchange/decision that triggered it (the AskUserQuestion decision time, or the last message in the captured batch), **not** the prompt-set start and **not** wall-clock-at-generation. The transcript already carries per-message timestamps. This directly satisfies OBS-02 acceptance: a session whose only typed prompt is at T0 but with decisions at T0+n yields observations dated ~T0+n.

### OBS-01 — Observation→Run linkage (mechanical, not separately debated)
- **D-09: ETM reads `getActiveMeasurement()` and stamps `task_id`.** Observations/digests/insights produced during a measurement carry the active `task_id` (resolved via the same single-span reader as the token path, e.g. `resolveLiveTaskIdSafe()`), are exposed in the observation view, and are queryable/correlatable to the Run. **For research:** confirm the observation write seam (`ObservationWriter.js`) can resolve the active span at write time without coupling ETM to the proxy.

### Claude's Discretion
- The exact storage mechanism for the foreground/background discriminator (new `token_usage` column vs aggregation-time derivation) — pick the least-invasive that survives re-aggregation (D-02).
- The concrete threshold for a "significant tool-activity batch" and the observation dedup key (D-07).
- The empty-canonical display string for legacy Runs (D-05).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase intent & evidence (read first)
- `.planning/v7.4-attribution-findings.md` — findings A–D from the `exp-dash-start-control` dogfood run; the authoritative statement of what's broken and why. Each decision above maps to a finding (A=timeline FIXED, B=canonical model, C=time-window over-attribution, D=ETM under-capture + timestamp-collapse).
- `.data/experiments/exp-dash-start-control-claude-opus-4-8.log.md` — the actual mis-measured run (1.24M tokens / haiku / Opus session).
- `.planning/REQUIREMENTS.md` §ATTR-01/02/03, OBS-01/02 (lines ~65–71) + the TELEM-03 note this phase corrects (line ~30).
- `.planning/ROADMAP.md` §"Phase 75" (lines 184–198) — goal, success criteria, depends-on (68/69/74).

### Token attribution path (ATTR-01/02/03)
- `lib/lsl/token/token-db.mjs` — 21-column `token_usage` schema (`:49–54`), `insertTokenRow()` / `insertTokenRowDeduped()` (`:107–195`). Row already carries `process`, `agent`, `task_id`, `granularity_tier`.
- `lib/lsl/token/claude-token-rows.mjs` — `buildClaudeTokenRows()` (`:82–231`), the existing (unwired) Claude transcript→rows extractor; per-turn + per-reasoning-step rows with `task_id: ''` awaiting stamp. The template for the other three agents' adapters.
- `lib/lsl/token/task-id.mjs` — `resolveLiveTaskIdSafe()` (`:64–79`), the single-span reader (best-effort, never throws). Use this to resolve the active task_id at the capture seam.
- `scripts/measurement-start.mjs` / `scripts/measurement-stop.mjs` — active span lifecycle; span shape `{ task_id, started_at, ended_at?, goal_sentence? }` in `.data/active-measurement.json`. `measurement-stop.mjs:~297–298` is today's `dominant = byAgentModel[0]` canonical selector (the seam D-05/D-06 replace) and the natural wiring point for D-03 batch capture.
- `lib/experiments/token-aggregate.mjs` (`:88–94`, `GROUP BY agent, model, provider, granularity_tier ORDER BY total_tokens DESC`) and `lib/experiments/run-write.mjs` (`:88–122`, `Run.metadata.model`) — where canonical/background must be computed once and persisted (D-06).
- `integrations/mcp-server-semantic-analysis/src/utils/token-usage-logger.ts` (`:54–128`) — host-side `attachTokenLogger`/`logTokenUsage`; the proxy-routed write seam (no task_id today). Relevant for confirming which agents are already captured here vs need a transcript adapter (D-04 research).

### Observation linkage (OBS-01/02)
- `src/live-logging/ObservationWriter.js` (`:~248+`) — observation write seam; today stamps from transcript exchange but has no `task_id` and no re-capture/true-event-time logic. The seam for D-07/D-08/D-09.
- ETM / `enhanced-transcript-monitor` (referenced in `ObservationWriter.js` comments; launchd `com.coding.etm`, logs `.logs/etm.log`) — the prompt-set snapshot unit that re-capture must change. **For research:** locate the actual ETM fire path that decides the unit-of-observation and where AskUserQuestion decision boundaries are (or aren't) visible.

### Dashboard surfaces (ATTR-02 display)
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` (`:160`, renders `run.model`), `timeline.tsx` (`:85,99`, per-turn `row.model`), `score-drawer.tsx` — the three surfaces that must read the persisted `canonical_model` + `background_models[]` and render the two-column display.
- `.planning/phases/74-performance-dashboard-reports/74-CONTEXT.md` — Phase 74 decisions carried forward (corrected-wins convention, faceted runs table, per-run drawer, timeline sub-bands + tier badge, bind-mount rebuild rule).

### Build/verify rules
- `CLAUDE.md` — dashboard is bind-mounted (`npm run build` + `supervisorctl restart web-services:health-dashboard-frontend`, no Docker rebuild); km-core `ontologyDir` rule for any experiment-store opener; E2E-verify UI with `gsd-browser` on `localhost:3032`.
- `lib/experiments/store.mjs` — `openExperimentStore()` (ontologyDir-aware) for any Run read/write.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildClaudeTokenRows()` + `insertTokenRowDeduped()` already exist and are idempotent — ATTR-03 Claude capture is wiring, not new extraction.
- `resolveLiveTaskIdSafe()` is the established single-span reader — reuse it identically in both the token path (ATTR-03) and the observation path (OBS-01) so they agree on the active task_id.
- `token_usage` rows already carry `process` and `agent` — the denylist (D-01) and segregation (D-02) can key off existing data without new capture.

### Established Patterns
- Compute-once-at-stop, persist-on-Run, read-everywhere (the lesson behind D-06) mirrors how Phase 74 surfaces already read `Run.metadata` rather than recomputing.
- Per-reasoning-step vs per-turn `granularity_tier` rows are already modeled — the new adapters must preserve this tiering.

### Integration Points
- `measurement-stop.mjs` is the convergence point: it's where D-03 (batch foreground capture), D-05/D-06 (canonical computation + persist), and the denylist segregation all wire in. Plan for it being the highest-churn file.
- `ObservationWriter.js` / ETM fire path is the convergence point for OBS-01/02.

</code_context>

<specifics>
## Specific Ideas

- The acceptance bar for OBS-02 is concrete and from the operator's own session: transcript `e0af5b8b` had its last typed prompt at 2026-06-28T21:00:43Z then ran to 2026-06-29T06:08Z with 5 morning AskUserQuestion decisions (05:30–06:03Z) and real deliverables — yet ETM produced only 8 observations all stamped 21:00:43Z. The fix must turn that into observations dated ~05:30–06:03Z.
- The "cross-agent" decision (D-04, all four agents) is a deliberate widening beyond the findings' Claude-only framing — the operator wants the rig honest for whichever agent runs the session. Research must not let this silently double-count proxy-captured agents.

</specifics>

<deferred>
## Deferred Ideas

- **Live (in-session) foreground token streaming** — D-03 ships batch-at-stop; real-time dashboard token display during a running measurement is a follow-up (file watcher, partial-turn handling, crash recovery). Note for a future phase.
- **Periodic time-based observation flush** — D-07 uses decision + tool-batch boundaries only; a wall-clock flush for ultra-long question-less stretches can be added later if those boundaries prove insufficient.

### Reviewed Todos (not folded)
None reviewed in this discussion.

</deferred>

---

*Phase: 75-measurement-attribution-accuracy-observation-linkage*
*Context gathered: 2026-06-29*
