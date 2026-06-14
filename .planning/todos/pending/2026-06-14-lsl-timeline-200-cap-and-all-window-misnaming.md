---
created: 2026-06-14T13:45:00.000Z
title: LSL timeline strip silently truncates history — 200-record cap + "all" window is only 365 days
area: unified-viewer / LSL timeline strip / dashboard backend endpoint
relates_to_phase: 56.1 (surfaced 2026-06-14 — out of scope of 56.1 bidirectional bridge)
resolves_phase: 61
files:
  - integrations/unified-viewer/src/panels/coding/useLslSessions.ts (WINDOW_MS at line 29-34, limit=200 in fetchSessions at line 49)
  - integrations/system-health-dashboard/server.js (or wherever GET /api/coding/lsl/sessions is implemented — needs verification)
  - integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx (auto-slide logic and ageMs comparison against WINDOW_MS use the cap)
related_todos:
  - 2026-06-14-online-pipeline-semantic-edges-and-timeline-bi-source.md (also touches LslTimelineStrip)
---

## Problem

Operator reports seeing "no data prior to May 27" in the LSL timeline strip at `localhost:5173/viewer/coding`, despite having ingested batch mode for over a year. Investigation:

- Disk has **22,583 LSL session files** in `.specstory/history/` going back to **2025-06-16** (i.e. just under 12 months of data).
- Distribution: 2025-09 (279), 2025-10 (878), 2025-11 (548), 2025-12 (2,355), 2026-01 (8,443), 2026-02 (2,513), 2026-03 (1,529), 2026-04 (3,573), 2026-05 (1,470), 2026-06 (143 so far).
- Knowledge graph has nodes back to 2025-06-16 (oldest createdAt) — confirmed via `jq '[.nodes[] | .attributes.createdAt] | sort | .[0]' .data/knowledge-graph/exports/general.json`.

## Two distinct issues in `useLslSessions.ts`

### Issue 1 — `limit=200` hard cap in `fetchSessions`

```ts
const url = `${apiClient.base}/api/coding/lsl/sessions?since=${encodeURIComponent(since)}&limit=200`
```

Regardless of window selection, the API request is capped at 200 sessions. When the window contains more than 200 sessions (every recent month has ≥143, most have 1000+), the API silently drops everything older than the 200 most-recent within the `since` window. For a 30d view with ~1,613 sessions in the last 30 days, only the most-recent ~200 show up → cutoff at roughly May 27.

### Issue 2 — `'all'` window is actually 365 days

```ts
export const WINDOW_MS: Record<LslWindow, number> = {
  '24h': 24 * 3600_000,
  '7d':  7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  'all': 365 * 24 * 3600_000,   // ← misnamed
}
```

The label `all` implies all-time but the value is exactly 365 days. With the earliest LSL file at 2025-06-16 and today at 2026-06-14, the 365-day cap would JUST barely include the oldest file — but combined with the 200-cap, anything older than the most-recent 200 in that year-long window is dropped.

## How surfaced

During Phase 56.1 visual smoke on 2026-06-14. Operator clicked through the timeline and noticed sparse coverage before May 27 despite over a year of ingestion history.

## Fix outline

Two-part change:

**Part A — Timeline cap removal/paging:**
- Raise `limit=200` to a much higher ceiling (e.g. 5000) OR implement cursor-based pagination so the timeline can render all sessions in the visible window without silent truncation
- Backend endpoint `/api/coding/lsl/sessions` may also have its own internal cap — verify and raise

**Part B — Rename or redefine `'all'`:**
- Option (i): rename to `'1y'` to be honest about the 365-day cap; add a new `'all'` that uses `Infinity` (or a year-back-from-oldest-on-disk computation)
- Option (ii): keep the label `'all'` and change the value to `Infinity` (request all sessions; let the cap-removal in Part A do the limiting)

## Acceptance

- Operator selects "all" timeline scale and sees ticks back to 2025-06-16 (the earliest LSL file on disk)
- Operator selects 30d and sees all sessions in the last 30 days, not just the most-recent 200
- 24h and 7d windows are unaffected (already small enough that the cap doesn't bite)
- The `useLslSessions` hook documents the new cap explicitly + the meaning of `'all'`

## Side note — sparse graph node history is a separate issue

The km-core graph has only **13 nodes from 2025-06**, then a gap until **629 nodes spawned in 2026-03**, suggesting the batch wave-analysis pipeline either: (a) was only run a few times against older LSL files, or (b) had a similar windowing cap that ignored older sessions. This is upstream of the timeline cap and would need separate investigation in `mcp-server-semantic-analysis` to determine whether ingestion-coverage retroactive backfill is desired.
