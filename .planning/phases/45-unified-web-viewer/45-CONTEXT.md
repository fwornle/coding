---
phase: 45-unified-web-viewer
phase_number: 45
phase_name: Unified Web Viewer
phase_slug: unified-web-viewer
captured: 2026-06-07
milestone: v7.1 Knowledge Management Unification
depends_on:
  - 42  # B migrated to km-core (UKB)
  - 44  # REST API + git snapshots (data layer)
requirements:
  - UI-01
---

# Phase 45 — Unified Web Viewer

## Domain

A single React + Vite web viewer parameterized by ontology config that replaces VKB (`integrations/memory-visualizer/` — B's viewer) and VOKB (`_work/rapid-automations/integrations/operational-knowledge-management/viewer/` — C's viewer). It reads exclusively through Phase 44's REST contract (`/api/v1/*` canonical + `/api/coding/*` typed views with the camelCase shape lock from Plan 44-16). One codebase, three URL paths — `/viewer/coding`, `/viewer/okb`, `/viewer/cap` — point at A's obs-api on :12436, B's semantic-analysis SSE on :3848, and C's OKM service respectively.

## Carrying Forward from Prior Phases

- **Phase 44 REST contract is locked.** Data layer reads only through `/api/v1/*` (canonical, Zod-typed) and `/api/coding/*` (typed views). camelCase wire keys for digests + insights (Plan 44-16, 2026-06-07); snake_case `session_id` only on observations. Storage stays snake_case in `metadata.*` — the reshape function in `lib/km-core/src/adapters/observation-view.ts` is the case-shift boundary. No direct LevelDB or SQLite access from the frontend.
- **Phase 42/43 — B and C are km-core-native.** The viewer can assume both backends serve the same canonical entity/relation shape.
- **Phase 38/40 — ontology config in `.data/ontologies/`.** Each system's ontology JSON drives the backend; `/api/v1/ontology/classes` already returns each system's classes.

## Decisions Locked

### D-45-01: Greenfield `integrations/unified-viewer/`

A new React + Vite package. NOT a fork of VKB or VOKB. Port only what's worth keeping from each (their renderer code is a reference, not a base). Clean architecture from day 1; deliberate IA decisions instead of inheriting two divergent layouts.

**Trade-off accepted:** Highest cost option of the four considered, but the user picked greenfield specifically to force deliberate IA decisions instead of carrying VKB or VOKB's accumulated drift forward.

```
integrations/unified-viewer/
  src/
    api/        — km-core REST client (typed via Phase 44 Zod schemas)
    config/     — per-system endpoint map + dev overrides
    graph/      — node/edge renderer (graph-lib TBD by researcher — see Open Questions)
    panels/     — entity detail, markdown, RCA — MVP slate per D-45-04
    store/      — fresh Zustand or Redux slice (researcher recommends)
  package.json  — React 18 + Vite + graph lib of choice
```

VKB + VOKB remain operational as fallback during MVP rollout; v2 sub-phase closes the parity gap before retiring them.

### D-45-02: URL-path routing — `/viewer/{system}`

One viewer deployment, three URLs. Bookmarkable per-system. Trivial routing via React Router. Each system's view independently shareable. Static SPA + reverse proxy or direct CORS to A/B/C.

```
/viewer/coding → ApiClient(baseUrl=http://localhost:12436)   # A (obs-api)
/viewer/okb    → ApiClient(baseUrl=http://localhost:3848)    # B (semantic-analysis SSE)
/viewer/cap    → ApiClient(baseUrl=https://okm.cc.bmwgroup.net)  # C (OKM)
```

**Mechanism:**
- React Router: `/viewer/:system` → `<UnifiedViewer system={params.system}/>`
- `ApiClient` resolves base URL from a static `SYSTEM_ENDPOINTS` map in `src/config/`
- Dev override: `VITE_BACKEND_CODING_URL`, `VITE_BACKEND_OKB_URL`, `VITE_BACKEND_CAP_URL` env vars
- On `:system` change: full state reset (store flush + new ApiClient instance) — no leaked state across systems

**Rejected alternatives:**
- Query param (`?system=...`) — worse bookmarking, harder state-reset discipline
- Runtime config endpoint — overkill for 3 systems; defer until the system list becomes dynamic
- Per-deployment build-time env — 3 SPAs is more CI complexity than the benefit warrants given current homogeneity

### D-45-03: Live ontology fetch — `/api/v1/ontology/classes` + optional `display` block

Source of truth is the backend. Each system's ontology JSON in `.data/ontologies/` drives `/api/v1/ontology/classes`. The viewer is dumb — it asks the API.

**Phase 44 contract extension (lands in Phase 45, NOT retrofit to 44):**

```ts
GET /api/v1/ontology/classes
→ [
  {
    "name": "Observation",
    "level": 3,
    "parent": "Detail",
    "display": {           // OPTIONAL — new in Phase 45
      "color": "#3b82f6",
      "icon": "📝",
      "shape": "circle"
    }
  },
  ...
]
```

**Fallback:** if a class has no `display` block, the viewer derives `color = hsl(hash(name) % 360, 65%, 55%)` (deterministic). New classes "just work" with no viewer rebuild.

**Where display hints live on disk:** a tiny overlay JSON next to each ontology — `.data/ontologies/{coding,okb,cap}.display.json` — merged server-side at request time so the API surface stays single-fetch. (Mechanism details defer to researcher; "overlay file" is the user's intent, not a hard implementation requirement.)

**Rejected alternatives:**
- Static config in viewer repo — visual config can drift from backend reality; every new class needs a viewer PR
- Hybrid (defaults + override) — overlaps with the fallback semantics above; collapses to "live fetch with fallback"

### D-45-04: Staged MVP — core + one signature panel per system

Phase 45 MVP ships the minimum that lets a VKB or VOKB user "do their daily work" against the unified viewer. v2 (a separate phase, NOT this one) closes the rest of the parity union before retiring the legacy viewers.

**MVP must-haves (this phase):**

- Force-directed graph render (nodes + edges from `/api/v1/entities` + `/api/v1/relations`)
- Click → entity detail panel (right side)
- Double-click → expand neighbors
- Search box (substring match against name + description)
- Level filter (L0 / L1 / L2 / L3 checkboxes)
- Ontology-class filter (multi-select from `/api/v1/ontology/classes`)
- URL `/viewer/{system}` routing per D-45-02
- Ontology-driven node colors per D-45-03
- **MarkdownViewer panel** (B's signature feature — renders `entity.description` + linked Markdown artefacts)
- **RCA lookup panel** (C's signature feature — root-cause analysis for a selected node — semantics defer to researcher's reverse-engineering of VOKB)

**v2 sub-phase deferred (NOT this phase):**

- TeamSelector (VKB's per-team scoping — useful but not blocking)
- MermaidDiagram panel (renders Mermaid-blocks inside Markdown)
- ConfirmDialog + UndoToast (destructive-action confirmations + undo — needs editing affordances we're not building yet)
- Cluster overlays (VOKB's visual grouping by inferred cluster)

**Decision rule for "MVP-worthy":** does a VKB or VOKB user lose access to a task they regularly do? If yes → MVP. If only "nice to have" → v2.

Plan count estimate: **5–6 plans** for MVP. Pre-research breakdown:

1. Scaffold `integrations/unified-viewer/` + API client + `/viewer/{system}` routing + ontology fetch + fallback color
2. Graph renderer (chosen lib) + click/expand/level-filter
3. Search box + ontology-class filter + entity detail panel
4. MarkdownViewer panel (B's signature) + Phase 44 `/api/v1/ontology/classes` `display` extension
5. RCA lookup panel (C's signature) — depends on researcher's RCA-semantics audit
6. Cross-system smoke: VKB + VOKB user can do their daily work; cutover gate (operator-verified)

(Researcher may split or merge.)

## Open Questions for Researcher

These are unanswered by the user-facing discussion but DO impact planning. The researcher must produce evidence-backed recommendations:

1. **Graph library choice.** Greenfield → no inherited `d3@7.8.5` dependency. Real options: d3-force (familiar, both legacy viewers use it), reagraph (TypeScript-native, React-first, declarative), sigma.js (high perf for >5k nodes), cytoscape.js (heavy but proven). Produce a comparison matrix scoring: TS ergonomics, perf at our scale (≤2k nodes typical, ≤10k edge case), bundle size, license, maintenance health, integration cost. Recommend one.
2. **RCA semantics in VOKB.** Read `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/` and document: which entity field(s) drive RCA, what UI affordance shows it, what API call(s) fetch the data. Produce a port-spec the planner can turn into MVP task.
3. **MarkdownViewer in VKB.** Read `integrations/memory-visualizer/src/components/MarkdownViewer.tsx` + `MermaidDiagram.tsx` and document: which entity field renders, what markdown subset is supported (CommonMark? GFM?), how does it handle artefact links + image embeds. Produce a port-spec (Mermaid deferred to v2 — strip the Mermaid hook).
4. **Display-hints overlay location + load mechanism.** The user wants `display` returned by `/api/v1/ontology/classes` as an optional block. Where do the per-system display JSONs live (`.data/ontologies/{system}.display.json` is the user's hint), and how does km-core's existing ontology loader merge them server-side without a breaking change to `OntologyConfigManager`?
5. **CORS / auth for C from a coding-hosted viewer.** C lives on `okm.cc.bmwgroup.net` (bmw.ghe.com network). A localhost-hosted viewer pointing at it needs to navigate corporate proxy + CORS + possibly OAuth. Document the path; if it requires backend-side proxy routing through A or B, that's a Phase 44 contract addition.

## Canonical Refs (MANDATORY — downstream agents must read)

- `.planning/ROADMAP.md` — Phase 45 § (Goal, Depends on, Requirements, Success Criteria, UI hint)
- `.planning/REQUIREMENTS.md` — § UI-01 "A single web viewer renders any KM-Core graph parameterized by ontology config; both VKB (B) and VOKB (C) users migrate to it without functional regression"
- `.planning/STATE.md` — milestone status (v7.1, 17/23 phases complete pre-Phase-45)
- `.planning/PROJECT.md` — core value, constraints, key decisions
- `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT.md` — Phase 44 base context (REST contract)
- `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md` — **camelCase wire-shape lock** (Plan 44-16, 2026-06-07). The viewer's API client MUST consume camelCase keys for digests + insights; snake_case `session_id` only on observations.
- `.planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md` — phase-44 verification gate, SC#1 cross-system parity status
- `.planning/phases/42-offline-ukb-migration-b/42-CONTEXT.md` — B-side km-core migration (what the viewer's "B" backend looks like post-Phase-42)
- `.planning/phases/43-okm-cross-repo-migration-c/43-CONTEXT.md` — C-side OKM migration (what the viewer's "C" backend looks like post-Phase-43)
- `lib/km-core/src/api/router.ts` — `/api/v1/*` canonical endpoint shape (Phase 44 Plan 06)
- `lib/km-core/src/api/handlers/ontology.ts` — `/api/v1/ontology/classes` current implementation (Phase 45 extends this with optional `display` block)
- `lib/km-core/src/adapters/observation-view.ts` — typed-view reshape boundary + camelCase contract (lines 161-247 carry the LOCKED contract comments from Plan 44-16)
- `tests/integration/typed-views.test.js` — wire-shape lock test (Plan 44-16). Viewer integration tests should mirror these assertions for the viewer's API client.
- `integrations/memory-visualizer/` — VKB (B's viewer) — REFERENCE for porting MarkdownViewer + Filters + TeamSelector (TeamSelector → v2)
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/` — VOKB (C's viewer) — REFERENCE for porting RCA lookup + force-directed renderer
- `integrations/system-health-dashboard/src/` — dashboard's existing React + Vite stack as a stylistic baseline; the viewer should feel like part of the same product family

## Deferred Ideas (NOT this phase)

These came up in scoping but belong elsewhere:

- **Phase 45.1 (v2 parity sub-phase):** TeamSelector port (VKB), MermaidDiagram panel, ConfirmDialog + UndoToast, cluster overlays (VOKB). Closes the full feature union and authorizes retirement of VKB + VOKB.
- **Authoring / editing in the viewer:** out of scope. Viewer is read-only against the REST API. Editing is a separate concern (would need POST/PATCH endpoints + auth + audit — bigger phase).
- **Cross-system queries (e.g., "show me how Observation X in A relates to Insight Y in B"):** out of scope. Each viewer instance is single-system.
- **Real-time updates (websocket / SSE push):** out of scope for MVP. Periodic polling is fine for now; pushed updates are a Phase 45.x optimization once usage patterns surface.

## Code Context (Scouted Assets)

| Path | Role | MVP fate |
|------|------|----------|
| `integrations/memory-visualizer/src/components/MarkdownViewer.tsx` | VKB markdown panel — B's signature | PORT (researcher produces spec) |
| `integrations/memory-visualizer/src/components/MermaidDiagram.tsx` | VKB mermaid block renderer | DEFER to v2 |
| `integrations/memory-visualizer/src/components/TeamSelector.tsx` | VKB per-team filter | DEFER to v2 |
| `integrations/memory-visualizer/src/components/Filters/` | VKB level + class filters | REFERENCE — rebuild in new package per D-45-04 |
| `integrations/memory-visualizer/src/components/KnowledgeGraph/` | VKB d3 renderer | REFERENCE — port logic into chosen graph lib |
| `_work/rapid-automations/.../viewer/src/` | VOKB renderer + RCA | REFERENCE — port RCA panel; renderer logic informs graph-lib decision |
| `integrations/system-health-dashboard/src/` | dashboard React + Vite | STYLE baseline (same product family look-and-feel) |
| `lib/km-core/src/api/handlers/ontology.ts` | `/api/v1/ontology/classes` handler | EXTEND with optional `display` field per D-45-03 |

## Threats / Constraints

- **C-system reachability** (`okm.cc.bmwgroup.net` via bmw.ghe.com network) likely requires corporate-proxy routing or backend-side proxying. Documented as Open Question #5; if backend-side proxy is needed, that adds one task to the plan.
- **Plan 44-16 wire-shape contract is load-bearing.** Any viewer integration test must use camelCase keys for digests + insights, snake_case `session_id` on observations. Mirror `tests/integration/typed-views.test.js` for the viewer's API client.
- **No dual viewer drift.** During MVP rollout VKB + VOKB stay up as fallback; they must NOT diverge from each other or from the unified viewer in any way that consumers come to depend on. v2 sub-phase retires both at once.
- **Greenfield discipline.** D-45-01 picks greenfield specifically for deliberate IA. The planner must NOT default to "copy VKB and modify" — that re-creates the architecture the user wanted out of.
