# Phase 69: Claude + Copilot Token Adapters - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 13 (4 new modules, 1 new test dir, 6 modified, 2 read-only reuse)
**Analogs found:** 13 / 13

Phase 69 is an **emission layer** on top of locked Phase-51 parsers + Phase-68 storage/reader.
Almost every file has an exact in-repo analog. The only genuinely-new primitive is the
host-side adapter INSERT helper (`token-db.mjs`) — and even that is a near-direct port of the
proxy's own `logCall`/`insertStmt` plus the backfill's DB-open pattern.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/lsl/token/token-db.mjs` (NEW) | utility (DB writer) | file-I/O / batch | `src/token-usage.ts` `logCall`/`insertStmt` (proxy) + `scripts/backfill-task-id-by-timestamp.mjs` open | exact (port) |
| `lib/lsl/token/claude-token-rows.mjs` (NEW) | service (extract→row) | transform | `lib/lsl/adapters/claude-jsonl-tree.mjs` `buildRow` | role-match |
| `lib/lsl/token/copilot-token-rows.mjs` (NEW) | service (extract→row) | transform | `lib/lsl/adapters/copilot-events.mjs` `buildRow`/`readSubAgentEvents` | exact |
| `lib/lsl/token/task-id.mjs` (NEW, optional thin) | utility (span reader import) | request-response | `scripts/measurement-start.mjs` dist-import block | exact |
| `lib/lsl/live/claude-fs-watch.mjs` (MODIFY) | watcher | streaming | self — `onMessage` callback (line 489) | exact (extend) |
| `lib/lsl/live/copilot-events-tail.mjs` (MODIFY) | watcher | event-driven | self — `tailEventsFile` listener (line 281) | exact (extend) |
| `scripts/sub-agent-live-claude.mjs` (MODIFY) | provider (daemon) | event-driven | self — ObservationWriter wiring (line 161-207) | exact (extend) |
| `scripts/sub-agent-live-copilot.mjs` (MODIFY) | provider (daemon) | event-driven | `sub-agent-live-claude.mjs` (sibling) | exact (extend) |
| `scripts/sweep-sub-agents.mjs` (MODIFY) | provider (sweep) | batch | self + `backfill-task-id-by-timestamp.mjs` `runSweep` | exact (extend) |
| `scripts/sub-agent-sweep-job.sh` (MODIFY) | config (launchd runner) | batch | self (additive, likely no edit) | exact |
| `lib/lsl/adapters/claude-jsonl-tree.mjs` (READ-ONLY reuse) | service | transform | self — `parentSessionFromClaudeSubagentPath`, `isSidechain` gate | n/a (consume) |
| `tests/token-adapters/wal-concurrency.test.mjs` (NEW) | test | integration | `backfill-task-id-by-timestamp.mjs` `--self-test` (node:test) | exact |
| `tests/token-adapters/*.test.js` (NEW) | test | unit/integration | `tests/live-logging/adapter-claude.test.js` (jest) | role-match |

---

## Pattern Assignments

### `lib/lsl/token/token-db.mjs` (NEW — utility, the ONLY file touching the DB)

**Analogs:** `src/token-usage.ts` (proxy: `insertStmt` L574-581, `logCall` L788-824, seed/id L588-595, USER_HASH validation L46-47) + `scripts/backfill-task-id-by-timestamp.mjs` (host-side open, L43-44, L171).

**Host-side `better-sqlite3` require + open** — copy from `backfill-task-id-by-timestamp.mjs:38-44,171`:
```javascript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
// ...
db = new Database(dbPath, { fileMustExist: true }); // backfill uses { readonly: dryRun, fileMustExist: true }
```
**Phase-69 delta:** the adapter is a *second writer*, so it MUST add `db.pragma('busy_timeout = 5000')`
immediately after open (the proxy sets WAL globally; busy_timeout is per-connection — see D-07 / RESEARCH Pattern 1).

**The exact 21-column INSERT to replicate** — `src/token-usage.ts:574-581` (column order is load-bearing; copy verbatim):
```javascript
INSERT INTO token_usage (
  id, timestamp, provider, model, process, subscription,
  input_tokens, output_tokens, total_tokens, latency_ms,
  prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms,
  agent, task_id, tool_call_id, parent_call_id, granularity_tier, reasoning_tokens
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**The id-allocation seed (Pitfall 2 — distinct user_hash)** — `src/token-usage.ts:588-595`. The proxy
seeds its counter from `MAX(id)+1 WHERE user_hash = ?`. The adapter does the same but with a
DISTINCT hash so it never races the proxy's in-memory counter:
```javascript
// proxy original (do NOT reuse its USER_HASH):
const r = db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM token_usage WHERE user_hash = ?`).get(USER_HASH);
// adapter: use 'cladpt' / 'copadt' (matches /^[a-z][a-z0-9]{5}$/ at token-usage.ts:47)
```

**Best-effort try/catch discipline (NEVER throws out of ingestion — D-03/D-08)** — mirror `logCall` L788-824:
```javascript
export function logCall(handle, row) {
  try {
    handle.insertStmt.run(handle.nextLocalId(), row.timestamp, /* ...coalesced... */
      row.tokens_estimated, USER_HASH, row.model_raw ?? row.model, row.overhead_ms ?? null,
      row.agent ?? '', row.task_id ?? '', row.tool_call_id ?? '',
      row.parent_call_id ?? '', row.granularity_tier ?? '', row.reasoning_tokens ?? 0);
  } catch (err) {
    process.stderr.write(`[token-usage] logCall failed (non-fatal): ${err.message}\n`);
  }
}
```
Note the coalescing: every numeric `?? 0`, every TEXT `?? ''`, `overhead_ms ?? null` (better-sqlite3
rejects `undefined`; an explicit `null` is required). This prevents `NaN`/`null` in NOT-NULL columns (V5).

**`TokenUsageRow` shape the adapter must produce** — `src/token-usage.ts:83-128` (all attribution fields optional;
`tokens_estimated` is `0 | 1`). Phase-69 values per column are tabulated in RESEARCH §"The Phase-68 contract".

---

### `lib/lsl/token/claude-token-rows.mjs` (NEW — service, transform)

**Analog:** `lib/lsl/adapters/claude-jsonl-tree.mjs` (`buildRow` L243-332).

**uid-check gate (V4 — copy verbatim, every file read MUST honor it)** — `claude-jsonl-tree.mjs:251-258`:
```javascript
if (typeof process.getuid === 'function') {
  const me = process.getuid();
  if (st.uid !== me) {
    process.stderr.write(`[claude-adapter] skipping non-owned ${absPath} (file uid=${st.uid} != ${me})\n`);
    return null;
  }
}
```

**isSidechain first-record gate + parent linkage (D-02 — reuse, do NOT re-implement)** — `claude-jsonl-tree.mjs:280-296`:
```javascript
if (firstObj && firstObj.isSidechain === false) {
  process.stderr.write(`[claude-adapter] skipped non-sidechain ${absPath}\n`);
  return null;
}
const parentSessionId = parentSessionFromClaudeSubagentPath(absPath); // EXPORTED L87 — import it
const agentId = agentIdFromClaudeSubagentPath(absPath);                // EXPORTED L95
const subHash = subHashFromAgentId(agentId);                          // EXPORTED L104
```
`parent_session_id` (and `computeSubIndexes` at L185) are the source of `parent_call_id` for sub-agent rows.
The token module derives `parent_call_id` from this tree — it does NOT walk the subagents dir itself.

**The Claude `usage` block to extract (per-turn source, ADAPT-01)** — VERIFIED shape (RESEARCH Code Examples):
`usage.input_tokens`, `usage.output_tokens` (thinking folded in — NO separate reasoning field),
`usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`; `requestId` (unique → `tool_call_id` + dedup key);
`isSidechain` (sub-agent gate). **D-05:** per-reasoning-step rows carry an ESTIMATED `reasoning_tokens`
from thinking-block content length, stamped `tokens_estimated = 1` — never claim native extraction.

**try/catch around every `JSON.parse` of an on-disk line (V5)** — `claude-jsonl-tree.mjs:266-274` (malformed line → skip, never throw).

---

### `lib/lsl/token/copilot-token-rows.mjs` (NEW — service, transform)

**Analog:** `lib/lsl/adapters/copilot-events.mjs` (`readSubAgentEvents` L142-158, `buildRow` L206-231, `discover` uid-check L271-285).

**Line-stream parse via the locked `parseCopilot` primitive (D-04 — do NOT write a new JSONL parser)** — `copilot-events.mjs:142-158`:
```javascript
import { parseCopilot } from '../../../src/live-logging/TranscriptNormalizer.js';
// ...
for await (const line of rl) {
  if (!line.trim()) continue;
  let parsed;
  try { parsed = parseCopilot(line); } catch { continue; }
  if (!parsed || parsed.type !== '<...>') continue;
  out.push(parsed);
}
```
Phase-69 reads raw lines for `type === 'session.shutdown'` (the existing adapter filters `'subagent'`);
the streaming + try/catch-per-line skeleton is identical.

**uid-check on each session dir (V4)** — `copilot-events.mjs:271-279` (same gate as Claude, statSync the session dir).

**Aggregate row build from `session.shutdown.modelMetrics` (ADAPT-02, D-04)** — RESEARCH Pattern 3, one row per model:
```javascript
const mm = evt?.data?.modelMetrics || {};
Object.entries(mm).map(([model, m]) => ({
  agent: 'copilot', provider: 'copilot', model,
  input_tokens: m.usage?.inputTokens ?? 0,
  output_tokens: m.usage?.outputTokens ?? 0,
  reasoning_tokens: m.usage?.reasoningTokens ?? 0,  // Pitfall 5: key may be absent — coalesce
  granularity_tier: 'per-session-aggregate',
  tool_call_id: model,
}));
```

**Vocabulary check + version-keyed verdict (D-04/D-09)** — enumerate distinct `type:` values; CLI is v1.0.63
(NOT the v1.0.48 in the stale `copilot-events.mjs:18` docstring — refresh it when touched). No per-turn token payload exists → aggregate is the only tier.

---

### `lib/lsl/token/task-id.mjs` (NEW thin wrapper — utility) OR inline in the two row modules

**Analog:** `scripts/measurement-start.mjs:29-52` (host-side dist import) + `src/measurement-span.ts:256-265` (`resolveLiveTaskId`).

**The single-reader import (D-03 — do NOT add a second JSON parser of active-measurement.json)** — `measurement-start.mjs:31-52`:
```javascript
import { pathToFileURL } from 'node:url';
const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR
  || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';
const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
const { resolveLiveTaskId } = await import(modUrl);
const task_id = resolveLiveTaskId(); // '' when no open span; NEVER throws (measurement-span.ts:256-265)
```
Use `resolveLiveTaskId()` per live row build. For completed-session rows write `task_id=''` then run the backfill join (below).

---

### `scripts/sweep-sub-agents.mjs` (MODIFY — provider, batch) + completed-session backfill

**Analog:** `scripts/backfill-task-id-by-timestamp.mjs` (`runSweep` L120-149, `loadArchivedSpans` L74-111).

**Reuse `runSweep` for completed-session task_id (D-03 — do NOT re-implement the timestamp join)** — `backfill-task-id-by-timestamp.mjs:122-123`:
```javascript
const updateStmt = db.prepare(
  "UPDATE token_usage SET task_id = ? WHERE task_id = '' AND timestamp >= ? AND timestamp <= ?");
```
Idempotent, never-clobbers a live-stamped value (`WHERE task_id = ''`), lexical ISO-8601 comparison.
After the sweep emits completed-session adapter rows with `task_id=''`, import/run this exact join.

**Dedup against live-captured turns (Pitfall 4)** — skip insert when a row with the same `(agent, tool_call_id)`
(Claude `requestId`; Copilot session-uuid+model) already exists. Check-then-insert or `INSERT ... WHERE NOT EXISTS`.

---

### `lib/lsl/live/claude-fs-watch.mjs` (MODIFY — watcher, streaming)

**Insertion point:** the `tailFile` `onMessage` callback, `claude-fs-watch.mjs:489-536`. Add an optional
`onTokenRow` hook ALONGSIDE the existing `opts.observationWriter.processMessages(...)` call (L504-513).
The exchange already carries the assistant record; the token hook extracts `usage` + `requestId` from the
same parsed line. Mirror the existing failure isolation at L530-534 (catch → `process.stderr.write` → `opts.onError`),
keeping the token write in its own try/catch so it can never break the observation path (D-08).

---

### `lib/lsl/live/copilot-events-tail.mjs` (MODIFY — watcher, event-driven)

**Insertion point:** the `tailEventsFile` per-line listener, `copilot-events-tail.mjs:281-302`. It currently
dispatches only `parsed.type === 'subagent'` (started/completed/failed). Add a branch for
`parsed.type === 'session.shutdown'` → emit the aggregate row. Keep each handler wrapped like the existing
`Promise.resolve(...).catch((err) => onError(err))` pattern (L293-297) for failure isolation.

---

### `scripts/sub-agent-live-{claude,copilot}.mjs` (MODIFY — provider/daemon, event-driven)

**Analog/insertion point:** `sub-agent-live-claude.mjs` ObservationWriter wiring (L161-207). Construct the
token-db handle (dynamic-import-guarded, same as `ObservationWriter` at L162-167 so `--help` works without
SQLite) and pass it as a new `onTokenRow`/`tokenDb` opt into `startClaudeWatcher({ ... })` at L202-207.
`sub-agent-live-copilot.mjs` is the sibling — wire identically. No plist change (D-08); `launchctl kickstart -k`
after the code change. Token writes stay best-effort so an emission failure never trips the error budget (L184-198).

---

### `scripts/sub-agent-sweep-job.sh` (MODIFY — config/launchd runner)

**Analog:** self. The runner just invokes `node scripts/sweep-sub-agents.mjs ...` (L100-104). If the token-row
emission rides inside `sweep-sub-agents.mjs`, this shell file likely needs **no edit** (additive in the .mjs).
Only touch if a separate backfill invocation must be appended after the sweep CLI returns 0 (L107-116 atomic-state pattern).

---

### `lib/lsl/adapters/claude-jsonl-tree.mjs` (READ-ONLY REUSE — no edit expected)

Consumed exports: `parentSessionFromClaudeSubagentPath` (L87), `agentIdFromClaudeSubagentPath` (L95),
`subHashFromAgentId` (L104), `computeSubIndexes` (L185), `SUBAGENT_PATH_RE` (L38). The `isSidechain`
first-record gate (L280) and uid-check (L251) live in the non-exported `buildRow` — re-apply the same
gates in the token module (do not bypass them by reading files directly).

---

## Shared Patterns

### Best-effort, never-throw write discipline
**Source:** `src/token-usage.ts:788-824` (`logCall`), `scripts/backfill-task-id-by-timestamp.mjs:140-144` (per-span skip), `copilot-events.mjs:399-402`.
**Apply to:** every token write, every file read, every `JSON.parse`. One bad line/file/span never aborts the pass; the token write never propagates into the LSL path (D-03/D-08).
```javascript
try { /* read | parse | insert */ } catch (err) {
  process.stderr.write(`[token-adapter] <op> failed (non-fatal): ${err.message}\n`);
}
```

### `no-console-log` — `process.stderr.write` only
**Source:** every analog uses `process.stderr.write(...)` for forensic output (`sub-agent-live-claude.mjs:21-22`, all adapters). No `console.log`. Apply to all new modules + tests.

### uid-check + project allowlist (V4 access control)
**Source:** `claude-jsonl-tree.mjs:251-258` (file uid), `copilot-events.mjs:271-285` (session-dir uid) + `PROJECT_ALLOWLIST_RE = /^[a-z0-9-]+$/i` (`copilot-events.mjs:41`).
**Apply to:** every session-file read in both token-row modules — fail closed on non-owned files; never traverse `..`.

### Parameterized statements only (V5 / SQL-injection)
**Source:** `token-usage.ts:574-581`, `backfill-task-id-by-timestamp.mjs:122-126`. Every value bound via `?`; never interpolate model name / task_id into SQL. `task_id` is additionally charset-validated upstream by `sanitizeTaskId` (`measurement-span.ts:83`).

### Distinct adapter `user_hash` for id-space isolation (Pitfall 2)
**Source:** `token-usage.ts:46-47,588-595`. Adapter rows use `'cladpt'`/`'copadt'` (matches `/^[a-z][a-z0-9]{5}$/`) so the second writer's `MAX(id)+1` never collides with the proxy's in-memory counter. **A1/OQ-2 in RESEARCH: confirm the hash with the user — it affects dashboard grouping.**

### node:test self-test fixture for CLI / concurrency
**Source:** `backfill-task-id-by-timestamp.mjs:194-256` (`--self-test` → `import('node:test')` + temp DB + `CREATE TABLE` fixture + assert). The WAL-concurrency acceptance test (`tests/token-adapters/wal-concurrency.test.mjs`) follows this exact shape against both the live `.data/llm-proxy/token-usage.db` (coexistence) and a temp DB (CI); PASS = `ok===N && busy===0`.

---

## No Analog Found

None. Every new and modified file has a concrete in-repo analog. The closest thing to "new" is the
host-side adapter INSERT (`token-db.mjs`), which is a direct port of the proxy's `logCall`/`insertStmt`
plus the backfill's open pattern — pattern-complete, not green-field.

---

## Metadata

**Analog search scope:** `lib/lsl/{adapters,live,token}`, `scripts/`, `tests/live-logging/`, `_work/rapid-llm-proxy/src/`.
**Files scanned:** 11 source analogs read + 1 test analog + 1 test dir listing.
**Key open decisions for the planner to surface (RESEARCH A1-A3 / OQ-1-3):** adapter `user_hash` value (dashboard impact), Claude reasoning-token estimation method (D-05 estimate vs zero vs drop), `requestId` dedup-key uniqueness verification.
**Pattern extraction date:** 2026-06-22
