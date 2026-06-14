# Phase 57: Lower Ontology & Project Tagging Foundation - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Foundational data-shape work for milestone v7.2. Two thin, orthogonal additions to the km-core entity surface so Phases 58–61 can stamp + consume them:

1. **A coding-specific L2 ontology vocabulary** — a `coding.lower.json` file declaring at least 10 L2 classes that `extends` upper-ontology L1 parents (`Component` / `SubComponent` / `Detail`). Loaded by the existing `OntologyRegistry` (Phase 38). Classifier emits one of the new L2 strings into `Entity.ontologyClass` for new entities.
2. **A `project` tag on every km-core entity** — stamped into `Entity.metadata.project` at every writer path that calls `kmStore.putEntity`. Closed-set vocabulary registered in km-core (`coding | okm | cap`). One-shot Phase 43-style backfill stamps existing entities so Phases 58–61 can rely on the field being populated everywhere.

**Out of scope for Phase 57** (deliberately deferred):
- Upper-ontology growth (LOWERONTO-02 soft gate — see `<deferred>`).
- Unified-viewer rendering of the new fields beyond a one-line filter-fallback patch (LOWERONTO-03 → Phase 60).
- Per-team `CollectiveKnowledge --includes--> Project` writer/seed wiring (ORPHAN-03 → Phase 59).
- Semantic-content edges on Insights (EDGE-01/02 → Phase 58).
- Rename of legacy `metadata.team` → `metadata.project` everywhere (transitional fallback only in Phase 57).

</domain>

<decisions>
## Implementation Decisions

### G1 — project tag placement
- **D-01:** Stamp `metadata.project` (not a top-level `Entity.project?`). Reason: zero km-core schema bump; the convention already exists in `lib/km-core/src/adapters/observation-view.ts:139` and `lib/km-core/src/adapters/online/mapper.ts:190-191` for online observations / digests / insights. Phase 57 extends the same convention to every km-core writer instead of inventing a new shape.
- **D-02:** Legacy `metadata.team` is **NOT** rewritten or deleted in Phase 57. Existing nodes keep `team`; new + backfilled nodes carry `project`. Transitional viewer-side read (`metadata.project ?? metadata.team`) keeps the existing filter working during the overlap. Eventual `team` cleanup is a follow-up phase.
- **D-03:** Closed-set vocabulary, registered in km-core: `lib/km-core/src/types/project.ts` exports `PROJECTS = ['coding','okm','cap'] as const`, `type Project = typeof PROJECTS[number]`, and `isProject(x: unknown): x is Project`. Writers import + assert (typeguard) before stamping. Filter UIs read the registry constant so the project list is a single source of truth. Adding a new project = code change in km-core, not silent drift.

### G2 — writer-path scope + backfill
- **D-04:** **Every** km-core writer stamps `metadata.project` before calling `kmStore.putEntity`. Concrete writer surfaces:
  - `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts` (Project nodes)
  - `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts` (Component nodes)
  - `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts` (Detail / SubComponent nodes)
  - `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts`
  - `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`
  - `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` (default stamp if upstream omitted)
  - `integrations/code-graph-rag/...` km-core write call-sites (code-symbol entities)
  - `lib/km-core/src/adapters/legacy-ingest.ts` (preserve current `metadata.project` plumbing for SQLite-sourced rows)
  - `scripts/backfill-raw-observations.mjs` (host-side, already stamps `metadata.project` via online-mapper convention — verify and lock)
  - Any other call site of `putEntity` discovered by `grep -rn "putEntity" integrations/ lib/ scripts/` at planning time.
- **D-05:** One-shot Phase 43-style JSON-replay backfill ships as part of Phase 57. New script `scripts/backfill-project-tag.mjs` reads `.data/knowledge-graph/exports/general.json`, derives `metadata.project` per entity via layered precedence:
  1. existing `metadata.project` (idempotent — already populated → no-op)
  2. existing `metadata.team` (`'coding'` etc., carried forward verbatim)
  3. ontology / id heuristic (e.g. `legacyId.system === 'C'` → `coding`; OKM-namespaced ids → `okm`; CAP-namespaced → `cap`)
  4. default `coding` for ambiguous / unknown cases (logged for operator review)
  Backfill writes back through km-core (`putEntity` with `skipOntologyCheck: true` per Phase 43 D-G4.1 trusted-path convention), preserving every other attribute. Idempotent — safe to re-run.
- **D-06:** Backfill produces a one-shot log artifact `.data/backfill-project-tag-<timestamp>.json` summarizing per-precedence-step counts and the ambiguous-default list so the operator can spot-check classifications.

### G3 — lower-ontology file + class set
- **D-07:** New file `.data/ontologies/coding.lower.json`. Path matches success-criterion-2 verbatim. Upper ontology (`.data/ontologies/upper.json`) is **NOT** modified by Phase 57 (LOWERONTO-02 deferred — see D-13). Per-project lower files (`okm.lower.json`, `cap.lower.json`) become a follow-up pattern; Phase 57 only ships `coding.lower.json`.
- **D-08:** JSON shape is a flat class list, each element naming its L1 parent via `extends`. Mirrors the existing `upper.json` shape and matches OntologyRegistry's Phase 38 `extends`-chain loader expectation:
  ```json
  {
    "name": "coding.lower",
    "extends": "upper",
    "classes": [
      { "name": "LiveLoggingSystem",   "extends": "<L1>", "description": "..." },
      { "name": "ConstraintMonitor",   "extends": "<L1>", "description": "..." },
      ...
    ]
  }
  ```
  L1 parent per L2 class is **Claude's discretion at plan time** — planner reads `.data/ontologies/upper.json` and the current classifier emissions, picks the most semantically appropriate L1 parent (`Component` / `SubComponent` / `Detail`), and confirms in `PATTERNS.md` / `PLAN.md`.
- **D-09:** Phase 57 ships **10 L2 classes** (6-class success-criterion floor + 4 high-traffic surfaces):
  - **Floor (6):** `LiveLoggingSystem`, `ConstraintMonitor`, `OnlineObservation`, `OnlineDigest`, `OnlineInsight`, `KnowledgeManagement`.
  - **Plus 4:** `BatchSemanticAnalysis` (manual UKB / wave-analysis pipeline), `RapidLlmProxy` (LLM routing surface — port 12435 per CLAUDE.md), `DockerizedServices` (docker-compose `coding-services` container per CLAUDE.md), `EtmDaemon` (launchd-managed `com.coding.etm` per CLAUDE.md).
  - Naming: PascalCase, no separators (matches existing upper-ontology `Component` style).
- **D-10:** Classifier integration is **in-scope for Phase 57** because success criterion #3 ("≥18 of 20 recent online-learned entities carry an L2 ontology class") is a runtime gate. `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` is updated to:
  - Load the 10 L2 classes from `coding.lower.json` via OntologyRegistry at startup.
  - Inject the L2 list into the classification prompt with one-line descriptions so the LLM can pick a more-specific class than the L1 default.
  - Default to the L1 parent when the LLM declines all L2 options (no forced classification).
- **D-11:** Unified-viewer transitional read is **in-scope for Phase 57**, narrow surgery only. `integrations/unified-viewer/src/store/viewer-store.ts` filter logic that reads `node.attributes.metadata.team` is patched to read `metadata.project ?? metadata.team` so the existing per-team filter rail keeps working after writers stop stamping `team`. **Renaming `selectedTeams → selectedProjects` is out of scope** for Phase 57 — that lands in Phase 60 (LOWERONTO-03) when the filter UI itself is reworked.

### G4 — LOWERONTO-02 soft gate
- **D-12:** **LOWERONTO-02 is deferred** to a follow-up phase. Phase 57 covers only `LOWERONTO-01` (lower-ontology file + classes) and `LOWERONTO-04` (project tag on every entity). Upper-ontology growth (`Diagnosis`, `Interface`, …) is honestly recorded as deferred in `<deferred>` below and in ROADMAP / REQUIREMENTS, **not** silently dropped. Reason: keeps Phase 57 a thin foundational add that Phases 58–61 can depend on within v7.2; upper-ontology growth touches the classifier prompt + every L1-aware downstream consumer and is its own scope.
- **D-13:** Phase 57 REQ coverage in ROADMAP.md must reflect this — REQ row should remain `LOWERONTO-01, LOWERONTO-02, LOWERONTO-04` for traceability, with LOWERONTO-02 explicitly marked `[deferred]` in the plan frontmatter so the requirements coverage gate doesn't false-positive a missing plan.

### Claude's Discretion
- **L1 parent per L2 class** in `coding.lower.json` — planner picks `Component` / `SubComponent` / `Detail` per L2 based on upper-ontology conventions and the current classifier behavior. Document the mapping in `PATTERNS.md` for executor reference.
- **Exact prompt wording** for the classifier update — planner drafts; success-criterion-3 (≥18/20 online entities carry an L2) is the acceptance signal.
- **Backfill heuristic for the legacyId-based fallback** in `backfill-project-tag.mjs` (D-05 step 3) — exact id-prefix patterns / regex are planner discretion; log the per-pattern counts.
- **Whether `metadata.project` typing flows into `Entity.metadata`** beyond `Record<string, unknown>` — planner can optionally add a `MetadataWithProject` helper type in km-core but is not required to.
- **Test surface** for the registry + classifier change — at minimum: 1 unit test for `isProject(x)`, 1 fixture-driven test that loads `coding.lower.json` through OntologyRegistry, 1 smoke / sample-of-20 test for the classifier emission rate. Planner refines.

### Folded Todos
- **`2026-06-14-ontology-rework-lower-ontology-and-project-grouping.md`** (`resolves_phase: 57`). The operator's voice on the lower-ontology rework directly motivates Phase 57. Folded scope:
  - Lower-ontology class set seeds (LSL, Constraints, Online-{Observation,Digest,Insight}, Batch-Semantic-Analysis, KnowledgeManagement) — all in D-09.
  - Project-grouped rendering hook (the `metadata.project` field stamping) — D-04 + D-05.
  - Classifier rework so new entities emit lower-ontology classes — D-10.
  - Upper-ontology growth (`Diagnosis`, `Interface`) — explicitly deferred per D-12 (the operator flagged this as a soft suggestion, not a requirement).
  - Unified-viewer project-grouped rendering UX (sidebar group / per-project sub-tabs / new filter dimension) — out of scope per D-11; lands in Phase 60 with LOWERONTO-03.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 57 inputs (this phase)
- `.planning/REQUIREMENTS.md` §LOWERONTO-01 / LOWERONTO-02 / LOWERONTO-04 — requirement text.
- `.planning/ROADMAP.md` §"Phase 57: Lower Ontology & Project Tagging Foundation" — goal + success criteria.
- `.planning/todos/pending/2026-06-14-ontology-rework-lower-ontology-and-project-grouping.md` — operator's voice on the lower-ontology rework; folded into this phase per D-09 + D-10.
- `CLAUDE.md` §"Mandatory Rules" and §"Rebuilding After Code Changes" — submodule build pipeline (semantic-analysis runs in `coding-services` container; both `npm run build` + Docker rebuild required).

### km-core surface (the data-shape contract)
- `lib/km-core/src/types/entity.ts:113-173` — canonical `Entity` shape. `ontologyClass?: string` (D-09 lands an L2 class here). `metadata: Record<string, unknown>` (D-04 lands `metadata.project` here). No `team` concept by design (line 41-42 comment).
- `lib/km-core/src/store/GraphKMStore.ts:41-42` — explicit "NO `team` concept" decision; `metadata.project` is the canonical project dimension.
- `lib/km-core/src/store/exporter.ts:152-170` — per-domain JSON export bucketing (currently keyed on `metadata.domain`). Planner verifies whether Phase 57 should bucket on `metadata.project` instead or leave bucketing alone; default = leave alone.
- `lib/km-core/src/adapters/observation-view.ts:139,220,276` — existing `metadata.project` convention for online observations / digests / insights. Phase 57 generalizes the convention; do NOT regress this surface.
- `lib/km-core/src/adapters/online/mapper.ts:190-191,229-230` — `metadata.project = row.project` writer convention. Same.
- `lib/km-core/src/adapters/legacy-ingest.ts:109,125,265,315,358` — `project` field in legacy SQLite row shapes. Preserve plumbing as-is.

### Ontology surface
- `.data/ontologies/upper.json` — current upper ontology (38KB). Read at planning time to determine L1 parents for the 10 L2 classes (D-09 + Claude's discretion).
- `.data/ontologies/coding-ontology.json` — existing coding-domain ontology (50KB). NOT extended in Phase 57 (D-07). Planner inspects to ensure no conflicts with new L2 class names.
- `.planning/phases/38-ontology-registry/38-CONTEXT.md` — OntologyRegistry contract: auto-discovers upper + N lower ontologies via `extends` chain. Phase 57's `coding.lower.json` is loaded by this exact mechanism — no loader changes expected.

### Phase 39 → entity shape lock
- `.planning/phases/39-entity-data-model/39-CONTEXT.md` — `Entity` shape lock: `ontologyClass?`, `descriptionSegments`, `legacyId`, provenance. Phase 57 only writes into existing fields (`ontologyClass`, `metadata`), no new top-level fields.

### Phase 42 / 43 → extension + backfill templates
- `.planning/phases/42-km-core-strangler-and-cleanup/` — `embedding?` first-class-optional-extension template (NOT used in Phase 57 per D-01); strangler-cleanup pattern.
- `.planning/phases/43-okm-cross-repo-migration-c/43-CONTEXT.md` §D-G4.1 — JSON-replay one-shot migration template. Phase 57's `backfill-project-tag.mjs` (D-05) follows the same shape.

### Writer-path surfaces (Phase 57 modifies)
- `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts`
- `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts`
- `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts`
- `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts`
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`
- `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` (classifier prompt update per D-10)
- `integrations/code-graph-rag/src/` (call-sites of `putEntity` — exact files identified at planning time via `grep -rn "putEntity"`)
- `scripts/backfill-raw-observations.mjs` (verify existing `metadata.project` stamping)

### Viewer transitional read (Phase 57 modifies)
- `integrations/unified-viewer/src/store/viewer-store.ts:174-178` — `selectedTeams` filter reads `metadata.team`. Phase 57 patches read to `metadata.project ?? metadata.team` per D-11. NO rename of `selectedTeams` in Phase 57 (Phase 60 / LOWERONTO-03 territory).

### Verification artifacts (success criteria source)
- `.data/knowledge-graph/exports/general.json` — current export (1262 nodes / 1592 edges / 88% connectivity per MEMORY.md). Backfill input AND success-criterion-1 verification surface (operator samples this for populated `metadata.project`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`OntologyRegistry` (`@fwornle/km-core`)** — Phase 38 deliverable; auto-discovers any `.json` in `.data/ontologies/` and walks `extends` chains. Phase 57's `coding.lower.json` slots in zero-config. No registry changes expected.
- **`metadata.project` convention in `lib/km-core/src/adapters/observation-view.ts` + `online/mapper.ts`** — the field already exists in the codebase for online-pipeline entities. Phase 57 generalizes it to every writer; no naming bikeshed needed.
- **Phase 43 D-G4.1 JSON-replay one-shot migration** — exact template for `scripts/backfill-project-tag.mjs` (D-05). Read `.data/knowledge-graph/exports/general.json`, derive new field, write back via km-core trusted path.
- **`isProject` typeguard pattern** — mirrors existing `EntityId` branded-type pattern in `lib/km-core/src/ids/branded.ts`. Add `lib/km-core/src/types/project.ts` next to it.

### Established Patterns
- **Submodule build pipeline (CLAUDE.md):** Any code change to `integrations/mcp-server-semantic-analysis` or `integrations/code-graph-rag` requires BOTH `npm run build` inside the submodule AND `docker-compose build coding-services && docker-compose up -d coding-services`. Plans MUST include explicit rebuild tasks; the dashboard / health-API services are bind-mounted and need different restart steps (also documented in CLAUDE.md).
- **km-core local patch** (CLAUDE.md): `node_modules/@fwornle/km-core/dist/store/persistence.js` `hydrate()` has a local patch. If Phase 57 bumps km-core via `npm install`, the patch must be re-applied. Planner notes this.
- **rapid-llm-proxy routing config** (CLAUDE.md): Phase 57 does not touch LLM routing, but the classifier (D-10) hits the proxy; planner verifies `wave-analysis-*` routing isn't perturbed.
- **Constraint violations are real issues** (CLAUDE.md / MEMORY.md): if a constraint fires during plan execution, fix the underlying code, don't dodge.

### Integration Points
- **OntologyRegistry → coding.lower.json:** new file dropped under `.data/ontologies/`, auto-discovered at OntologyRegistry init time (Phase 38 mechanism). Zero loader change.
- **Classifier prompt → 10 L2 classes:** `ontology-classification-agent.ts` already reads from OntologyRegistry to construct its class list; Phase 57's add expands the same list, no architectural change.
- **Viewer filter → metadata.project ?? metadata.team:** single-file, single-line-ish surgery in `viewer-store.ts`. Bind-mounted; needs `npm run build` per CLAUDE.md, no Docker rebuild for the dashboard / viewer bundle.
- **Backfill script → km-core trusted-path write:** uses `skipOntologyCheck: true` per Phase 43 D-G4.1 convention to bypass classifier on existing entities (we're only setting `metadata.project`, not changing `ontologyClass`).

</code_context>

<specifics>
## Specific Ideas

- **Operator validation surface for success criterion #1** ("operator inspecting any recent km-core entity sees a `project` tag"): one-liner via `jq` on `.data/knowledge-graph/exports/general.json` — `jq '.nodes[] | select(.attributes.metadata.project) | .attributes.metadata.project' | sort | uniq -c`. Should show `coding` dominating with `okm` / `cap` populated where applicable. Plan / verification can codify this.
- **Success criterion #3 sampling** ("≥18 of 20 recent online-learned entities carry an L2"): the natural runtime sample is "the last 20 entities written by the online pipeline whose `metadata.source` is `online`". Plan can encode this as a smoke test.
- **PascalCase L2 names** (D-09): keep verbatim — `LiveLoggingSystem` not `live-logging-system` not `LIVE_LOGGING_SYSTEM`. Matches existing upper-ontology style and JSON-serializable without quoting concerns.

</specifics>

<deferred>
## Deferred Ideas

- **LOWERONTO-02 — upper-ontology growth** (`Diagnosis`, `Interface`, …). Soft-gated in ROADMAP and explicitly deferred per D-12. Track in `STATE.md` and surface during v7.2 retro for a follow-up phase. Operator's two suggested classes (`Diagnosis`, `Interface`) carry forward verbatim.
- **`metadata.team` → `metadata.project` rename** across writers + viewer (`selectedTeams` → `selectedProjects` etc.). Phase 57 keeps `team` untouched and uses a one-line transitional read; the cleanup is a separate scope. Probably bundled with Phase 60 (LOWERONTO-03) or its own thin follow-up.
- **Per-project lower-ontology files** (`okm.lower.json`, `cap.lower.json`). Pattern established by `coding.lower.json` in Phase 57; the other-project files belong to whoever owns those projects to ship later.
- **OKM Express `/api/entities` ↔ unified-viewer routing fix** (todo `2026-06-10-okm-express-api-contract-bridge.md` matched here on keywords; routes to Phase 61 / OKBROUTE-02 per ROADMAP).
- **LSL timeline 200-record cap + "all" window misnaming** (todo `2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md` matched on keywords; routes to Phase 61 / LSLTIME-01..03).
- **Online filter hides CollectiveKnowledge** (todo `2026-06-14-online-filter-hides-ck-truncates-trace.md`; routes to Phase 60 / VKBUI-03).
- **Online pipeline semantic edges** (todo `2026-06-14-online-pipeline-semantic-edges-and-timeline-bi-source.md`; routes to Phase 58 / EDGE-01,02).
- **Orphan digest observation refs** (todo `2026-05-23-orphan-digest-observation-refs.md`; routes to Phase 59 / ORPHAN family).
- **VKB Evidence/Pattern filter asymmetry** (todo `2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md`; routes to Phase 60 / VKBUI-01).
- **VKB sidebar Legend static cross-domain bleed** (todo `2026-06-14-vkb-legend-static-cross-domain-bleed.md`; routes to Phase 60 / VKBUI-02).
- **VKB shows Observations/Digests architecture bleed** (todo `2026-06-14-vkb-shows-observations-digests-architecture-bleed.md`; routes to Phase 60 / VKBUI-03).

### Reviewed Todos (not folded)
All 14 todo matches above scored 0.6 on shared keywords (`viewer`, `phase`, `online`, `project`, `ontology`). Only the `2026-06-14-ontology-rework-...` todo is genuinely a Phase 57 scope match (and is folded under `<decisions>` → "Folded Todos"). The rest are surfaced here so the next phase planner knows they were considered.

</deferred>

---

*Phase: 57-lower-ontology-project-tagging-foundation*
*Context gathered: 2026-06-14*
