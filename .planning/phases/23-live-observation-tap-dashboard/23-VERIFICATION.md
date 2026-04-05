---
phase: 23-live-observation-tap-dashboard
verified: 2026-04-05T06:55:00Z
status: gaps_found
score: 5/7 must-haves verified
gaps:
  - truth: "Full-text search via FTS5 works on observation content"
    status: failed
    reason: "FTS5 virtual table cannot be created on the readonly DB connection; observations_fts table never exists at query time"
    artifacts:
      - path: "integrations/system-health-dashboard/server.js"
        issue: "_getObservationsDb() opens DB with readonly:true then tries CREATE VIRTUAL TABLE — silently fails. Subsequent ?q= search queries return HTTP 500 'no such table: observations_fts'. ObservationWriter.js never creates the FTS5 table on the writable connection either."
    missing:
      - "ObservationWriter.init() must CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts (writable connection owns schema)"
      - "OR: server.js must open a separate writable connection just for FTS5 schema creation, or drop readonly:true and rely on SQLite's default POSIX locking"
  - truth: "GET /api/observations returns paginated JSON with agent/time/project/search filtering"
    status: partial
    reason: "Agent filter works for single agent (?agent=claude) but fails with 500 for 2-3 agents because Express delivers multiple ?agent= params as an array and server calls .split(',') on an array (TypeError)"
    artifacts:
      - path: "integrations/system-health-dashboard/server.js"
        issue: "Line ~3844: const agents = agent.split(',').map(...) fails when agent is string[] (multi-value query param). Docker log: 'Query error: agent.split is not a function'"
    missing:
      - "Normalize agent param: const agentParam = Array.isArray(agent) ? agent : agent.split(','); before mapping"
human_verification:
  - test: "Confirm 108 observations visible at localhost:3032/observations"
    expected: "NavBar shows Observations badge with count; cards render with agent color dots"
    why_human: "User has already confirmed this — recording for completeness"
  - test: "Test multi-agent filter: uncheck all agents, re-check only claude + copilot, apply"
    expected: "Results show only claude and copilot observations; no 500 error"
    why_human: "Multi-agent array bug blocks this path programmatically; needs UI verification post-fix"
---

# Phase 23: Live Observation Tap Dashboard Verification Report

**Phase Goal:** Live coding sessions produce real-time observations alongside verbatim LSL, browsable from the health dashboard
**Verified:** 2026-04-05T06:55:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ETM fires observe() asynchronously after each exchange without blocking LSL | VERIFIED | `_fireObservation()` at ETM line 3113 is not awaited; `.catch()` handler prevents bubbling; `processMessages().catch()` confirmed fire-and-forget pattern |
| 2 | GET /api/observations returns paginated JSON with agent/time/project/search filtering | PARTIAL | Agent (single), time range, project filters work; FTS5 (?q=) returns HTTP 500; multi-agent array returns HTTP 500 |
| 3 | Full-text search via FTS5 works on observation content | FAILED | `observations_fts` virtual table never created — readonly DB rejects CREATE; table missing at query time; confirmed via Docker logs |
| 4 | User can navigate between Health and Observations pages via top nav bar | VERIFIED | NavBar component wired in App.tsx BrowserRouter; user confirmed working at localhost:3032 |
| 5 | Observations page shows filterable, paginated list from REST API | VERIFIED | 108 observations confirmed by user and live API spot-check |
| 6 | User can filter by agent, time range, project, and full-text search | PARTIAL | Single-agent and time range filters confirmed working; multi-agent (2-3 selected) returns 500; FTS search returns 500 |
| 7 | Clicking an observation card expands to show full content | VERIFIED | User confirmed; ObservationCard uses Collapsible with expand/collapse; accordion managed by parent expandedId state |

**Score:** 5/7 truths verified (2 partial/failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/enhanced-transcript-monitor.js` | Observation tap in processExchanges | VERIFIED | Import at line 35, _initObservationWriter at line 716, _fireObservation at line 735, tap call at line 3113 |
| `integrations/system-health-dashboard/server.js` | GET /api/observations REST endpoint | VERIFIED | Route at line 163, handler at line 3829, FTS5 attempted at line 3806 |
| `integrations/system-health-dashboard/src/pages/observations.tsx` | ObservationsPage with sidebar filters + content area | VERIFIED | Exports ObservationsPage; fetches from /api/observations; 30_000ms auto-refresh; empty states present |
| `integrations/system-health-dashboard/src/components/nav-bar.tsx` | Top navigation between Health and Observations | VERIFIED | NavBar with useLocation, active indicator, obsCount badge |
| `integrations/system-health-dashboard/src/components/observation-card.tsx` | Expandable observation row | VERIFIED | ObservationCard with Collapsible; agent-colored left border |
| `integrations/system-health-dashboard/src/components/agent-badge.tsx` | Colored agent identifier badge | VERIFIED | AGENT_COLORS map for claude/copilot/opencode/mastra |
| `integrations/system-health-dashboard/src/components/observation-filters.tsx` | Filter sidebar with controls | VERIFIED | ObservationFilters with agent checkboxes, time range, project select, search input, Apply Filters |
| `integrations/system-health-dashboard/src/components/pagination-bar.tsx` | Page navigation controls | VERIFIED | PaginationBar with Prev/Next and ellipsis |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/enhanced-transcript-monitor.js` | `src/live-logging/ObservationWriter.js` | import + processMessages() call | WIRED | Import line 35; _fireObservation calls processMessages().catch() |
| `integrations/system-health-dashboard/server.js` | `.observations/observations.db` | better-sqlite3 query | WIRED | _getObservationsDb() opens DB via join(codingRoot, '.observations/observations.db') |
| `integrations/system-health-dashboard/src/pages/observations.tsx` | `http://localhost:3033/api/observations` | fetch with query params | WIRED | Line 77: fetch(`${API_BASE_URL}/api/observations?${qs}`) |
| `integrations/system-health-dashboard/src/App.tsx` | `src/pages/observations.tsx` | react-router-dom Route | WIRED | Route path="/observations" element={ObservationsPage} at line 23 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/pages/observations.tsx` | observations (state) | fetch /api/observations | Yes — 108 records from SQLite | FLOWING |
| `server.js` handleGetObservations | data rows | SQLite observations table via better-sqlite3 | Yes — `SELECT ... FROM observations` with real query | FLOWING |
| `nav-bar.tsx` | obsCount | fetch /api/observations?limit=0 | Yes — returns total=108 | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| GET /api/observations returns {data, total, limit, offset} | curl localhost:3033/api/observations?limit=3 | keys: data,total,limit,offset; total: 108 | PASS |
| ObservationWriter.js is importable | node -e "import('./src/live-logging/ObservationWriter.js')" | OK | PASS |
| FTS5 search (?q=code) returns results | curl localhost:3033/api/observations?q=code&limit=3 | HTTP 500 — "no such table: observations_fts" | FAIL |
| Multi-agent filter (?agent=claude&agent=mastra) works | curl "localhost:3033/api/observations?agent=claude&agent=mastra&limit=3" | HTTP 500 — "agent.split is not a function" | FAIL |
| /api/observations/projects endpoint works | curl localhost:3033/api/observations/projects | [] (empty — project field is null for all current observations) | PASS (correct behavior when project not set) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LIVE-01 | 23-01-PLAN.md | Enhanced-transcript-monitor produces mastra observations in real-time alongside verbatim LSL (additive, not replacing) | SATISFIED | ETM imports ObservationWriter, fires _fireObservation() per exchange without await; 108 observations in DB confirm it ran successfully |
| LIVE-02 | 23-01-PLAN.md, 23-02-PLAN.md | Observations are browsable via REST endpoint on the health dashboard | PARTIAL | REST endpoint exists and serves 108 obs; UI confirmed working by user; FTS5 and multi-agent filter paths broken |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `integrations/system-health-dashboard/server.js` | ~3803 | `new Database(dbPath, { readonly: true })` followed by CREATE VIRTUAL TABLE | Blocker | FTS5 table never created; ?q= search returns 500 |
| `integrations/system-health-dashboard/server.js` | ~3844 | `agent.split(',')` without Array.isArray guard | Warning | Multi-agent filter (2-3 agents) returns 500; single-agent and all-agents work |

### Human Verification Required

#### 1. Dashboard UI Confirmation (already done)

**Test:** Open http://localhost:3032 and navigate to /observations
**Expected:** 108 observations visible, agent-colored cards (claude=blue, copilot=green, mastra=fuchsia), NavBar badge showing count
**Why human:** User has already confirmed this. Recorded here for completeness.

#### 2. Multi-Agent Filter Post-Fix

**Test:** After fixing the `agent.split` Array.isArray issue, uncheck two agents (e.g. opencode and mastra), apply filters, verify remaining two agents display
**Expected:** Results show only claude and copilot observations with correct total
**Why human:** Requires interaction with filter UI to exercise the 2-agent code path

### Gaps Summary

Two gaps block full goal achievement:

**Gap 1 — FTS5 Search Broken (Blocker)**
The FTS5 virtual table `observations_fts` cannot be created on a readonly database connection. The server opens the DB with `readonly: true` (correct for a reader), then tries to `CREATE VIRTUAL TABLE` on it — SQLite rejects this. The error is caught and logged but not fatal to init, so the server starts fine. However, any request with `?q=` hits `no such table: observations_fts` and returns HTTP 500.

Root fix: `ObservationWriter.init()` should create the FTS5 table on its writable connection. The dashboard server can then use it read-only.

**Gap 2 — Multi-Agent Array Filter Bug (Warning)**
When the frontend sends `?agent=claude&agent=mastra`, Express parses `req.query.agent` as `['claude', 'mastra']` (an array). The server code does `agent.split(',')` which throws `TypeError: agent.split is not a function`. The common paths (all agents = no param sent, single agent = string param) work. Only the 2-3 agent selection fails.

Root fix: `const agents = Array.isArray(agent) ? agent : agent.split(',');`

Note: The user confirmed the dashboard works correctly for browsing the 108 existing observations. Both gaps affect search/filter edge cases rather than core display functionality. The primary phase goal — real-time observations generated during sessions AND browsable from the dashboard — is substantially achieved. The two gaps affect the FTS5 search feature and multi-agent filtering.

---

_Verified: 2026-04-05T06:55:00Z_
_Verifier: Claude (gsd-verifier)_
