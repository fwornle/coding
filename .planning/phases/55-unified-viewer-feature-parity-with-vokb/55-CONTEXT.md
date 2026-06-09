---
phase: 55
phase_name: unified-viewer-feature-parity-with-vokb
captured: 2026-06-09
updated: 2026-06-09
trigger: 2026-06-09 operator visual review against legacy VOKB localhost:3002
requirement: UI-02 (NEW)
milestone: post-v7.1 (out-of-milestone bug-fix / feature-parity phase)
amends: Phase 45 D-45-02 (system routing — CAP dropped, OKB target corrected)
status: Ready for planning
---

# Phase 55: Unified Viewer Feature Parity with VOKB — Context

**Gathered:** 2026-06-09 (problem statement)
**Updated:** 2026-06-09 (decisions locked via `/gsd-discuss-phase 55`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring the unified viewer (`integrations/unified-viewer/`, the Phase 45 React + Vite + Sigma.js + Zustand SPA) to **exact functional and rendering parity with the legacy VOKB** (`_work/rapid-automations/integrations/operational-knowledge-management/viewer/`), correct the OKB-tab data-routing bug, drop the CAP tab (Phase 45 inherited a hallucinated URL), and add four coding-domain-specific surfaces (hierarchy navigator, LSL timeline, ETM live tail, workflow status). Phase 45's routing scaffold stays as the substrate; this phase fills in the UI. Phase 45 shipped ~15% of VOKB's surface area; Phase 55 closes the remaining ~85% plus the additions.

**Not in scope:** consumer-side cutover from VKB/VOKB to unified-viewer (that's a separate operator decision after parity is verified); production rollout at `localhost:3032/viewer/*`; BMW corporate proxy/DNS setup for any future remote OKM endpoint.

</domain>

## Why This Phase Exists (Phase 45 retrospective)

Phase 45 ("Unified Web Viewer") was marked complete on 2026-06-08 with the MVP-shipped note "VKB + VOKB stay live as fallback per CONTEXT.md Deferred Ideas". The operator's 2026-06-09 visual review against `localhost:3002` (the legacy VOKB) showed that the unified viewer at `localhost:5173/viewer/{coding,okb,cap}` delivers ~15% of VOKB's surface area:

| VOKB capability | Unified viewer status |
|---|---|
| Stats bar (nodes, edges, evidence, patterns, orphans, connectivity %, LIVE indicator) | ❌ absent |
| Node shape encoding by entity type (squares / diamonds / circles) | ❌ all circles |
| Layer filter (Evidence / Pattern) | ❌ absent |
| Domain filter (RaaS / KPI-FW / General) | ❌ absent |
| Full Ontology Class tree with per-class counts | ⚠ flat class checklist, no counts |
| Show All Relations / Show Clusters / Merged Only / Hide Documentation toggles | ❌ absent |
| Trending Patterns sparklines sidebar | ❌ absent |
| Issue Triage tab + Knowledge Graph tab modes | ❌ absent |
| Entity Details sub-tabs (Default / Evolution / Confidence / Timeline) | ❌ flat panel |
| Relationships breakdown by edge type with counts | ❌ absent |
| Sources & Evidence with per-source icons | ❌ absent |
| Occurrence History | ❌ absent |
| Legend explaining colors / shapes / encoding | ❌ absent |

Plus three direct bugs the same review caught:

- **OKB tab shows the coding KG, not OKM data.** `integrations/unified-viewer/src/config/system-endpoints.ts:18` maps `okb → localhost:3848` (semantic-analysis), which holds the same km-core LevelDB store as obs-api at `:12436`. So `Coding` and `OKB` tabs show functionally identical data — both the coding KG. The actual OKM project's km-core data lives in `_work/rapid-automations/integration/operational-knowledge-management/.data/` and is served by OKM's own Express on `OKB_PORT ?? 8090` (`_work/.../operational-knowledge-management/src/index.ts:17`).
- **CAP tab error UX is misleading.** The viewer's red banner says "Browser blocked the request to https://okm.cc.bmwgroup.net (CORS)". The console shows `net::ERR_NAME_NOT_RESOLVED` — DNS failure, not CORS. Root cause: **the URL `https://okm.cc.bmwgroup.net` is hallucinated** (Phase 45 D-45-02 invented it). Nothing is on `cc.bmwgroup.net`. CAP tab is being dropped (D-55-01b).
- **Markdown vs Entity tab UX inconsistency.** Markdown tab shows ONLY the description text — no metadata header, no Class chip, no Created/Last-confirmed. Entity tab shows the description PLUS the metadata. Markdown is strictly worse, plus a different side-panel width.

Phase 45 stays checked-off in the ROADMAP milestone log because the routing layer, multi-base ApiClient, ontology display-overlay, and view shell are real. Phase 55 picks up the UI work that should have been part of Phase 45 from the start.

## Success Criteria (Locked, from ROADMAP)

1. **Data routing correctness.** OKB tab fetches from OKM's km-core via OKM's HTTP server; a new visitor sees RaaS / KPI-FW / business entities, not `CodeAnalyzer` / `PersistenceAgent`.
2. **CAP tab removed.** No `/viewer/cap` route, no `cap` entry in `SYSTEM_ENDPOINTS`, no `VITE_BACKEND_CAP_URL` env var. Unified viewer is a 2-system viewer (coding + okb).
3. **Legend present.** Color, shape, border, and pulse encoding documented in an always-visible or one-click legend; matches VOKB's encoding semantics exactly.
4. **Node shape encoding by entity type.** Distinct shapes for distinct entity classes, matching VOKB's convention; researcher-derived overlay JSON drives the mapping.
5. **Filter parity with VOKB.** Layer, Domain, full Ontology Class tree with per-class counts, plus Show All Relations / Show Clusters / Merged Only / Hide Documentation toggles.
6. **Header stats bar.** Total nodes, total edges, evidence count, pattern count, orphan count, connectivity %, LIVE indicator.
7. **Entity Details parity.** Sub-tabs (Default / Evolution / Confidence / Timeline), Relationships breakdown by edge type with counts, Sources & Evidence with per-source icons, Occurrence History.
8. **Markdown / Entity panel UX.** Markdown tab keeps metadata header + renders description as markdown; Entity tab unchanged; harmonized panel widths.
9. **Trending Patterns sidebar.** Sparklines for top patterns.
10. **Issue Triage mode.** A separate viewer mode targeting operational triage.

Plus the four coding-specific additions from D-55-02 (see Implementation Decisions).

<decisions>
## Implementation Decisions

### Routing & Data Source

**D-55-01a: Generalized km-core routing.**
The unified-viewer reads from any km-core data dir via an HTTP endpoint conforming to Phase 44's `/api/v1/*` Zod-typed REST contract. Per-system config is a `(slug, label, kmCoreApiBaseUrl)` tuple. The viewer is agnostic to where the data lives; each project is responsible for exposing one HTTP base URL.

- **coding** → `http://localhost:12436` (obs-api, already serves Phase 44 contract — `coding/.data/`, github.com/fwornle, public)
- **okb** → `http://localhost:8090` (OKM Express — `_work/rapid-automations/integration/operational-knowledge-management/.data/`, bmw.ghe.com, corporate)
- **Adapter check:** researcher MUST verify OKM Express on `:8090` already conforms to Phase 44's `/api/v1/*` Zod contract (paths, camelCase keys, response shapes). If it doesn't, either bring OKM Express up to spec (preferred — corporate repo, doable in `_work/`) or add a frontend adapter shim. Cannot proceed without this verification.

**D-55-01b: Drop CAP tab.**
Phase 45's `cap → https://okm.cc.bmwgroup.net` is a hallucinated URL. Phase 55 ships a 2-system viewer. Remove `cap` from `VALID_SYSTEMS`, `SYSTEM_ENDPOINTS`, `SYSTEM_LABELS`, the `/viewer/cap` route, the `VITE_BACKEND_CAP_URL` env var, and any test fixtures referencing CAP. **No CAP placeholder, no "NOT_YET_CONFIGURED" sentinel** — the tab is gone, not deferred.

**D-55-01c: Disallowed sources (rule).**
**Nothing is on `cc.bmwgroup.net`.** Any code, doc, test fixture, or comment referencing `cc.bmwgroup.net` is wrong. Corporate Git for projects in `_work/rapid-automations/` is on `bmw.ghe.com` (HTTPS-token-auth via gh CLI; SSH publickey fails for current keys — see memory `feedback_bmw_ghe_https`). Phase 55 must not introduce any `cc.bmwgroup.net` references and SHOULD remove any inherited ones it finds.

### Feature Scope

**D-55-02a: Port all 12 VOKB features with exact parity (source-grounded).**
Default for every VOKB feature is `port-to-unified`. Researcher MUST read VOKB's actual source code (`_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/`) and re-implement on the unified-viewer's stack (React + Vite + Sigma.js + Zustand + Phase-44 REST). **"Roughly similar from screenshots" is insufficient** (see Canonical Refs → feedback memory). Only if a feature is structurally meaningless on the target dataset (e.g. Issue Triage requires edge types absent from coding's ontology) does the planner ESCALATE to the operator — silent drops are not allowed.

VOKB source files the researcher MUST read (port-spec inputs):
- `components/KnowledgeGraph/GraphVisualization.tsx` — main graph renderer; shape/color encoding lives here
- `components/KnowledgeGraph/NodeDetails.tsx` — entity detail sub-tabs (Default/Evolution/Confidence/Timeline)
- `components/KnowledgeGraph/TrendingPanel.tsx` — sparklines source
- `components/KnowledgeGraph/IssueTriage.tsx` — triage mode
- `components/KnowledgeGraph/HistorySidebar.tsx` — occurrence history
- `components/KnowledgeGraph/CorrelationPanel.tsx` + `CorrelationDetail.tsx` — relationships breakdown
- `components/Filters/{Layer,Domain,Ontology,Search}Filter.tsx`, `LegendPanel.tsx` — filter parity + legend
- `api/okbClient.ts` — REST endpoints VOKB hits (input to D-55-04/05 endpoint matrix)
- `store/slices/*.ts` — Redux state shape (informs Zustand store extensions)
- `utils/graphHelpers.ts` — encoding helpers (D-55-03 input)

**D-55-02b: Add 4 coding-specific surfaces beyond VOKB.**
Phase 55 is a feature-superset of VOKB, not just parity:
1. **Component hierarchy navigator** — Tree view of coding's 4-level structure (Project → Component → SubComponent → Detail / L0–L3). Click an L1 node → filter graph to descendants. VOKB has no analog.
2. **Session timeline / LSL strip** — Horizontal timeline of LSL session boundaries. Click a session → filter graph to entities mentioned in that session.
3. **Live observation stream (ETM tail)** — Sidebar streaming real-time observations as ETM writes them (similar pattern to dashboard live tail). LIVE indicator pulses on new obs. Cross-references entities being touched.
4. **Workflow execution status (ukb / wave-analysis)** — Inline UKB-Ops panel showing currently running workflows + progress, mirroring the dashboard's existing panel.

Each coding-specific surface only appears for the `coding` system tab (gated by `system === 'coding'`) since they depend on coding-specific infrastructure (ETM, LSL, ukb workflow runner). OKB surface stays VOKB-parity only.

**Plan sizing:** 12 ports + 4 additions + routing/legend/encoding work = realistically **10–14 plans** (perhaps more after planner decomposes). The ROADMAP's "6–8 plans" estimate was for parity-only; the superset expands it.

### Visual Encoding

**D-55-03: Researcher-derived per-system encoding overlay.**
The researcher reads VOKB's encoding source (`utils/graphHelpers.ts` + `GraphVisualization.tsx`) and translates its conventions onto coding's wider ontology, producing `coding/.data/ontologies/coding.display.json`. Operator reviews and tweaks before plan-phase ends.

**Schema extension** (Phase 44 contract amendment owned by Phase 55):
```jsonc
{
  "name": "Observation",
  "level": 3,
  "parent": "Detail",
  "display": {
    "color": "#3b82f6",           // existing — Phase 45
    "icon": "📝",                  // existing — Phase 45
    "shape": "circle",             // existing — Phase 45
    "borderStyle": "solid",        // NEW — Phase 55. enum: solid|dashed (orphan)
    "pulseRule": "lastUpdatedWithin:60s"  // NEW — Phase 55. null|expression
  }
}
```

Fallback: if a class has no `display` block, hash-fallback color (Phase 45 mechanism preserved) + default shape (circle) + solid border + no pulse.

**OKB overlay (`okb.display.json`):** Lives in the OKM repo (`_work/rapid-automations/integration/operational-knowledge-management/.data/ontologies/`), not in this repo. Phase 55 ships only `coding.display.json` and the schema contract. Operator may or may not author the OKB overlay PR to the OKM repo as a follow-up; Phase 55's success criteria don't require it.

### Backend Endpoints

**D-55-04/05: Researcher inventories endpoint gaps; planner proposes additions per Phase 44 contract.**
RESEARCH.md produces a feature→endpoint matrix (one row per feature in D-55-02) classifying each as `existing-/api/v1/*` / `new-endpoint-required` / `derive-on-frontend`. New endpoints follow Phase 44's lock:
- Path prefix: `/api/v1/*` (canonical) or `/api/coding/*` (typed views with camelCase shape lock from Plan 44-16)
- Zod-typed request/response schemas
- camelCase wire keys for digests + insights; snake_case only for `session_id` on observations
- No direct LevelDB/SQLite access from the frontend
- camelCase storage stays snake_case in `metadata.*` via `lib/km-core/src/adapters/observation-view.ts` reshape boundary

**Operator review gate:** matrix is reviewed by operator BEFORE plan-phase scopes per-feature plans. Surprises during execution are not acceptable for backend changes.

**Streaming vs polling:** Decided per-feature by the planner. No blanket constraint. SSE on obs-api is established (pattern from semantic-analysis on `:3848`); planner can use it for ETM live tail / LIVE indicator. Workflow status, trends, stats can poll. Operator may veto specific picks during plan review.

### UI-SPEC Scope

**D-55-06: Full UI-SPEC.md via `/gsd-ui-phase 55` before plan-phase.**
Phase 55's 16 surfaces + encoding overlay + layout decisions warrant a design contract. Spawn `/gsd-ui-phase 55` AFTER this CONTEXT.md is committed and BEFORE `/gsd-plan-phase 55`. UI-SPEC.md covers:
- Layout (stats bar position, left/right rail composition for filters + trending + hierarchy nav + LSL strip)
- Component inventory (16 surfaces + supporting infrastructure)
- Encoding mapping reference (links to `coding.display.json`)
- Interaction patterns (keyboard shortcuts — extends existing `KeyboardHelpDialog`)
- Side-panel width harmonization (Markdown ↔ Entity tab consistency per SC-8)
- Mode switching (Knowledge Graph mode vs Issue Triage mode)

### Process Amendments (carried forward from existing 55-CONTEXT.md)

Phase 55 also re-records three process rules that should have prevented Phase 45's premature sign-off:
- **Every phase close-out MUST produce a VERIFICATION.md**, even when shipped under MVP-fallback. The verifier itself should distinguish `must_have failure` from `MVP-deferred`.
- **For viewer-touching plans, the verifier MUST include a side-by-side screenshot comparison** against the legacy viewer being replaced (or a documented justification for the absence).
- **The "MVP shipped with X as fallback" framing is not a sign-off shortcut** — it requires explicit operator approval naming the deferred items.

These rules apply going forward; Phase 55's own verifier MUST include the VOKB side-by-side comparison.

### Claude's Discretion

- Specific plan decomposition (10–14 plans is a sizing estimate, not a cap)
- Choice of SSE vs polling per individual feature (within D-55-04/05's matrix)
- Keyboard shortcut assignments for new surfaces (extends `KeyboardHelpDialog`)
- Internal Zustand slice organization for new state (state shape MUST mirror VOKB's Redux slices where porting; new state can follow unified-viewer's existing conventions)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, UI-spec author, planner) MUST read these before producing artifacts.**

### Source-of-truth for exact parity (VOKB)

- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/KnowledgeGraph/GraphVisualization.tsx` — main graph renderer; shape/color/border/pulse encoding logic
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/KnowledgeGraph/NodeDetails.tsx` — entity detail sub-tabs (Default/Evolution/Confidence/Timeline)
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/KnowledgeGraph/TrendingPanel.tsx` — sparklines source
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/KnowledgeGraph/IssueTriage.tsx` — triage mode
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/KnowledgeGraph/HistorySidebar.tsx` — occurrence history
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/KnowledgeGraph/CorrelationPanel.tsx` + `CorrelationDetail.tsx` — relationships breakdown
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/Filters/{Layer,Domain,Ontology,Search}Filter.tsx`, `LegendPanel.tsx` — filter + legend reference
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/api/okbClient.ts` — endpoints VOKB consumes
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/store/slices/*.ts` — VOKB state shape
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/utils/graphHelpers.ts` — encoding helpers (D-55-03 input)

### Source-of-truth for OKB backend

- `_work/rapid-automations/integrations/operational-knowledge-management/src/index.ts` — Express server entry; `OKB_PORT ?? 8090`; `app.use(cors())` permissive
- `_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts` — route registration (CORS, middleware)
- `_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts` — REST endpoints (compare against Phase 44 `/api/v1/*` contract for D-55-01a adapter check)

### Prior-phase decisions Phase 55 extends or amends

- `.planning/phases/45-unified-web-viewer/45-CONTEXT.md` — D-45-01 (greenfield React+Vite), D-45-02 (URL routing — **amended by D-55-01a/b**), D-45-03 (live ontology fetch + display block — **schema extended by D-55-03**), D-45-04 (staged MVP — **Phase 55 IS the v2 sub-phase referenced**)
- `.planning/phases/45-unified-web-viewer/45-VERIFICATION.md` — gap inventory + retroactive sign-off, documents the 15%-of-VOKB shortfall
- `.planning/phases/45-unified-web-viewer/45-FOLLOWUPS.md` — operator follow-ups
- `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT.md` + `44-16-PLAN.md` — Phase 44 REST contract lock (`/api/v1/*` canonical, `/api/coding/*` typed views, camelCase shape lock, Zod schemas); D-55-04/05 endpoint additions MUST conform
- `.planning/phases/43-okm-cross-repo-migration-c/43-CONTEXT.md` — OKM cross-repo migration context (informs OKB Express conformance check in D-55-01a)

### Existing unified-viewer code (Phase 45 scaffold to extend)

- `integrations/unified-viewer/src/config/system-endpoints.ts` — **the file that needs the okb=:8090 fix + cap removal** (D-55-01a/b)
- `integrations/unified-viewer/src/api/` — ApiClient + per-system base URL resolution
- `integrations/unified-viewer/src/graph/SigmaCanvas.tsx`, `graph-builder.ts`, `node-renderer.ts`, `color-fallback.ts` — Sigma.js renderer; extend for shape/border/pulse encoding per D-55-03
- `integrations/unified-viewer/src/panels/{NavBar,FilterRail,SidePanel,EntityDetailPanel,MarkdownViewerPanel,RcaOpsPanel,Footer}.tsx` — existing panels; extend or replace per ported VOKB feature
- `integrations/unified-viewer/src/store/` — Zustand store; add slices to mirror VOKB's Redux state shape where porting
- `integrations/unified-viewer/src/components/KeyboardHelpDialog.tsx` — keyboard shortcut UI; extend for new surfaces

### Memory / feedback / rules (LOCKED for this phase)

- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_exact_ui_parity.md` — **EXACT parity, not "roughly similar from screenshots"** (the operator rule for this phase). Read VOKB source files listed above; plans must include "Source files read: …"; verifier runs side-by-side screenshots.
- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_logger_class.md` — port VOKB's `Logger` (categorized + level-filtered + localStorage-persisted). NO raw `console.*` outside `utils/logging/Logger.ts`.
- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_e2e_verify.md` — use `gsd-browser` / `/playwright-cli` for visual UI verification; never claim "it works" from DB queries alone.
- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_bmw_ghe_https.md` — bmw.ghe.com via HTTPS-token-auth (gh CLI), not SSH publickey. **No `cc.bmwgroup.net` references** (D-55-01c).
- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_acceptance_grep_word_boundary.md` — acceptance greps need word boundaries; "X is unused" claims need precise regex, not a specific snake_case/camelCase variant.

### Project structure & conventions

- `.planning/PROJECT.md` — project-level scope and stack
- `.planning/REQUIREMENTS.md` §UI-01 (Phase 45 complete) and §UI-02 (this phase) — requirement definitions
- `.planning/codebase/STACK.md`, `STRUCTURE.md`, `INTEGRATIONS.md` — repo-level architecture context
- `CLAUDE.md` — project rules: `documentation-style` skill before docs/PUML; PlantUML CLI not jar; TypeScript strict; use `gsd-browser` for visual verification at localhost:3032/5173; constraint dodging forbidden

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`integrations/unified-viewer/src/graph/SigmaCanvas.tsx` + `graph-builder.ts`** — Sigma.js renderer with custom node program slot. Extend node program to support `borderStyle` (solid/dashed) and `pulseRule` (animated halo) per D-55-03. Color/shape already supported.
- **`integrations/unified-viewer/src/graph/color-fallback.ts`** — Deterministic hash → HSL fallback color. Preserved for classes with no `display.color`. Phase 55 adds analogous fallbacks for `shape` (default `circle`), `borderStyle` (default `solid`), `pulseRule` (default `null`).
- **`integrations/unified-viewer/src/panels/EntityDetailPanel.tsx`** — Existing flat panel. Refactor to host sub-tabs (Default / Evolution / Confidence / Timeline) per SC-7; preserve the Default tab as the current panel's content.
- **`integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx`** — Existing markdown panel; lacks metadata header. Extend to host metadata chip block (Class / Level / Parent / Created / Last confirmed) per SC-8; harmonize side-panel width with EntityDetailPanel.
- **`integrations/unified-viewer/src/components/KeyboardHelpDialog.tsx`** — Keyboard shortcut help UI. Extend registration to cover new surfaces (mode-switch, sub-tab cycling, hierarchy navigation).
- **OKM Express on `:8090`** — Already serves OKM's km-core data with permissive CORS (`app.use(cors())`). Eligible as OKB tab backend pending Phase 44 contract conformance check (D-55-01a).
- **`integrations/system-health-dashboard/src/lib/UkbOpsPanel.tsx`** (pattern reference) — Workflow status panel for D-55-02b #4. Port the rendering pattern; data source is the same `/api/ukb/*` endpoints on `:3033`.

### Established Patterns

- **Phase 44 REST contract is the data layer.** All viewer reads go through `/api/v1/*` (canonical, Zod-typed) or `/api/coding/*` (typed views with camelCase shape lock). No direct LevelDB / SQLite access from frontend. snake_case `session_id` only on observations; everything else camelCase.
- **Phase 45 live-ontology-fetch pattern.** Backend is single source of truth for class display hints. Viewer asks `/api/v1/ontology/classes` and gets `{name, level, parent, display?}`. New classes "just work" with hash fallback. D-55-03 extends the `display` block shape; the fetch pattern is unchanged.
- **Phase 45 system-routing pattern.** `system-endpoints.ts` maps slug → baseUrl. Vite env-var overrides (`VITE_BACKEND_<SYSTEM>_URL`). D-55-01a generalizes this to a `(slug, label, baseUrl)` tuple.
- **`gsd-browser` for visual UI verification** — Phase 55 plans MUST use `gsd-browser navigate / screenshot / click / eval` for visual smoke tests against `localhost:5173` and `localhost:3032`. Hand-rolled `node /tmp/foo.mjs` Playwright scripts re-trigger the `prefer-gsd-browser` constraint.
- **Structured E2E tests under `tests/e2e/unified-viewer/`** — Phase 45 established this convention (`45-06-PLAN.md`). Phase 55's tests extend it; suites run via `npx playwright test`.
- **Frontend Logger** — Per `feedback_logger_class.md`, VOKB's categorized + level-filtered + localStorage-persisted Logger is being ported into unified-viewer. NO raw `console.*` outside `utils/logging/Logger.ts`.

### Integration Points

- **`/api/v1/ontology/classes`** — Phase 44 endpoint; Phase 55 extends response schema with `display.borderStyle` and `display.pulseRule`. Backend change in km-core's HTTP server (`lib/km-core/` or wherever ontology-overlay merging happens — researcher locates).
- **`/api/v1/entities`, `/api/v1/relations`** — Existing entity/relation reads; D-55-04/05 adds new endpoints for Evolution / Confidence / Timeline / Trends / Triage / Stats / Hierarchy / LSL strip.
- **obs-api SSE** — Existing SSE pattern on coding's obs-api can serve ETM live tail + LIVE indicator for D-55-02b #3 (planner decides exact endpoint).
- **`/api/ukb/*` on port 3033** — Existing health-API workflow endpoints; UkbOps panel (D-55-02b #4) reads from these.
- **OKM `_work/rapid-automations/integration/operational-knowledge-management/src/api/routes.ts`** — Existing REST routes for OKB; Phase 55 may amend (D-55-01a adapter work) and/or add Evolution/Confidence/Timeline parallels for the OKB tab.

</code_context>

<specifics>
## Specific Ideas

- **Exact parity, not "roughly similar from screenshots"** (operator rule, 2026-06-09). The researcher MUST open the VOKB source files listed in Canonical Refs; ported features must match VOKB's behavior end-to-end (event handlers, edge cases, keyboard shortcuts, state transitions, encoding subtleties). Verifier runs side-by-side screenshots.
- **OKM Express on `:8090` is the OKB backend** — confirmed by `_work/.../operational-knowledge-management/src/index.ts:17` (`OKB_PORT ?? 8090`) and `src/api/server.ts:111` (`app.use(cors())`). Permissive CORS removes the previous concern about Phase 45 D-45-02 needing OKM-side CORS config.
- **Drop CAP, don't placeholder it.** Operator explicitly rejected the "keep CAP as a placeholder slot" option. No `cap` slug anywhere.
- **No `cc.bmwgroup.net` anywhere.** Project rule extended (D-55-01c). Search-and-purge during execution.
- **Plan count realistically 10–14+.** ROADMAP's "6–8 plans" estimate predates the D-55-02b additions (4 coding-specific surfaces). Planner sizes accordingly; operator may chunk into sub-waves if appropriate.
- **OKB display overlay is OKM-repo work.** Phase 55 ships `coding.display.json` only. Authoring `okb.display.json` in `_work/rapid-automations/integration/operational-knowledge-management/.data/ontologies/` is a follow-up PR to the OKM repo, not a Phase 55 deliverable. Without it, OKB tab falls back to hash colors + default shapes (acceptable).

</specifics>

<deferred>
## Deferred Ideas

- **OKM-repo PR for `okb.display.json`** — Author the OKB-side display overlay in `_work/rapid-automations/integration/operational-knowledge-management/.data/ontologies/okb.display.json` so OKB tab gets the same shape/color/border/pulse semantics. Out of scope for Phase 55 source-tree; suitable as a separate PR to the OKM repo after Phase 55 ships and the schema is stable.
- **Consumer-side cutover from VKB/VOKB to unified-viewer** — Phase 55 closes the parity gap; the actual user-facing migration (retiring VKB at `:8080` / VOKB at `:3002`) is a separate operator decision. Plan 45-06 already drafted the cutover mechanics.
- **Production rollout at `localhost:3032/viewer/*`** — Replacing VKB / VOKB on host nav with the unified viewer at the dashboard's port. Operator follow-up after parity is verified.
- **Mirror OKM data into coding's km-core** — Operator picked direct routing (D-55-01a), not mirroring. If a future use case emerges ("view OKB without running OKM locally"), a separate phase scopes the mirror pipeline.
- **Generalize to N > 2 projects** — D-55-01a's `(slug, label, baseUrl)` tuple architecture supports any number of projects, but Phase 55 ships only `coding + okb`. Adding a third (e.g. another `_work/` km-core data source) is a future config change, not new code.
- **Add CAP back if it becomes a real system** — D-55-01b drops CAP today because the URL was hallucinated. If a CAP-like third system materializes later (with a real km-core data source), it follows the D-55-01a pattern; no special handling needed.

</deferred>

---

*Phase: 55-unified-viewer-feature-parity-with-vokb*
*Context gathered: 2026-06-09 (problem statement) / updated 2026-06-09 (decisions locked)*
