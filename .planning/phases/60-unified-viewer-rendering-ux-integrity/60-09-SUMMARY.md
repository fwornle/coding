---
phase: 60-unified-viewer-rendering-ux-integrity
plan: 09
subsystem: ontology-classification
tags: [ontology, l2-classification, deterministic-classifier, km-core, unified-viewer, migration]

requires:
  - phase: 60-07
    provides: ontology API serves L0/L1/L2 {level,parent} metadata; handler-side contract complete
  - phase: 57
    provides: the closed 10-class L2 lower-ontology vocabulary (coding.lower.json) + no-forced-L2 invariant (D-10)
provides:
  - Deterministic name+description -> L2 class mapper (classifyL2) shared by the writer agent and the migration
  - Going-forward L2 assignment in the online + wave-analysis classification pipeline
  - 87 existing entities backfilled to carry a parent-consistent L2 ontologyClass
  - Project surfaced as an L0 anchor (level:0) in the ontology API
  - OntologyFilter renders level-None classes entities carry (Insight/Digest) + the full L0->L1->L2 tree
affects: [unified-viewer ontology filter, future ontology-classification work, LOWERONTO-04 project-tag work]

tech-stack:
  added: []
  patterns:
    - "Deterministic closed-vocabulary keyword classifier (no LLM) shared between a writer agent and a one-shot migration via a single imported module"
    - "Two-pass keyword match: name dominates description (avoids sibling-subsystem cross-contamination)"

key-files:
  created:
    - integrations/mcp-server-semantic-analysis/src/agents/l2-subsystem-classifier.ts
    - integrations/mcp-server-semantic-analysis/src/agents/l2-subsystem-classifier.test.ts
    - scripts/backfill-l2-subsystem-class.mjs
  modified:
    - integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts
    - .data/ontologies/upper.json
    - .data/ontologies/obs-api/upper.json
    - integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx
    - integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx
    - .planning/phases/60-unified-viewer-rendering-ux-integrity/60-VERIFICATION.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "L2 classification is DETERMINISTIC (keyword heuristic over the closed 10-class vocabulary), not LLM-driven — the vocabulary is a closed lookup, entities carry no usable path/tags signal, and the migration must be cheap + idempotent + re-runnable."
  - "NAME dominates description (two-pass match): a full pass over the entity name in table order wins before the description is consulted, because subsystem descriptions reference sibling subsystems and would otherwise mis-route by table position."
  - "No-forced-L2 (Phase 57 D-10) preserved: classifyL2 returns null when no confident parent-consistent match exists. EtmDaemon legitimately ends up with 0 members."
  - "Live migration ran with obs-api stopped (km-core LevelDB is single-owner); obs-api restarted afterward and hydrated from the updated JSON export (the documented hydrate patch)."
  - "Operator accepted 9/10 populated L2 classes as SC#5 PASS — the SC#5 intent (navigable L0->L1->L2 tree, non-zero per-L2 counts, working L2 selection) is met; forcing a 10th class would violate the no-forced-L2 invariant."

patterns-established:
  - "Shared-module classifier: writer agent + migration import ONE classifyL2 from the submodule dist — zero copy-paste of the keyword table."
  - "Short-bare-token (<=4 chars, e.g. etm/lsl) keyword matching uses word boundaries; compound keywords use substring."
---

# Plan 60-09 Summary — SC#5 (LOWERONTO-03) L2-classification gap closure

## What shipped

Closed the last open Phase 60 success criterion. Before this plan, NO entity carried an L2 ontology class, so the unified-viewer Ontology Class filter collapsed every L1 to a flat row (4 flat checkboxes, no L1→L2 tree). Plan 60-09 made entities actually carry L2 classes and taught the filter to render everything entities carry.

**Task 1 — Deterministic L2 classifier.** `l2-subsystem-classifier.ts` exports `classifyL2(name, description, l1Parent)` and `L2_KEYWORD_MAP` (closed 10-class vocabulary). Pure, synchronous, parent-consistent, returns null on no confident match. 10 unit tests lock per-class reachability, parent-consistency, no-forced-L2, and name-over-description precedence.

**Task 2 — Writer wiring.** `classifySingleObservation` applies `classifyL2` to refinable L1 carriers (Component/SubComponent/Detail), stamping `ontologyClass=L2`, `ontologySource='lower'`, `classificationMethod='heuristic'`. Hard-root guard untouched. Submodule built; `mcp-servers:semantic-analysis` restarted → going-forward L2 is live in the container.

**Task 3 — Project level:0.** Added `"level": 0` to the Project class in both `.data/ontologies/upper.json` and `.data/ontologies/obs-api/upper.json`; obs-api reloaded. API now serves `[Project, System]` at level 0.

**Task 4 — Backfill migration.** `scripts/backfill-l2-subsystem-class.mjs` (modeled on `repair-ck-ontology-class.mjs`): `--dry-run` prints the per-L2 distribution; live mode `putEntity({skipOntologyCheck})` + `exportJson`. Imports the shared `classifyL2` (no copied table). Constructs `GraphKMStore` WITH `ontologyDir` (CLAUDE.md km-core rule).

**Task 5 — Live migration (operator-approved).** Dry-run distribution reviewed and approved. obs-api stopped (LevelDB single-owner), live migration wrote **87 entities** (0 errors, 9/9 intended L2 classes non-zero), obs-api restarted (hydrated from the updated JSON export per the documented km-core hydrate patch). Served per-L2: LiveLoggingSystem 2, ConstraintMonitor 1, KnowledgeManagement 1, BatchSemanticAnalysis 1, RapidLlmProxy 1, DockerizedServices 1, OnlineObservation 30, OnlineDigest 39, OnlineInsight 11, EtmDaemon 0.

**Task 6 — OntologyFilter level-None rows.** API-driven path now renders classes the API returns with no numeric level (Insight/Digest) that entities carry, as a dedicated flat section (`filter-ontology-level-none-flat`); Project surfaces as an L0 anchor automatically. 19 OntologyFilter tests green; viewer build clean.

**Task 7 — Operator visual re-verify (PASS).** Live gsd-browser re-smoke of the 7 SC#5 checks against `/viewer/coding`. Real L0→L1→L2 tree renders (screenshots captured). 4 clean PASS (L0 anchors, level-None rows, Typed-Views-absent, L2-selection-filters-graph); checks 1/3/4 fall marginally short (labelCount 14, 2 triangles, 9/10 L2 rows) solely because **EtmDaemon has 0 members** — correct under the no-forced-L2 / parent-consistency invariant. Operator accepted as PASS. Flipped 60-VERIFICATION SC#5 PARTIAL→PASS (status passed, sc_passed 5, sc_partial 0, gaps_open 0), ROADMAP Phase 60 + 60-09 to done, REQUIREMENTS LOWERONTO-03 to done.

## The EtmDaemon=0 nuance (known, accepted)

`EtmDaemon`'s parent is `SubComponent`, but no SubComponent-level entity *is* the ETM daemon — only Detail-level observation/intent records *mention* ETM, which legitimately stay `Detail`. Assigning any to EtmDaemon would violate parent-consistency or force a wrong L2. So EtmDaemon is a valid-but-currently-unpopulated L2. If a genuine SubComponent ETM entity is ever created, the going-forward writer (Task 2) will classify it automatically.

## Deviations from plan

- **Classifier refined during Task 1/4** (anticipated by the plan): switched keyword matching to two passes (name first, then description) after the dry-run revealed sibling-subsystem description cross-contamination mis-routing SemanticAnalysis and DockerizedServices. Lifted reachability from 7/10 to 9/10. +2 regression tests.
- **obs-api stopped for the live migration**: the plan said "open GraphKMStore … putEntity … exportJson", but km-core's LevelDB is single-owner and obs-api holds it. Stopped obs-api (launchctl bootout) for the migration window, then bootstrapped it back; it hydrated from the updated JSON export.

## Verification

- `node --test dist/agents/l2-subsystem-classifier.test.js` → 10/10 pass
- `npm test -- OntologyFilter` → 19/19 pass
- submodule + viewer `npm run build` → clean
- live migration: 87 writes, 0 errors, 9/9 intended L2 classes non-zero in the export and served by obs-api
- gsd-browser re-smoke: L0={System,Project}, 9 L2 rows with real counts, Insight/Digest rows, Typed Views absent, L2 selection changes graph (838→825)
