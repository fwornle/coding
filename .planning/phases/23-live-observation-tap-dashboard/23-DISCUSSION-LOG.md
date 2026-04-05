# Phase 23: Live Observation Tap & Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-04
**Phase:** 23-live-observation-tap-dashboard
**Areas discussed:** ETM observation trigger, Non-blocking guarantee, Dashboard REST design, Dashboard UI placement

---

## ETM Observation Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Per exchange | observe() after each user→assistant exchange | ✓ |
| Time-window batch | Buffer and observe() every N minutes | |
| Session end only | observe() once at session close | |

**User's choice:** Per exchange
**Notes:** Most useful for live browsing. Higher LLM cost acceptable.

---

## Agent Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All agents | Every coding --<agent> produces observations | ✓ |
| Claude + Mastra only | Only primary agents | |
| Configurable per agent | Config flag per agent | |

**User's choice:** All agents

---

## Non-Blocking Guarantee

| Option | Description | Selected |
|--------|-------------|----------|
| Fire-and-forget async | processMessages() without await | ✓ |
| Separate worker thread | Node worker_thread isolation | |
| External queue process | Queue file + consumer process | |

**User's choice:** Fire-and-forget async
**Notes:** Simplest approach, ETM already uses async patterns.

---

## REST API Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Agent + time + project | Basic filters | |
| Full-text search + filters | FTS5 content search + all filters | ✓ |
| Minimal list all | Client-side filtering | |

**User's choice:** Full-text search + filters

---

## API Host

| Option | Description | Selected |
|--------|-------------|----------|
| Health API at :3033 | Add routes to existing server | ✓ |
| Separate API server | New port :3034 | |

**User's choice:** Health API at :3033

---

## UI Placement

| Option | Description | Selected |
|--------|-------------|----------|
| New Observations page | Dedicated /observations page | ✓ |
| Tab on Sessions page | Additional tab | |
| Sidebar panel | Collapsible sidebar | |

**User's choice:** New Observations page

---

## Display Format

| Option | Description | Selected |
|--------|-------------|----------|
| Summary + metadata | Text, agent icon, timestamp, project, expandable | ✓ |
| Compact one-liner | First line + timestamp + badge | |
| Card with context | Full text + source exchange + tags | |

**User's choice:** Summary + metadata

---

## Claude's Discretion

- FTS5 table schema
- Observation detail panel layout
- Auto-refresh strategy
- Navigation badge for observation count
