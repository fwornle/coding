# Phase 57: Lower Ontology & Project Tagging Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 57-lower-ontology-project-tagging-foundation
**Areas discussed:** G1 project tag placement, G2 writer-path scope + backfill, G3 lower-ontology file + class set, G4 LOWERONTO-02 soft gate

---

## G1 — Project tag field placement (G1.1)

| Option | Description | Selected |
|--------|-------------|----------|
| A — top-level `Entity.project?` | Mirror Phase 42 `embedding?` pattern. First-class field, queryable through km-core's strict path. Cost: schema bump + node_modules patch + every consumer sees the new optional field. | |
| B — `metadata.project` (Recommended) | Convention already exists in `lib/km-core/src/adapters/observation-view.ts:139`, `online/mapper.ts:190-191`. Zero schema bump. Viewer reads `metadata.project ?? metadata.team` as a transitional fallback. | ✓ |
| C — rename `team` → `project` everywhere | One canonical dimension. Touches viewer-store.ts:174-178 (`selectedTeams`→`selectedProjects`), every wave-agent + content-validation + git-history + vibe-history agent. Cleanest end-state but biggest blast radius. | |

**User's choice:** B — `metadata.project`
**Notes:** Operator picked the recommendation. Keeps Phase 57 a thin foundational add; the `team` cleanup is a separate scope.

---

## G1 — Project value vocabulary (G1.2)

| Option | Description | Selected |
|--------|-------------|----------|
| Closed set with registry (Recommended) | Declare canonical values in km-core: `coding`, `okm`, `cap`. Add a TS const + runtime validator; writer paths assert/typeguard. | ✓ |
| Freeform string | Any string is valid. Lowest friction; risk of typos and duplicates in filter UI. | |
| Closed set, convention-only | Document `coding | okm | cap` in CONTEXT.md / ROADMAP.md; writers honor it informally. No runtime enforcement. | |

**User's choice:** Closed set with registry
**Notes:** Single source of truth for the project dimension. Filter UI auto-populates from the registry constant.

---

## G2 — Writer-path scope (G2.1)

| Option | Description | Selected |
|--------|-------------|----------|
| All km-core writers (Recommended) | Every `putEntity` call-site stamps `metadata.project`: semantic-analysis waves + canonical-mapper + persistence-agent + classifier default; ObservationConsolidator (already does); code-graph-rag; legacy-ingest; backfill-raw-observations; any other site. | ✓ |
| Semantic-analysis writers only | Stamp only in the wave-controller / wave1–3 / canonical-mapper / persistence-agent / classifier path. Skip code-graph-rag and legacy-ingest. | |
| Online + manual UKB only | Stamp only in the online pipeline (already done) and the manual UKB / wave-analysis path. Minimum-viable scope. | |

**User's choice:** All km-core writers
**Notes:** Belt-and-braces; success criterion #1 holds for every entity type. Avoids "unknown" bucket in Phase 60 viewer grouping.

---

## G2 — Backfill yes/no (G2.2)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — Phase 43-style JSON-replay backfill (Recommended) | One-shot `scripts/backfill-project-tag.mjs` reads `.data/knowledge-graph/exports/general.json`, derives `metadata.project` via layered precedence (`team` fallback → heuristic → default `coding`), writes back via km-core. Mirrors Phase 43 D-G4.1. | ✓ |
| No — forward-only | Honor success criterion #1 literally ("writer path stamps it at insert time, not as a one-shot backfill"). Existing ~1262 nodes lack `metadata.project`; Phase 59 has to fall back to `metadata.team`. | |
| Defer to Phase 59 | Fold the backfill into Phase 59's orphan-repair migration (one migration, two effects). | |

**User's choice:** Yes — Phase 43-style backfill
**Notes:** Phase 59 orphan-repair gets a fully-populated `metadata.project` field to compute per-project anchor edges on. Idempotent script — safe to re-run.

---

## G3 — Lower-ontology file location (G3.1)

| Option | Description | Selected |
|--------|-------------|----------|
| New `.data/ontologies/coding.lower.json` (Recommended) | Matches success-criterion-2 path verbatim. Per-project lower files become a pattern. OntologyRegistry's auto-discovery picks it up by glob. | ✓ |
| Extend existing `coding-ontology.json` | 50KB file already declares a coding-domain ontology. Add L2 classes inside it. Mixes upper-style "ontology" with L2-extends-L1 convention. | |
| Per-class JSON files under `.data/ontologies/lower/coding/` | Maximum modularity. Overkill at 6 classes. | |

**User's choice:** New `coding.lower.json`
**Notes:** Pattern extensible to `okm.lower.json`, `cap.lower.json` later.

---

## G3 — Lower-ontology JSON shape (G3.2)

| Option | Description | Selected |
|--------|-------------|----------|
| Flat class list with `extends` per class (Recommended) | Mirror OntologyRegistry's Phase 38 `extends` chain expectation: each L2 names its L1 parent. Matches existing upper.json shape. | ✓ |
| Hierarchical map keyed by L1 parent | Cheaper for humans to scan, but inverts the `extends` direction OntologyRegistry expects — loader transformation needed. | |

**User's choice:** Flat class list with `extends`
**Notes:** Zero loader change.

---

## G3 — L2 class set scope (G3.3)

| Option | Description | Selected |
|--------|-------------|----------|
| 6-class floor only | `LiveLoggingSystem`, `ConstraintMonitor`, `OnlineObservation`, `OnlineDigest`, `OnlineInsight`, `KnowledgeManagement`. Matches success criterion #2 exactly. | |
| Floor + 4 (Recommended) | Floor + `BatchSemanticAnalysis`, `RapidLlmProxy`, `DockerizedServices`, `EtmDaemon`. 10 classes covers dominant production surfaces. | ✓ |
| Operator dictates the list | Open-ended freeform. | |

**User's choice:** Floor + 4 (10 classes)
**Notes:** Adds operational surfaces named in CLAUDE.md (LLM proxy, docker-compose, ETM daemon, batch wave-analysis). Stronger sample for success criterion #3.

---

## G4 — LOWERONTO-02 soft gate (G4.1)

| Option | Description | Selected |
|--------|-------------|----------|
| Defer LOWERONTO-02 to a follow-up phase (Recommended) | Mark LOWERONTO-02 as honestly deferred. Phase 57 closes with LOWERONTO-01 + LOWERONTO-04 only. Keeps Phase 57 a thin foundational add. | ✓ |
| Grow now — add `Diagnosis` + `Interface` | Add the two L1 classes the operator floated. Closes LOWERONTO-02 in Phase 57. Bigger upper-ontology surface to verify. | |
| Grow now — add more than 2 | Open-ended L1 class list. Same shape, larger surface. | |

**User's choice:** Defer LOWERONTO-02
**Notes:** Operator's `Diagnosis` / `Interface` ideas carry forward verbatim in `<deferred>` so the next phase planner has them.

---

## Wrap-up

| Option | Description | Selected |
|--------|-------------|----------|
| No — write CONTEXT.md (Recommended) | All 4 gray areas locked. Planner has enough to plan. | ✓ |
| Discuss the viewer transitional read | Pin viewer-store.ts:174-178 exact patch. | |
| Discuss the classifier prompt update | Decide whether classifier emission is Phase 57 or follow-up. | |
| Add a deferred idea or scope-creep note | Freeform. | |

**User's choice:** Write CONTEXT.md
**Notes:** Viewer transitional read and classifier prompt update both folded into CONTEXT.md as in-scope for Phase 57 (the latter because success criterion #3 is a runtime gate that needs the classifier update).

---

## Claude's Discretion

- L1 parent per L2 class in `coding.lower.json` — planner picks `Component` / `SubComponent` / `Detail` based on upper-ontology conventions and current classifier behavior.
- Exact classifier prompt wording for the updated ontology-classification-agent.
- Backfill heuristic for the legacyId-based fallback (exact regex / id-prefix patterns).
- Optional `MetadataWithProject` helper type in km-core (not required, planner discretion).
- Exact test surface beyond the documented minimum (1 unit for `isProject`, 1 OntologyRegistry-load fixture, 1 sample-of-20 classifier smoke).

## Deferred Ideas

- LOWERONTO-02 upper-ontology growth (`Diagnosis`, `Interface`, …).
- `metadata.team` → `metadata.project` rename across writers + viewer (`selectedTeams` → `selectedProjects` etc.).
- Per-project lower-ontology files (`okm.lower.json`, `cap.lower.json`).
- 9 other Phase 60 / 61 todos that surfaced as keyword matches but route to their respective downstream v7.2 phases (see CONTEXT.md `<deferred>` for the full list).
