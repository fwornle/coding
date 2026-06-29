# Phase 75: Measurement Attribution Accuracy & Observation Linkage - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 11 (8 modified, 3 net-new test files)
**Analogs found:** 11 / 11 (every new/modified file has a strong in-repo analog — this phase is a re-targeting/refactor, not net-new extraction)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/lsl/token/stop-adapter-registry.mjs` *(new)* | service / registry | file-I/O → batch | `lib/lsl/token/claude-token-rows.mjs` + `task-id.mjs` | role-match (registry is new shape; build/insert/resolve all exist) |
| `scripts/measurement-stop.mjs` *(modify)* | controller / orchestrator | batch + request-response | itself (in-file seam at `:297-313`) | exact (extend existing convergence point) |
| `lib/experiments/token-aggregate.mjs` *(modify)* | service | CRUD (read-only SUM) | itself (`aggregateByTaskId` `:62-100`) | exact (add a parallel fg/bg breakdown) |
| `lib/experiments/run-write.mjs` *(modify)* | model / persistence | CRUD (idempotent write) | itself (`writeRun` metadata block `:94-121`) | exact (add 3 metadata fields) |
| `lib/experiments/query.mjs` *(no change expected)* | service | CRUD (read) | itself (`readRuns` `...meta` spread `:106-110`) | exact (new fields auto-flow; verify only) |
| `src/live-logging/ObservationWriter.js` *(modify)* | service | event-driven (write) | itself (`writeObservation` `:1069`, created_at `:1126`) | exact (add task_id to metadata; created_at already honored) |
| `scripts/enhanced-transcript-monitor.js` (ETM) *(modify)* | service / daemon | streaming → event-driven | itself (`_firePromptSetObservation` `:768`, boundary `:1375`) | exact (refactor fire boundary + dedup key) |
| `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` *(modify)* | component | request-response (render) | itself (model cell `:159-161`) | exact (replace cell + add 2nd column) |
| `integrations/system-health-dashboard/src/components/performance/timeline.tsx` *(modify)* | component | request-response (render) | itself (`TurnLabel` `:77-102`) | exact (read canonical/bg fields) |
| `integrations/system-health-dashboard/src/components/performance/score-drawer.tsx` *(modify)* | component | request-response (render) | itself (`rationaleFor` `:51`) | exact (read persisted fields) |
| `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` *(modify)* | store | state | itself (`Run` interface `:42`) | exact (extend interface) |
| `tests/experiments/canonical-attribution.test.mjs` *(new)* | test | unit | `tests/experiments/token-aggregate.test.mjs` | exact (same temp-DB fixture pattern) |
| `tests/lsl/token/stop-adapter-registry.test.mjs` *(new)* | test | unit | `tests/lsl/token/*` + `tests/live-logging/adapter-claude.test.js` | role-match |
| `tests/live-logging/ETM-recapture.test.js` *(new)* | test | unit | `tests/live-logging/ObservationWriter.*.test.js` (jest) | role-match |
| `tests/e2e/performance/canonical-columns.spec.ts` *(new)* | test | e2e | `tests/e2e/<area>/<spec>.spec.ts` convention (CLAUDE.md) | role-match (gsd-browser) |

---

## Pattern Assignments

### `lib/lsl/token/stop-adapter-registry.mjs` (new — per-agent adapter registry, D-04)

**Analog:** `lib/lsl/token/claude-token-rows.mjs` (extractor) + `lib/lsl/token/task-id.mjs` (span reader) + `lib/lsl/token/token-db.mjs` (insert/user_hash constants).

**Imports pattern** (from `claude-token-rows.mjs:36-42`, `token-db.mjs:31-43`):
```javascript
import fs from 'node:fs';
import process from 'node:process';
import { buildClaudeTokenRows } from './claude-token-rows.mjs';
import {
  openTokenDb,
  insertTokenRowDeduped,
  ADAPTER_USER_HASH_CLAUDE,   // 'cladpt'
  ADAPTER_USER_HASH_COPILOT,  // 'copadt'
} from './token-db.mjs';
import { resolveLiveTaskIdSafe } from './task-id.mjs';
```

**Core registry pattern** (Pattern 1 in RESEARCH; keyed map of `{ mode, build?, locate? }`):
```javascript
// 'transcript' = build main-session rows + insert as cladpt (Claude bypasses proxy).
// 'stamp-only' = rows already in token_usage via proxy; gap is task_id, not capture.
// DO NOT add a transcript build for stamp-only agents — double-count (D-04 anti-pattern).
export const STOP_ADAPTERS = {
  claude:   { mode: 'transcript', userHash: ADAPTER_USER_HASH_CLAUDE, build: buildClaudeTokenRows },
  copilot:  { mode: 'stamp-only' }, // proxy-routed today; copadt adapter only if bypass-guard fires (A1/OQ2)
  opencode: { mode: 'stamp-only' },
  mastra:   { mode: 'stamp-only' },
};
```

**Capture-seam pattern** — reuse the extractor exactly as `claude-token-rows.mjs:82` does, then stamp + dedup-insert (mirrors `token-db.mjs:178` dedup contract). The extractor leaves `task_id: ''` (`claude-token-rows.mjs:186,221`) **by design** — the caller stamps:
```javascript
const taskId = await resolveLiveTaskIdSafe();           // task-id.mjs:64 — best-effort, never throws
const rows = buildClaudeTokenRows(mainSessionJsonl);    // works on non-subagent paths (parent_call_id='')
const db = openTokenDb(dbPath);
try {
  for (const r of rows) insertTokenRowDeduped(db, { ...r, task_id: taskId }); // (user_hash, tool_call_id) natural-key dedup
} finally { db.close(); }
```

**uid-gate (V4 — preserve):** `buildClaudeTokenRows` already applies `st.uid === process.getuid()` (`claude-token-rows.mjs:93-101`). Any NEW main-session locator (Pitfall 2) must NOT re-stat with weaker checks — pass the path straight to the extractor so the existing gate runs.

**Main-session locator (Pitfall 2):** locate by time-window (mtime/last-message-ts ∈ `[span.started_at, span.ended_at]`) — the same time-window approach `buildTraceSeam(normAgent, span)` already uses in `measurement-stop.mjs:325`.

---

### `scripts/measurement-stop.mjs` (modify — controller/orchestrator)

**Analog:** itself. The seam to replace is `:296-313` (today's `dominant = byAgentModel[0]` tag-sourcing).

**Current seam to REPLACE** (`:297-303` — the finding-B bug):
```javascript
const { totals, byAgentModel } = aggregateByTaskId(span.task_id);
const dominant = byAgentModel[0] ?? {};          // ← REJECTED by D-05 (never fall back to dominant)
const normAgent = normalizeAgent(dominant);
```

**Replacement pattern** (D-03 capture → D-05/D-06 compute; RESEARCH §Code Examples):
```javascript
// (3.0) D-03 batch capture BEFORE aggregation so fg rows exist when we sum.
await captureForegroundTokens(span);   // stop-adapter-registry dispatch (claude → transcript)

// (3.1) aggregate, then derive fg/bg from the new breakdown.
const { totals, byAgentModel } = aggregateByTaskId(span.task_id);
const fgGroups = byAgentModel.filter(isForegroundGroup);   // from token-aggregate helper
const bgGroups = byAgentModel.filter(g => !isForegroundGroup(g));
const canonical = fgGroups[0] ?? null;                     // D-05: null, NOT byAgentModel[0]
const canonicalModel = canonical?.model ?? null;
const canonicalAgent = canonical ? normalizeAgent(canonical) : null;
const backgroundModels = bgGroups.map(g => ({ model: g.model, process: g.process, total_tokens: g.total_tokens }));
```

**Tag-passing pattern** (extend the existing `tags` object `:307-313`, then `writeRun` at `:334`):
```javascript
const tags = {
  task_hash: taskHash,
  agent: canonicalAgent ?? null,        // canonical replaces normAgent/dominant.agent
  model: canonicalModel ?? null,
  framework: span.meta?.framework ?? canonicalAgent ?? null,
  trace_id: span.task_id,
  canonical_model: canonicalModel,      // NEW (D-06)
  canonical_agent: canonicalAgent,      // NEW (D-06)
  background_models: backgroundModels,  // NEW (D-06)
};
```

**Error-handling convention (inherit):** stop is a "never hard-block" orchestrator — capture must be best-effort. Wrap `captureForegroundTokens` so a failure logs `process.stderr.write` and continues, exactly as `task-id.mjs:73-78` and the score path at `:336-347` do. Output via `process.stdout.write`/`process.stderr.write` only (no-console-log rule, file header `:33-34`).

**Double-count guard (A1):** add a stop-time warning when an in-scope agent ran with NO proxy rows AND NO adapter rows (detects an Anthropic-direct bypass for opencode/mastra). One `process.stderr.write` warning line, non-fatal.

---

### `lib/experiments/token-aggregate.mjs` (modify — service, read-only CRUD)

**Analog:** itself (`aggregateByTaskId` `:62-100`). Add a fg/bg classifier and (optionally) a parallel breakdown — do NOT change the readonly open or the bound-`?` discipline.

**Derivation pattern** (RESEARCH §Code Examples; Discretion D-02 = aggregation-time, no schema migration):
```javascript
const BACKGROUND_PROCESS_RE = /^(consolidator-|health-coordinator$|observation-writer$|backfill$|reproject-|route-judge$)/;
const FOREGROUND_USER_HASHES = new Set(['cladpt', 'copadt']); // adapter rows (claude/copilot)
export function isForegroundGroup(g) {
  return FOREGROUND_USER_HASHES.has(g.user_hash) && !BACKGROUND_PROCESS_RE.test(g.process || '');
}
```

**Constraint to preserve** (`:76` and `:85,91`): `{ readonly: true, fileMustExist: true }` open + every `task_id` bound as `?` (NEVER interpolated). To classify by `user_hash`/`process` the `byAgentModel` SELECT (`:88-94`) must add `user_hash, process` to its `SELECT`/`GROUP BY` — keep the `ORDER BY total_tokens DESC` and the COALESCE-zero-totals fallback (`:42-50,68-70`).

---

### `lib/experiments/run-write.mjs` (modify — model/persistence)

**Analog:** itself (`writeRun` metadata block `:94-121`).

**Add pattern** (RESEARCH Pattern 2 — alongside the existing 8 tags at `:101-113`):
```javascript
// inside metadata: { ... } of the Run putEntity:
canonical_model:   t.canonical_model ?? null,     // fg chat agent's model, or null (legacy)
canonical_agent:   t.canonical_agent ?? null,
background_models: t.background_models ?? [],      // [{ model, process, total_tokens }]
```

**Conventions to preserve:** strict-path `putEntity` with synthetic `provenance` (`:76-81,122`); `null` is meaningful, never `?? 0` (`:58-60`); `domain: 'experiment'` bucketing (`:99`); idempotent re-close updates the same node via the `metadata.task_id` scan (`:66-72`). No ontology edit needed — new fields ride in `metadata` (same as the six heuristics, `:114-120`).

**Read path (verify, likely no change):** `query.mjs:106-110` spreads `...meta`, so `canonical_model`/`background_models` auto-flow to every dashboard surface. Confirm with a `run-read`/`runs-endpoint` test assertion.

---

### `src/live-logging/ObservationWriter.js` (modify — service, event-driven, OBS-01)

**Analog:** itself (`writeObservation` `:1069`; created_at source `:1124-1127`).

**created_at is ALREADY correct** (`:1126`) — honors the earliest message `createdAt`. The ETM fix (below) supplies the RIGHT batch-local messages; this file needs only the task_id:
```javascript
const messageTimestamp = messages.find(m => m.createdAt)?.createdAt;  // :1126 — DO NOT change
const nowISO = messageTimestamp || new Date().toISOString();
```

**task_id-stamp pattern (D-09):** resolve via the SAME single-span reader the token path uses, and put it on `metadata` before the `legacyObservationToEntity` build (`:1139-1163`). Resolve at the ETM call site (preferred — keeps the writer proxy-free) OR here behind a best-effort wrapper. The metadata object is already serialized into the entity (`:1147`):
```javascript
const taskId = metadata.task_id ?? (await resolveLiveTaskIdSafe());  // never throws (task-id.mjs:64)
// ...
entity.metadata = { ...entity.metadata, source: 'auto', task_id: taskId };  // extend the existing :1163 spread
```

**Conventions to preserve:** `_redact` runs before persist (`:1116-1121,1147`); content-hash + semantic dedup (`:1096-1111`); `skipOntologyCheck: true` for Observation/Digest/Insight (`:1164`); `process.stderr.write` logging only.

---

### `scripts/enhanced-transcript-monitor.js` (ETM) (modify — daemon, streaming→event-driven, OBS-02)

**Analog:** itself (`_firePromptSetObservation` `:768-870`; prompt-set boundary `:1375`).

**Current boundary (the bug, `:1375`):** a new set starts ONLY on a typed user prompt → one fire per 9-hour session, all messages, `created_at` = first exchange.

**Fix pattern (D-07/D-08):** add mid-set fire points and pass ONLY the batch's exchanges so `ObservationWriter`'s earliest-`createdAt` (`:1126`) resolves to the batch's real time. Reuse the existing per-exchange timestamp stamping at `:799,835`:
```javascript
createdAt: new Date(exchange.timestamp).toISOString(),  // :799/:835 — already per-message; keep as-is
```

**Fire triggers:**
- (a) on an `AskUserQuestion` tool_use + tool_result pair (decision boundary — the natural steering point);
- (b) on a "significant tool-activity batch" between decisions. **Discretion threshold (RESEARCH A4):** fire when ≥ 8 `tool_use` blocks OR ≥ 10 min elapsed since the last fire within a question-less stretch.

**Dedup pattern (Pitfall 4) — change the unit, change the key:** the existing dedup is `_firedPromptKeys` keyed `count|lastExchangeId` with a 15s window (`:774-788`). For per-batch firing, advance a `lastFiredExchangeUuid` cursor per transcript on each mid-set fire (the next batch starts after it), using the batch's LAST message uuid — the code already prefers `lastMessageUuid` over `id` for cursor advance (`:522-523,594-595,633-634`). OBS dedup key becomes `(task_id, batch-last-message-uuid)`.

**task_id at fire (D-09):** resolve `resolveLiveTaskIdSafe()` once and pass it in the metadata object built at `:865-870` so it reaches `ObservationWriter.writeObservation`'s metadata.

---

### Dashboard two-column model render (ATTR-02 — runs-table / timeline / score-drawer)

**Analog:** `runs-table.tsx` model cell (`:159-161`), `timeline.tsx` `TurnLabel` (`:77-102`), `score-drawer.tsx` field reads (`:51-58`).

**runs-table.tsx — replace the `run.model` cell** (`:159-161`) with canonical + a second bg column (RESEARCH §Code Examples; Discretion empty-canonical string):
```tsx
{/* canonical (chat) model */}
<TableCell className="text-sm text-muted-foreground">
  {run.canonical_model
    ? <span className="font-mono">{run.canonical_model}</span>
    : <span className="text-muted-foreground italic">unmeasured</span>}
</TableCell>
{/* background-service models */}
<TableCell className="text-sm text-muted-foreground">
  {run.background_models?.length
    ? run.background_models.map(b => b.model).join(', ')
    : <span className="text-muted-foreground">—</span>}
</TableCell>
```
Add the matching `<TableHead>` next to the existing "Model" header (`:114`). **Null-not-zero/em-dash convention** is already established here (`num()` `:41-43`) — reuse the `—` sentinel idiom; "unmeasured" is the D-05 empty-canonical sentinel (NEVER silently fall back to dominant).

**timeline.tsx** — `TurnLabel` already renders `row.process` + `row.model` per turn (`:84-99`), which is exactly the fg-vs-bg distinction at the row level. New work is reading the Run-level `canonical_model`/`background_models` for any header/summary; keep the `fmtTime`/`tokens` null-guards (`:25-36`) and `data-testid` hooks.

**score-drawer.tsx** — read the persisted fields via the same best-effort `run?.…` idiom as `rationaleFor` (`:51-58`); display canonical model in the drawer header.

**performanceSlice.ts — extend the `Run` interface** (`:42-79`, which already has `agent`/`model`):
```typescript
canonical_model?: string | null
canonical_agent?: string | null
background_models?: { model: string; process: string; total_tokens: number }[]
```
Mirror the existing optional-nullable field style (`:44-46`). Facet wiring (`:677-680`) already keys on `run.model ?? '—'` — extend if canonical should drive the facet.

**Build/deploy (CLAUDE.md / RESEARCH Runtime State):** dashboard is bind-mounted — after `.tsx` edits run `npm run build` + `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` (NO Docker rebuild). E2E-verify with `gsd-browser` on `localhost:3032`.

---

### Test files

**`tests/experiments/canonical-attribution.test.mjs`** (new) — analog `tests/experiments/token-aggregate.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';   // better-sqlite3 temp DB (:27-35)
```
Reuse the `createTokenUsageTable`/`insertRow` temp-DB fixture (`token-aggregate.test.mjs:38-70`) — add `user_hash`, `process` columns. Seed cladpt fg rows + c197ef daemon rows; assert `isForegroundGroup` segregates them and `canonical` = the cladpt model (never `byAgentModel[0]`). Live assertions gate on an env var (`EXPERIMENTS_LIVE`), NEVER a `--live` argv (MEMORY.md `reference_node_test_argv_live_gate`; header note `:21-23`).

**`tests/lsl/token/stop-adapter-registry.test.mjs`** (new) — analog `tests/live-logging/adapter-claude.test.js` + `tests/experiments/token-aggregate.test.mjs`. Assert registry dispatch: `claude` → `transcript` (builds + inserts cladpt rows on a fixture main-session JSONL), `copilot`/`opencode`/`mastra` → `stamp-only` (NO transcript build — the double-count guard). Acceptance grep gate (RESEARCH Wave 0): grep the stop path for the time-window seam + the `cladpt` insert.

**`tests/live-logging/ETM-recapture.test.js`** (new, **jest** — ETM/ObservationWriter use jest per RESEARCH §Test Framework) — analog `tests/live-logging/ObservationWriter.*.test.js`. Fixture: transcript with typed prompt @T0 + AskUserQuestion decisions @T0+n (model the real `e0af5b8b` case: last typed prompt 21:00:43Z, decisions 05:30–06:03Z). Assert observations dated ~T0+n (not T0), carry `metadata.task_id`, and no duplicate per `(task_id, batch-last-message-uuid)`.

**`tests/e2e/performance/canonical-columns.spec.ts`** (new) — convention `tests/e2e/<area>/<spec>.spec.ts`, run via `npx playwright test` OR `gsd-browser` (CLAUDE.md). Assert the two columns render and the empty-canonical sentinel shows for a legacy Run.

---

## Shared Patterns

### Single-span task_id resolution (D-09 — token path AND observation path agree)
**Source:** `lib/lsl/token/task-id.mjs:64-79` (`resolveLiveTaskIdSafe`)
**Apply to:** stop-adapter-registry (ATTR-03), ObservationWriter/ETM (OBS-01)
```javascript
const taskId = await resolveLiveTaskIdSafe();  // best-effort, returns '' / never throws
```
Both paths MUST use this same reader (no second span-file parser) so token attribution and observation linkage resolve the identical active task_id.

### Idempotent token insert (ATTR-03)
**Source:** `lib/lsl/token/token-db.mjs:178-195` (`insertTokenRowDeduped`)
**Apply to:** the stop-path foreground capture
`(user_hash, tool_call_id)` natural-key dedup — safe to re-run a measurement-stop without double-inserting.

### Best-effort / never-hard-block error handling
**Source:** `task-id.mjs:73-78`, `token-db.mjs:140-145`, `measurement-stop.mjs:336-352`
**Apply to:** all new stop-path + ETM code
Catch, `process.stderr.write('[…] failed (non-fatal): …')`, continue. The close must never crash on a capture/resolve failure.

### Null-not-zero / em-dash sentinel (display + persistence)
**Source:** `run-write.mjs:58-60`, `query.mjs:96-98`, `runs-table.tsx:41-43`, `timeline.tsx:25-27`
**Apply to:** canonical_model persistence + all three dashboard surfaces
`null` means "could not compute / unmeasured" and is preserved AS-IS — never coerced to 0. Empty canonical renders the D-05 sentinel ("unmeasured" / "—"), never a dominant fallback.

### Compute-once-at-stop, persist-on-Run, read-everywhere (D-06)
**Source:** `run-write.mjs` metadata block (`:94-121`) + `query.mjs` `...meta` spread (`:106-110`)
**Apply to:** canonical/background derivation
Compute once in `measurement-stop.mjs`, write to `Run.metadata`, let `readRuns` spread it to every surface. No per-surface recompute (that divergence IS finding B).

### Proxy DB sole-writer / second-writer discipline (Security V5)
**Source:** `token-aggregate.mjs:74-76` (`readonly:true`), `token-db.mjs:84-88` (`fileMustExist:true` + distinct `cladpt`/`copadt` user_hash + busy_timeout)
**Apply to:** aggregation (read) + adapter inserts (write)
Coding is a SECOND writer only. Aggregate readonly; adapter inserts use the distinct adapter user_hash. DO NOT add a column/migration to the proxy-owned DB (D-02 → aggregation-time derivation instead).

### uid-gate on transcript reads (Security V4)
**Source:** `claude-token-rows.mjs:93-101` (`st.uid === process.getuid()`)
**Apply to:** any new main-session JSONL locator
Pass located paths through `buildClaudeTokenRows` so the existing uid-gate runs; never weaken it.

---

## No Analog Found

None. Every file in scope extends or refactors an existing in-repo module with a strong analog. The only NEW shape — the per-agent adapter registry (`stop-adapter-registry.mjs`) — composes three existing primitives (`buildClaudeTokenRows`, `insertTokenRowDeduped`, `resolveLiveTaskIdSafe`) rather than introducing new extraction.

## Metadata

**Analog search scope:** `lib/lsl/token/`, `lib/experiments/`, `scripts/`, `src/live-logging/`, `integrations/system-health-dashboard/src/components/performance/`, `integrations/system-health-dashboard/src/store/slices/`, `tests/experiments/`, `tests/lsl/token/`, `tests/live-logging/`
**Files scanned:** ~14 source + 3 test-dir listings
**Pattern extraction date:** 2026-06-29
