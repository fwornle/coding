---
phase: 83-token-reconciliation-layer
reviewed: 2026-07-06T08:49:46Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts
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
  critical: 3
  warning: 9
  info: 9
  total: 21
status: issues_found
---

# Phase 83: Code Review Report

**Reviewed:** 2026-07-06T08:49:46Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 83 builds the token-reconciliation layer: a request-id + fuzzy matcher joining
adapter transcript rows to authoritative proxy wire rows, a reconcile mode in
`captureForegroundTokens`, a `reconciliation.json` sink + read route, proxy-side task-id
hardening / OpenAI cache parse / duplicate-id fixes, and copilot BYOK gating. The proxy
files were reviewed as the Phase-83 diff range `d3f3869..7a01346` (commits 5512068,
3b73e59, 8ff4b41, 634f23b, be925ae, 530351e, 7a01346) only.

The matcher core (`reconcile.mjs`, `token-db.mjs` primitives) is well-tested and its
never-throw / parameterized-bind contracts hold. However, three critical defects were
found in the wiring around it: the sink's `aggregateDeltas` roll-up is arithmetically
dead (always `{}`), the `unmatched_wire` metric is structurally always 0 for claude
(the exact "trivially passing golden property" the code comments claim to prevent),
and the D-08 no-inherit tap change silently zeroes foreground attribution for measured
spans started after agent launch. Several tests seed fixtures whose shape diverges from
production data (`wire01` user_hash, non-empty copilot wire `tool_call_id`), which is
why the suites pass while the production paths are broken.

Note: the proxy repo gitignores `dist/*.js`; the local `dist/usage-cache.js` and
`dist/token-usage.js` were verified to contain the new code (`parseOpenAICache`,
`idx_token_usage_reqid`), so no stale-dist issue exists locally — but the daemon must
be restarted to load it (operational, not a code finding).

## Critical Issues

### CR-01: `aggregateDeltas` in reconciliation.json is always empty — the sum guard checks the wrong type

**File:** `scripts/measurement-stop.mjs:446-454`
**Issue:** The sink rolls up `perRequest[].deltas` with:

```js
for (const [field, val] of Object.entries(deltas)) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    aggregateDeltas[field] = (aggregateDeltas[field] ?? 0) + val;
  }
}
```

But each `deltas[field]` produced by `computeDeltas` (lib/lsl/token/reconcile.mjs:181-192)
is an **object** `{ wire, transcript, delta, flagged }`, never a number. The
`typeof val === 'number'` guard is therefore always false and
`summary.aggregateDeltas` is written as `{}` on every close — the D-12 per-field
delta roll-up (consumed by the Plan-07 golden comparison and the Phase-86 badge) is
dead code. The route test fixture (`tests/vkb-server/reconciliation-route.test.js:49`)
shows the intended shape (`aggregateDeltas: { input_tokens: 5 }`), but no test
exercises the sink itself, so this passed green.
**Fix:**
```js
for (const [field, val] of Object.entries(deltas)) {
  const d = val && typeof val === 'object' ? val.delta : val;
  if (typeof d === 'number' && Number.isFinite(d)) {
    aggregateDeltas[field] = (aggregateDeltas[field] ?? 0) + d;
  }
}
```

### CR-02: `unmatched_wire` is structurally always 0 for claude spans — wire rows carry the adapter user_hash the query excludes

**File:** `lib/lsl/token/stop-adapter-registry.mjs:589-595` (with `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2217`)
**Issue:** `countUnmatchedWireRows` scopes wire rows via
`WHERE task_id = ? AND user_hash != ?`, excluding `adapter.userHash` (`cladpt` for
claude). But the production `/v1/messages` tap stamps claude wire rows with
`user_hash: adapterUserHash(agent)` — which **is** `cladpt`
(server.mjs:2217, `adapterUserHash()` at :70). So for a measured claude span every
wire row is excluded from the query and `unmatched_wire` is 0 no matter how many
orphan wire rows exist. This makes golden property (3) of
`config/experiments/wire-verify-83-reconcile.yaml` ("HEALTHY SPAN unmatched_wire=0")
**trivially pass** — the precise failure mode the code comment at :479
("NEVER defaulted to 0 — which a silent default would make trivially pass") claims
to avoid. The unit test masks this by seeding wire rows with `user_hash: 'wire01'`
(tests/token-adapters/reconcile-mode.test.js:105), a hash the production tap never
writes for claude. The header comment of `reconcile.mjs` (:21-24, "wire rows and
transcript rows carry DIFFERENT user_hash by design") is false for claude.
**Fix:** Distinguish wire rows by `process`/provenance rather than `user_hash`, e.g.
exclude only rows whose `process` is a transcript-adapter provenance
(`token-adapter-claude` rows written by the tap vs adapter cannot be told apart by
hash — add a distinct wire marker, or exclude by
`process NOT IN (fallbackProcessFor(agent))` combined with tracking the rowids the
transcript loop actually inserted). At minimum, count wire candidates as
"rows with this task_id whose tool_call_id was NOT produced by this run's inserts",
and add a test seeding wire rows with `user_hash: 'cladpt'` to mirror production.

### CR-03: Measured spans started after agent launch lose all foreground attribution — no-inherit tap rows keep `task_id=''` and reconcile never stamps them

**Files:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2037-2046`, `lib/lsl/token/token-db.mjs:253-260`, `scripts/launch-agent-common.sh:414-418`
**Issue:** Chain of three facts:
1. D-08 (commit 3b73e59): a header-less `/v1/messages` tap request now stamps
   `task_id=''` instead of inheriting the ambient span. The launcher sets
   `ANTHROPIC_CUSTOM_HEADERS="x-task-id: ${TASK_ID:-}"` **once at launch time**
   (launch-agent-common.sh:418), so any interactive claude session launched without a
   span (the normal `coding --claude` case) sends an empty header for its entire
   lifetime — including during a span later opened via dashboard Start/Stop
   (Phase 74) or manual `measurement-start`. All its wire rows get `task_id=''`.
2. In reconcile mode those wire rows still match by request-id, so the transcript
   rows (which DO carry the span's task_id) are **not inserted** — zero net rows.
3. `RECONCILE_GAP_FILL_SQL` fills reasoning/tier/parent/cache but **not** `task_id`,
   so the matched wire rows stay `task_id=''` forever.

Result: `aggregateByTaskId(span.task_id)` finds no foreground rows; the run closes
with `total_tokens=0` and canonical model null. Pre-83, ambient inheritance stamped
these rows — this is a regression on the mainline interactive-measurement path,
partially masked because experiment cells (launched with `TASK_ID` set) are
unaffected. The only signal is the single A1 stderr warning at
measurement-stop.mjs:541-545.
**Fix:** Have the reconcile gap-fill also stamp the span task_id onto matched wire
rows whose `task_id` is empty (wire-authoritative counts unaffected):
```sql
task_id = CASE WHEN task_id = '' THEN ? ELSE task_id END
```
passing `transcriptRow.task_id` in `reconcileGapFill`, and add a reconcile-mode test
where the seeded wire row has `task_id=''`.

## Warnings

### WR-01: `:reason:N` rows bypass the span-window clamp — out-of-window reasoning rows are stamped with the measured task_id

**File:** `lib/lsl/token/stop-adapter-registry.mjs:511`
**Issue:** `if (!reasonStep && !withinSpanWindow(transcriptRow, span)) continue;` —
reason-step rows skip the window filter that exists precisely because
`buildClaudeTokenRows` returns the WHOLE transcript (comment at :336-341). Bypassing
the **match** is justified (the wire has no reasoning split); bypassing the
**window** is not: a reasoning row whose parent turn is outside the span is inserted
with the span's task_id while its parent turn is correctly excluded — internally
inconsistent and over-attributing reasoning tokens to the run whenever the ambient
session is longer than the span and the interactive sweep has not already captured
those rows (dedup would then drop them). The interactive (non-reconcile) loop at
:431-433 window-filters ALL rows including reason rows.
**Fix:** Apply the window to reason rows too; keep only the match bypass:
```js
if (!withinSpanWindow(transcriptRow, span)) continue;
if (reasonStep) { insertTokenRowDeduped(db, transcriptRow); ... }
```

### WR-02: Two transcript rows can fuzzy-match the same wire row — the second row's tokens are silently lost

**File:** `lib/lsl/token/reconcile.mjs:111-134` (loop at `stop-adapter-registry.mjs:498-557`)
**Issue:** `fuzzyMatch` has no notion of already-claimed wire rows. Two id-less
transcript rows near the same timestamp both resolve to the same nearest wire row;
both are reported `matched`, neither is inserted. One distinct LLM call's tokens
vanish from `token_usage` with no fallback row and no flag — violating the
"not near-zero (loss)" golden property (1). This is the realistic copilot shape
(one aggregate transcript row is fine, but any multi-row adapter without request-ids
hits this).
**Fix:** Thread the `matchedRequestIds`/claimed-wire-id set (or the wire row PK)
into `fuzzyMatch` and skip already-claimed candidates; on exhaustion fall back to a
provenance-tagged insert.

### WR-03: Proxy `logCall` dedup drops the richer duplicate — diverges from the coding-side merge-on-cache semantics it claims to mirror

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:993-996,1016`
**Issue:** On a `(user_hash, tool_call_id)` hit, `logCall` returns (drops the row)
unconditionally. The coding-side `insertTokenRowDeduped`
(lib/lsl/token/token-db.mjs:319-359) instead ENRICHES a cache-less existing row when
the incoming duplicate carries cache/reasoning (the Phase 82-04 fix for exactly this
data-loss mode). Commit 530351e claims "byte-identical dedup semantics to
coding-side lib/lsl/token/token-db.mjs" — it is not. If the adapter's cache-less row
lands first (live Stop-hook sweep racing a still-streaming tap write within the
5-min grace window), the tap's authoritative cache split is permanently dropped.
**Fix:** On dedup hit, replicate the merge-on-cache branch (existing cache sum 0 and
incoming carries cache/reasoning → in-place UPDATE) before returning.

### WR-04: One-shot dup repair keeps the earliest rowid without merging — legacy cache/reasoning data on the later duplicate is deleted

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:667-686`
**Issue:** The migration `DELETE`s every `(user_hash, tool_call_id)` duplicate except
`MIN(rowid)`. Pre-existing duplicate pairs in the live DB are typically a cache-less
tap row plus a later cache-bearing enrich/adapter row; keeping the earliest blindly
discards the richer values with no merge and no backup. Also the comment "keep the
earliest rowid — the wire row the reconcile matcher deterministically prefers" is
wrong on two counts: the matcher's probe orders by `id` (per-hash counter), not
`rowid`, and per-hash id spaces make "earliest" arbitrary across writers.
**Fix:** Before deleting, fold `MAX(cache_read_tokens)`, `MAX(cache_write_tokens)`,
`MAX(reasoning_tokens)` from the doomed duplicates into the surviving row (an
UPDATE-then-DELETE in one transaction), or keep the row with the larger
cache sum.

### WR-05: Coding-side `insertTokenRow` still has no id-collision retry — the race D-11 fixed on the proxy side silently drops adapter rows on the other side

**File:** `lib/lsl/token/token-db.mjs:132-173`
**Issue:** The proxy now writes `cladpt`/`copadt` rows from its own connection with
`MAX(id)+1` + retry (token-usage.ts:998-1021). The coding-side second writer
allocates `MAX(id)+1` (NEXT_ID_SQL:84-85) with **no retry**: on a composite-PK
collision the catch at :167 logs and returns false — the row is dropped. The D-06
"distinct hash spaces never race" invariant in this file's header is obsolete now
that both writers share the adapter hash space (Route 1 tap + stop-time adapter run
concurrently inside the 5-min locator grace window).
**Fix:** Mirror the proxy's disambiguation: on `SQLITE_CONSTRAINT*`, re-probe the
dedup key; if not a dup, recompute `MAX(id)+1` and retry (bounded).

### WR-06: Copilot production wire rows carry `tool_call_id=''` — gap-fill, cache-merge, and matched-id tracking are all no-ops for copilot

**Files:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2717-2718`, `lib/lsl/token/stop-adapter-registry.mjs:529-535,633-649`
**Issue:** Shim-path (`/v1/copilot/...`) rows never set `tool_call_id` ("stay unset
here — logCall defaults them" server.mjs:2718). Consequences in reconcile mode:
(a) request-id matching can never fire for copilot (fuzzy only); (b) a fuzzy-matched
wire row cannot be enriched — `reconcileGapFill(db, '', …)` returns false on the
degenerate-id guard; (c) `mergeCopilotSessionStateCache` keys `opts.copilotCacheSplit`
on wire `tool_call_id`s that are all `''` in production — a shipped no-op; (d) the
matched wire row is never added to `matchedRequestIds` (`if (wireRow.tool_call_id)`),
so it is still counted in `unmatched_wire`. The copilot test masks all four by
seeding wire rows with non-empty ids (`'sess-1:claude-sonnet-4.6'`,
reconcile-mode.test.js:459-472).
**Fix:** Stamp a per-request id on shim wire rows (e.g. the provider response `id`
already available in the completion envelope, or a UUID minted per shim request) so
copilot rows join like claude rows; track fuzzy matches by wire PK
(`user_hash`,`id`) instead of `tool_call_id`.

### WR-07: `_validTaskId` accepts `.` and `..` — the reconciliation route's traversal gate is weaker than documented and tested

**File:** `lib/vkb-server/api-routes.js:777-779` (used at :608, :614)
**Issue:** `/^[A-Za-z0-9._-]+$/` matches dots-only strings, so `taskId = '..'` passes
validation and `path.join(dataDir, 'measurements', '..', 'reconciliation.json')`
resolves to `.data/reconciliation.json` — one level above the intended root. Impact
is bounded (no `/` allowed, fixed filename appended) but the handler comment claims
"a `../` traversal is rejected with 400 and the read can never escape
.data/measurements/", and the test only covers `'../etc'` and `'a/b'`
(reconciliation-route.test.js:66-77), not bare `'..'`. The write side
(`sanitizeTaskId`, lib/repro/capture-snapshot.mjs:45-49) strips leading dots, so the
two sides also disagree on which ids are representable.
**Fix:** Reject dot-only / leading-dot ids: `if (/^\.+$/.test(id)) return false;`
(or reuse `sanitizeTaskId` and require `sanitizeTaskId(id) === id`), and add a bare
`'..'` 400 test.

### WR-08: Machine-hash id counter is never resynced after a collision retry — every subsequent `logCall` permanently pays a failed INSERT + probe

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:998-1021` (`nextLocalId` at :727)
**Issue:** After a PK collision, attempt 1 allocates `MAX(id)+1` from the DB, but
`_localIdSeq` (a plain `_localIdSeq++` counter) is not advanced to match. Once the DB
max runs ahead of the counter, every following machine-hash `logCall` attempt 0
collides again (counter value ≤ existing max), triggering a constraint error, a
dedup re-probe, and a retry — on every insert until process restart. Correctness is
preserved by the retry, but the hot path degrades permanently and the stderr channel
fills with recurring constraint noise (the exact symptom 7a01346 was fixing).
**Fix:** After a successful retry insert (or on any recompute), resync the counter:
expose `handle.bumpLocalSeq(id + 1)` and call it when `effectiveUserHash === USER_HASH`
and the DB-computed id was used.

### WR-09: Stale launcher comment documents the removed ambient-fallback "safety valve" for the empty x-task-id header

**File:** `scripts/launch-agent-common.sh:414-418`
**Issue:** "An empty TASK_ID leaves the header value blank → the tap falls back to
its ambient resolveLiveTaskId() (safety valve)." After D-08 (commit 3b73e59) the tap
stamps `task_id=''` for a blank header — there is no ambient fallback anymore. The
comment now documents the opposite of the shipped behavior and hides the CR-03
regression from any operator reading the launcher.
**Fix:** Rewrite the comment to state the no-inherit rule and that only a non-empty
`TASK_ID` at launch binds a measured cell.

## Info

### IN-01: `reconcile.mjs` header claims wire and transcript rows "carry DIFFERENT user_hash by design" — false for claude

**File:** `lib/lsl/token/reconcile.mjs:21-24`
**Issue:** Claude wire tap rows are `cladpt` (server.mjs:2217) — the same hash as the
transcript adapter. The cross-hash framing misled `countUnmatchedWireRows` (CR-02).
**Fix:** Correct the comment: the join crosses hash boundaries for copilot/shims only;
claude wire and transcript rows share `cladpt` and are distinguished by write order +
dedup.

### IN-02: `RECONCILE_GAP_FILL_SQL` updates every row sharing the tool_call_id (no user_hash scope)

**File:** `lib/lsl/token/token-db.mjs:253-260`
**Issue:** `WHERE tool_call_id = ?` touches all hashes' rows with that id (e.g. a
prior fallback cladpt row AND the wire row). Fill-gaps-only semantics bound the
damage, but tier/parent/cache can be stamped onto rows that are not the matched wire
row. **Fix:** Add `AND (user_hash = ? OR ...)` scoping to the matched wire row's PK.

### IN-03: `RECONCILE_PROBE_SQL` comment: "ORDER BY id makes the earliest (wire) row the deterministic winner" is not guaranteed

**File:** `lib/lsl/token/token-db.mjs:227-238`
**Issue:** Ids are independent per-user_hash counters; a cladpt adapter row can carry
a lower id than the wire row for the same tool_call_id. The pick is deterministic but
not necessarily the wire row. **Fix:** Order by a wire-provenance discriminator (e.g.
`process`) first, or document that either row is acceptable because gap-fill hits all
rows (see IN-02).

### IN-04: `withinSpanWindow` duplicated in two modules

**Files:** `lib/lsl/token/reconcile.mjs:95-103`, `lib/lsl/token/stop-adapter-registry.mjs:342-351`
**Issue:** Two copies of the identical clamp (acknowledged in the comment). A future
grace-window change in one silently desynchronizes the matcher from the loop.
**Fix:** Export it from one module (registry already imports from token-db/reconcile).

### IN-05: Shim path silently degrades a malformed explicit task id to the ambient span

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2329-2337`
**Issue:** `safeSanitizeTaskId` maps an illegal explicit header/body/path id to `''`,
after which `taskId || safeSanitizeTaskId(resolveLiveTaskId())` (and the downstream
`body.task_id ?? resolveLiveTaskId()`) rebinds the call to whatever span is live —
the ambient-leak class Phase 82-06 closed — with no log line. The tap branch logs the
rejection (:2034); the shim does not. **Fix:** Log the rejection like the tap branch.

### IN-06: `logCall` re-prepares two statements on every insert

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:983-988`
**Issue:** `nextIdStmt`/`dedupStmt` are `db.prepare`d per call instead of once on the
handle (like `insertStmt`). Not a correctness issue; hot-path churn on every token
log. **Fix:** Hoist both onto the handle next to `insertStmt`.

### IN-07: Reconciliation route's ENOENT shape differs from the served-file shape

**File:** `lib/vkb-server/api-routes.js:620-623`
**Issue:** Hit → verbatim top-level `{ schemaVersion, span, summary, perRequest }`;
miss → `{ reconciliation: null }`. Consumers (Phase 86 badge) must special-case two
shapes; a `null`-check on `body.reconciliation` would misread a hit as a miss.
**Fix:** Return `{ reconciliation: <file> }` on hit or a documented
`{ schemaVersion: null }` empty on miss — one envelope.

### IN-08: Re-running a close re-counts `fallback` without inserting

**File:** `lib/lsl/token/stop-adapter-registry.mjs:543-547`
**Issue:** The fallback branch increments `unmatched_transcript`/`fallback` before
`insertTokenRowDeduped`, whose dedup hit (row already inserted by a prior run) makes
it return false — the report claims a fallback insert that did not happen, so a
re-close overwrites `reconciliation.json` with inflated-looking (but row-less)
fallback counts. **Fix:** Count only when the insert/enrich returns true, or record
`deduped: true` in `perRequest`.

### IN-09: Sink writes under `sanitizeTaskId(task_id)` while the read route looks up the raw id

**Files:** `scripts/measurement-stop.mjs:474-479`, `lib/vkb-server/api-routes.js:614`
**Issue:** A task_id whose sanitized form differs from itself (leading dot, illegal
char → `_`) is written under the transformed directory name but requested by the
original id → permanent graceful-empty 200. Proxy-minted ids are pre-sanitized so
this is latent, but the two ends should share one canonicalization. **Fix:** Have the
route resolve `sanitizeTaskId(taskId)` (after validation) before the path join.

---

_Reviewed: 2026-07-06T08:49:46Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
