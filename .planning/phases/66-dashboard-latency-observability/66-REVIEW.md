---
phase: 66-dashboard-latency-observability
reviewed: 2026-06-21T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.test.ts
  - integrations/system-health-dashboard/src/pages/token-usage.tsx
  - integrations/system-health-dashboard/src/components/llm-latency-tile.tsx
  - integrations/system-health-dashboard/src/components/system-health-dashboard.tsx
  - integrations/system-health-dashboard/src/components/health-status-card.tsx
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 66: Code Review Report

**Reviewed:** 2026-06-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the Phase 66 dashboard latency observability changes: the per-model
`p50_latency_ms` median query added to `getSummary()` in the rapid-llm-proxy
token-usage layer, its unit suite, and the four React surfaces that render it
(the Token Usage by-model "Median Latency" column, the new `LlmLatencyTile`
headline tile with 1h-window fetch + client-bucketed sparkline, the
`health-status-card` `reference`/`unknown` status additions and `badgeLabel`
override, and the tile registration in `system-health-dashboard.tsx`).

The headline requirements hold up under scrutiny:

- **SQL injection (p50 median):** PASS. The new median query
  (`token-usage.ts:826-832`) binds `model`, `since`, and `offset` as `?`
  parameters — nothing is interpolated. SQLite accepts `LIMIT 1 OFFSET ?` with
  a bound integer.
- **Never-throw on empty/young DB:** PASS. The p50 loop is wrapped in its own
  `try/catch` (`825-845`), `count <= 0` rows are skipped, and an absent median
  simply leaves `p50_latency_ms` off the row. Test 2 asserts the empty-DB path
  returns `by_model: []` without throwing.
- **Median convention:** PASS. `Math.floor((count - 1) / 2)` yields lower-mid
  for even counts and the true middle for odd counts, matching the client-side
  `median()` in `llm-latency-tile.tsx:124-128` and the test's asserted `3000`.
- **Tile fetch is same-origin:** PASS. `llm-latency-tile.tsx:211-212` fetches
  `/api/token-usage/*` (relative), NOT `http://localhost:12435`, so it rides
  server.js's reverse proxy as required by D-01/66-PATTERNS.
- **Effect cleanup / polling leak (tile):** PASS. The tile's `useEffect` uses a
  `cancelled` flag plus `clearInterval` in cleanup; empty dependency array means
  the interval is created once.

No blocking defects found. The warnings below concern a pre-existing SQL
interpolation pattern that the new median code sits adjacent to, a count/window
coupling fragility, a sparkline-vs-headline data-source divergence, and a
cross-surface `since`-clamping behaviour that can mislead the 1h tile.

## Warnings

### WR-01: Unbound `bucketSeconds` interpolated directly into 4 SQL statements

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:859, 888, 916, 943`
**Issue:** Four bucketing queries interpolate `${bucketSeconds}` straight into
the SQL string rather than binding it:
```js
SELECT (strftime('%s', timestamp) / ${bucketSeconds}) * ${bucketSeconds} AS bucket_sec, ...
```
`bucketSeconds = Math.max(1, opts.bucketMinutes ?? defaultBucketMinutes(hours)) * 60`.
This is pre-existing code (not added in Phase 66), but the new per-model median
work sits inside the same `getSummary()` and inherits the risk. `opts.bucketMinutes`
originates from the dashboard's `?bucketMinutes=` query param at the HTTP layer.
`Math.max(1, x)` does NOT coerce to an integer or reject non-numeric input — if a
caller passes a non-numeric value that survives parsing as `NaN`, the literal
`NaN` is interpolated into the SQL (`/ NaN`), producing a malformed/garbage query
rather than a parameterized failure. It is not a classic string-injection vector
(the value can't carry SQL once it's a JS number), but it is an unvalidated value
reaching the query text.
**Fix:** Validate/floor to a positive integer before use, and prefer binding:
```js
const bucketMinutes = Math.max(1, Math.floor(Number(opts.bucketMinutes) || defaultBucketMinutes(hours)));
const bucketSeconds = bucketMinutes * 60;
// then bind: `... strftime('%s', timestamp) / ? ...` with bucketSeconds as a param,
// or at minimum keep the Math.floor(Number(...)) guard so NaN can never reach SQL.
```

### WR-02: p50 median couples OFFSET to a separately-computed COUNT — silent skew if the two queries ever diverge

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:833-842`
**Issue:** The median's `OFFSET (count-1)/2` is derived from `row.calls`, which
comes from the **`by_model`** aggregate (`COUNT(*)` over `WHERE timestamp >= ?
GROUP BY model`). The median's own statement re-selects with `WHERE model = ?
AND timestamp >= ?`. Today these two predicates produce identical row sets so the
offset is correct, but the correctness is implicit: any future edit that adds a
filter to one query and not the other (e.g. excluding `latency_ms = 0` cold
spawns from one path) silently shifts the OFFSET off the true median with no
error. Because both are best-effort, the bug would surface as a wrong number on
the dashboard, not a crash.
**Fix:** Compute the count inside the same statement context, e.g. derive offset
from `COUNT(*)` over the identical predicate, or add a guard asserting the median
statement's own row count matches `count` before trusting the offset. At minimum,
add a code comment binding the two predicates together as an invariant so a future
editor knows they must stay in lock-step.

### WR-03: Tile headline number and its sparkline are computed from two different data sources that can disagree

**File:** `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx:226-253`
**Issue:** The headline median (`m.p50_latency_ms`) comes from the **server's 1h
summary** query, while the trend sparkline (`buildSparkline`) is computed
**client-side from the `/recent` feed** (capped at 500 rows). For a busy hour the
500-row cap may not span the full window, so the sparkline's overall level — and
especially its final bucket — can differ materially from the headline number the
badge colors against. An operator reading "Regressed (red)" next to a sparkline
whose visible points sit under 3s will see a contradiction. The comment at
lines 36-40 acknowledges the 500-row truncation but not the resulting headline/
trend mismatch.
**Fix:** Either (a) derive the headline median from the same in-window `/recent`
rows used for the sparkline so both agree, or (b) add a one-line caveat in the
tile legend that the sparkline is a sampled trend (last ≤500 calls) and may not
reflect the full-window median. Option (a) also removes the dependency on the
server p50 for the tile entirely.

### WR-04: 1h tile median is silently widened when the DB's earliest row is <1h old

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:774-779` (consumed by the tile via `hours=1`)
**Issue:** `getSummary()` clamps `since` to `Math.max(rawSince, earliestMs)`.
For the tile's `hours=1` request this is harmless when data exists, but the clamp
direction means `since` can never be *narrower* than the requested 1h — it only
ever moves the window-start *forward* to the earliest row. The 66-02 enhancement
comment (tile, lines 20-30) justifies the 1h window specifically to age out
stale pre-worker-pool history; however the headline p50 is still computed over
"all in-window rows for the model including cold spawns" (D-06, comment at
`token-usage.ts:819-820`). A burst of cold-spawn outliers inside the last hour
will pull the median up and flip the badge to red even though warm calls are
≤3s — the exact failure mode the 1h window was meant to avoid, just on a shorter
horizon. This is a design-intent gap rather than a code bug, but it undermines
the stated rationale and is worth flagging before it generates false "Regressed"
alerts.
**Fix:** Confirm with the phase owner whether cold-spawn rows should be excluded
from the tile's headline median (the sparkline already smooths via per-bucket
medians). If cold spawns must stay, document that the 1h tile can still read red
on a cold-spawn burst so operators don't treat it as a hard regression signal.

## Info

### IN-01: `error` state in TokenUsagePage is set but its content is generic and can mask the real failure

**File:** `integrations/system-health-dashboard/src/pages/token-usage.tsx:309-310`
**Issue:** The `catch` swallows the real error and always sets the same string
("Check that the LLM proxy is running on port 12435"), even when the failure is
a non-OK HTTP status from a reachable proxy (e.g. a 500 from the new p50 path).
The actual `err` is discarded, making field debugging harder.
**Fix:** Include the caught message in dev, e.g.
`setError(\`Failed to load token usage: ${err instanceof Error ? err.message : 'unknown'}\`)`,
or log `err` to the console/Logger before replacing it with the user-facing string.

### IN-02: Hardcoded `PROXY_BASE = http://localhost:12435` in the Token Usage page

**File:** `integrations/system-health-dashboard/src/pages/token-usage.tsx:18-19`
**Issue:** Unlike the new tile (which correctly uses same-origin
`/api/token-usage/*`), the Token Usage page still hardcodes the proxy host:port.
This is pre-existing and out of Phase 66's stated change set, but it is the exact
anti-pattern the tile was written to avoid (66-PATTERNS Redux caveat). When the
page is container-served at :3032 the absolute `localhost:12435` only works
because the operator's browser runs on the same host; it will break for any
non-localhost dashboard consumer.
**Fix:** Migrate the page to the same same-origin `/api/token-usage/*` reverse-proxy
path the tile uses, so both surfaces share one transport assumption. Track as a
follow-up if out of scope for 66.

### IN-03: Latency threshold envelope duplicated across three files with no shared constant

**File:** `integrations/system-health-dashboard/src/pages/token-usage.tsx:204-208`, `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx:92-96`
**Issue:** The `≤3000 / ≤5000 / else` threshold logic (`latencyThresholdStatus`
vs `latencyStatus`) and the `isHaikuModel` / `median` helpers are copy-pasted
between the page and the tile. A future tweak to the warm bar (3000ms) must be
made in two places or the two surfaces will disagree — the very inconsistency the
"BOTH surfaces" requirement was meant to prevent.
**Fix:** Extract the thresholds (and `isHaikuModel`, `median`, `formatLatency`)
into a shared module (e.g. `src/lib/latency.ts`) imported by both surfaces.

### IN-04: Test suite never exercises the even-count lower-mid convention it documents

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.test.ts:53-63`
**Issue:** The file header (lines 10-13) and the median comment specifically call
out the LOWER-MID convention for **even** counts, but all three tests seed odd
(5) or single (1) row sets. The even-count branch — the one most likely to be
mis-specified (lower-mid vs upper-mid vs average-of-two) — has no assertion.
**Fix:** Add a test seeding an even set, e.g. `[1000,2000,3000,4000]` (count 4,
offset `(4-1)/2 = 1`), asserting `p50_latency_ms === 2000` (lower-mid), to lock
the convention against regression.

### IN-05: `buildSparkline` returns variable-length arrays, decoupling X positions from real time

**File:** `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx:146-149`
**Issue:** Empty buckets are `.filter`ed out before rendering, so the sparkline's
horizontal axis is "Nth non-empty bucket", not elapsed time. Two models with
different traffic gaps render lines whose X-spacing means different things, and a
quiet stretch followed by a spike draws as a steep adjacent rise rather than a
gap-then-spike. The comment frames dropping empties as intentional (avoid a
misleading dip to zero), which is reasonable, but the resulting non-uniform time
axis is an undocumented trade-off.
**Fix:** Either keep all `SPARK_BUCKETS` slots and render gaps as breaks in the
path (null-segment the SVG), or add a comment noting the X-axis is ordinal
(non-empty buckets) not temporal, so a future reader doesn't assume even spacing.

---

_Reviewed: 2026-06-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
