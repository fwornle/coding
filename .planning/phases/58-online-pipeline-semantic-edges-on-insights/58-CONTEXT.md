# Phase 58: Online Pipeline Semantic Edges on Insights — Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Online-generated Insight entities currently carry only `capturedBy → LiveLoggingSystem` provenance edges — they live as isolated leaves hanging off the LSL anchor, traversable only as "an insight, somewhere in the online stream", not as "an insight ABOUT the Components / SubComponents / Details it actually discusses".

Phase 58 adds **semantic-content edges**: every new Insight emits at least one `mentions → <domain entity>` edge to the Components / SubComponents / Details the Insight's content discusses, in addition to the existing `capturedBy` provenance edge. Plus an atomicity guarantee (EDGE-02) so a concurrent reader never sees a half-written Insight.

**Two related delivery surfaces:**

1. **Writer-path emission** — `ObservationConsolidator` (the only producer of online Insights) computes the `mentions` set before each Insight write and lands node + edges atomically.
2. **One-shot backfill** — the 96 existing Insights in the live graph get retroactive `mentions` edges via the same LLM classifier the writer uses.

**Out of scope for Phase 58** (deliberately deferred):
- 3 of the 4 ROADMAP-candidate edge types (`dependsOn`, `isRelatedTo`, `instanceOf`) — `mentions` first, expansion as separate phases when concrete need surfaces (see `<deferred>`).
- Insight ↔ Insight cross-references — would change traversal semantics and create circularity risk (Insight A mentions Insight B mentions Insight A).
- TransferablePattern as edge target — patterns are layered above Insights in the current architecture; cross-layer edges deferred until pattern surface stabilizes.
- Timeline bi-source coloring (LSL ticks colored blue=batch / red=online) — closes via LSLTIME-03 in Phase 61, not here. Folded todo `2026-06-14-online-pipeline-semantic-edges-and-timeline-bi-source` explicitly cleaves its timeline-coloring portion to Phase 61.
- Subsystem tagging of Insights at write time (`metadata.subsystem='online-consolidator' vs 'wave-analysis'`) — would also feed Phase 61's timeline coloring; deferred together.
- Unified-viewer rendering changes — Phase 60 (`LOWERONTO-03` + `2026-06-14-online-filter-hides-ck-truncates-trace`).
- Re-running existing online-learning batches to re-classify historic Insights with FUTURE edge types beyond `mentions` — deferred per the folded todo.

</domain>

<decisions>
## Implementation Decisions

### G1 — Edge vocabulary

- **D-01:** Phase 58 ships **exactly one** new semantic-content edge type: `mentions`. Semantics: "this Insight discusses entity X". Single-type vocabulary keeps the LLM prompt simple (no disambiguation between `mentions` / `dependsOn` / etc.), the EDGE-01 acceptance grep deterministic (any Insight with ≥1 `mentions` edge passes), and the viewer-side filter additive (one new entry in the relation-type dropdown). The three other ROADMAP-candidate types (`dependsOn`, `isRelatedTo`, `instanceOf`) defer to subsequent phases when a concrete consumer surfaces — none currently exists in v7.2.
- **D-01.1:** `isRelatedTo` is **NOT** added even if a future phase wants relational expansion — the existing `related_to` edge type (202 instances in the live graph) covers this with naming-collision risk if both ship together. Future phases should extend `related_to` semantics or pick a distinct name.

### G2 — Edge generation strategy

- **D-02:** **One LLM classifier call per Insight.** After ObservationConsolidator synthesizes an Insight, a single follow-up call to the LLM (claude-haiku per CLAUDE.md `taskType` routing for cheaper bulk calls) takes (Insight summary, candidate entity catalog) → returns the subset the Insight `mentions`. Mirrors the routing pattern Phase 57-04 established for the L2 ontology refinement step. Cost envelope: ~96 calls for the backfill (D-05) + 1 call per Insight thereafter (low volume — Insights are consolidator-triggered, ~10/day typical).
- **D-02.1:** **Prompt shape (planner discretion on exact wording).** Two-part system message: (a) the ontology hint (L1 / L2 from coding.lower.json) so the LLM frames candidates by layer, (b) the candidate catalog (D-03) as a `<name>: <one-line description>` list. User message is the Insight summary. Response: JSON array of entity names. Reject any name not in the candidate catalog (no fabricated targets).
- **D-02.2:** **Threshold: no fixed top-K cap.** The LLM decides how many entities are mentioned. Typical range expected: 2-5 per Insight. Planner adds a sanity cap (e.g. 20) only as a guard against a hallucinated 50-entity response.

### G3 — Edge target scope

- **D-03:** Candidate set is the **L1 + L2 + L3 vertical** at classification time: every entity with `entityType` in `{Component, SubComponent, Detail}`. Current graph: 7 + 326 + 312 = **645 candidates**. Fits a single LLM prompt (~10K tokens of names + descriptions, well under context window). Insights about a specific Detail can therefore edge directly there rather than getting collapsed to its parent SubComponent — preserves traversal granularity.
- **D-03.1:** **No filtering by `metadata.project`** at classification time. Cross-project Insights are rare but legitimate (e.g., a Coding-project Insight that mentions a Component shared with OKM). The closed-set Project vocabulary from Phase 57 is for tagging, not target gating.
- **D-03.2:** **No Insight ↔ Insight, no Pattern, no Process, no Container, no File targets.** Scope cleanly to the L1-L3 architectural hierarchy. Cross-layer edges to Patterns / Insights / Files become a separate phase if/when they prove needed.

### G4 — Atomicity contract (EDGE-02)

- **D-04:** **Stage edges first, then atomic node+edges write.** ObservationConsolidator order:
  1. Synthesize Insight summary (existing path).
  2. **NEW:** LLM classifier call → list of `mentions` targets (in-memory, no graph writes yet).
  3. **NEW:** Build the edge list (`{from: pendingInsightId, to: targetId, type: 'mentions', metadata: {...}}[]`) in memory.
  4. Single `kmStore.putEntity(insight)` to land the node.
  5. Synchronous `for` loop calling `kmStore.addRelation(edge)` for each staged edge — **same microtask**, no awaits between addRelation calls beyond what the store requires.
  6. Existing `_anchorEntity` call (the `capturedBy → LiveLoggingSystem` edge from this commit's writer-path patch).

  km-core's JSON exporter is debounced 5s downstream of the in-memory Graphology, so a concurrent `/api/v1/entities` reader either sees the prior state (no Insight) or the new state (Insight + all `mentions` edges + capturedBy anchor). No intermediate-orphan window.

- **D-04.1:** **LLM call before putEntity is intentional.** If the LLM call fails, the Insight is NOT written — falls through to the next consolidation cycle on retry. Acceptable because: (a) Insights are derived state, no data loss (the underlying digests + observations remain), (b) the writer-path is already async (operator triggers consolidation manually or via scheduled job — failure surfaces in the operator workflow), (c) the alternative (write-then-edge-then-flip-pending) requires every reader path to filter on a pending flag, and any reader that forgets re-introduces the orphan-bleed Phase 58 is closing.

- **D-04.2:** **km-core transaction primitive is NOT a prerequisite.** The single-tick `putEntity → addRelation*N` ordering relies on JavaScript microtask scheduling, NOT on a kmStore transaction. If a future km-core release adds transactional support, the writer should adopt it as a defense-in-depth upgrade — but Phase 58 ships against the current API surface.

### G5 — Backfill scope

- **D-05:** **Backfill the 96 existing Insights in this phase.** New script `scripts/backfill-insight-mentions.mjs` reads `.data/knowledge-graph/exports/general.json`, identifies every `entityType=='Insight'` node, and runs the same D-02 LLM classifier against each — emitting `mentions` edges back through `kmStore.addRelation` (with `skipOntologyCheck` per the Phase 43 D-G4.1 trusted-path convention). Idempotent — running twice doesn't duplicate edges (kmStore.addRelation must be idempotent on the `(from, to, type)` triple; if it isn't, the script dedups in-process).
- **D-05.1:** **Backfill logs to `.data/backfill-insight-mentions-<ts>.json`** following the Phase 57-05 backfill summary convention: per-Insight `{insightId, name, mentionsAdded, errors[]}` plus aggregate counts. Operator can spot-check.
- **D-05.2:** **Backfill SHOULD run on the orphan-fix recovery state (817 nodes / 1285 edges as of 2026-06-15T05:35Z).** It does NOT re-run the LLM against Insights that already carry `mentions` edges (idempotency check). Acceptable runtime: ~96 claude-haiku calls × ~2s each = ~3 min wall-clock, plus the obs-api stop/restart cycle (D-06 lessons applied).

### G6 — Writer-path unification (Phase 57 fallout)

- **D-06:** **`ObservationConsolidator._pushInsightToKG` is refactored to write through `ObservationWriter.writeInsight`**, not via VKB HTTP `PUT /api/entities/${topic}`. Reason: the current dual-path means the new `mentions` edge logic AND the existing `_anchorEntity` `capturedBy` logic would otherwise need to be duplicated in BOTH writers, with drift risk (Phase 58 ship + a future change to ObservationWriter that the consolidator path silently misses).
  - The HTTP-PUT path was chosen historically because the consolidator's environment didn't always have a `kmStore` handle. The path that ObservationWriter uses requires `options.kmStore` (constructor injection), so the refactor includes wiring `kmStore` into the consolidator (verify `ObservationConsolidator` constructor accepts `options.kmStore`; if not, extend it).
  - Existing `has_insight` relation from Project anchor (line 565-580) is preserved — it edges the Insight back to the team's Project node for UI hierarchy. Both that edge AND the new `mentions` edges AND the existing `capturedBy` edge ship via the same `kmStore.addRelation` path.
- **D-06.1:** **The VKB HTTP `PUT /api/entities/${topic}` path is NOT deleted.** It remains for non-consolidator callers (anything else in the codebase that writes Insights to VKB). Refactor scope is targeted: only `_pushInsightToKG`'s call site changes.
- **D-06.2:** **The bridgeRemainingOrphans periodic backfill (ObservationConsolidator.js line 1903-1925) IS audited as part of this phase** — its current scope (anchor edges only) is extended to also call the D-02 LLM classifier on any Insight it finds without `mentions` edges. Same backfill code path as D-05.

### Claude's Discretion

- **Exact LLM prompt wording** for the `mentions` classifier — planner drafts; SC#1 (sample 20 Insights, ≥18 carry ≥1 `mentions` edge) is the acceptance signal.
- **Candidate catalog construction** — planner decides whether to load all 645 names+descriptions per call (simple) or build a single shared in-memory catalog the consolidator caches across calls (more efficient at higher Insight throughput). Cache invalidation on a new Component/SubComponent/Detail entering the graph is the trade-off.
- **kmStore.addRelation idempotency check** — planner verifies whether km-core's `addRelation` is idempotent on `(from, to, type)` or whether the writer needs to dedupe before calling. Phase 38 GraphKMStore research is the source of truth.
- **Backfill batching** — planner decides whether to run all 96 LLM calls serially (simpler) or in parallel waves of N (faster). Either acceptable; lean to serial unless the operator surfaces a wall-clock concern.
- **Test surface** — at minimum: 1 unit test for the prompt-construction helper, 1 fixture test that the writer emits a `mentions` edge given a stubbed LLM response, 1 integration test that backfill is idempotent. Planner refines.

### Folded Todos

- **`2026-06-14-online-pipeline-semantic-edges-and-timeline-bi-source.md`** (`resolves_phase: 58`, `resolves_phase_secondary: 61`). The primary problem statement with verified jq evidence (91 Insights / 111 capturedBy-only edges as of 2026-06-14) and a suggested 6-step milestone shape. Folded scope:
  - Semantic-edge generation per Insight (steps 2, 5 in the todo) — D-02 + D-05.
  - Writer-path unification implied by the deep-dive (todo "What's missing in ObservationConsolidator.js") — D-06.
  - Subsystem tagging on write (step 1) — **deferred** to Phase 61 (timeline coloring is its consumer).
  - Subsystem-aware `pickAllResolvable` (step 3) — **deferred** as optional viewer-side change.
  - Timeline bi-source coloring (step 4) — **deferred** to Phase 61 (LSLTIME-03).
  - Re-running consolidation for historic Insights (step 5) — folded as backfill D-05 for the `mentions` edge type only; future edge types remain deferred.
- **`2026-05-23-orphan-digest-observation-refs.md`** (8 digests reference observations missing from both live SQLite and cold-store export). Folded as a defensive note: the D-04 atomicity contract (write edges + node atomically) is the structural mechanism that prevents this kind of dangling-reference state for the new Insight `mentions` edges. The 8 historic dangling digest→observation refs are NOT cleaned up in Phase 58 — they predate this writer surface; separate maintenance scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase boundary + scope
- `.planning/ROADMAP.md` (search for "Phase 58") — goal, requirement IDs (EDGE-01, EDGE-02), three success criteria, milestone v7.2 context.
- `.planning/REQUIREMENTS.md` (EDGE-01, EDGE-02 rows) — exact acceptance language.

### Prior phases this depends on
- `.planning/phases/57-lower-ontology-project-tagging-foundation/57-CONTEXT.md` — Phase 57 introduced `OnlineInsight` as an L2 ontology class (`coding.lower.json`) and the project tag stamping convention. Both surface in Phase 58 edges.
- `.planning/phases/57-lower-ontology-project-tagging-foundation/57-04-SUMMARY.md` — the ontology-classification-agent that runs the L2 refinement; same routing pattern (`taskType` → claude-haiku) is the model for the D-02 `mentions` classifier.

### Code surfaces in scope
- `src/live-logging/ObservationConsolidator.js` (~174 KB) — the consolidator hot path. Relevant sections:
  - `_pushInsightToKG` (~line 520-585) — current Insight write path via VKB HTTP. **Refactor target** per D-06.
  - `_ensureProjectAnchor` (~line 604+) — Project anchor resolution used by the existing `has_insight` edge.
  - `bridgeRemainingOrphans` (~line 1903-1925) — periodic anchor backfill. **Extend** per D-06.2.
- `src/live-logging/ObservationWriter.js` (~70 KB) — the durable writer that already implements `_anchorEntity` (`capturedBy → LiveLoggingSystem`). Relevant sections:
  - `writeInsight` (~line 1165) — the canonical entry point the consolidator should route through per D-06.
  - `_resolveAnchorId` (line 380) — **just patched in commit 955617a1a** to retry on every call instead of giving up after one failure. Pattern to mirror for any other one-shot resolution caches added in Phase 58.
  - `_anchorEntity` (line 412) — the existing `addRelation` writer; the new `mentions` edges go through the same `kmStore.addRelation` API.

### km-core surfaces
- `lib/km-core/src/store/GraphKMStore.ts` — `putEntity`, `addRelation`, `findByOntologyClass` APIs the writer uses.
- `lib/km-core/src/store/persistence.ts` — the 2026-06-15 hydrate-prefer-JSON patch (76ffd18 in submodule, e8312e35e in outer) is load-bearing. The Phase 58 backfill (D-05) and writer (D-04) BOTH assume the patch is in place; restart cycles during execution will trip the same regression otherwise.
- `lib/km-core/src/types/project.ts` — `PROJECTS` / `isProject` from Phase 57-01. Not directly consumed by Phase 58 but the closed-set semantics inform why D-03.1 doesn't filter targets by project.

### Operational invariants (CLAUDE.md)
- `./CLAUDE.md` — full project rules. Especially:
  - **rapid-llm-proxy routing** — `wave-analysis-*` overrides matter for the LLM classifier call routing; D-02's claude-haiku routing relies on the `taskType` field being honored.
  - **Submodule rebuild rule** — the writer-path unification (D-06) touches `src/live-logging/` (host-side, not bind-mounted). No docker rebuild needed for `ObservationConsolidator.js` / `ObservationWriter.js` edits, but km-core changes DO require the rebuild dance.
  - **launchd-managed daemons** — `com.coding.obs-api` runs the writer; planner schedules the LevelDB-lock release dance (`launchctl bootout`) for any backfill that needs direct kmStore access. The 2026-06-15 obs-api respawn race is the cautionary tale.

### Test fixtures
- `lib/km-core/tests/fixtures/` — existing fixture corpora for OntologyRegistry-driven tests. Same pattern for the new `mentions` writer + backfill tests.

### External references
- None at this phase. The semantic-content edge convention is internal — no published spec.

</canonical_refs>

<deferred>
## Deferred Ideas

- **3 of the 4 ROADMAP-candidate edge types** (`dependsOn`, `isRelatedTo`, `instanceOf`) — add in a future phase when a concrete consumer (viewer filter, traversal query, analytics) needs differentiation beyond `mentions`. `isRelatedTo` is doubly-deferred due to naming collision with existing `related_to` (D-01.1).
- **Insight ↔ Insight cross-references** — would let an Insight edge to other Insights it builds on. Useful for meta-insights but introduces circularity risk and changes traversal semantics. Separate phase.
- **TransferablePattern as edge target** — patterns are layered above Insights; cross-layer edges deferred until the pattern surface stabilizes (Phase 60+).
- **Subsystem tagging on write (`metadata.subsystem`)** — distinguishes online-consolidator vs wave-analysis Insights. Phase 61 consumer (timeline bi-source coloring, LSLTIME-03).
- **Timeline bi-source coloring** — closes via LSLTIME-03 in Phase 61.
- **Re-classifying historic Insights with FUTURE edge types beyond `mentions`** — backfill (D-05) covers `mentions` only. When new edge types ship, they get their own backfill phase.
- **km-core transactional primitives** — D-04.2 ships against current single-tick microtask semantics. If km-core adds a `transaction()` API later, the writer should adopt it as a defense-in-depth upgrade (no immediate harm if it doesn't ship).
- **Subsystem-aware `pickAllResolvable`** — viewer-side fallback that uses semantic similarity (Qdrant) to widen the resolution net for buckets with no mentions edges. Defer until SC#1 (`≥18/20 Insights carry mentions`) proves the runtime; only fall back to similarity if mentions coverage is below threshold in practice.
- **Cleaning up the 8 historic digest→observation dangling refs** (`2026-05-23-orphan-digest-observation-refs.md`). Separate maintenance scope.
- **Renaming `related_to` → `mentions`** (or another vocabulary harmonization across edge types). Too disruptive; defer until edge-type vocabulary review across phases.

</deferred>

<surrounding_context>
## Operational Notes for Downstream Agents

The day this phase context was gathered (2026-06-15) included a **graph-state recovery cycle** that materially affects how planning + execution proceed:

1. **The km-core hydrate-prefer-JSON patch (commit e8312e35e + submodule 76ffd18) MUST stay in place.** It's the safety net for any obs-api restart during backfill or testing. If a future `npm run build` in `lib/km-core` wipes the patch (Phase 57-01 lesson), reapply BEFORE any backfill runs.

2. **The orphan-anchor patch (commit 955617a1a) is already in.** ObservationWriter's `_resolveAnchorId` now retries on every call. Insights written under this code base will get their `capturedBy` edge whenever the anchor is hydrated. Phase 58 builds on this.

3. **Container `mcp-servers:semantic-analysis` is still FATAL** (open issue: static import of `isProject` from `@fwornle/km-core` fails inside the container despite dynamic import working). Not a Phase 58 blocker — the consolidator + the writer run host-side, not in the container. But the health dashboard will stay Degraded until that's fixed.

4. **The 22 currently-orphan Insights have been backfilled with `capturedBy` edges** (commit 955617a1a). Their `mentions` edges are STILL missing — the D-05 backfill in Phase 58 closes that gap.

</surrounding_context>

<next_steps>
## Next Steps

1. **`/clear`** to reset orchestrator context.
2. **`/gsd-plan-phase 58`** — produces `58-PLAN.md` (executable). Planner reads this CONTEXT.md + the canonical refs and decomposes into plans (likely 3-4: writer-path unification, mentions classifier, backfill script, atomicity test surface).
3. **Optional `/gsd-discuss-phase 58 --update`** if planning surfaces additional gray areas before execution.

</next_steps>
