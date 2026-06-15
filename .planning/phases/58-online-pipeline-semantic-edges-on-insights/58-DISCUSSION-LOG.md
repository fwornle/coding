# Phase 58 — Discussion Log

**Date:** 2026-06-15
**Mode:** discuss (default)
**Outcome:** CONTEXT.md captured 6 decisions across 4 gray areas.

## Pre-discussion analysis

Phase boundary derived from ROADMAP.md (EDGE-01, EDGE-02). Prior decisions from Phase 57-CONTEXT.md applied: `OnlineInsight` as L2 ontology class, `metadata.project` stamping, `isProject` typeguard. Pending todos cross-referenced — 11 keyword matches, 2 deemed relevant.

**Codebase scout:**
- `src/live-logging/ObservationConsolidator.js` (174 KB, hot path).
- `src/live-logging/ObservationWriter.js` (70 KB, canonical writer with `_anchorEntity`).
- `lib/km-core/src/store/GraphKMStore.ts` — `putEntity` / `addRelation` / `findByOntologyClass` API surface.
- jq counts of current graph state (post 2026-06-15 recovery): 96 Insights total, 22 orphans pre-anchor-backfill (0 after commit 955617a1a), `mentions` edge type does not yet exist.

## Todos folded into scope

| Todo file | Score | Decision |
|---|---|---|
| `2026-06-14-online-pipeline-semantic-edges-and-timeline-bi-source.md` | 0.6 (direct `resolves_phase: 58` match) | **Folded** — primary problem statement |
| `2026-05-23-orphan-digest-observation-refs.md` | 0.6 | **Folded** as defensive note (atomicity D-04 prevents recurrence for `mentions` edges) |
| Other 9 keyword matches | 0.6 | **Reviewed, not folded** — belong to Phase 60 (unified-viewer concerns), infra, or cross-system |

## Gray areas presented

User selected ALL 4 areas (multiSelect): Edge type vocabulary, Edge generation strategy, Edge target scope, Atomicity contract.

## Q&A trail

### Q1 — Edge type vocabulary
- **Options presented:** Minimal (just `mentions`) / ROADMAP 4-type set / Curated 3 (drop `isRelatedTo`) / Reuse existing `related_to`.
- **Selected:** Minimal — just `mentions` (Recommended). One semantic-content edge type; future expansion as separate phases when concrete consumers surface.
- **Captured as:** D-01 + D-01.1.

### Q2 — Edge generation strategy
- **Options presented:** LLM classifier per Insight / Qdrant semantic similarity / Token-overlap heuristic / Hybrid (similarity gate + LLM verify).
- **Selected:** LLM classifier per Insight (Recommended). 1 call per Insight via claude-haiku routing.
- **Captured as:** D-02 + D-02.1 + D-02.2.

### Q3 — Edge target scope
- **Options presented:** Component + SubComponent + Detail / Component + SubComponent only / Wider set including Patterns + Insights / Project-scoped subset.
- **Selected:** Component + SubComponent + Detail (Recommended). 645 candidates from the live graph; fits a single LLM prompt.
- **Captured as:** D-03 + D-03.1 + D-03.2.

### Q4 — Atomicity contract (EDGE-02)
- **Options presented:** Stage edges then atomic node+edges / Pending flag + multi-step / km-core transaction primitive / Best-effort + documented race.
- **Selected:** Stage edges first, then atomic node+edges in single tick (Recommended).
- **Captured as:** D-04 + D-04.1 + D-04.2.

### Q5 — Backfill scope (96 existing Insights)
- **Options presented:** Backfill in this phase / Writer-path only, defer backfill.
- **Selected:** Backfill in this phase (Recommended). ~96 claude-haiku calls; mirrors Phase 57-05 backfill pattern.
- **Captured as:** D-05 + D-05.1 + D-05.2.

### Q6 — Writer-path unification (Phase 57 fallout)
- **Options presented:** In scope (route `_pushInsightToKG` through `ObservationWriter`) / Out of scope (patch separately).
- **Selected:** In scope (Recommended). Closes the dual-path technical debt the 2026-06-15 orphan-anchor incident exposed.
- **Captured as:** D-06 + D-06.1 + D-06.2.

## Interruptions handled mid-discussion

The discuss-phase was interrupted three times by parallel operational issues:

1. **Knowledge graph regression at viewer (orphans + lost edges)** — diagnosed Phase 57-05 backfill caused a hydrate-prefer-LevelDB regression (the 2026-06-11 manual patch was wiped by `npm run build` in 57-01). Recovery committed in e8312e35e + 76ffd18 (km-core submodule) + cd8bfaf68 + e54cc2572. Phase 58 plans assume the patch is in place.
2. **Observation + Digest entity bleed in km-core** — operator pointed out these belong in the observation store, not the unified KG. Cleanup committed in cd8bfaf68. The writer-side root cause (still active) is folded into Phase 58 scope via D-06.
3. **22 orphan Insights surfaced post-recovery** — diagnosed as `ObservationWriter._resolveAnchorId` giving up after one failed lookup. Backfill + writer patch committed in 955617a1a. Phase 58 builds on this — the canonical writer path NOW reliably anchors; the next layer of writer correctness is the `mentions` edge emission this phase delivers.

These interruptions surfaced critical context for the phase plan and are referenced in `<surrounding_context>` of CONTEXT.md.

## Deferred ideas captured

See CONTEXT.md `<deferred>` — 9 items deferred to future phases or maintenance work, including 3 of the 4 ROADMAP-candidate edge types, Insight↔Insight cross-refs, Pattern-target edges, subsystem tagging, timeline coloring, km-core transactional primitives, similarity-fallback resolution, the 8 historic dangling refs, and a `related_to`→`mentions` vocabulary harmonization.

## Scope-creep redirects

- Operator interest in fixing the container `mcp-servers:semantic-analysis` FATAL state was **explicitly declined** in favor of resuming discuss-phase; flagged as a separate concern that doesn't block Phase 58 (writer + consolidator run host-side).
- Subsystem tagging for timeline coloring was **redirected to Phase 61** (`LSLTIME-03` per the folded todo's `resolves_phase_secondary`).
