# Phase 60: Unified Viewer Rendering UX Integrity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 60-unified-viewer-rendering-ux-integrity
**Areas discussed:** Layer filter data contract, Legend derivation strategy, CK under Online filter, L2 ontology UX + schema source

---

## Layer filter data contract (SC#1)

### Q1 — unify divergent layer-derivation between LayerFilter counts and visibility-predicate

| Option | Description | Selected |
|--------|-------------|----------|
| Shared deriveLayer() helper | Extract one helper module; both call sites use it. No writer changes, no API contract change. | |
| Stamp `layer` at writer time | First-class field on every km-core entity; writers stamp it; one-shot backfill. Cleaner long-term but heavier scope. | |
| Hybrid: helper now, writer-stamp later | Ship the helper as the unifying fix; file a follow-up phase for writer-stamped field. | ✓ |

**User's choice:** Hybrid.
**Notes:** Captures pragmatism without locking out the cleaner long-term shape. Follow-up phase noted in CONTEXT.md `<deferred>` block.

### Q2 — L2 ontology class layer resolution (Phase 57 added `OnlineInsight` etc.)

| Option | Description | Selected |
|--------|-------------|----------|
| Walk `extends` via OntologyRegistry | Helper takes registry; resolves L2 → L1 ancestor; existing Insight\|Pattern rule applies at any matching ancestor. Auto-handles future L2 additions. | ✓ |
| Hardcoded L2 map | Inline `Record<L2, layer>` map for the 10 Phase 57 classes. Drifts on new L2s. | |
| Inference from name suffix | Pattern-match class name endings. Brittle to naming conventions. | |

**User's choice:** Walk `extends` via OntologyRegistry.
**Notes:** Viewer already fetches registry data via `/api/v1/ontology/classes?withDisplay=true`; helper reuses the same response.

---

## Legend derivation strategy (SC#2)

### Q1 — fix the static legend that bleeds OKB content into VKB

| Option | Description | Selected |
|--------|-------------|----------|
| Fully dynamic from rendered graph | LegendPanel receives `entities` + `relations`; each section computed from what's present. Drops static arrays. | ✓ |
| Per-tab schema constant | Keep hardcoded but add per-tab schema (CODING_LEGEND_SCHEMA vs OKB). Smaller diff but still static. | |
| Hybrid: derived DOMAINS/RELATIONSHIPS, per-tab SOURCE/LAYER | Mixed strategy keyed on which sections suffer cross-tab bleed. | |

**User's choice:** Fully dynamic from rendered graph.
**Notes:** Solves cross-tab bleed in one stroke; OKB tab will show OKB types naturally because that's what's rendered.

### Q2 — what "rendered graph" means as Legend input

| Option | Description | Selected |
|--------|-------------|----------|
| Filtered — mirror exactly what's on canvas | Uncheck Pattern → LAYERS section loses Pattern row. Literal 1:1 mapping. | ✓ |
| Unfiltered — reflect full loaded dataset | Static reflection of every type/source present in loaded payload (pre-filter). | |
| Both — dim unrendered rows | Render unfiltered set; dim what's currently filtered out. | |

**User's choice:** Filtered — mirror exactly what's on canvas.
**Notes:** Matches SC#2 literal reading: "static OKB-domain entries are NOT present when zero such nodes are rendered" — 'rendered' means visible.

---

## CK under Online filter (SC#4)

### Q1 — root-cause fix for CK truncating traces under Online filter

**Investigation finding shared before the question:** Verified `general.json` shows CK's `ontologyClass = 'Detail'` (not `'System'`) and `metadata.source = 'manual'`. The viewer's `visibility-predicate.ts:69-76` already exempts `System | Project | Component` from Learning Source filter, so the fix is upstream data, not predicate logic.

| Option | Description | Selected |
|--------|-------------|----------|
| Fix CK ontologyClass to 'System' (data) | One-shot km-core writer-side data fix. The existing structural-backbone exemption catches it for free. | ✓ |
| Re-tag CK + Projects as `source: 'both'` | Writer-side stamp + backfill so `source` carries a new value. More invasive — touches every source-vocabulary consumer. | |
| Exempt hierarchy roots by name | Add CK by name to the predicate's structural-backbone exemption. Leaks structural knowledge into the filter. | |

**User's choice:** Fix CK ontologyClass to 'System' (data fix).
**Notes:** Cleanest data-truthful fix. Aligns with what Phase 56 / 56.1 expected (CK = System root). Project nodes are already correctly classified.

### Q2 — where the fix lands (writer guard vs backfill only)

**Investigation finding shared before the question:** The writer at `content-validation-agent.ts:2685` correctly asserts `'CollectiveKnowledge': 'System'`. A downstream re-classifier is overwriting CK's class. Live snapshot still carries `metadata.classification: 'System'` (the writer's assertion) but `ontologyClass: 'Detail'` (the override).

| Option | Description | Selected |
|--------|-------------|----------|
| Backfill only + protect via writer guard | One-shot repair + guard against re-classifier corrupting CK again. Future wave-analysis runs won't regress. | ✓ |
| Backfill only — file re-classifier hardening as follow-up | Ship only the one-shot repair; next `ukb` could re-corrupt. | |
| Writer guard only — next wave-analysis re-emits correctly | Skip backfill; rely on next `ukb` run. Bug visible until next manual UKB. | |

**User's choice:** Backfill only + protect via writer guard.
**Notes:** Ships both deliverables in Phase 60: `scripts/repair-ck-ontology-class.mjs` + writer-side guard exempting hard-classified system roots. Constants live in new `lib/km-core/src/types/hierarchy-roots.ts`.

---

## L2 ontology UX + schema source (SC#5)

**Investigation finding shared before the questions:** `GET /api/v1/ontology/classes?withDisplay=true` already returns `{name, parent, level, display}` per Phase 45 Plan 04 extension. `parent` is the extends-chain parent. No new endpoint needed — drop the hardcoded `CODING_SCHEMA` and consume existing API.

### Q1 — what happens to the existing `Typed Views` sub-grouping

| Option | Description | Selected |
|--------|-------------|----------|
| Drop Typed Views — dynamic L1→L2 is the only grouping | Single structural view. Typed Views was a Phase 55 stopgap; L2 ontology supersedes it. | ✓ |
| Keep both as parallel groupings | Render `Hierarchy (L1→L2)` AND `Typed Views` as parallel collapsibles. More UI surface, two views. | |
| Drop now; add back if operator misses it | Ship Phase 60 with L1→L2 only; capture Typed Views as deferred re-evaluation. | |

**User's choice:** Drop Typed Views.
**Notes:** Lighter UI, single mental model.

### Q2 — L1 group collapse affordance

| Option | Description | Selected |
|--------|-------------|----------|
| Collapse is purely UI; filter unchanged | Triangle toggles disclosure only. `all`/`none` link-buttons remain for bulk-toggle. Predictable. | ✓ |
| Collapse hides L2 from filter | Visual collapse == filter collapse. Faster bulk-hide but conflates operations. | |
| Collapse + count-badge cue | UI-only collapse + aggregate count badge on header. Adds visual cue without conflation. | |

**User's choice:** Collapse is purely UI; filter unchanged.
**Notes:** Matches existing upper/lower section collapse semantics in `OntologyFilter.tsx:311-377`.

---

## Claude's Discretion

- **SC#3 (Observation/Digest debug toggle)** — not selected for explicit discussion. Locked to default in CONTEXT.md `<decisions>` G3: add `showDebugEntityTypes` boolean to viewer-store (default `false`), surface as a row in `GraphToggles.tsx` labeled `Show debug entity types (Observation, Digest)`, non-persistent. Hard-exclusion at `visibility-predicate.ts:46-47` stays as the default.
- **Exact CSS classes** for new L1 group rows + debug toggle row — match nearby Tailwind patterns, no new design tokens.
- **`Section` component location** — planner picks: stay in `LegendPanel.tsx` or extract to `panels/legend/Section.tsx`.
- **Writer-guard constant naming** — planner picks (`HIERARCHY_ROOTS` / `SYSTEM_ROOTS` / etc.); placed under `lib/km-core/src/types/`.
- **Repair script scope width** — planner decides whether to widen beyond `ontologyClass` to also touch `metadata.team` ('ui' is odd for a system root).
- **Test surface refinement** — minimums noted in CONTEXT.md D-25; planner picks fixtures and coverage.

## Deferred Ideas

- **Writer-stamped `layer` field on every km-core entity** — Phase 60 follow-up; suggested title "Writer-stamped layer field + helper retirement".
- **`metadata.team → metadata.project` rename + viewer `selectedTeams → selectedProjects` rename** — Phase 57 D-11 deferred; keep deferred per Phase 57's deferred-ideas list.
- **Per-tab Legend variant for `/viewer/okb`** — dynamic LegendPanel naturally adapts; file follow-up only if OKB needs special rendering.
- **Schema-source migration for VOKB tab** — VOKB still uses hardcoded `VOKB_SCHEMA`. Follow-up once VOKB OntologyRegistry side is in shape.
- **`showDebugEntityTypes` localStorage persistence** — non-persistent today; add if operators flip it constantly.
- **Aggregate count badge on collapsed L1 group** — rejected Option C in Q2 of L2 discussion; add later if at-a-glance summary is missed.
