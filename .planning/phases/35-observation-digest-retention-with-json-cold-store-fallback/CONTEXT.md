# Phase 35: Observation & Digest Retention with JSON Cold-Store Fallback — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** User-provided scope (skipped discuss-phase — requirements are well-defined and concrete).

---

## Problem statement

The SQLite store at `.observations/observations.db` accumulates observations and digests without bound. Current state: **1,659 observations / 623 digests / 61 insights**. The dashboard at `localhost:3032` typically displays a 7-day window (verified — defaults to 08.05.2026 → 15.05.2026 in the date pickers), so the vast majority of rows in SQLite are never touched by interactive reads. The existing `ObservationExporter` already mirrors all three tables to JSON every 10s under `.data/observation-export/` (`observations.json`, `digests.json`, `insights.json`), so the cold tier is **already available** — this phase adds a read path against it and a pruner that removes the duplicated hot-tier rows.

Insights are excluded from pruning — they are the long-term memory consumed by the prompt-injection hook (Phase 30/30.1/31). Truncating them would degrade prompt context quality.

## Locked decisions

| ID | Decision | Source |
|----|----------|--------|
| L1 | Default retention window: **7 days**, matching the dashboard's default From/To picker spread. | User scope |
| L2 | Retention applies to `observations` and `digests` ONLY. `insights` is untouched. | User scope |
| L3 | Dashboard queries crossing the retention boundary serve recent rows from SQLite plus historical rows from `.data/observation-export/*.json`, merged and sorted by `created_at`. | User scope |
| L4 | Pruner must enforce a minimum retention floor > 4h. The dedup window in `_isSemanticallyDuplicate` (`src/live-logging/ObservationWriter.js:624`) reads the last 4h; pruning into that window would break dedup correctness. | Invariant — flagged during scoping |
| L5 | No change to JSON export schema or 10s cadence (`ObservationExporter`, `ObservationWriter.js:540-543`). The cold-store format is consumed as-is. | User scope |
| L6 | Cold-store reads are read-only. Never write back into SQLite from JSON (avoids re-firing dedup or duplicating IDs). | Invariant |

## Claude's discretion (gray areas the planner must resolve)

| ID | Question | Notes |
|----|----------|-------|
| G1 | Where to centralize the "fetch from JSON for older-than-retention" logic — in `obs_api` (so all callers benefit) or only in the dashboard's `server.js`. | Recommendation: `obs_api`, since it already owns `single-owner-rw` role on the DB. Dashboard becomes a thin reader. |
| G2 | LRU cache for parsed JSON-by-day. | Recommendation: yes, small (~16 entries) keyed by `YYYY-MM-DD`. Parsing a 1,659-row JSON once per dashboard refresh is fine; parsing on every paginated scroll is not. |
| G3 | Pruner schedule and host. | Options: (a) in-process `setInterval` inside `obs_api` (simplest, restart-safe via launchd KeepAlive); (b) external launchd job. **Recommendation (a)** — keeps everything in one supervised process. Interval: 1h. |
| G4 | Pruning atomicity. | Single `DELETE WHERE created_at < ?` transaction per table is fine — both tables fit in a few MB. No batched-delete loop required at current scale. |
| G5 | Configuration surface. | Add `retentionDays` to `.observations/config.json` under `defaults.observation`. Loaded by `ObservationWriter` and the pruner. Validate `>= 1` (24h floor; >4h dedup invariant satisfied trivially). |
| G6 | Dashboard widening UX. | When user sets `From` older than retention, surface a subtle indicator that data is being served from cold storage (slower). Not a blocker — just a hint. |

## Files touched (anticipated)

| Path | Change |
|------|--------|
| `.observations/config.json` | Add `retentionDays` setting under `defaults.observation`. |
| `src/live-logging/ObservationWriter.js` | Read `retentionDays`; expose it. (Minimal change.) |
| `src/live-logging/ObservationPruner.js` (CREATE) | Module owning the prune cycle. Imports DB handle from caller, runs `DELETE FROM observations WHERE created_at < datetime('now', ?)` and same for `digests`. |
| `src/live-logging/ColdStoreReader.js` (CREATE) | Module that reads `.data/observation-export/{observations,digests}.json`, indexes by date with an LRU, returns rows in a `[start, end)` range. |
| `scripts/observations-api-server.mjs` | Wire pruner on startup (1h interval). Extend `GET /observations` / `GET /digests` (or add `/observations/range`, `/digests/range`) to range-merge SQLite + cold store when `from` is older than the retention boundary. |
| `integrations/system-health-dashboard/server.js` | Forward dashboard range queries to obs_api's range-aware endpoints. |
| `integrations/system-health-dashboard/` (frontend) | Optional: cold-store indicator (G6). |

## Invariants the planner must preserve

1. **Dedup safety**: never prune rows newer than `max(4h + epsilon, retentionDays-derived cutoff)`. The pruner must defensively compute the cutoff with this floor.
2. **Insights immutability**: zero DELETE/UPDATE against the `insights` table from this phase's code.
3. **No double-counting**: in any range query, a given observation `id` must appear exactly once. Since the JSON export contains *all* rows including currently-hot ones, the merge logic must filter cold-store rows by `created_at < retention_boundary` (or by `id NOT IN (sqlite_ids)`) to avoid duplicates.
4. **Export cadence stays at 10s**: do not assume the JSON is more current than 10s. For queries that include the most-recent 10s, only SQLite is authoritative.
5. **SafeDatabase contract**: prune transactions go through the existing `openDatabase` handle. No raw `better-sqlite3` access.
6. **Container restart contract**: backend changes need `docker-compose restart coding-services`; the obs_api launchd job needs `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api`. Plan must call this out in verification steps.

## Verification expectations

- Unit-level: pruner test that seeds N obs/digests across a 14-day spread, runs prune at 7d retention, asserts only `<=7d` rows remain AND `insights` unchanged.
- Integration: cold-store reader test that parses a fixture JSON and returns the correct slice for a `[from, to)` range crossing the boundary.
- Live: dashboard query for `From = 30d ago` returns the same row IDs as a snapshot of the JSON exports (modulo ordering), with no duplicates against SQLite.
- Dedup-invariant guard: a unit test that asserts the configured `retentionDays` translates to a cutoff > 4h ago.

## Open requirement references

- v7.0 milestone (Health Monitoring Consolidation) — Phase 35 contributes to bounded host-side storage growth, complementing Phases 33-34's coordinator-as-SoT model.
- No ADRs or PRDs apply; this is a pragmatic operational feature.
