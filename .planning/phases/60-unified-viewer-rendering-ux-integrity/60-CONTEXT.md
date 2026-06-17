# Phase 60: Unified Viewer Rendering UX Integrity - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Five symmetric truthfulness fixes to the unified viewer at `localhost:5173/viewer/coding` so the rendered graph, its filters, and its sidebar Legend stop lying about what's on screen:

1. **Layer filter symmetry (VKBUI-01 / SC#1)** — `LayerFilter.tsx` and `visibility-predicate.ts` use two divergent layer-derivation rules, producing both wrong count badges and an asymmetric Evidence-vs-Pattern toggle (one effectively a no-op). Unify the read paths.
2. **Dynamic Legend (VKBUI-02 / SC#2)** — `LegendPanel.tsx` ships four static constant arrays (`SHAPE_SWATCHES`, `LAYER_BADGE_CLASS`, `SOURCE_SAMPLES`, `RELATIONSHIP_SAMPLES`) carrying OKB content (`RuntimeDiagnostics`, RCA edge types, `Automated RCA` source) into the VKB tab. Derive every section from the currently-rendered (post-filter) graph.
3. **Observation/Digest debug toggle (VKBUI-03 / SC#3)** — `visibility-predicate.ts:46-47` already hard-excludes `Observation` + `Digest` entity types by default (architecture-bleed shield landed earlier). Only the operator-visible debug toggle to re-enable them is missing. Phase 60 ships only the toggle UI + store wiring; the default-hide behaviour stays.
4. **CollectiveKnowledge under Online filter (VKBUI-04 / SC#4)** — `visibility-predicate.ts:69-76` already exempts `System | Project | Component` ontologyClasses from the Learning Source filter, but the live `general.json` has CK as `ontologyClass: 'Detail'` while the writer at `content-validation-agent.ts:2685` correctly asserts CK should be `System`. The bug is upstream data drift caused by a downstream re-classifier overwriting CK's class. Repair the data + guard the writer.
5. **L2 lower-ontology classes in OntologyFilter (LOWERONTO-03 / SC#5)** — `OntologyFilter.tsx` has a hardcoded `CODING_SCHEMA` (Phase 55 stopgap) with `Hierarchy` + `Typed Views`. Phase 57 shipped 10 L2 classes in `.data/ontologies/coding.lower.json` extending L1 parents (Component / SubComponent / Detail), and `GET /api/v1/ontology/classes?withDisplay=true` already returns `{name, parent, level, display}`. Drop the hardcoded schema; render L1 groups with L2 children fetched from the API.

**Out of scope (deferred to follow-up phases):**
- `metadata.team -> metadata.project` rename in writers + `selectedTeams -> selectedProjects` viewer rename (Phase 57 D-11 deferred).
- Stamping `layer: 'evidence' | 'pattern'` as a first-class km-core entity field at writer time (Layer filter hybrid follow-up, see D-02).
- Phase 61 LSL-timeline + OKB routing work (separate phase, can run in parallel).

</domain>

<decisions>
## Implementation Decisions

### G1 — Layer filter data contract (SC#1)

- **D-01:** Ship a shared `deriveLayer(entity, ontologyRegistry): 'evidence' | 'pattern'` helper in `integrations/unified-viewer/src/graph/layer.ts` (new file). Both `LayerFilter.tsx` (count badges) and `visibility-predicate.ts:81-85` (filter predicate) call it. Single point of truth for the inference rule; closes the asymmetry without touching any writer path or invalidating snapshots.
- **D-02:** The helper walks the OntologyRegistry `extends` chain — a class is 'pattern' iff it (or any ancestor up the `extends` chain) matches `Insight` or `Pattern`; otherwise 'evidence'. The viewer already fetches registry data via `GET /api/v1/ontology/classes?withDisplay=true` (`ApiClient.ts:135`); helper reads the same payload. No hardcoded L2 list — Phase 57's `OnlineInsight` / `OnlineDigest` / etc. auto-classify correctly, and future L2 additions just work.
- **D-03:** Explicit `metadata.layer` field on a node still wins when present (covers writer-side stamping experiments that may seed the field). Helper precedence: explicit `metadata.layer` -> ontology-extends walk -> default `'evidence'`.
- **D-04 (deferred to follow-up phase):** Migrate to writer-stamped `layer` field on every km-core entity. Helper goes away; reads become field-literal. File the follow-up phase against ROADMAP after Phase 60 closes — title suggestion: "Writer-stamped layer field + helper retirement".

### G2 — Legend derivation (SC#2)

- **D-05:** `LegendPanel.tsx` becomes fully dynamic, keyed on the currently-rendered (post-filter) graph. Component receives `entities: Entity[]` + `relations: Relation[]` props (both filtered via `useVisibleEntityIds` or equivalent — same predicate the canvas uses, no schema drift). Hardcoded `SHAPE_SWATCHES`, `LAYER_BADGE_CLASS`, `SOURCE_SAMPLES`, `RELATIONSHIP_SAMPLES` arrays are removed.
- **D-06:** Per-section derivation rules:
  - **DOMAINS** — distinct `ontologyClass` values present in `entities`. SHAPE + COLOR lookups stay in `vokb-palette` / `color-fallback`'s `SHAPE_PALETTE`; LegendPanel is now a *filter* over those palettes by what's rendered. Unknown class -> fallback circle + gray, with a tooltip "class without registered shape" so drift surfaces.
  - **LAYERS** — distinct `deriveLayer(e, registry)` values across `entities`. Empty array (no rendered nodes) -> section hidden.
  - **SOURCE** — distinct `metadata.source` values (`'manual'` / `'auto'` / `'online'` / etc.) present. The OKB-only `Official doc` / `Automated RCA` / `User input` / `Team knowledge` samples are dropped; what shows up is exactly what's tagged in the data.
  - **RELATIONSHIPS** — distinct `relation.type` values present in `relations`. EDGE_STYLES lookup stays in `vokb-palette`; unknown relation types render with the existing `'#d1d5db'` gray fallback (already defensive in `LegendPanel.tsx:204`).
- **D-07:** Empty section (zero entries after filter) is hidden entirely (no `Section` rendered). Avoids "DOMAINS: (none)" placeholder noise. The collapsible `<details>` summary `Legend` stays visible even if every section is empty; expanding it shows nothing — clear signal the canvas is empty.
- **D-08:** Section ordering: DOMAINS -> LAYERS -> SOURCE -> RELATIONSHIPS, preserved as today.

### G3 — Observation/Digest debug toggle (SC#3)

- **D-09:** `visibility-predicate.ts:46-47` hard-exclusion stays as the default. Add a new boolean store field `showDebugEntityTypes` in `viewer-store.ts` (default `false`); when `true`, the predicate skips the Observation/Digest exclusion branch (lines 46-47). Predicate signature extended with this flag in `VisibilityFilters`.
- **D-10:** UI surface: add a row in `GraphToggles.tsx` (under the existing Show Edges / Show Clusters / Show Relation Labels / Show Merged Only / Hide Doc Nodes toggles) labeled `Show debug entity types (Observation, Digest)` with a small tooltip explaining "Architecture-bleed shield: these types should not appear in production VKB. Toggle ON only for debugging."
- **D-11:** Toggle does NOT persist (no localStorage). Matches the existing GraphToggles behaviour. Resets every page load — operator must consciously re-enable.

### G4 — CollectiveKnowledge under Online filter (SC#4)

- **D-12:** The viewer-side `visibility-predicate.ts:69-76` already exempts `System | Project | Component` from the Learning Source filter — no predicate change. The bug is upstream data: CK's `ontologyClass = 'Detail'` in `general.json` while the writer at `content-validation-agent.ts:2685` correctly asserts `'CollectiveKnowledge': 'System'`. A downstream re-classifier is overwriting.
- **D-13:** Ship a one-shot repair: `scripts/repair-ck-ontology-class.mjs` reads `.data/knowledge-graph/exports/general.json`, sets the CK node's `ontologyClass` to `'System'`, writes back via km-core `putEntity` with `skipOntologyCheck: true` (Phase 43 D-G4.1 trusted-path convention), and re-exports `general.json`. Idempotent — safe to re-run. Outputs `.data/repair-ck-ontology-class-<timestamp>.json` log with before/after values.
- **D-14:** Ship a writer-side guard against the re-classifier corrupting CK again. Locate during research — likely candidates: `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` or `coordinator.ts` (the LLM-driven re-classification path). The guard exempts a closed-set list of hard-classified system roots (`CollectiveKnowledge`, plus the four project anchors `Coding`, `DynArch`, `Timeline`, `Normalisa` per `quality-assurance-agent.ts:1921`) from re-classification, regardless of LLM verdict. Constants imported from a new `lib/km-core/src/types/hierarchy-roots.ts` so the source of truth is sharable.
- **D-15:** Verification: post-repair, run `jq '.nodes[] | select(.attributes.name == "CollectiveKnowledge") | .attributes.ontologyClass' .data/knowledge-graph/exports/general.json` — must return `"System"`. Then visual-smoke `localhost:5173/viewer/coding`: toggle Online filter, select any leaf node, confirm the trace reaches CK and the node count includes CK + project anchors.

### G5 — L2 lower-ontology classes in OntologyFilter (SC#5)

- **D-16:** Drop the hardcoded `CODING_SCHEMA` (`OntologyFilter.tsx:82-100`) including the `Typed Views` (LSL Pipeline / Patterns / Other) group. Typed Views was a Phase 55 stopgap; the L1->L2 hierarchy from Phase 57's `coding.lower.json` supersedes it. Single mental model, lighter UI.
- **D-17:** `OntologyFilter.tsx` (coding-tab variant) fetches `GET /api/v1/ontology/classes?withDisplay=true` (already wired in `ApiClient.ts:135`) and builds groups from the response: every class with `parent` is an L2 child of its parent L1; every L1 with at least one L2 child renders as a collapsible group; L1s without L2 children render as flat rows (matches today's flat-row behaviour). L0 (`System` / `Project`) renders ungrouped at the top.
- **D-18:** UX shape mirrors the existing `renderSubGroup` layout (`OntologyFilter.tsx:253-296`): each L2 row carries a per-class count badge (count from the *filtered* entities, same source the count badges use today — so the badge reflects "how many of this class are currently on screen"). The `all` / `none` link-buttons (lines 266-291) stay and operate on the L2 children of the group.
- **D-19:** L1-group collapse is **purely UI** — clicking the triangle toggles disclosure, filter state unchanged. Matches the existing upper/lower section collapse semantics (`OntologyFilter.tsx:311-377`). Operators use `all`/`none` link-buttons for bulk-toggle.
- **D-20:** L0 anchors (`System`, `Project`) are NOT placed in a collapsible group — they sit as ungrouped rows at the top of the filter so the operator can always see + toggle the system root + project anchors directly. Matches Phase 56 visibility-predicate structural-backbone convention.

### Claude's Discretion

- **D-21:** Exact CSS classes for the new L1 group rows + the new "Show debug entity types" toggle row — match nearby Tailwind patterns; no new design tokens. UI-SPEC §3 micro-type rules (text-[10px] / text-[9px] / text-[8px]) preserved verbatim.
- **D-22:** Whether the LegendPanel `Section` component itself remains exported from `LegendPanel.tsx` or moves to a shared `panels/legend/Section.tsx` — planner picks based on whether anything else consumes it.
- **D-23:** Exact name of the new writer-guard module / list of hard-classified roots constant — planner picks (`HIERARCHY_ROOTS` / `SYSTEM_ROOTS` / etc.). Place under `lib/km-core/src/types/`.
- **D-24:** Whether `repair-ck-ontology-class.mjs` should also fix `metadata.classification` (already `'System'` per the live snapshot, so likely no-op) and `metadata.team` (`'ui'` is odd for a system root) in the same pass, or stay narrow to `ontologyClass`. Planner decides; if widening, add a clear flag and log the scope.
- **D-25:** Test surface — at minimum: unit test for `deriveLayer()` covering Phase 57 L2 classes; component test for LegendPanel dynamic rendering with multiple entity-set fixtures; component test for OntologyFilter with mocked `/api/v1/ontology/classes?withDisplay=true` response; integration test for the writer guard. Planner refines.

### Folded Todos

- **`2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md`** (`resolves_phase: 60`) — Layer filter asymmetry verified at root cause: divergent layer-derivation between `LayerFilter.tsx` and `visibility-predicate.ts`. Folded via G1.
- **`2026-06-14-vkb-legend-static-cross-domain-bleed.md`** (`resolves_phase: 60`) — Static `SHAPE_SWATCHES` / `SOURCE_SAMPLES` / `RELATIONSHIP_SAMPLES` carry OKB content into VKB. Folded via G2.
- **`2026-06-14-vkb-shows-observations-digests-architecture-bleed.md`** (`resolves_phase: 60`) — Hard-exclusion already shipped (`visibility-predicate.ts:46-47`); only the debug toggle was missing. Folded via G3.
- **`2026-06-14-online-filter-hides-ck-truncates-trace.md`** (`resolves_phase: 60`) — Verified at root cause: CK's `ontologyClass = 'Detail'` in live snapshot (writer says `'System'`, downstream re-classifier corrupts). Folded via G4 as a data repair + writer guard.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 60 inputs (this phase)

- `.planning/REQUIREMENTS.md` §VKBUI-01 / VKBUI-02 / VKBUI-03 / VKBUI-04 / LOWERONTO-03 — requirement text.
- `.planning/ROADMAP.md` §"Phase 60: Unified Viewer Rendering UX Integrity" — goal + the five success criteria verbatim.
- `.planning/todos/pending/2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md` — operator's voice on Layer asymmetry; folded.
- `.planning/todos/pending/2026-06-14-vkb-legend-static-cross-domain-bleed.md` — operator's voice on Legend bleed; folded.
- `.planning/todos/pending/2026-06-14-vkb-shows-observations-digests-architecture-bleed.md` — operator's voice on Observation/Digest bleed; folded.
- `.planning/todos/pending/2026-06-14-online-filter-hides-ck-truncates-trace.md` — operator's voice on CK truncation; folded.
- `CLAUDE.md` §"Rebuilding After Code Changes" — `integrations/unified-viewer/` is bind-mounted (no Docker rebuild). However any change to `integrations/mcp-server-semantic-analysis/src/agents/` (G4 writer guard) requires BOTH `npm run build` inside the submodule AND `docker-compose build coding-services && docker-compose up -d coding-services`.

### Prior phase context (carrying forward)

- `.planning/phases/57-lower-ontology-project-tagging-foundation/57-CONTEXT.md` §D-09 (10 L2 classes), §D-11 (selectedTeams rename deferred to here), §G3 (`coding.lower.json` shape).
- `.planning/phases/56.1-unified-viewer-many-to-many-bridge/56.1-CONTEXT.md` §D-1 (multi-selection store contract), contract #3 (viewport stable on filter changes) — must NOT regress in Phase 60.
- `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-PATTERNS.md` — `LegendPanel.tsx` and `OntologyFilter.tsx` patterns we're now evolving.
- `.planning/phases/45-…/45-VERIFICATION.md` — descope honesty record. Phase 60 closes some of the parity gap surfaced there.

### Viewer surface (Phase 60 modifies)

- `integrations/unified-viewer/src/panels/LegendPanel.tsx` — full rewrite to dynamic per D-05..D-08. Drop static arrays; receive `entities` + `relations` props.
- `integrations/unified-viewer/src/panels/filters/LayerFilter.tsx:33` — switch count derivation from `(e as {layer?: string}).layer || 'evidence'` to the shared `deriveLayer(e, registry)` helper.
- `integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx:82-100` — drop hardcoded `CODING_SCHEMA`; build groups dynamically from API response per D-17..D-20.
- `integrations/unified-viewer/src/panels/filters/GraphToggles.tsx` — add `Show debug entity types` row per D-10.
- `integrations/unified-viewer/src/graph/visibility-predicate.ts:46-47` — gate the Observation/Digest hard-exclusion on `filters.showDebugEntityTypes !== true` per D-09.
- `integrations/unified-viewer/src/graph/visibility-predicate.ts:81-85` — replace inline inference with `deriveLayer(e, registry)` call.
- `integrations/unified-viewer/src/graph/layer.ts` — **NEW.** Shared `deriveLayer()` helper per D-01..D-03.
- `integrations/unified-viewer/src/store/viewer-store.ts` — add `showDebugEntityTypes: boolean` (default `false`) + toggle action; thread into `VisibilityFilters` build paths.
- `integrations/unified-viewer/src/graph/useVisibleEntityIds.ts` + `D3GraphCanvas.tsx` — ensure new `showDebugEntityTypes` flag flows through every predicate call site.

### km-core / semantic-analysis surface (Phase 60 modifies)

- `integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts:2685` — confirms intended `'CollectiveKnowledge': 'System'` classification (read-only ref).
- `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` AND `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` — research candidates for the re-classifier that overwrites CK. Locate during planning; add the hard-root guard per D-14.
- `integrations/mcp-server-semantic-analysis/src/agents/quality-assurance-agent.ts:1921` — existing `exemptNodes` set (`CollectiveKnowledge`, `Coding`, `DynArch`, `Timeline`, `Normalisa`, `Ui`, `Resi`, `Raas`). Pattern source for the new hard-root constant.
- `lib/km-core/src/types/hierarchy-roots.ts` — **NEW.** Exports `HIERARCHY_ROOTS` (or equivalent) constant per D-14 + D-23. Importers: G4 writer guard + repair script.
- `scripts/repair-ck-ontology-class.mjs` — **NEW.** One-shot repair per D-13. Mirrors `scripts/backfill-project-tag.mjs` shape (Phase 57 D-05 pattern).

### Ontology API surface (Phase 60 consumes — no changes)

- `lib/km-core/src/api/handlers/ontology.ts` — `GET /api/v1/ontology/classes?withDisplay=true` already returns `{name, level?, parent?, display?}` per the Phase 45 Plan 04 extension. Sufficient for D-17 L1->L2 grouping. No new endpoint.
- `integrations/unified-viewer/src/api/ApiClient.ts:135` — viewer already calls this endpoint. Response shape already typed.
- `.data/ontologies/coding.lower.json` — Phase 57 deliverable. 10 L2 classes mapped to L1 parents. Source of truth for D-17 group structure.

### Verification artifacts

- `.data/knowledge-graph/exports/general.json` — current canonical export. Repair input + verification surface for D-15.
- `.specstory/history/` — operator session logs; use `/sl` if cross-session continuity is needed for the writer-guard research.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`visibility-predicate.ts:46-47`** — Observation/Digest hard-exclusion already shipped. Phase 60 only adds a runtime toggle to bypass it; no logic to re-implement.
- **`visibility-predicate.ts:69-76`** — Learning Source structural-backbone exemption (`System | Project | Component`) already shipped. CK fix is data, not code.
- **`vokb-palette.ts` SHAPE_PALETTE + EDGE_STYLES + LAYER_BADGE_CLASS** — color/shape/edge lookups stay here. LegendPanel becomes a *consumer* (filtered by rendered content), not a duplicator of these tables.
- **`OntologyFilter.tsx:200-296` `renderClassCheckbox` + `renderSubGroup`** — row + group rendering primitives are reusable verbatim. Only the `CODING_SCHEMA` source changes.
- **`OntologyFilter.tsx:214-230` `__none__` sentinel handling** — empty-array-vs-`__none__` semantics already correct. New L1->L2 groups inherit verbatim.
- **`GET /api/v1/ontology/classes?withDisplay=true`** — already returns `parent` (extends-chain parent). Both the OntologyFilter group builder AND the `deriveLayer()` ancestor-walk consume the same response.
- **`quality-assurance-agent.ts:1921` `exemptNodes`** — pattern for the hard-root constant in `lib/km-core/src/types/hierarchy-roots.ts`. Copy verbatim minus the team-anchor framing.

### Established Patterns

- **Submodule build pipeline (CLAUDE.md):** G4's writer guard touches `integrations/mcp-server-semantic-analysis/` -> requires `npm run build` + `docker-compose build coding-services && docker-compose up -d coding-services`. G1/G2/G3/G5 viewer changes are bind-mounted -> just `npm run build` inside `integrations/unified-viewer/`.
- **Phase 56 contract #3 — viewport stable on filter changes.** Adding the `showDebugEntityTypes` toggle, dynamic Legend, and L1->L2 OntologyFilter must NOT trigger viewport animate/relayout. Smoke-loop check: filter toggles never re-zoom the canvas.
- **Phase 56.1 D-1 — multi-selection store contract.** No code in Phase 60 touches `selectedNodeIds` / `focalNodeId` / `selectedBucketKeys`; all writes still route through `setSelection` / `clearSelection`. New `showDebugEntityTypes` toggle uses a dedicated action.
- **Phase 43 D-G4.1 trusted-path write convention** (`putEntity` with `skipOntologyCheck: true`) — repair script uses this so the LLM-driven classifier doesn't re-corrupt during the repair pass.
- **UI-SPEC §3 micro-type exceptions (`text-[10px]` / `text-[9px]` / `text-[8px]`)** — preserved verbatim in new rows; no new design tokens.

### Integration Points

- **OntologyRegistry -> viewer via `/api/v1/ontology/classes?withDisplay=true`.** Single fetch drives BOTH `deriveLayer()` ancestor-walk AND `OntologyFilter` L1->L2 grouping. Cache once in the viewer (React Query or store) to avoid two round-trips.
- **`showDebugEntityTypes` store field -> every `useVisibleEntityIds` call site.** Add to `VisibilityFilters` build path so the predicate sees it; thread through `D3GraphCanvas.tsx` dep list.
- **Writer-guard `HIERARCHY_ROOTS` -> re-classifier guard.** Constant exported from `lib/km-core/src/types/hierarchy-roots.ts`; imported by both the writer guard and the repair script so the truth lives once.
- **`general.json` repair -> live km-core graph.** Repair writes via km-core API (not direct JSON edit); km-core's debounced exporter re-emits `general.json`. Per MEMORY.md / CLAUDE.md the local `persistence.js` patch ensures hydrate-prefers-JSON-when-newer survives.

</code_context>

<specifics>
## Specific Ideas

- **L1->L2 group rendering** — when the `Component` L1 group is expanded, list its L2 children with per-class count badges (e.g., `LiveLoggingSystem`, `ConstraintMonitor`, `KnowledgeManagement`, `BatchSemanticAnalysis`, `RapidLlmProxy`, `DockerizedServices` for the Phase 57 set). Two link-buttons under the group: `[all]` / `[none]`. Collapse triangle hides the L2 rows but does not deselect them. Matches existing collapse UX in upper/lower sections.

- **Legend Source section after fix (VKB tab, typical render):** when `learningSource = 'combined'`, the SOURCE section shows whatever `metadata.source` values are present in the rendered graph — likely `'manual'`, `'auto'`, `'online'`. No `'Official doc'` / `'Automated RCA'` placeholder rows.

- **CK repair script sanity check** before re-export — print `before: ontologyClass=<X>` and `after: ontologyClass=System` so the operator sees the flip. If `before == 'System'` already, exit clean with "no change needed" (idempotency).

- **Debug toggle copy** — `Show debug entity types (Observation, Digest)` keeps the operator honest about what the toggle re-enables. Tooltip on hover: "Architecture-bleed shield: these types should not appear in production VKB. Toggle ON only for debugging."

</specifics>

<deferred>
## Deferred Ideas

- **Writer-stamped `layer` field on every km-core entity** (D-04 follow-up). When this lands, `deriveLayer()` can retire and both read paths become field-literal. Suggested phase title: "Writer-stamped layer field + helper retirement". File against ROADMAP after Phase 60 closes.
- **`metadata.team -> metadata.project` rename + `selectedTeams -> selectedProjects` viewer rename.** Phase 57 D-11 deferred this to Phase 60 in spirit, but it's distinct from any of the SC#1–SC#5 surfaces and would balloon the diff. Keep deferred per Phase 57's deferred-ideas list; pick up when the LOWERONTO-04 team-cleanup phase runs.
- **Per-tab Legend variant for `/viewer/okb`.** Phase 60 ships the dynamic-from-render LegendPanel; it naturally adapts to OKB-tab content because OKB renders different entities + edge types. No per-tab schema needed — but if the OKB tab needs special rendering (e.g., RCA-domain symbols absent from the shared palette), file a follow-up.
- **Schema-source migration for VOKB tab** — VOKB still uses `VOKB_SCHEMA` (hardcoded) in `OntologyFilter.tsx:29-79`. Phase 60 only refactors the coding-tab variant. VOKB tab should follow the same API-driven pattern but that's separate — file as a follow-up once VOKB's OntologyRegistry side is in shape.
- **Persistence of `showDebugEntityTypes` across reload.** Non-persistent today per D-11. If operators end up flipping this constantly during debugging sessions, add localStorage + persistence in a follow-up.
- **Aggregate count badge on collapsed L1 group** (the rejected Option C in the L1-collapse question). If operators miss the at-a-glance summary, add later. No data lost — just a UI affordance.

### Reviewed Todos (not folded)

- **`2026-05-23-orphan-digest-observation-refs.md`** — scored on observation/digest keywords but is a Phase 59-scope data-integrity issue (already closed via Phase 59-04-PLAN.md repair). Out of Phase 60 scope.
- **`2026-06-10-okm-express-api-contract-bridge.md`** — routes to Phase 61 / OKBROUTE-02. Out of scope.
- **`2026-06-10-sub-agent-dashboard-observability-gap.md`** — scored on shared keywords ("system", "phase") but is a Phase 51 follow-up. Out of scope.
- **`2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md`** — routes to Phase 61 / LSLTIME-01..03. Out of scope.

</deferred>

---

*Phase: 60-unified-viewer-rendering-ux-integrity*
*Context gathered: 2026-06-17*
