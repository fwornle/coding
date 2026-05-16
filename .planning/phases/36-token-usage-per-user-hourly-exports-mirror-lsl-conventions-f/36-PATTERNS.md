# Phase 36: token-usage per-user hourly exports — Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** 7 (5 modified + 1 new + 1 deleted)
**Analogs found:** 7 / 7 (all have strong same-codebase analogs)

> Scope sourced from CONTEXT.md "Files in play" + "Proposed waves" (no
> RESEARCH.md by project convention). Analogs come from the live coding
> repo and the `_work/rapid-llm-proxy` submodule (located at
> `/Users/Q284340/Agentic/_work/rapid-llm-proxy/`, NOT `coding/_work/`).

---

## File Classification

| New/Modified File | Wave | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `scripts/health-coordinator.js` (publish `lsl.current_window`) | W1 | coordinator-publisher | poll-tick, in-memory state | same file — existing `lsl_by_project` slot + `runAllChecks()` lsl block (line 1071) | exact (in-file) |
| `_work/rapid-llm-proxy/src/token-usage.ts` (writer rewrite + schema mig) | W2+W3 | writer + reader + schema-mig | event-driven debounced write, cold-start hydration | same file — `exportToJson()` (line 190), `restoreFromJsonIfEmpty()` (line 134), `initTokenDb()` (line 93) + `scripts/lsl-paths.js` (recursive walk + YYYY/MM layout) | exact (extends in-file) |
| `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (coordinator URL wiring) | W2 | submodule-bridge / config | request-response (`execSync curl`) | same file — `detectNetworkMode()` (line 201) already curls coordinator | exact (in-file) |
| `bin/coding` (export `LLM_PROXY_USER_HASH`) | W4 | config-launcher / env-export | shell env-export | same file — env-export block lines 290-309 | exact (in-file) |
| `.gitignore` (WAL/SHM coverage) | W5 | gitignore | none | line 180 `*.db` block | exact (in-file) |
| `scripts/migrate-token-usage-export.mjs` (NEW) | W5 | migration-script | batch, file-I/O + SQLite read | `scripts/migrate-lsl-to-yyyymm.js` (bucket-by-filename → YYYY/MM) + `scripts/backfill-raw-observations.mjs` (one-shot SQLite-driven script) | role-match (combine both) |
| `.data/llm-proxy-export/token-usage.json` (DELETE in mig commit) | W5 | data file | n/a | n/a — deletion | n/a |

**Anomaly:** the launchd plist (`~/Library/LaunchAgents/com.coding.llm-cli-proxy.plist`) is also "in play" in spirit because Wave 4 requires `LLM_PROXY_USER_HASH` to reach the proxy process. `launchd` does NOT inherit shell env, so `export LLM_PROXY_USER_HASH=…` in `bin/coding` only helps if the proxy is spawned by `bin/coding` (it is not — it is launched by launchd). Planner must address this: either add the env var to the plist's `EnvironmentVariables` dict (same pattern as `LLM_PROXY_DATA_DIR` already there), OR have `start-llm-proxy.sh` compute the hash itself by shelling out to `node scripts/user-hash-generator.js`. See "Risks / landmines" per-file below.

---

## Pattern Assignments

### 1. `scripts/health-coordinator.js` — publish `state.lsl.current_window` (Wave 1)

**Role:** coordinator-publisher · **Data flow:** poll-tick, in-memory state mutation

**Analog (same file):** existing `lsl_by_project` slot in `currentState` + the LSL block of `runAllChecks()`.

**Existing imports block** (lines 31–45) — the new code needs `getTimeWindow` from a sibling script:
```javascript
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';
import { probeHttpHealth, probeTcpPort } from '../lib/utils/service-probe.js';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import os from 'node:os';
import ProcessStateManager from './process-state-manager.js';
```
**Add:** `import { getTimeWindow, utcToLocalTime } from './timezone-utils.js';`

**Existing `currentState` shape — where to insert the new field** (lines 157–206):
```javascript
const currentState = {
  container: { healthcheck: 'unknown', last_probe_end: null },
  services: [],
  lsl: {},                                  // <-- per-session map, keyed by sid:projectName
  lsl_by_project: {},                       // <-- rollup
  processes: [],
  databases: { status: 'unknown' },
  files: [],
  knowledge_pipeline: { … },
  proxy: { … },
  network: { location: 'unknown', … },
  generated_at: new Date(STARTED_AT).toISOString(),
  coordinator_uptime_s: 0
};
```
**Difference to apply:** the `lsl` slot is a `Record<sid:project, entry>`, NOT the right place for `current_window` (which is a single global value). Add a new sibling field at the top level — call it `lsl_current_window` OR nest it under a fresh `lsl_meta: { current_window: '0900-1000' }`. CONTEXT.md uses `state.lsl.current_window` — but `lsl` is a `Record<>`, so adding `current_window` directly into it would collide with session keys. Planner should pick one of:
- **(a)** `state.lsl_current_window` (top-level, breaks dotted CONTEXT path but is type-safe)
- **(b)** `state.lsl_meta.current_window` (new namespace, future-friendly)
- **(c)** `state.lsl.current_window` literally — works because session keys are `<sid>:<project>` which never collides with the bare string `current_window`, but is type-confusing (mixes value shapes).
- Recommend **(b)** for clean shape; document the CONTEXT.md path in the plan.

**Existing poll-tick entry-point** — where to call the new populate (`runAllChecks` body around line 1063–1071):
```javascript
async function runAllChecks() {
  // ----- Network environment detection (every 30s) -----
  …
  // ----- Container healthcheck (SPEC R7) -----
  try {
    currentState.container = pollDockerHealth();
  } catch (err) { … }

  // ----- LSL staleness + project rollup (signals were ingested between ticks) -----
  try {
    const lslMode = shouldInject('lsl');
    …
    refreshLslStaleness();
    …
```
**Add (cheap, no I/O):** right before or after the LSL block — compute window from local time and store. Pattern:
```javascript
// ----- LSL window (cheap clock-only compute; consumers may read this
// instead of computing locally, dedupes window source) -----
try {
  const local = utcToLocalTime(new Date());
  currentState.lsl_meta = { current_window: getTimeWindow(local) };
} catch (err) {
  log(`lsl current_window compute threw: ${err.message}`, 'ERROR');
  // SPEC R6 — never substitute 'healthy'/synthetic on error; clear the field.
  if (currentState.lsl_meta) currentState.lsl_meta.current_window = 'unknown';
}
```

**Smoke-test target** (per CONTEXT.md Wave 1):
```bash
curl -s http://127.0.0.1:3034/health/state | jq .lsl_meta.current_window
# → "0900-1000"
```

**Risks / landmines:**
- `getTimeWindow` reads `config/live-logging-config.json` on **every call** (see timezone-utils.js:85). At 5s tick × continuous uptime that's 17,000+ fs reads/day. Cache the `sessionDurationMs` once at coordinator init, or memoize behind `Symbol.for('lsl-window-cache')`.
- `getTimeWindow` uses `localDate.getHours()` — it relies on the JS engine's `TZ`. Plist sets only `PATH`; coordinator inherits launchd's `TZ` (UTC by default on macOS launchd contexts). The statusline runs in a tmux/login shell with `TZ` set. **Result: coordinator-published window may differ from statusline-computed window by `Europe/Berlin` offset.** Mitigation: explicitly compute local via `utcToLocalTime(new Date())` (already in timezone-utils.js — uses `Intl.DateTimeFormat` with the project timezone), DON'T pass a bare `new Date()`.
- CONTEXT.md says "consumers stay on local computation in v1" — so this Wave 1 publish is **observation only**, no consumer rewrites. Don't be tempted to flip the dashboard / statusline at the same time.

---

### 2. `_work/rapid-llm-proxy/src/token-usage.ts` — writer rewrite + schema migration (Waves 2 & 3)

**Role:** writer (event-driven debounced) + reader (cold-start hydration) + schema-migration
**Data flow:** debounced write per LLM completion · recursive read on init

**Analog (same file):** `exportToJson()` (lines 190–224), `restoreFromJsonIfEmpty()` (lines 134–178), `initTokenDb()` (lines 93–127), `scheduleExport()` debounce (lines 232–242). Plus cross-file analog: `scripts/lsl-paths.js` for the YYYY/MM layout and `lslListAll()` recursive walker.

**Existing single-file path resolver** (lines 76–83 — keep for DB path, replace for export):
```typescript
export function resolveTokenExportPath(overrideDataDir?: string): string {
  const explicit = process.env.LLM_PROXY_TOKEN_EXPORT_PATH;
  if (explicit) return explicit;
  const dataDir = overrideDataDir
    || process.env.LLM_PROXY_DATA_DIR
    || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'llm-proxy-export', 'token-usage.json');
}
```
**Difference to apply (Wave 2):** add `resolveTokenExportDir(overrideDataDir?)` that returns the base dir (drops trailing filename); keep `resolveTokenExportPath` for legacy callers but mark `@deprecated`. New function signature:
```typescript
export function resolveTokenExportDir(overrideDataDir?: string): string {
  const explicit = process.env.LLM_PROXY_TOKEN_EXPORT_DIR;
  if (explicit) return explicit;
  const dataDir = overrideDataDir
    || process.env.LLM_PROXY_DATA_DIR
    || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'llm-proxy-export');
}
```

**LSL YYYY/MM layout to mirror** (`scripts/lsl-paths.js` lines 17–49):
```javascript
const DATE_RE = /(\d{4})-(\d{2})-\d{2}/;
export function dateSubdirFromFilename(filename) {
  const m = filename.match(DATE_RE);
  if (!m) return null;
  return path.join(m[1], m[2]);
}
export function lslPath(baseDir, filename) {
  const sub = dateSubdirFromFilename(filename);
  if (!sub) return path.join(baseDir, filename);
  return path.join(baseDir, sub, filename);
}
export function lslWritePath(baseDir, filename) {
  const full = lslPath(baseDir, filename);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}
```
**Difference to apply:** reimplement inline in TS (port — don't import the JS module across submodule boundary; rapid-llm-proxy stays standalone per CONTEXT.md "Proxy does not depend on coding-side modules"). Filename template changes from `.md` to `.json`.

**LSL filename template** (`scripts/timezone-utils.js` lines 195–222):
```javascript
const localDate = utcToLocalTime(timestamp);
const year = localDate.getFullYear();
const month = (localDate.getMonth() + 1).toString().padStart(2, '0');
const day = localDate.getDate().toString().padStart(2, '0');
const timeWindow = getTimeWindow(localDate);     // 'HHMM-HHMM'
const userHash = UserHashGenerator.generateHash({ debug: options.debug });
const partSuffix = options.partNumber ? `-${options.partNumber}` : '';
const baseName = `${year}-${month}-${day}_${timeWindow}${partSuffix}_${userHash}`;
return `${baseName}.md`;
```
**Difference to apply:** same template but `.json`. **DROP** the `_from-<project>` suffix per CONTEXT.md line 51 ("each proxy owns its own `.data/`"). Drop the part-number suffix (no need for splitting hour-level files). Source `userHash` from `process.env.LLM_PROXY_USER_HASH || 'unknown'` per CONTEXT.md decision (a). Filename: `YYYY-MM-DD_HHMM-HHMM_<hash6>.json`.

**Existing `exportToJson()` pattern to extend** (lines 190–224) — adapt the safety-merge block per-hour:
```typescript
export function exportToJson(handle: TokenUsageDb): void {
  try {
    const exportPath = resolveTokenExportPath();
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });

    const dbRows = handle.db.prepare(`
      SELECT id, timestamp, provider, model, process, subscription,
             input_tokens, output_tokens, total_tokens, latency_ms,
             prompt_preview, tokens_estimated
      FROM token_usage
      ORDER BY id ASC
    `).all();

    let merged = dbRows;
    try {
      const existing = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
      if (Array.isArray(existing) && existing.length > dbRows.length) {
        const dbIds = new Set(dbRows.map((r: any) => r.id));
        const preserved = existing.filter((r: any) => !dbIds.has(r.id));
        merged = [...preserved, ...dbRows];
        process.stderr.write(
          `[token-usage] Safety merge: kept ${preserved.length} historic + ${dbRows.length} current = ${merged.length} total\n`
        );
      }
    } catch { /* first export or unreadable — overwrite with dbRows */ }

    const content = JSON.stringify(merged, null, 2) + '\n';
    try {
      if (fs.readFileSync(exportPath, 'utf-8') === content) return; // no-op write
    } catch { /* file doesn't exist yet — write it */ }
    fs.writeFileSync(exportPath, content, 'utf-8');
  } catch (err) {
    process.stderr.write(`[token-usage] export failed (non-fatal): ${(err as Error).message}\n`);
  }
}
```
**Difference to apply (Wave 2):**
- Replace with `exportToHourFile(handle, now: Date)`:
  - Fetch window from coordinator (cached 30s, see proxy-bridge `detectNetworkMode` pattern) with local fallback (recompute from `now`).
  - Compute filename: `YYYY-MM-DD_HHMM-HHMM_<hash>.json`.
  - Build target path via inline `lslWritePath()` port.
  - SELECT only rows in `[windowStart, windowEnd)` AND with matching `user_hash` (Wave 3 column) — per CONTEXT.md the per-file scope is `(window, hash)`. Each file holds **this user's** rows for **this window only**.
  - Keep the dedup-on-write check (`if existing JSON.parse(content) === new content, no-op`) to avoid churn during a debounce burst.
  - Safety merge by `id` becomes safety merge by `(user_hash, id)` — preserves rows from a teammate's previous push if local DB lacks them. Critical for git-pull-then-push flow.

**Existing debounce — replace with per-window keying** (lines 232–242):
```typescript
const EXPORT_DEBOUNCE_MS = 2000;
let _exportTimer: NodeJS.Timeout | null = null;
function scheduleExport(handle: TokenUsageDb): void {
  if (_exportTimer) return;
  _exportTimer = setTimeout(() => {
    _exportTimer = null;
    exportToJson(handle);
  }, EXPORT_DEBOUNCE_MS);
  _exportTimer.unref();
}
```
**Difference to apply (Wave 2):** keyed-per-window debounce + hour-boundary flush:
```typescript
const EXPORT_DEBOUNCE_MS = 2000;
const _exportTimers = new Map<string, NodeJS.Timeout>(); // key = window string
function scheduleExport(handle: TokenUsageDb, now: Date): void {
  const window = currentWindow(now);            // 'HHMM-HHMM'
  if (_exportTimers.has(window)) return;
  const t = setTimeout(() => {
    _exportTimers.delete(window);
    exportToHourFile(handle, now);
  }, EXPORT_DEBOUNCE_MS);
  t.unref();
  _exportTimers.set(window, t);
}
// Hour-boundary flush: when a new logCall arrives and its window != all
// pending timer windows, the pending ones must FLUSH IMMEDIATELY rather
// than wait for their 2s timer (which would write to the wrong file at
// XX:59:58 → XX:00:00 boundary if the next call is at XX:00:01).
```
**Hour-boundary critical landmine:** at the XX:00 boundary, a row written at 09:59:59 belongs in `…_0900-1000_…json` and a row at 10:00:01 belongs in `…_1000-1100_…json`. The window-keyed map ensures both timers can be pending simultaneously, but the SELECT must filter by timestamp range, NOT by "all rows since last export" — otherwise the 09:59:59 row will be written into the 1000-1100 file at the next flush. SELECT `WHERE timestamp >= ? AND timestamp < ?` with window-start and window-end ISO strings.

**Existing schema-init (Wave 3 — add migration in-place)** (lines 98–116):
```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS token_usage (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,
    provider        TEXT    NOT NULL,
    model           TEXT    NOT NULL,
    process         TEXT    NOT NULL DEFAULT 'unknown',
    subscription    TEXT    NOT NULL DEFAULT 'unknown',
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    prompt_preview  TEXT    NOT NULL DEFAULT '',
    tokens_estimated INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
  CREATE INDEX IF NOT EXISTS idx_token_usage_process   ON token_usage(process);
  CREATE INDEX IF NOT EXISTS idx_token_usage_provider  ON token_usage(provider);
`);
```
**Difference to apply (Wave 3):** add a `migrate()` block AFTER the `CREATE TABLE IF NOT EXISTS` and BEFORE the prepared statements. Idempotent — guard each step with a `PRAGMA table_info` check:
```typescript
const cols = db.prepare(`PRAGMA table_info(token_usage)`).all() as Array<{ name: string }>;
const hasUserHash = cols.some(c => c.name === 'user_hash');
if (!hasUserHash) {
  db.exec(`ALTER TABLE token_usage ADD COLUMN user_hash TEXT NOT NULL DEFAULT 'unknown'`);
}
// Unique index for dedup-on-hydrate (CONTEXT.md decision (c))
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_hash, id)`);
```
SQLite's `ALTER TABLE ADD COLUMN` requires a constant default (`NOT NULL DEFAULT 'unknown'` is constant — fine). The unique index name `idx_token_usage_user_id` is per CONTEXT.md Wave 3.

**Existing `restoreFromJsonIfEmpty` — REPLACE with `hydrateFromExports`** (lines 134–178):
```typescript
function restoreFromJsonIfEmpty(handle: TokenUsageDb, overrideDataDir?: string): void {
  try {
    const count = (handle.db.prepare('SELECT COUNT(*) as c FROM token_usage').get() as { c: number }).c;
    if (count > 0) return;                       // <-- THE BUG: cross-user merge never runs
    const exportPath = resolveTokenExportPath(overrideDataDir);
    let rows: any[];
    try { rows = JSON.parse(fs.readFileSync(exportPath, 'utf-8')); } catch { return; }
    if (!Array.isArray(rows) || rows.length === 0) return;
    const insertWithId = handle.db.prepare(`INSERT INTO token_usage (id, …) VALUES (?, …)`);
    const tx = handle.db.transaction((arr: any[]) => { for (const r of arr) insertWithId.run(…); });
    tx(rows);
    process.stderr.write(`[token-usage] Restored ${rows.length} rows from ${exportPath}\n`);
  } catch (err) {
    process.stderr.write(`[token-usage] restore failed (non-fatal): ${(err as Error).message}\n`);
  }
}
```
**Difference to apply (Wave 3):** new `hydrateFromExports(handle)` that:
- **ALWAYS runs on init** (drop the `count > 0 → return` guard — that's the critical change so cross-user pull adds peer rows even when your local DB has data).
- Walk `<baseDir>/**/*.json` with a recursive walker ported from `scripts/lsl-paths.js:lslListAll()` (lines 69–87):
  ```javascript
  export function lslListAll(baseDir, predicate = (name) => name.endsWith('.md')) {
    const results = [];
    const ignoreDirs = new Set(['.git', 'node_modules']);
    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || ignoreDirs.has(e.name)) continue;
          walk(path.join(dir, e.name));
        } else if (predicate(e.name)) {
          results.push(path.join(dir, e.name));
        }
      }
    }
    walk(baseDir);
    return results;
  }
  ```
  Port to TS, predicate `name.endsWith('.json')`.
- For each file: parse filename → extract `<hash6>` suffix (regex `_([a-z][a-z0-9]{5})\.json$`); parse JSON → INSERT with `ON CONFLICT(user_hash, id) DO NOTHING` so the unique index dedups idempotently:
  ```typescript
  const insertOnConflict = handle.db.prepare(`
    INSERT INTO token_usage (
      id, timestamp, provider, model, process, subscription,
      input_tokens, output_tokens, total_tokens, latency_ms,
      prompt_preview, tokens_estimated, user_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_hash, id) DO NOTHING
  `);
  ```
- For each row missing `user_hash` (e.g. legacy file format), backfill from the filename suffix.

**Risks / landmines:**
- **`restoreFromJsonIfEmpty` → `hydrateFromExports` semantic change:** the old behavior skipped hydration on non-empty DB. Wave 3 must ALWAYS run hydration so a `git pull` of a new peer's `_g9b30a.json` file actually shows up in your dashboard. The old `count > 0 → return` is the bug; explicitly call this out in the plan.
- **SQLite WAL/SHM:** the `.db-wal` file is what CONTEXT.md "Verified facts" identifies as the source of dirty `git status`. The unique-index addition triggers an extra checkpoint on the WAL — at 1457 rows it's fine, but **make sure to call `db.pragma('wal_checkpoint(TRUNCATE)')` after the migration** so the WAL shrinks back to ~0 bytes, otherwise the user sees `.db-wal` of several MB AGAIN and gets confused. (Wave 5 `.gitignore` change covers this defensively, but the migration should still checkpoint.)
- **`id` collisions across users:** two users on different machines both got `id=1` (SQLite AUTOINCREMENT starts at 1 per-machine). Without `user_hash` discriminator they collide; with `UNIQUE(user_hash, id)` they coexist. Make sure NO code path uses `id` alone as a primary key (e.g. dashboard SQL `WHERE id=?`). Search-grep gate for the planner: `grep -rn "WHERE id\s*=" _work/rapid-llm-proxy/src/`.
- **`tokens_estimated` typing:** TypeScript declares `0 | 1` but SQLite stores INTEGER. The `ON CONFLICT` INSERT might run with `null`/`undefined` from an old export — coerce with `?? 0`.
- **Debounce key correctness:** if `_exportTimers` is keyed by `window`, a row written at exactly XX:00:00.000 might race two timers. Tiebreaker: use `[windowStart, windowEnd)` (right-exclusive). The window-from-`getTimeWindow()` returns `HHMM-HHMM` where the second value is exclusive (e.g. `0900-1000` covers `[09:00, 10:00)`).
- **No `_from-<project>` suffix:** confirmed in CONTEXT.md line 51. Don't carry over LSL's redirect logic.
- **Coordinator unreachable on cold boot:** the proxy's launchd job and the coordinator's launchd job race at boot. `detectNetworkMode()` in `proxy-bridge/server.mjs` (line 219) already has the `catch (_) { … fall back to local detection }` pattern — mirror exactly. Local fallback = recompute via the same `(localHour, sessionDuration=60)` formula, no config file read on hot path (cache `sessionDurationMs` once at module init).

---

### 3. `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — coordinator URL wiring (Wave 2)

**Role:** submodule-bridge config · **Data flow:** outbound `execSync curl` to coordinator

**Analog (same file):** `detectNetworkMode()` (lines 196–231) already does exactly this pattern — curl the coordinator with timeout, fall back on failure, cache 30s.

**Existing pattern to mirror** (lines 196–231):
```javascript
let cachedNetworkMode = null;
let networkModeCheckedAt = 0;
const COORDINATOR_URL = process.env.HEALTH_COORDINATOR_URL || 'http://127.0.0.1:3034';
const NETWORK_CACHE_TTL_MS = 30_000;

function detectNetworkMode() {
  const now = Date.now();
  if (cachedNetworkMode && (now - networkModeCheckedAt) < NETWORK_CACHE_TTL_MS) return cachedNetworkMode;
  let mode;
  // Try coordinator first (single source of truth)
  try {
    const raw = execSync(
      `curl -sf --max-time 1 ${COORDINATOR_URL}/health/state`,
      { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const state = JSON.parse(raw);
    if (state?.network?.location) {
      mode = state.network.location === 'corporate' || state.network.location === 'vpn'
        ? 'corporate' : 'public';
      log(`Network mode from coordinator: ${mode} (location: ${state.network.location})`);
    }
  } catch (_) {
    // Coordinator unavailable — fall back to local detection
  }
  if (!mode) { mode = detectNetworkModeSync(); log(`Network mode (local fallback): ${mode}`); }
  cachedNetworkMode = mode;
  networkModeCheckedAt = now;
  return mode;
}
```
**Difference to apply (Wave 2):** add a parallel function `currentWindow(now: Date)` (or similar) that:
- Reuses the same `COORDINATOR_URL` constant.
- Caches for 30s (same TTL as network mode — coordinator polls at 5s, so 30s cache means at most 6-tick lag).
- Reads `state.lsl_meta.current_window` (or whichever slot Wave 1 picks).
- Local fallback: compute from `now` via inline copy of the LSL window formula (don't re-import — keep submodule standalone).

**Where to call it:** from `exportToHourFile()` in `src/token-usage.ts` — which means the bridge needs to either (a) pass a window-resolver callback into `initTokenDb()`, or (b) export the function and import it in `token-usage.ts`. Cleaner: define `resolveCurrentWindow()` in `token-usage.ts` itself (the bridge file is JS, the token-usage is TS — circular imports painful). Inline copy in TS file, keep `COORDINATOR_URL` env-driven.

**Risks / landmines:**
- `execSync` blocks the event loop for up to 2s on coordinator-unreachable cold boot. The proxy's hot path (LLM completion) calls `logCall` → `scheduleExport` (debounced 2s) → `exportToHourFile` → `currentWindow`. If the very first call hits a 2s `execSync` block, the FIRST completion's response time gets a 2s tax. Mitigation: warm the cache at module init (background, fail-silent) so the hot path always sees a populated cache.
- The `LLM_PROXY_USER_HASH` env-read also lives at this layer (token-usage.ts is the natural home — used inside `exportToHourFile`). Read once at module init, NOT per-call (env doesn't change mid-process and reading is slow on launchd).

---

### 4. `bin/coding` — export `LLM_PROXY_USER_HASH` (Wave 4) ⚠️ READ ANOMALY BELOW

**Role:** config-launcher / env-export · **Data flow:** shell env-export

**Analog (same file):** the env-export block at lines 290–309:
```bash
# Export dry-run and force flags for launch scripts
export CODING_DRY_RUN="$DRY_RUN"
export CODING_FORCE_CLEAN="$FORCE_CLEAN"

# Set environment variables for agent adapter system
export CODING_AGENT="$AGENT"
export CODING_TOOLS_PATH="$SCRIPT_DIR/.."
export CODING_REPO="$SCRIPT_DIR/.."
export CODING_PROJECT_DIR="$PROJECT_DIR"

# Ensure private session-history dirs exist. …
if [ -x "$SCRIPT_DIR/init-history.sh" ]; then
  "$SCRIPT_DIR/init-history.sh" 2>/dev/null || true
fi
export CODING_AGENT_ADAPTER_PATH="$SCRIPT_DIR/../lib/agent-api/adapters"
export CODING_HOOKS_CONFIG="$SCRIPT_DIR/../config/hooks-config.json"
export CODING_TRANSCRIPT_FORMAT="$AGENT"

# Launch appropriate agent
AGENT_LAUNCHER="$SCRIPT_DIR/../scripts/launch-${AGENT}.sh"
…
```
**Difference to apply (Wave 4):** add one block in the same style, BEFORE `exec`:
```bash
# Multi-user token-usage filename collision prevention (Phase 36).
# Computed once per launch; the proxy reads $LLM_PROXY_USER_HASH and
# falls back to 'unknown' if not set. Same hash function the LSL system
# uses (scripts/user-hash-generator.js → SHA-256 of $USER + 'lsl-user-hash' salt).
if command -v node >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/../scripts/user-hash-generator.js" ]; then
  LLM_PROXY_USER_HASH="$(node "$SCRIPT_DIR/../scripts/user-hash-generator.js" 2>/dev/null | tail -1 || echo unknown)"
  export LLM_PROXY_USER_HASH
fi
```
NB the CLI form: `user-hash-generator.js` runs `runIfMain` (lines 233–240) which prints debug + system info + the hash on the last line. So `tail -1` extracts the hash. **Better:** add a non-debug invocation mode, or call via `node -e 'import("…").then(m => process.stdout.write(m.default.generateHash()))'`. Pick the cleaner approach in the plan.

**🚨 ANOMALY — bin/coding does NOT launch the LLM proxy.**

The proxy is launched by **launchd** via `~/Library/LaunchAgents/com.coding.llm-cli-proxy.plist`. That plist's `ProgramArguments` calls `/Users/Q284340/Agentic/_work/rapid-llm-proxy/bin/start-llm-proxy.sh`. Env vars exported in the user's shell (from `bin/coding`) do NOT propagate to launchd-spawned processes.

The current plist (verified at `/Users/Q284340/Library/LaunchAgents/com.coding.llm-cli-proxy.plist`):
```xml
<key>EnvironmentVariables</key>
<dict>
    <key>LLM_PROXY_PORT</key>
    <string>12435</string>
    <key>LLM_PROXY_DATA_DIR</key>
    <string>/Users/Q284340/Agentic/coding/.data</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
</dict>
```

**The planner must pick ONE of these for Wave 4 to actually work:**
- **(a)** Add `LLM_PROXY_USER_HASH` to the plist `EnvironmentVariables` dict (analog: existing `LLM_PROXY_DATA_DIR` slot). Pros: simple. Cons: per-machine plist edit; doesn't work for second users without re-running install.
- **(b)** Have `start-llm-proxy.sh` compute the hash itself by shelling out to `node /Users/Q284340/Agentic/coding/scripts/user-hash-generator.js`. Pros: works automatically. Cons: hard-codes the coding repo path (already done in the script for `COORDINATOR_URL`'s sibling — `ENV_FILE="/Users/Q284340/Agentic/_work/rapid-llm-proxy/.env"`).
- **(c)** Make the proxy itself fall back to computing the hash if `LLM_PROXY_USER_HASH` is unset — port `user-hash-generator.js` into TypeScript inside the submodule. Pros: no plist or wrapper edit. Cons: code duplication; submodule needs to stay in sync with the salt.
- **(d)** Document Wave 4 as "single-user MVP — accepts hash from env only; multi-machine setup deferred". CONTEXT.md decision (a) says "before launching the proxy" but the proxy is NOT launched by `bin/coding`; this needs reconciliation with the user.

**Existing `start-llm-proxy.sh` analog** for option (b) — env-export pattern (lines 121–134):
```bash
if probe_corp_network; then
  export LLM_NETWORK_MODE=corporate
  if proxy_url=$(extract_proxy_url) && [ -n "$proxy_url" ]; then
    export HTTPS_PROXY="http://${proxy_url}"
    export HTTP_PROXY="http://${proxy_url}"
    export NO_PROXY="localhost,127.0.0.1,::1"
    log "exported HTTPS_PROXY=$HTTPS_PROXY LLM_NETWORK_MODE=corporate (corporate network)"
  …
```
Inject:
```bash
# Phase 36: multi-user token-usage hash (LSL-style)
USER_HASH_SCRIPT="/Users/Q284340/Agentic/coding/scripts/user-hash-generator.js"
if [ -f "$USER_HASH_SCRIPT" ] && command -v "$NODE_BIN" >/dev/null 2>&1; then
  LLM_PROXY_USER_HASH="$($NODE_BIN -e "import('$USER_HASH_SCRIPT').then(m => process.stdout.write(m.default.generateHash()))" 2>/dev/null || echo unknown)"
  export LLM_PROXY_USER_HASH
  log "exported LLM_PROXY_USER_HASH=$LLM_PROXY_USER_HASH"
fi
```

**Risks / landmines:**
- Forgetting that launchd-vs-shell-env distinction means Wave 4 silently no-ops in production. Plan must include a verification step: `launchctl getenv LLM_PROXY_USER_HASH` after kickstart, AND/OR a one-line log assertion inside the proxy at boot (`log('user_hash=' + (process.env.LLM_PROXY_USER_HASH || 'unknown — falling back'))`).
- `runIfMain`'s debug output (3 lines: System Info JSON, Consistency Test, Generated Hash) breaks shell-substitution if the planner just does `LLM_PROXY_USER_HASH=$(node …)`. Use the ESM `import()` one-liner or add a `--hash-only` CLI flag to `user-hash-generator.js`.
- Don't run the hash generator in dry-run mode — it's slow (synchronous SHA-256 is fine, but `runIfMain` startup + JSON.stringify takes ~50ms which is noticeable on cold path).
- OKB / rapid-automations launchers: CONTEXT.md says "Confirm OKB / rapid-automations launchers follow suit; or leave for follow-up". Mark explicitly as TODO in the plan; don't fix what we can't verify.

---

### 5. `.gitignore` — WAL/SHM coverage (Wave 5)

**Role:** gitignore · **Data flow:** none

**Existing block** (lines 179–183):
```
# Database files
*.db
*.sqlite
*.sqlite3
```

**Verified state** (from CONTEXT.md "Verified facts" + my `ls .data/llm-proxy/`):
- `*.db` matches `token-usage.db` ✓
- `*.db-wal` (4.1 MB) → NOT matched by `*.db` (glob does NOT match `.db-wal`)
- `*.db-shm` → also NOT matched

**Difference to apply (Wave 5):** broaden `*.db` to `*.db*` OR add explicit lines. CONTEXT.md line 113 suggests both options. The broader form is one line and covers future `.db-journal` (rollback journal) too:
```
# Database files (covers .db, .db-wal, .db-shm, .db-journal, .db-shm-journal, etc.)
*.db*
*.sqlite*
*.sqlite3
```
OR (safer, explicit):
```
# Database files
*.db
*.db-wal
*.db-shm
*.db-journal
*.sqlite
*.sqlite3
```
**Existing precedent for explicit -shm/-wal in the same file** (lines 191–193 — knowledge.db):
```
.data/knowledge.db
.data/knowledge.db-shm
.data/knowledge.db-wal
```
This suggests the convention in this repo is **explicit per-file lines**. The new `.gitignore` block should follow that style for consistency. Pick the same style.

**CRITICAL ordering note from CONTEXT.md Wave 5:** ".gitignore: …One-line fix lands FIRST." — yes, land this in its own commit BEFORE the migration commit so the migration commit doesn't add the `.db-wal` to git history.

**Risks / landmines:**
- The user's current `git status` shows `?? .data/llm-proxy/` (whole directory untracked because of the dir-level pattern at line 197 `!.data/`). Once the gitignore fix lands AND existing `.db-wal` files are removed from index (they shouldn't be tracked, but verify with `git ls-files | grep '\.db-'`), `git status` should be clean for that dir.
- DO NOT broaden to `*` patterns that catch the new `.json` export files — those need to STAY tracked. The current allow-list at line 196–199 (`!.data/`, `!.data/observation-export/`, etc.) needs a corresponding `!.data/llm-proxy-export/` line if not already present. **Grep gate for the planner: `grep -n 'llm-proxy-export' .gitignore` — should return at least one allow-list line; if missing, ADD `!.data/llm-proxy-export/`.**

---

### 6. `scripts/migrate-token-usage-export.mjs` (NEW) — one-shot bucketing (Wave 5)

**Role:** migration-script · **Data flow:** read SQLite + read monolithic JSON → bucket-by-window → write many per-hour JSONs → delete monolith

**Analogs (combine two):**
- `scripts/migrate-lsl-to-yyyymm.js` — for the YYYY/MM bucketing + dry-run-friendly output style
- `scripts/backfill-raw-observations.mjs` — for the one-shot SQLite-driven `.mjs` script shape (createRequire, better-sqlite3, dry-run flag, structured stderr log)

**Analog 1: `migrate-lsl-to-yyyymm.js`** (full file, 63 lines — re-use directly):
```javascript
#!/usr/bin/env node
/**
 * One-shot migration: move flat LSL files into YYYY/MM/ subdirs.
 * …
 */
import fs from 'fs';
import path from 'path';
import { dateSubdirFromFilename } from './lsl-paths.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function migrateDir(absDir, predicate) {
  if (!fs.existsSync(absDir)) {
    return { dir: absDir, moved: 0, skipped: 0, missing: true };
  }
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .filter(e => e.isFile() && predicate(e.name));
  let moved = 0;
  let skipped = 0;
  for (const e of entries) {
    const sub = dateSubdirFromFilename(e.name);
    if (!sub) { skipped++; continue; }
    const targetDir = path.join(absDir, sub);
    fs.mkdirSync(targetDir, { recursive: true });
    const src = path.join(absDir, e.name);
    const dst = path.join(targetDir, e.name);
    if (fs.existsSync(dst)) { skipped++; continue; }
    fs.renameSync(src, dst);
    moved++;
  }
  return { dir: absDir, moved, skipped, missing: false };
}

const results = [
  migrateDir(path.join(ROOT, '.specstory', 'history'), (n) => n.endsWith('.md')),
  …
];
for (const r of results) {
  if (r.missing) process.stdout.write(`SKIP (missing): ${r.dir}\n`);
  else process.stdout.write(`${r.dir}: moved=${r.moved} skipped=${r.skipped}\n`);
}
```

**Analog 2: `backfill-raw-observations.mjs`** (lines 25–53) — CLI arg + SQLite pattern:
```javascript
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseIntArg(args, '--limit');
const ONLY_ID = parseStrArg(args, '--id');

const DB_PATH = process.env.OBSERVATIONS_DB
  || path.resolve('.observations/observations.db');
…
function parseIntArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = parseInt(argv[i + 1], 10);
  return Number.isFinite(v) ? v : null;
}
```

**Difference to apply (Wave 5):** combine the two patterns. The migration script logic per CONTEXT.md:
1. Read existing `.data/llm-proxy-export/token-usage.json` (JSON, 637 KB, 1457 rows).
2. For each row: compute window via `getTimeWindow(utcToLocalTime(row.timestamp))`; pick hash = `'c197ef'` (the single contributor today) OR shell out to `node scripts/user-hash-generator.js`.
3. Bucket rows by `(YYYY-MM-DD, window, hash)`.
4. For each bucket: write `<baseDir>/YYYY/MM/YYYY-MM-DD_HHMM-HHMM_<hash>.json` (use `dateSubdirFromFilename` from `lsl-paths.js`).
5. Delete the old monolithic file in the SAME commit (atomic w/r/t git).
6. Print summary: `bucketed=<N> rows → <M> files; deleted .data/llm-proxy-export/token-usage.json`.

Sketch (final shape — planner should refine):
```javascript
#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { getTimeWindow, utcToLocalTime } from './timezone-utils.js';
import { dateSubdirFromFilename } from './lsl-paths.js';
import UserHashGenerator from '../src/live-logging/user-hash-generator.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const EXPORT_DIR = path.join(ROOT, '.data', 'llm-proxy-export');
const MONO_PATH = path.join(EXPORT_DIR, 'token-usage.json');

const hash = UserHashGenerator.generateHash();  // 'c197ef' on current machine

const rows = JSON.parse(fs.readFileSync(MONO_PATH, 'utf-8'));
const buckets = new Map();                       // 'YYYY-MM-DD_HHMM-HHMM' → rows[]
for (const row of rows) {
  const local = utcToLocalTime(row.timestamp);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  const window = getTimeWindow(local);
  const key = `${y}-${m}-${d}_${window}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push({ ...row, user_hash: row.user_hash || hash });
}
process.stderr.write(`[migrate] ${rows.length} rows → ${buckets.size} (window, user) buckets\n`);

for (const [key, bucketRows] of buckets) {
  const fname = `${key}_${hash}.json`;
  const sub = dateSubdirFromFilename(fname);
  const targetDir = path.join(EXPORT_DIR, sub);
  const target = path.join(targetDir, fname);
  if (DRY_RUN) {
    process.stderr.write(`  [dry] ${target} ← ${bucketRows.length} rows\n`);
    continue;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(bucketRows, null, 2) + '\n', 'utf-8');
}
if (!DRY_RUN) {
  fs.unlinkSync(MONO_PATH);
  process.stderr.write(`[migrate] deleted ${MONO_PATH}\n`);
}
```

**Risks / landmines:**
- **Hash for legacy rows:** CONTEXT.md decision (a) says `'unknown'` as default; the migration script can do better — it KNOWS the single contributor is `'c197ef'` (verified fact line 19). Use that, NOT `'unknown'`. After migration, `WHERE user_hash = 'unknown'` should return 0 rows.
- **Coordinator NOT consulted in migration:** the script runs once, possibly with coordinator down. Always compute window locally (don't bother with the coordinator fetch path — see `currentWindow()` for that).
- **`getTimeWindow(utcToLocalTime(row.timestamp))` consistency:** `row.timestamp` is ISO-8601 UTC per token-usage.ts line 13 schema. `utcToLocalTime` handles TZ correctly (`Intl.DateTimeFormat` based). Don't pass `new Date(row.timestamp)` directly — `localDate.getHours()` would be in launchd's UTC.
- **DST boundary rows:** twice a year, a row's local window changes ambiguously. Acceptable for v1; document as known limitation; volume is ~60 rows/year worst case.
- **Idempotency:** if the script runs twice (no DRY_RUN), the second run reads NOTHING because the monolith is gone. Fine if the first commit landed; flaky if the operator re-runs out of habit. Defensive: `if (!fs.existsSync(MONO_PATH)) { process.stderr.write('[migrate] monolith already removed — nothing to do\n'); process.exit(0); }` at top of script.
- **DB column `user_hash` MAY NOT EXIST YET when this script runs:** Wave 5 is AFTER Wave 3 (schema migration). Confirm wave-ordering in plan; if migration script populates per-row `user_hash` from the bucketing, the DB doesn't need to be touched — the script writes only to JSON. Good. **But** if the user re-runs the proxy after Wave 3 + before Wave 5, the proxy's `hydrateFromExports` will try to walk `.data/llm-proxy-export/` and find ONLY the monolith (no `YYYY/MM/` files yet). It will skip it (predicate ends-with `.json` matches monolith too — INSERT will collide on `user_hash='unknown', id=…` and DO NOTHING). Safe, but means dashboard could briefly show only fresh-DB rows. Document the recommended ordering: Waves 1–3 land, THEN Wave 4 sets env hash, THEN Wave 5 (gitignore + migration in one PR).

---

### 7. `.data/llm-proxy-export/token-usage.json` — delete in migration commit (Wave 5)

**Role:** data file · **Data flow:** n/a (deletion)

**Difference to apply:** `fs.unlinkSync(MONO_PATH)` inside the migration script (Wave 5 step 4 above). Same git commit as the new per-hour files. No analog needed.

---

## Shared Patterns

### Coordinator-curl with local fallback
**Source:** `_work/rapid-llm-proxy/proxy-bridge/server.mjs:196-231` (`detectNetworkMode`)
**Apply to:** new `currentWindow()` in `_work/rapid-llm-proxy/src/token-usage.ts`
```javascript
const COORDINATOR_URL = process.env.HEALTH_COORDINATOR_URL || 'http://127.0.0.1:3034';
const CACHE_TTL_MS = 30_000;
let _cachedWindow = null;
let _cacheCheckedAt = 0;
function currentWindow(now: Date): string {
  const t = Date.now();
  if (_cachedWindow && (t - _cacheCheckedAt) < CACHE_TTL_MS) return _cachedWindow;
  let w;
  try {
    const raw = execSync(`curl -sf --max-time 1 ${COORDINATOR_URL}/health/state`,
      { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const state = JSON.parse(raw);
    w = state?.lsl_meta?.current_window || state?.lsl?.current_window;
  } catch (_) { /* fall through */ }
  if (!w) w = computeWindowLocally(now);   // inline copy of getTimeWindow formula
  _cachedWindow = w;
  _cacheCheckedAt = t;
  return w;
}
```

### Best-effort error handling for export/persistence
**Source:** `_work/rapid-llm-proxy/src/token-usage.ts` (`logCall` line 248, `exportToJson` line 190, `restoreFromJsonIfEmpty` line 134)
**Apply to:** all new write paths in `token-usage.ts` (`exportToHourFile`, `hydrateFromExports`, `currentWindow`)
**Pattern:** wrap in `try { … } catch (err) { process.stderr.write(\`[token-usage] X failed (non-fatal): \${(err as Error).message}\n\`); }`. Never throw into the LLM request hot path.

### YYYY/MM directory layout
**Source:** `scripts/lsl-paths.js:17-49` (`dateSubdirFromFilename`, `lslPath`, `lslWritePath`)
**Apply to:** path construction in `exportToHourFile` AND `migrate-token-usage-export.mjs`. Port to TS (inline, ~10 lines) in the submodule; reuse the JS module directly in the migration script (it's in the coding repo).

### Recursive walker for hydration
**Source:** `scripts/lsl-paths.js:69-87` (`lslListAll`)
**Apply to:** `hydrateFromExports` in `token-usage.ts`. Port to TS (inline, ~12 lines). Use `.json` predicate. Same dot-dir + node_modules skip.

### Env-export block style in bash
**Source:** `bin/coding:290-309`
**Apply to:** new `LLM_PROXY_USER_HASH` export block. Match the comment + `export` + spacing style.

### Idempotent SQLite schema migration
**Source:** existing `CREATE INDEX IF NOT EXISTS` lines in `initTokenDb` (lines 113–115)
**Apply to:** new `ALTER TABLE ADD COLUMN` + `CREATE UNIQUE INDEX` guarded by `PRAGMA table_info` and `IF NOT EXISTS`. Always idempotent — `initTokenDb` runs on every proxy boot.

---

## No Analog Found

None — every changed file has at least one strong same-codebase analog. The closest thing to "no analog" is the **coordinator-published `current_window` field itself** — there is no precedent in `currentState` for a single global derived value (the existing slots are all per-entity Records or per-check arrays). Pick a clean shape (`state.lsl_meta.current_window`) and document.

---

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/coding/scripts/` (LSL helpers, migration scripts, coordinator)
- `/Users/Q284340/Agentic/coding/bin/coding` (launcher)
- `/Users/Q284340/Agentic/coding/.gitignore`
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts`
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs`
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/bin/start-llm-proxy.sh`
- `/Users/Q284340/Library/LaunchAgents/com.coding.llm-cli-proxy.plist`

**Files scanned (full read):** 9
**Files grepped:** 4
**Pattern extraction date:** 2026-05-16

**Build/deploy reminder for the planner** (per CLAUDE.md Submodules rule):
- `_work/rapid-llm-proxy/src/token-usage.ts` (TS) requires `cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && npm run build` before changes take effect (compiles to `dist/token-usage.js` which `proxy-bridge/server.mjs:36` imports).
- `_work/rapid-llm-proxy` is NOT a coding submodule (it lives at `Agentic/_work/`, parallel to `coding/`). It runs in its own launchd job, NOT in the `coding-services` Docker container. No `docker-compose build` needed.
- After build, deploy = `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`.
- `scripts/health-coordinator.js` runs on the host under launchd; deploy = `launchctl kickstart -k gui/$(id -u)/com.coding.health-coordinator` (or whatever the plist Label is).
