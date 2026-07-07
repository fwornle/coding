---
phase: 83-token-reconciliation-layer
reviewed: 2026-07-07T09:40:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/agent-envelope-passthrough.test.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/openai-cache-parse.test.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-dupid-constraint.test.mjs
  - config/agents/copilot.sh
  - config/experiments/wire-verify-83-reconcile.yaml
  - lib/lsl/token/reconcile.mjs
  - lib/lsl/token/stop-adapter-registry.mjs
  - lib/lsl/token/token-db.mjs
  - lib/vkb-server/api-routes.js
  - scripts/launch-agent-common.sh
  - scripts/measurement-stop.mjs
  - tests/token-adapters/reconcile-matcher.test.js
  - tests/token-adapters/reconcile-mode.test.js
  - tests/vkb-server/reconciliation-route.test.js
findings:
  critical: 1
  warning: 11
  info: 14
  total: 26
status: issues_found
---

# Phase 83: Code Review Report (Re-Review after Plan 83-09 Gap Closure)

**Reviewed:** 2026-07-07T09:40:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Re-review after Plan 83-09 (coding `d40a4aaca`, proxy `9f9ab3d`/`4b68681`) closed
the two blockers from the 2026-07-06T14:31Z review. **Both prior fixes are
verified sound in their target scenarios:**

- **Prior CR-01 (fuzzy matches loop-inserted fallback rows / double-consume) —
  FIXED for the single-hash case.** `fuzzyMatch` now honors
  `opts.candidateWireIds` (pre-loop PK snapshot) and `opts.consumedWireIds`
  (live matched set, passed by reference) — `lib/lsl/token/reconcile.mjs:143-144`,
  threaded from `reconcileBatches` at `lib/lsl/token/stop-adapter-registry.mjs:516,535`.
  The request-id probe stays deliberately unscoped (safe: the partial-unique index
  gives ≤1 row per `(user_hash, tool_call_id)` and a fallback row never carries a
  later turn's request-id). Regression tests `CR-01/proxy-down` (fallback=2,
  matched=0 — golden property 2 restored) and `CR-01/double-consumption`
  (matched=1, fallback=1) pass; the full 38-test suite is green.
- **Prior CR-02 (copilot wire rows lacked `copadt`) — FIXED.** The `/api/complete`
  `logTokenCall` now stamps `user_hash: adapterUserHash(body.agent)` when
  `body.agent` is non-empty (`server.mjs:2717-2719`), mirroring the `/v1/messages`
  tap (`:2217`). Every shim route sets a non-empty agent
  (header > body > path-default, `:2273-2314`), so copilot BYOK wire rows land
  `copadt` and the coding-side `snapshotWireRowIds` sees them; omitted-agent
  direct callers keep the machine hash (verified: no coding-side `/api/complete`
  caller sends `agent`). Proxy row-contract test (d) and the coding-side
  `CR-02/copilot-orphan` / `CR-02/copilot-healthy` tests pass.

**One new blocker.** The CR-01 scoping keys row identity on the **bare `id`
column, which is not unique** — the table's PK is composite `(user_hash, id)`.
A different-hash row with the same numeric id passes the snapshot filter. I
reproduced this end-to-end (PoC): a claude measured span fuzzy-consumed a
**copadt** row from a different task, marked the real cladpt wire row consumed,
reported `unmatched_wire=0` (truth: 1), and silently dropped the transcript
turn's tokens. See CR-01 below.

The CR-02 fix also has two knock-on effects (new WR-09, WR-10) and the prior
warnings/infos not addressed by 83-09 are carried forward with fresh line
references. Prior IN-12 is escalated to WR-11 because the CR-01 scoping now
actively feeds the snapshot's `task_id=''` rows into fuzzy matching where the
CR-03 backfill can stamp them.

## Critical Issues

### CR-01: Wire-row identity keyed on non-unique bare `id` — cross-hash id collision defeats the fuzzy scoping, the consumed-set, and the unmatched_wire diff (PoC-verified)

**File:** `lib/lsl/token/stop-adapter-registry.mjs:511,550,585-589,614-632`, `lib/lsl/token/reconcile.mjs:71-74,143-144,151,323`, `lib/lsl/token/token-db.mjs:235-238`

**Issue:** The table's identity is the composite PK `(user_hash, id)` — each
adapter hash has its own `MAX(id)+1` sequence, so `cladpt` id=1 and `copadt`
id=1 (and machine-hash ids) coexist by design (D-11). But every 83-09 identity
structure uses the bare integer `id`:

- `snapshotWireRowIds` returns `Set(r.id)` (`stop-adapter-registry.mjs:622-624`);
- `FUZZY_CANDIDATES_SQL` selects candidates across **all** hashes and filters
  with `candidateWireIds.has(c.id)` / `consumedWireIds.has(c.id)`
  (`reconcile.mjs:137-144`);
- `matchedWireRowIds.add(result.wireRowId)` and the post-loop diff
  `wireRowIds \ matchedWireRowIds` (`stop-adapter-registry.mjs:550,585-589`)
  compare those same bare ids.

A row under a **different** user_hash whose numeric id collides with a snapshot
row's id therefore (a) passes the fuzzy candidate filter, (b) when matched,
marks the *legitimate* snapshot row as consumed, and (c) hides the legitimate
row from the unmatched_wire diff. Reproduced (PoC, temp DB, production shapes):
cladpt wire row `(cladpt, id=1, req-wire-only, task=recon-task)` + concurrent
copadt row `(copadt, id=1, same model, in-window, task=other-copilot-task)`;
one claude transcript turn with an unmatched request-id. Result:

```
report: matched=1 fallback=0 unmatched_wire=0
perRequest[0]: method=fuzzy, deltas vs the COPADT row (wire=999 vs transcript=100)
```

The turn "matched" the copilot session's row (its tokens were never inserted —
silent loss), `reconcileGapFill` was aimed at the copadt row's `tool_call_id`,
and the genuine cladpt wire row was reported as matched instead of orphaned.
Because cladpt/copadt/opcadt sequences all count 1..N from similar epochs,
numeric overlap is near-certain; the remaining preconditions (same model,
in-window timestamp, a fuzzy-path turn) are exactly the concurrent multi-agent
measurement scenario this milestone targets. The invariant 83-09 claims
("fuzzy can only land on a snapshot row not already consumed") does not hold.

**Fix:** Key row identity on `rowid` (the table is a rowid table — the D-11
migration repair already uses it) end-to-end:

```sql
-- token-db.mjs RECONCILE_PROBE_SQL / reconcile.mjs FUZZY_CANDIDATES_SQL
SELECT rowid AS rid, id, tool_call_id, model, timestamp, ... FROM token_usage ...
-- stop-adapter-registry.mjs snapshotWireRowIds
SELECT rowid AS rid, tool_call_id, timestamp, task_id FROM token_usage WHERE user_hash = ? ...
```

```js
// reconcile.mjs fuzzyMatch / reconcileRow: use c.rid / wireRow.rid
if (candidateWireIds && !candidateWireIds.has(c.rid)) continue;
if (consumedWireIds && consumedWireIds.has(c.rid)) continue;
...
wireRowId: wireRow.rid ?? null,
```

(Alternatively key on the composite string `` `${user_hash}:${id}` `` — but
`rowid` is simpler and also fixes the IN-02 ordering nit.) Add a regression
test seeding a same-numeric-id different-hash row (the PoC above is directly
convertible).

## Warnings

### WR-01: `:reason:N` rows bypass the span-window clamp in reconcile mode — whole-session reasoning over-attribution

**File:** `lib/lsl/token/stop-adapter-registry.mjs:528-531`
**Issue:** (Carried — not addressed by 83-09.) The interactive loop
window-scopes every row (:433); the reconcile loop exempts reason-steps:
`if (!reasonStep && !withinSpanWindow(...)) continue;`. D-02 justifies bypassing
the *match* (the wire never carries a reasoning split), not the *window*.
`buildClaudeTokenRows` returns the whole ambient transcript, so a short measured
span over a long-lived session inserts every out-of-window `:reason:N` row
stamped with the span's task_id. Impact bounded to `reasoning_tokens` (reason
rows carry input/output/total = 0), but it inflates the measured run's reasoning
metric with hours of unrelated thinking.
**Fix:** Apply the window clamp before the `reasonStep` branch (keep the match
bypass): `if (!withinSpanWindow(transcriptRow, span)) continue;`

### WR-02: Fallback insert overwrites the SUBAGENT_PROCESS marker — canonical-model selection can be hijacked in proxy-down runs

**File:** `lib/lsl/token/stop-adapter-registry.mjs:559`
**Issue:** (Carried.) `insertTokenRowDeduped(db, { ...transcriptRow, process: fallbackProcess })`
replaces whatever `batch.process` stamped — for sub-agent batches that is
`token-adapter-claude-subagent`. A proxy-down sub-agent row lands as
`token-adapter-claude-fallback`, so `isSubagentGroup`
(`scripts/measurement-stop.mjs:501`) no longer recognizes it, and a cheap
high-volume Explore sub-agent can win `fgGroups.find(...)` and become the run's
canonical chat model — the exact hijack SUBAGENT_PROCESS exists to prevent.
**Fix:** Compose provenance instead of replacing it (e.g.
`` process: batch.process ? `${fallbackProcess}-subagent` : fallbackProcess ``)
and match sub-agent groups by suffix in the canonical picker.

### WR-03: Proxy `logCall` dedup drops the richer duplicate — diverges from the coding-side merge-on-cache semantics

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:993-996,1016`
**Issue:** (Carried.) On a `(user_hash, tool_call_id)` hit, `logCall` drops the
incoming row even when the existing row is cache-less and the incoming row
carries cache/reasoning — whereas the coding-side `insertTokenRowDeduped`
(`token-db.mjs:331-361`) merges-on-cache in that situation. If a stop-time
transcript row lands first (e.g. proxy restart mid-session), a later tap write
with the real cache split is discarded.
**Fix:** Mirror the merge-on-cache branch (UPDATE cache/reasoning when the
existing row's cache sum is 0), or explicitly document first-writer-wins on the tap.

### WR-04: One-shot dup repair keeps the earliest rowid without merging — cache/reasoning data on the deleted duplicate is lost

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:671-686`
**Issue:** (Carried.) The pre-index repair `DELETE ... WHERE rowid NOT IN
(SELECT MIN(rowid) ... GROUP BY user_hash, tool_call_id)` unconditionally
deletes the later duplicate. When the earlier row is a cache-less transcript row
and the later one the cache-bearing tap row, the cache split is destroyed rather
than merged before deletion.
**Fix:** Before deleting, gap-fill the survivor from the doomed row (cache when
survivor cache sum is 0; `MAX(reasoning_tokens)`), mirroring `MERGE_ON_CACHE_SQL`.

### WR-05: Coding-side `insertTokenRow` still has no id-collision retry — the race D-11 fixed on the proxy side drops adapter rows on the coding side

**File:** `lib/lsl/token/token-db.mjs:132-173`
**Issue:** (Carried.) `insertTokenRow` computes `MAX(id)+1` and does a single
INSERT; a concurrent proxy write into the same adapter hash space (which now
happens by design — the tap stamps `cladpt`, and post-83-09 the shim stamps
`copadt`/`opcadt`/`mstadt`, widening the race surface) between the SELECT and
the INSERT raises `SQLITE_CONSTRAINT` and the row is silently dropped
(`return false`), with no recompute-and-retry equivalent to `logCall`'s D-11 loop.
**Fix:** Wrap the INSERT in a bounded retry that recomputes `MAX(id)+1` on a
constraint error that is not a `(user_hash, tool_call_id)` duplicate — the same
probe-disambiguation `logCall` uses.

### WR-06: Copilot production wire rows carry `tool_call_id=''` — request-id matching, gap-fill, and cache-merge are all no-ops for copilot

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2730-2731` (comment: "tool_call_id/parent_call_id/reasoning_tokens stay unset here")
**Issue:** (Carried.) The `/api/complete` pipeline never sets `tool_call_id`, so
copilot BYOK wire rows have an empty request-id. Consequences: the request-id
probe can never match a copilot wire row (all copilot matching is fuzzy);
`reconcileGapFill` returns false for a fuzzy-matched empty-id wire row
(`token-db.mjs:310`), so the CR-03 task_id backfill and the cache split never
land on copilot wire rows; `wireToolCallId` is falsy so the D-04
`copilotCacheSplit` merge (`stop-adapter-registry.mjs:655-671`) can never apply
in production. The new CR-02 test acknowledges this ("documented, not
asserted", `reconcile-mode.test.js:760-763`) but production remains no-op.
**Fix:** Stamp a per-request id on shim-originated rows (upstream response id or
a generated UUID threaded through `internalBody.tool_call_id`) so copilot wire
rows carry an identity.

### WR-07: `_validTaskId` accepts `'.'` and `'..'` — one-level path escape from `.data/measurements/`

**File:** `lib/vkb-server/api-routes.js:777-779` (used by `handleReconciliation` :614)
**Issue:** (Carried.) The regex `/^[A-Za-z0-9._-]+$/` matches dot-only strings.
`taskId='..'` resolves `path.join(dataDir, 'measurements', '..', 'reconciliation.json')`
→ `.data/reconciliation.json`, outside the intended directory. The docstring
claims it "mirrors the proxy span gate", but the proxy's `sanitizeTaskId`
explicitly rejects `'.'`/`'..'`. Impact bounded (only a file named
`reconciliation.json` one level up), and the test suite
(`tests/vkb-server/reconciliation-route.test.js`) still never probes dot-only ids.
**Fix:**
```js
_validTaskId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 80
    && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}
```

### WR-08: Machine-hash id counter never resynced after a collision retry — every subsequent `logCall` pays a failed INSERT + probe

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:999-1023`
**Issue:** (Carried.) When the first attempt (`handle.nextLocalId()`) collides,
the retry recomputes `MAX(id)+1` from the DB but never updates `_localIdSeq` —
which is now permanently behind (it advances one per call while the DB also
advances one per call, so it never catches up). Every future machine-hash insert
first fails on the composite PK, runs the dedup probe, then retries. Correct but
wasteful and noisy in the constraint-error path.
**Fix:** After a successful retry insert, resync the counter (expose a
`handle.bumpLocalId(id)` or re-run `seedLocalSeq`).

### WR-09: CR-02 stamping silently removes all shim agent traffic from the per-window JSON exports — history lost on any DB reset

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:356-364` (`exportToHourFile` `WHERE ... user_hash = ?` bound to the machine `USER_HASH`), `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2717-2719`
**Issue:** `exportToHourFile` exports only machine-hash rows, and
`hydrateFromExports` restores from those files after a DB wipe. Before 83-09,
`/api/complete` shim rows (copilot BYOK, opencode, mastra — every shim call sets
a non-empty agent) carried the machine hash and were exported; after the CR-02
stamp they carry `copadt`/`opcadt`/`mstadt` and are **never** written to any
export file. The adapter-hash export blind spot previously affected only the
`/v1/messages` cladpt tap; it now covers the bulk of measured agent traffic.
A `.data` wipe / fresh clone (both documented operational events) permanently
loses every agent-attributed wire row while machine-hash daemon rows survive —
silently.
**Fix:** Either export per adapter hash too (the filename convention already
encodes the hash suffix: emit `..._copadt.json` files alongside the machine
file), or document adapter-hash rows as intentionally machine-local and
non-durable.

### WR-10: Copilot reconcile granularity mismatch — healthy spans report `unmatched_wire = N-1`, and an idle-exit session double-counts via aggregate fallback

**File:** `lib/lsl/token/stop-adapter-registry.mjs:487-592` with `lib/lsl/token/copilot-token-rows.mjs` (per-session aggregate rows), `lib/lsl/token/reconcile.mjs:68` (`DEFAULT_FUZZY_WINDOW_MS`)
**Issue:** The copilot transcript adapter emits ONE aggregate row per
(session, model) timestamped at `session.shutdown`, while the (now copadt-visible
per CR-02) wire side has one row per LLM call. Two consequences:
1. A healthy measured copilot span with N wire calls can match at most one wire
   row per transcript aggregate → `unmatched_wire ≈ N-1` on a *correct* run — a
   structurally noisy metric that will read as a matching failure. The
   `CR-02/copilot-healthy` test seeds exactly ONE wire row, so this never
   surfaces in the suite.
2. If the session's last wire call precedes shutdown by more than the 2-min
   fuzzy window (operator idles, then exits), the aggregate row matches nothing
   and is fallback-inserted with the span task_id — the whole session's tokens
   are then counted TWICE for the task (per-call wire rows + the aggregate
   fallback row).
**Fix:** For copilot spans, either suppress the aggregate fallback when the span
window contains ≥1 copadt wire row for the same model (wire is authoritative),
or compare aggregate-vs-SUM(wire) instead of aggregate-vs-single-row; and
compute/report `unmatched_wire` per agent semantics (or document the copilot
N-1 expectation in the sink so property-3-style gates are not applied to copilot).

### WR-11: Snapshot's `task_id=''` arm now feeds concurrent interactive rows into fuzzy matching, where CR-03 stamps them with the span task_id

**File:** `lib/lsl/token/stop-adapter-registry.mjs:619` (`(task_id = ? OR task_id = '')`), `lib/lsl/token/reconcile.mjs:303-314` (gap-fill with `task_id`), `lib/lsl/token/token-db.mjs:267`
**Issue:** (Escalated from prior IN-12 by the CR-01 wiring.) A concurrent
interactive claude session's tap rows carry `task_id=''` (D-08 no-inherit) and
enter the measured span's wire snapshot when in-window. Post-83-09 those rows
are not just an `unmatched_wire` inflation — they are legitimate
`candidateWireIds` members, so an unmatched measured-span turn can fuzzy-match a
concurrent interactive row (same model, within 2 min), report it `matched`,
drop its own tokens, and the CR-03 backfill then stamps the *span task_id* onto
the unrelated interactive row — cross-session attribution capture. The
wire-verify YAML mitigates by mandating UNATTENDED runs, but nothing in code
enforces that.
**Fix:** Restrict the `''` arm to rows whose request-id also appears in the
span transcript (request-id-confirmed), or at minimum exclude `task_id=''` rows
from `candidateWireIds` (keep them in the unmatched_wire snapshot only), so
fuzzy can never bind a neutral row to the span.

## Info

### IN-01: `RECONCILE_GAP_FILL_SQL` updates every row sharing the tool_call_id (no user_hash/rowid scope)

**File:** `lib/lsl/token/token-db.mjs:260-268`
**Issue:** `WHERE tool_call_id = ?` has no `user_hash`/`rowid` bound; the partial
unique index only constrains per-hash, so a same-request-id row under a
different hash is also stamped. The CR-01 PoC showed gap-fill being aimed at a
wrong-hash row's tool_call_id. `reconcileRow` already carries the wire row —
`WHERE rowid = ?` closes this together with CR-01.

### IN-02: `RECONCILE_PROBE_SQL` comment overstates determinism

**File:** `lib/lsl/token/token-db.mjs:230-238`
**Issue:** "ORDER BY id makes the earliest (wire) row the deterministic winner" —
ids are per-user_hash sequences, so cross-hash comparison by bare `id` does not
order by insertion time. Ordering by `rowid` (see CR-01 fix) makes the comment true.

### IN-03: `withinSpanWindow` now duplicated in three places

**File:** `lib/lsl/token/reconcile.mjs:102-110`, `lib/lsl/token/stop-adapter-registry.mjs:342-351` (+ the snapshot reuses the registry copy)
**Issue:** (Carried.) Two module-private copies of the same clamp with different
signatures; a future grace-window change must be made twice. Export one from a
shared location.

### IN-04: Shim/tap degrade a malformed explicit x-task-id to the ambient span

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2030-2036`
**Issue:** (Carried.) A malformed explicit `x-task-id` falls back to
`safeSanitizeTaskId(resolveLiveTaskId())` — the ambient span — the inheritance
behavior D-08 forbids for header-less requests. Falling back to `''` (neutral)
would be safer.

### IN-05: `logCall` re-prepares two statements on every insert

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:983-988`
**Issue:** (Carried.) `nextIdStmt`/`dedupStmt` are prepared per call in the hot
path. Hoist to handle scope like `insertStmt`.

### IN-06: Reconciliation route's ENOENT shape differs from the served-file shape

**File:** `lib/vkb-server/api-routes.js:620-623`
**Issue:** (Carried.) A hit returns the file verbatim
(`{schemaVersion, span, summary, perRequest}`); a miss returns
`{reconciliation: null}` — a different envelope. Consider `204` or one envelope.

### IN-07: Re-close semantics changed — a prior run's fallback rows now satisfy the request-id probe and report as `matched`

**File:** `lib/lsl/token/reconcile.mjs:186-189` with `lib/lsl/token/stop-adapter-registry.mjs:544-559`
**Issue:** (Updated from prior IN-07.) A re-run of reconcile over the same span
finds the first run's fallback-inserted rows via the unscoped request-id probe
(same `tool_call_id`) and reports them `matched` — the sink then overwrites
`reconciliation.json` with a "healthy" report, erasing the fallback evidence of
the original proxy-down close. Currently bounded: the two-phase close marker
(`measurement-stop.mjs:296-313,663-670`) prevents an accidental re-close, and
`stopMeasurement` returns null for an already-archived span. Document, or key
the probe away from `token-adapter-*-fallback` rows.

### IN-08: Sink writes under `sanitizeTaskId(task_id)` while the read route looks up the raw id

**File:** `scripts/measurement-stop.mjs:471-476` vs `lib/vkb-server/api-routes.js:614`
**Issue:** (Carried.) A task_id containing characters `sanitizeTaskId` strips
lands under the sanitized name but the route joins the raw id → permanent
graceful-empty. Latent (experiment ids are charset-safe today); align by
sanitizing in the route too.

### IN-09: Stale test comments still describe the deleted post-loop `unmatched_wire` query

**File:** `tests/token-adapters/reconcile-mode.test.js:26-27,413-415`
**Issue:** (Carried — not fixed by 83-09.) The header and Test 7 banner still say
"counted via the POST-LOOP DB query"; the implementation is a pre-loop PK
snapshot diff. Update the comments.

### IN-10: `num()` coalesces only null/undefined — NaN and strings pass through

**File:** `lib/lsl/token/reconcile.mjs:51-53`, `lib/lsl/token/token-db.mjs:88-90`
**Issue:** (Carried.) `v ?? 0` lets NaN/strings into `computeDeltas` arithmetic
and DB binds. Contrast `usage-cache.ts`'s `Number.isFinite` guard. Fix:
`return typeof v === 'number' && Number.isFinite(v) ? v : 0;`

### IN-11: `unmatched_transcript` and `fallback` are always identical

**File:** `lib/lsl/token/stop-adapter-registry.mjs:557-558`
**Issue:** (Carried.) Both counters increment together in the single no-match
branch — two names for one number, and both increment even when
`insertTokenRowDeduped` returns false (dedup hit). Either document the intended
divergence or make `fallback` count actual successful inserts.

### IN-12: A snapshot query failure now disables fuzzy matching entirely — degraded mode flips from "over-match risk" to "guaranteed fallback double-count"

**File:** `lib/lsl/token/stop-adapter-registry.mjs:626-631` (empty Set on error), `lib/lsl/token/reconcile.mjs:143`
**Issue:** New behavior with the CR-01 scoping: if `snapshotWireRowIds` errors,
`candidateWireIds` is the empty Set and every fuzzy candidate is excluded. For
fuzzy-dependent agents (copilot — WR-06) every transcript row then
fallback-inserts while the wire rows remain → double count under a transient DB
error that the old unscoped code tolerated. Consider passing `null` (unscoped)
instead of an empty Set on snapshot failure, or logging the degradation loudly
in the report.

### IN-13: Proxy row-contract tests mirror server.mjs logic instead of exercising it

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/agent-envelope-passthrough.test.mjs:61-97`
**Issue:** `buildRow` re-implements the server's stamping (including a local
copy of `adapterUserHash`); the suite proves the persistence contract but cannot
catch drift in `server.mjs:2717-2719` itself (e.g. someone removing the spread).
An HTTP-level test against the running daemon (or extracting the row-build into
a shared helper imported by both) would make the CR-02 guarantee structural.

### IN-14: `adapterUserHash` mints a foreground-classified adapter hash for any agent string

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:70-76,2717-2719`
**Issue:** Any `/api/complete` or shim caller sending an arbitrary `agent`
(e.g. `'zzz'`, or `'copilot '` with trailing whitespace on the direct path,
which derives `copilo` instead of `copadt` — body.agent is not trimmed at
`:2706`, only the X-Agent header is) gets a derived 6-char adapter hash and is
classified as adapter/foreground traffic downstream. Localhost-only proxy, so
accepted-risk; consider trimming `body.agent` and logging unknown-agent hash
derivations once.

---

_Reviewed: 2026-07-07T09:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
