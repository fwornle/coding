# Phase 23: Live Observation Tap & Dashboard - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the enhanced-transcript-monitor (ETM) to call observe() in real-time during live coding sessions, producing mastra observations alongside verbatim LSL output. Add a REST endpoint on the health API (port 3033) for browsing observations with full-text search and filtering. Add a new Observations page to the health dashboard UI.

</domain>

<decisions>
## Implementation Decisions

### ETM Observation Trigger
- **D-01:** Call observe() per exchange — after each user→assistant exchange completes. Produces granular, near-real-time observations.
- **D-02:** All agents produce observations (claude, copilot, opencode, mastra). Unified observation history across all agents.
- **D-03:** Use the ObservationWriter from Phase 22 — already handles LLM proxy routing at :8089 and LibSQL persistence at `.observations/observations.db`.

### Non-Blocking Guarantee
- **D-04:** Fire-and-forget async — call `ObservationWriter.processMessages()` without awaiting the result. Errors logged to stderr, never block the LSL pipeline. ETM already uses async patterns throughout.
- **D-05:** Per Phase 20 D-13: LSL and observations run independently in parallel. No coordination needed — ETM writes LSL synchronously, fires observe() asynchronously.

### REST API Design
- **D-06:** Endpoint at `GET /api/observations` on the health API server (port 3033).
- **D-07:** Filtering: `?agent=claude&from=2026-04-01&to=2026-04-03&project=onboarding-repro&q=search+term`
- **D-08:** Full-text search support — use LibSQL FTS5 virtual table on observation content for the `q` parameter.
- **D-09:** Pagination via `?limit=50&offset=0`. Default limit 50.
- **D-10:** Response format: JSON array of observation objects with `id`, `content`, `agent`, `project`, `sessionId`, `timestamp`, `source` fields.

### Dashboard UI
- **D-11:** New dedicated page at `/observations` in the health dashboard.
- **D-12:** List view showing: observation summary text, agent icon/color (matching statusline colors — magenta M: for mastra, etc.), timestamp, project name, session ID. Click to expand full content.
- **D-13:** Filter sidebar with: agent selector (multi-select), time range picker, project selector, full-text search input.
- **D-14:** Uses the same React + TailwindCSS patterns as existing dashboard pages.

### Claude's Discretion
- FTS5 table schema and trigger setup (created on first query or at startup)
- Observation detail panel layout (expanded view on click)
- Auto-refresh strategy for the observations list (polling interval or SSE push)
- Whether to show a real-time observation count badge in the dashboard nav

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ETM (MUST modify)
- `scripts/enhanced-transcript-monitor.js` — 3863 lines, main file to modify for observation tap
- `src/live-logging/ObservationWriter.js` — Phase 22 writer with LLM proxy routing (MUST reuse, not recreate)
- `src/live-logging/TranscriptNormalizer.js` — Phase 22 normalizer (reuse parsers for exchange → MastraDBMessage)

### Health Dashboard (MUST extend)
- `integrations/system-health-dashboard/server.js` — Backend API server at :3033 (add /api/observations route)
- `integrations/system-health-dashboard/src/pages/` — React pages (add Observations page)
- `integrations/system-health-dashboard/src/components/` — Reusable components

### Phase 20/22 Decisions (carry forward)
- `.planning/phases/20-foundation-opencode-om/20-CONTEXT.md` — D-13 (parallel operation), D-14 (additive), D-15 (shared session IDs)
- `.planning/phases/22-transcript-converters/22-CONTEXT.md` — D-07/D-08 (LLM proxy routing), D-09 (fix API key error)

### Storage
- `.observations/observations.db` — LibSQL database (write destination)
- `.observations/config.json` — Token budgets and model config
- `src/llm-proxy/llm-proxy.mjs` — LLM proxy bridge at :8089

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ObservationWriter.js` (227 lines) — already handles observe() calls through LLM proxy, LibSQL persistence
- `TranscriptNormalizer.js` — parseClaude/parseCopilot/parseSpecstory → MastraDBMessage (reuse for exchange normalization)
- Dashboard component patterns: existing pages use React + TailwindCSS + recharts for data display
- Health API already serves `/api/ukb/*`, `/api/health/*` endpoints — follow same Express router pattern

### Established Patterns
- ETM uses EventEmitter + async callbacks for pipeline stages
- Dashboard pages: React functional components with hooks, fetching from :3033
- Agent colors: claude=blue, copilot=green, opencode=cyan, mastra=magenta (colour13)

### Integration Points
- ETM exchange completion callback → fire observe() asynchronously
- Health API Express router → add `/api/observations` route
- Dashboard nav → add Observations page link
- LibSQL → add FTS5 virtual table for full-text search

</code_context>

<specifics>
## Specific Ideas

- The GOOGLE_GENERATIVE_AI_API_KEY error from mastra's native observation system needs to be resolved by routing through our LLM proxy — this is critical for observations to actually work
- Agent colors in the observations list should match statusline colors for visual consistency
- Session IDs shared between LSL and observations (per Phase 20 D-15) enable cross-referencing

</specifics>

<deferred>
## Deferred Ideas

- Real-time SSE push for live observation updates (could be added later as progressive enhancement)
- Observation-based search across all projects (cross-project observation aggregation)
- Replacing LSL with observations as primary record (Phase 20 D-14 says "not this milestone")

</deferred>

---

*Phase: 23-live-observation-tap-dashboard*
*Context gathered: 2026-04-04*
