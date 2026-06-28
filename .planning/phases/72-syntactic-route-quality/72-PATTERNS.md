# Phase 72: Syntactic Route Quality - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 11 new + 3 modified
**Analogs found:** 14 / 14 (every new/modified file grounds on a concrete in-repo analog)

> All file access for this map was read-only. The planner should treat the line numbers below as the exact convention to replicate — especially the km-core `openExperimentStore()`/`ontologyDir` rule (CLAUDE.md, mandatory acceptance grep) and the `no-console-log` → `process.stderr.write` rule.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/lsl/route/route-event.mjs` | utility (type + shared helpers: digest, outcome enum) | transform | `lib/lsl/token/token-db.mjs` (shared consts/helpers) + `node:crypto` usage in `measurement-stop.mjs:190-192` | role-match |
| `lib/lsl/route/claude-route-trace.mjs` | reader/parser | file-I/O (JSONL → RouteEvent[]) | `lib/lsl/token/claude-token-rows.mjs` | exact (same file, disjoint slice) |
| `lib/lsl/route/copilot-route-trace.mjs` | reader/parser | file-I/O (events.jsonl → RouteEvent[]) | `lib/lsl/token/copilot-token-rows.mjs` | exact (same file, disjoint slice) |
| `lib/lsl/route/opencode-route-trace.mjs` | reader/parser | file-I/O (SQLite `part` → RouteEvent[]) | `lib/lsl/adapters/opencode-sqlite.mjs` | exact (same DB, `part` table) |
| `lib/lsl/route/build-trace.mjs` | reader/dispatcher | request-response (span → RouteEvent[]\|null) | `scripts/measurement-stop.mjs:188-189` (dominant-agent pick) + Pitfall 7 timestamp-window | role-match |
| `lib/experiments/route-heuristics.mjs` | pure-compute | transform (RouteEvent[] → six metrics) | `lib/lsl/token/claude-token-rows.mjs:56-63` (pure `num`/`estimate` helpers) | role-match |
| `lib/experiments/run-write.mjs` (EXTEND) | store-writer | CRUD (idempotent km-core write) | itself (extend the Outcome-stub pattern for the Route node) | exact |
| `scripts/measurement-stop.mjs` (EXTEND) | CLI orchestrator | request-response (close pipeline) | itself (insert step 3.5/3.6 between :199 and :205) | exact |
| `scripts/experiments-recompute-route.mjs` | CLI | batch (timestamp-join + idempotent recompute) | `scripts/backfill-task-id-by-timestamp.mjs` + `scripts/measurement-stop.mjs` (store open/close) | role-match |
| goal_sentence population (in `measurement-stop.mjs` / `measurement-start`) | utility/CLI | transform (PLAN.md `**Goal**:` regex / TTY prompt) | `measurement-stop.mjs:94-103` (prompt) + `:136-139` (arg parse) | role-match |
| `tests/experiments/route-heuristics.test.mjs` | test | — | `tests/experiments/run-write.test.mjs` (node:test) | exact |
| `tests/experiments/route-readers.test.mjs` | test | — | `tests/token-adapters/claude-token-rows.test.js` (fixture+ownedCopy) but **port to `node:test`** | role-match |
| `tests/experiments/goal-sentence.test.mjs` | test | — | `tests/experiments/taxonomy.test.mjs` / `run-write.test.mjs` | role-match |
| `tests/fixtures/route/` | test fixture | — | `tests/token-adapters/fixtures/` (per-agent sample files) | role-match |

---

## Pattern Assignments

### `lib/lsl/route/claude-route-trace.mjs` (reader, file-I/O)

**Analog:** `lib/lsl/token/claude-token-rows.mjs` — reads the *same* Claude session JSONL but a **disjoint slice**: the token adapter `continue`s on everything except `usage` blocks (`:160-161`); the route reader walks `tool_use`/`tool_result` blocks the token adapter skips. **Reuse the gates, not the row builder** (RESEARCH Pitfall 3, Anti-Patterns).

**Imports + gate reuse** (lines 36-42):
```javascript
import fs from 'node:fs';
import process from 'node:process';
import {
  SUBAGENT_PATH_RE,
  parentSessionFromClaudeSubagentPath,
} from '../adapters/claude-jsonl-tree.mjs';
```

**uid-check gate — copy VERBATIM** (lines 82-101) — T-69-traversal / V4 access control:
```javascript
let st;
try { st = fs.statSync(jsonlPath); }
catch (err) { process.stderr.write(`[route-claude] stat failed: ${jsonlPath}: ${err.message}\n`); return []; }
if (typeof process.getuid === 'function') {
  const me = process.getuid();
  if (st.uid !== me) {
    process.stderr.write(`[route-claude] skipping non-owned ${jsonlPath} (file uid=${st.uid} != ${me})\n`);
    return [];
  }
}
```

**Per-line DoS gate — copy VERBATIM** (lines 145-153) — T-69-dos:
```javascript
for (const line of lines) {
  if (!line.trim()) continue;
  let rec;
  try { rec = JSON.parse(line); }
  catch { continue; } // malformed line → skip, never abort
  if (!rec || typeof rec !== 'object') continue;
  // route reader: walk rec.message.content[] for tool_use / tool_result (NOT usage)
}
```

**Core extraction pattern** (RESEARCH §Code Examples, confirmed on disk):
```javascript
// assistant record: message.content[] has { type:'tool_use', id, name, input }
// user record:      message.content[] has { type:'tool_result', tool_use_id, is_error, content }
// rec.timestamp is the per-event clock.
for (const b of content) {
  if (b.type === 'tool_use')    starts.set(b.id, { id: b.id, name: b.name, input: b.input, ts: rec.timestamp });
  if (b.type === 'tool_result') ends.set(b.tool_use_id, { ts: rec.timestamp, is_error: !!b.is_error });
}
// abandoned = starts whose id is absent from ends.
```

---

### `lib/lsl/route/copilot-route-trace.mjs` (reader, file-I/O)

**Analog:** `lib/lsl/token/copilot-token-rows.mjs` — reads the *same* `events.jsonl` but only `session.shutdown.modelMetrics` (`:198`). The route reader walks `tool.execution_start` / `tool.execution_complete` events (full per-tool fidelity on v1.0.63). Copilot is **NOT** pre-nulled — D-02 null is the fallback, not Copilot's normal path (RESEARCH State-of-the-Art).

**Mandatory line-primitive reuse (locked key-link)** — copy `:50-54`:
```javascript
// parseCopilot is the ONLY Copilot line parser; invoke it as the recognized-
// primitive gate, then read the event `type` discriminator from the raw line.
import { parseCopilot } from '../../../src/live-logging/TranscriptNormalizer.js';
```

**uid-check gate via `readOwnedFile`** (copilot-token-rows.mjs:83-110) — copy the same fail-closed helper.

**Per-line scan + type discriminator** (copilot-token-rows.mjs:167-198):
```javascript
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  try { parseCopilot(line); } catch { /* defensive */ }   // recognized-primitive gate
  let evt;
  try { evt = JSON.parse(line); } catch { continue; }       // T-69-dos
  const eventType = evt.type || evt.event;
  // route reader: match tool.execution_start (data.toolCallId/toolName/arguments + evt.timestamp)
  //               with tool.execution_complete (data.toolCallId/success/result + evt.timestamp)
}
```
Outcome map (RESEARCH §Pattern 1 table): `success` ← `execution_complete.data.success===true`; `error` ← `false`; `abandoned` ← start with no matching complete; `denied` folds into `error` for v0 (A4).

---

### `lib/lsl/route/opencode-route-trace.mjs` (reader, file-I/O via SQLite)

**Analog:** `lib/lsl/adapters/opencode-sqlite.mjs` — already opens `opencode.db` read-only and parses the `part` table. **Reuse the open/guard helpers verbatim**; the route reader filters `part.data` where `type === 'tool'` (the adapter only summarizes parts as `[tool: ...]` at `:396-398`).

**better-sqlite3 import + read-only open** (opencode-sqlite.mjs:56, 166-171) — RESEARCH OQ1 resolves: Phase 51/70 already use `better-sqlite3` (repo dep), so reuse it (do NOT reach for `node:sqlite`):
```javascript
import Database from 'better-sqlite3';
function openReadonlyDb(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000'); // landmine #2 WAL contention
  return db;
}
```

**uid-check** (opencode-sqlite.mjs:106-114, `isOwnedByMe`) and **schema guard** (`checkSchemaVersion`, exported at `:135`) — reuse both; add `part` columns to the read contract.

**Tool-part extraction** (RESEARCH §Code Examples, confirmed):
```javascript
// part.data = { type:'tool', callID, tool, state:{ status, input, error, time:{start,end} } }
// status: 'completed' | 'error' | 'pending'|'running'(abandoned)
// PITFALL 6: state.time.{start,end} are epoch MILLISECONDS → new Date(ms).toISOString()
```
Mirror the millisecond→ISO conversion already done at opencode-sqlite.mjs:385-387 (`Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : null`).

---

### `lib/lsl/route/route-event.mjs` (utility, transform)

**Analog:** `lib/lsl/token/token-db.mjs` for the shared-const/helper-module convention + `crypto.createHash('sha256')` already used at `measurement-stop.mjs:190-192`.

Holds the `RouteEvent` jsdoc typedef (RESEARCH §Pattern 1), the `outcome` enum, and `inputsDigest(input)`:
```javascript
import crypto from 'node:crypto';
// V6: never hand-roll a hash. Canonical-JSON the tool input, then sha256.
export function inputsDigest(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
}
```
`computeHeuristics` parses every timestamp via `Date.parse` ONLY (Pitfall 6 — readers already normalized to ISO).

---

### `lib/lsl/route/build-trace.mjs` (dispatcher, request-response)

**Analog:** `scripts/measurement-stop.mjs:188-189` (dominant-agent pick) + the timestamp-window join from `scripts/backfill-task-id-by-timestamp.mjs:131-147`.

**Pick reader by dominant agent — the value already exists at the call site:**
```javascript
// measurement-stop.mjs:188-189
const { totals, byAgentModel } = aggregateByTaskId(span.task_id);
const dominant = byAgentModel[0] ?? {};   // dominant.agent → reader selection
```

**Run↔session matching (Pitfall 7 — biggest correctness risk):** scope located RouteEvents to the span window `[span.started_at, span.ended_at]`. Confirm against the lexical-ISO window predicate in backfill (`:139` `timestamp >= ? AND timestamp <= ?`). **Return `null` (NOT `[]`) when no trace file is found** (Pitfall 4 / D-02) — `[]` would mean "trace found, genuinely empty" and pollute averages with a fake `total_step_count: 0`.

---

### `lib/experiments/route-heuristics.mjs` (pure-compute, transform)

**Analog:** the pure-helper style of `claude-token-rows.mjs:56-63` (`estimateReasoningTokens`, `num` — deterministic, no I/O). This module imports nothing from km-core or fs — it consumes `RouteEvent[]` only.

Signature + the all-null fallback constant (D-02):
```javascript
export const ALL_NULL_HEURISTICS = {
  loop_count: null, edit_revert_count: null, redundant_read_count: null,
  abandoned_tool_count: null, total_step_count: null, wallclock_per_step: null,
};
/** @param {RouteEvent[]|null} trace */
export function computeHeuristics(trace) { /* strict D-06 defns; null trace → ALL_NULL_HEURISTICS */ }
```
The six strict definitions + per-heuristic golden-fixture cases (incl. mandatory true-negative per D-06/D-08) are fully specified in RESEARCH §"The Six Heuristics". v0 `edit_revert_count` = Edit-input A→B→A pattern, `null` when inputs not reconstructable (OQ2/A2 — planner must lock + fixture this).

---

### `lib/experiments/run-write.mjs` (store-writer, CRUD) — **EXTEND**

**Analog:** itself — the Route node is an exact replica of the existing **Outcome-stub** idempotent pattern. Add a `heuristics` arg to `writeRun({ span, taskClass, pending, tags, totals, heuristics })`.

**(1) Flat metrics on the Run** — add the six keys to the Run `metadata` object (run-write.mjs:82-97), all null-able (D-02), alongside the existing 8 tags.

**(2) One Route node — replicate the Outcome idempotent lookup + mint** (run-write.mjs:102-126), keyed by `metadata.run_task_id`:
```javascript
let existingRouteId;
if (existingId) {
  for await (const e of store.iterate({ entityType: 'Route' })) {
    if (e.metadata?.run_task_id === span.task_id) { existingRouteId = e.id; break; }
  }
}
const routeId = await store.putEntity({
  id: existingRouteId ?? mintEntityId(),   // NEVER span.task_id (Pitfall 1 — parseEntityId needs UUIDv7)
  name: `${span.task_id}-route`,
  entityType: 'Route',                      // validated against experiment-ontology.json (strict path)
  layer: 'evidence',
  description: span.goal_sentence ?? '',    // ROUTE-01: propagate goal onto the Route node (D-09)
  metadata: { run_task_id: span.task_id, ...heuristics, goal_sentence: span.goal_sentence ?? '' },
}, { provenance });                         // reuse the SAME synthetic provenance (run-write.mjs:64-69)
```

**(3) `tookRoute` relation with a STABLE key** (mandatory — run-write.mjs:128-138, WR-01). `tookRoute` is already declared on the Run class (verified: `experiment-ontology.json` Run.relationships.tookRoute → ["Route"]):
```javascript
await store.addRelation({
  type: 'tookRoute', from: runId, to: routeId,
  key: `${runId}:tookRoute:${routeId}`,     // WITHOUT key → N re-closes = N parallel edges (Pitfall 2)
});
```

**Ontology note (verified on disk):** the `Route` class currently declares `"properties": {}`. km-core strict path validates `entityType`, not unknown metadata keys (Run already stores `task_id`/`pending`/`started_at`/`ended_at` beyond its declared properties), so heuristics ride in `metadata` with **no ontology edit required** (A5). Declaring the six + `goal_sentence` as first-class Route properties is an optional, additive, low-risk planner choice.

---

### `scripts/measurement-stop.mjs` (CLI orchestrator) — **EXTEND**

**Analog:** itself — insert steps 3.5/3.6 between the existing token-aggregation (`:188-199`) and `writeRun` (`:205`). Confirmed insertion point.

```javascript
// after :199, before :205
import { buildNormalizedTrace } from '../lib/lsl/route/build-trace.mjs';
import { computeHeuristics, ALL_NULL_HEURISTICS } from '../lib/experiments/route-heuristics.mjs';
// ── (3.5) build normalized trace + (3.6) compute heuristics ──
const trace = await buildNormalizedTrace(span, { dominantAgent: dominant.agent });
const heuristics = trace ? computeHeuristics(trace) : ALL_NULL_HEURISTICS; // D-02 null
// ── (4) writeRun gains heuristics ──
await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });
```

**goal_sentence population (ROUTE-01)** — reuse the existing seams in this file:
- **/gsd (D-03):** PLAN.md `**Goal**:` regex extraction, fallback to ROADMAP `**Goal**:`. The `--goal`/`--phase` arg seam already exists (`:136-138` via `parseStrArg`). Zero-LLM string extraction.
- **Freeform (D-04):** the TTY `prompt()` helper already exists (`:94-103`); editable at close.
- **Headless (D-05):** the quarantine path (empty goal + `pending=true`) already exists (`:181-185`) — never block.

**Logging rule:** this file documents `process.stdout.write`/`process.stderr.write` only (header `:33-35`) — keep all new output on those, never `console.*`.

---

### `scripts/experiments-recompute-route.mjs` (CLI, batch) — **NEW (optional)**

**Analog:** `scripts/backfill-task-id-by-timestamp.mjs` (timestamp-join + `--dry-run` + entry-point guard + self-test) combined with the store open/close `try/finally` from `measurement-stop.mjs:202-209`.

**km-core store open — MANDATORY pattern** (CLAUDE.md acceptance grep `ontologyDir`): open via `openExperimentStore()` ONLY, never `new GraphKMStore` inline. `openExperimentStore` is the single caller that passes `ontologyDir` (store.mjs:43-50). Wrap in `try { ... } finally { await store.close(); }` (single-owner LevelDB, Pitfall 5):
```javascript
import { openExperimentStore } from '../lib/experiments/store.mjs';
const store = await openExperimentStore();
try {
  // find Run by metadata.task_id scan (run-write.mjs:55-60), rebuild trace from archived span,
  // recompute heuristics, call the SAME extended writeRun (idempotent — updates SAME Run + Route).
} finally { await store.close(); }
```

**Entry-point guard** (backfill:281-295) so importing the module for tests does not run `main()`:
```javascript
const isMain = (() => { try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } })();
if (isMain) main();
```
No new write semantics — it reuses the idempotent `writeRun` path (Phase 71 D-14).

---

### Tests + fixtures (Wave 0)

**`tests/experiments/route-heuristics.test.mjs`** — analog `tests/experiments/run-write.test.mjs`. **Use `node:test` + `node:assert/strict`** (`import { test } from 'node:test'; import assert from 'node:assert/strict';`). One describe-block per heuristic, each with at least one **true-negative** case (D-06/D-08). Quick run: `node --test tests/experiments/route-heuristics.test.mjs`.

**`tests/experiments/route-readers.test.mjs`** — analog `tests/token-adapters/claude-token-rows.test.js` for the **`ownedCopy(srcPath, name)` fixture-into-tmpdir** convention (so the uid gate passes):
```javascript
function ownedCopy(srcPath, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-readers-'));
  const dst = path.join(dir, name); fs.copyFileSync(srcPath, dst); return { dir, dst };
}
```
**CAUTION — framework mismatch:** the `tests/token-adapters/*.test.js` files use **jest globals** (`expect`, bare `test`). The new `tests/experiments/*.test.mjs` files must follow the **`node:test`** convention (the established pattern for `tests/experiments/`), NOT jest. Copy the *fixture/ownedCopy mechanics* from the token-adapter test, but the *assertion style* from `run-write.test.mjs`.

**`tests/experiments/goal-sentence.test.mjs`** — analog `tests/experiments/taxonomy.test.mjs`. Covers PLAN.md/ROADMAP `**Goal**:` extraction + the headless-quarantine path (empty goal + pending).

**`tests/fixtures/route/`** — analog `tests/token-adapters/fixtures/` (a per-agent sample-file dir). Golden `RouteEvent[]` JSON + small real-shape per-agent captures (Claude JSONL slice, Copilot events.jsonl slice, OpenCode `part` rows) covering loop / edit-revert / redundant-read / abandoned / parallel-same-turn / true-negatives.

---

## Shared Patterns

### km-core store open (CLAUDE.md — mandatory `ontologyDir`)
**Source:** `lib/experiments/store.mjs:40-54`
**Apply to:** `experiments-recompute-route.mjs` (and any new CLI touching the experiment store). Acceptance grep for `ontologyDir` is mandatory per CLAUDE.md.
```javascript
import { openExperimentStore } from '../lib/experiments/store.mjs';
const store = await openExperimentStore();   // the ONLY constructor that passes ontologyDir
try { /* ... */ } finally { await store.close(); }   // single-owner LevelDB (Pitfall 5)
```
Never `new GraphKMStore({...})` inline — without `ontologyDir` the strict-path entityType validation silently degrades to a no-op (store.mjs:10-12).

### Idempotent km-core entity write (mint id, never task_id)
**Source:** `lib/experiments/run-write.mjs:52-77, 102-126`
**Apply to:** the Run-metric extension + the new Route node.
```javascript
import { mintEntityId } from '@fwornle/km-core';
// lookup by a metadata key, reuse id on re-close, mint UUIDv7 on first write:
let existingId;
for await (const e of store.iterate({ entityType: 'Route' })) {
  if (e.metadata?.run_task_id === span.task_id) { existingId = e.id; break; }
}
const id = existingId ?? mintEntityId();   // NEVER span.task_id (parseEntityId requires UUIDv7 — Pitfall 1)
```

### Stable relation key (parallel-edge dedupe)
**Source:** `lib/experiments/run-write.mjs:128-138`
**Apply to:** the `tookRoute` edge.
```javascript
await store.addRelation({ type, from, to, key: `${from}:${type}:${to}` });
// WITHOUT key → addEdge() appends a NEW parallel edge every re-close (WR-01 / Pitfall 2)
```

### Synthetic ProvenanceStamp for strict-path writes
**Source:** `lib/experiments/run-write.mjs:62-69`
**Apply to:** every `putEntity` in run-write (Route node reuses the same object).
```javascript
const provenance = { provider: 'coding-measure-stop', model: 'n/a', runId: span.task_id, timestamp: new Date().toISOString() };
// putEntity(..., { provenance }) — the store NEVER invents one (D-30).
```

### uid-check + per-line DoS gate (every agent-file reader)
**Source:** `claude-token-rows.mjs:82-101` (uid), `:145-153` (per-line try/catch); `opencode-sqlite.mjs:106-114` (`isOwnedByMe`) for SQLite.
**Apply to:** all three route readers. Reject non-owned files (V4); skip malformed lines (V5/T-69-dos); a `buildNormalizedTrace` that can't read returns `null`, so the close still completes.

### Logging — `no-console-log` (CLAUDE.md)
**Source:** every analog header (`measurement-stop.mjs:33-35`, `run-write.mjs:22`, both token rows headers).
**Apply to:** all new files. Use `process.stderr.write` (diagnostics) / `process.stdout.write` (CLI summary) only. Never `console.*`. Do not dodge the constraint by switching raw-write APIs.

### Timestamp handling across agents (Pitfall 6)
**Source:** `opencode-sqlite.mjs:385-387` (epoch-ms → ISO).
**Apply to:** the OpenCode reader normalizes epoch-ms to ISO-8601 in the RouteEvent; Claude/Copilot are already ISO; `computeHeuristics` uses `Date.parse` only. Lexical ISO comparison for the span window is chronologically correct (backfill `:14-17`).

---

## No Analog Found

None. Every new file grounds on a concrete in-repo analog. Two near-gaps the planner must resolve (both have a partial analog, not a true absence):

| File | Role | Gap | Planner action |
|------|------|-----|----------------|
| `lib/experiments/route-heuristics.mjs` | pure-compute | No existing *deterministic route-quality scorer* — closest is the taxonomy keyword heuristic (`deriveClassFromText`, also zero-LLM). | New pure function; ground its style on the zero-LLM helpers in `claude-token-rows.mjs:56-63`. Definitions are fully specified in RESEARCH §Six Heuristics. |
| `lib/lsl/route/build-trace.mjs` dispatcher | reader/dispatcher | No existing "pick a per-agent reader by dominant agent + time-window" composer. | Compose from `measurement-stop.mjs:188-189` (dominant pick) + backfill window predicate; confirm Pitfall 7 window before coding the readers. |

## Metadata

**Analog search scope:** `lib/lsl/route/` (new), `lib/lsl/token/`, `lib/lsl/adapters/`, `lib/experiments/`, `scripts/`, `tests/experiments/`, `tests/token-adapters/`, `tests/fixtures/`, `.data/ontologies-experiment/`
**Files scanned (read in full or targeted):** `scripts/measurement-stop.mjs`, `lib/experiments/run-write.mjs`, `lib/experiments/store.mjs`, `lib/lsl/token/claude-token-rows.mjs`, `lib/lsl/token/copilot-token-rows.mjs`, `lib/lsl/adapters/opencode-sqlite.mjs`, `scripts/backfill-task-id-by-timestamp.mjs`, `tests/experiments/run-write.test.mjs`, `tests/token-adapters/claude-token-rows.test.js`, `.data/ontologies-experiment/experiment-ontology.json`
**Pattern extraction date:** 2026-06-24
</content>
</invoke>
