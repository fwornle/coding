# Phase 45 Discussion Log

**Date:** 2026-06-07
**Skill:** /gsd-discuss-phase 45
**Mode:** discuss (no flags)

Human-reference log of the discuss-phase session that produced `45-CONTEXT.md`. Not consumed by downstream agents.

## Areas presented to user

User selected all four via multi-select:

1. Base codebase + migration path
2. Backend selection mechanism
3. Ontology-driven rendering shape
4. Feature parity scope (MVP vs v2)

## Area 1 — Base codebase + migration path

**Question:** Which codebase is the base for the unified viewer?

**Options presented:**

- Fork VKB (`integrations/memory-visualizer/`) — keep richer feature surface; lowest migration risk
- Fork VOKB viewer — start from VOKB's renderer; cross-repo lift
- Greenfield `integrations/unified-viewer/` — clean architecture; ~2-3x effort
- Extend dashboard at :3032 — single URL, but bloats the dashboard bundle

**User selected:** Greenfield `integrations/unified-viewer/`

**Rationale captured:** "forces deliberate IA decisions" — user picked the highest-cost option specifically because they want a clean architecture, not VKB+VOKB drift carried forward.

**Recorded as:** D-45-01.

## Area 2 — Backend selection mechanism

**Question:** How does the unified viewer choose which backend (A, B, or C) to point at?

**Options presented:**

- URL path `/viewer/{system}` — bookmarkable per system, trivial routing
- Query param `?system=...` — single URL with system dropdown; worse bookmarking
- Runtime config endpoint — best for dynamic system list; overkill for 3 systems
- Per-deployment build-time env — 3 SPAs; CI complexity

**User selected:** URL path `/viewer/{system}` (recommended option)

**Implementation hints from preview:** React Router `/viewer/:system`, `ApiClient` resolves base URL from a static `SYSTEM_ENDPOINTS` map, dev-overridable via `VITE_BACKEND_{A,B,C}_URL`.

**Recorded as:** D-45-02.

## Area 3 — Ontology-driven rendering shape

**Question:** Where do colors / class hierarchy / node icons come from?

**Options presented:**

- Live fetch `/api/v1/ontology/classes` — API is source of truth; minor Phase 44 contract extension
- Static config in viewer repo — zero API change; drift risk
- Hybrid (defaults + override) — collapses to live-fetch-with-fallback

**User selected:** Live fetch from `/api/v1/ontology/classes` (recommended option)

**Locked details from preview:**

- Phase 45 extends the schema with an optional `display` block per class
- Viewer falls back to deterministic `hash(name) → HSL` color when `display` is absent
- Source of truth: `.data/ontologies/{coding,okb,cap}.json` + a tiny display-hints overlay per system

**Recorded as:** D-45-03. The `display` extension is a Phase 44 contract addition that LANDS WITHIN Phase 45 (not retroactively in 44).

## Area 4 — Feature parity scope (MVP vs v2)

**Question:** How aggressive should Phase 45's MVP feature parity be?

**Options presented:**

- Tight MVP — core read + filter + search; VKB+VOKB stay up; v2 closes parity
- Full union from day 1 — every feature; retire VKB+VOKB immediately; ~8-10 plans
- Staged MVP — core + 1 signature feature per system (B's MarkdownViewer + C's RCA); ~5-6 plans

**User selected:** Staged MVP — core + 1 signature feature per system (recommended option)

**Locked MVP slate from preview:**

MVP:
- Tight-MVP (force-directed graph + click/expand/filter/search/entity panel)
- MarkdownViewer panel (B's signature)
- RCA lookup panel (C's signature)

v2 (separate phase):
- TeamSelector, MermaidDiagram, ConfirmDialog + UndoToast, cluster overlays

**Recorded as:** D-45-04. Plan-count estimate: 5–6 plans.

## Claude's discretion (not asked, recorded as Open Questions for researcher)

1. **Graph library choice** — greenfield means we don't inherit `d3@7.8.5`. Researcher produces a scored comparison: d3-force vs reagraph vs sigma.js vs cytoscape.js. Recommend one.
2. **RCA semantics in VOKB** — reverse-engineer VOKB's RCA panel; produce port-spec.
3. **MarkdownViewer in VKB** — reverse-engineer VKB's MarkdownViewer; produce port-spec (strip Mermaid hook — deferred to v2).
4. **Display-hints overlay location + load mechanism** — exact path + how km-core's ontology loader merges them.
5. **CORS / auth for C from a coding-hosted viewer** — bmw.ghe.com network access path.

## Deferred Ideas

- Phase 45.1 (v2 parity sub-phase) — TeamSelector + Mermaid + ConfirmDialog/Undo + cluster overlays; retires VKB+VOKB.
- Authoring/editing in the viewer — read-only this phase.
- Cross-system queries (A↔B↔C) — out of scope; single-system per instance.
- Real-time updates (websocket / SSE push) — periodic polling is fine for MVP.

## Outcome

`45-CONTEXT.md` written with 4 decisions, 5 open questions for researcher, 8+ canonical refs, 4 deferred ideas.

Next steps: `/gsd-plan-phase 45` (or `/gsd-ui-phase 45` first if a UI design contract is wanted — Phase 45 has `UI hint: yes` in the ROADMAP).
