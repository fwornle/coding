# Phase 67: Reproducibility & Replay Rig - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 20 (15 new modules/CLIs/tests + 3 edits + 2 fixtures)
**Analogs found:** 20 / 20 (every new file has an in-repo analog — this phase is ~80% wiring existing single-reader surfaces)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/repro/capture-snapshot.mjs` | service | batch / file-I/O | `lib/experiments/evidence-harness.mjs` (spawnSync git + fs reads) | role-match |
| `lib/repro/restore-snapshot.mjs` | service | file-I/O / transform | `scripts/measurement-stop.mjs` (orchestrator + prompt) + `lib/experiments/store.mjs` (sandbox store) | role-match |
| `lib/repro/git-state.mjs` | utility | file-I/O / transform | `lib/experiments/evidence-harness.mjs:153-166` (`readDiffStat` fixed-argv spawnSync) | exact |
| `lib/repro/kb-capture.mjs` | service | file-I/O / batch | `lib/experiments/store.mjs` (km-core paths) + km-core hydrate patch (CLAUDE.md) | role-match |
| `lib/repro/env-allowlist.mjs` | utility | transform | `scripts/backfill-raw-observations.mjs:38-42` (env resolution) | partial |
| `lib/repro/mcp-inventory.mjs` | utility | request-response / transform | `lib/experiments/evidence-harness.mjs:153-166` (spawnSync CLI capture) | role-match |
| `lib/repro/fixtures/match-key.mjs` | utility | transform | `scripts/measurement-stop.mjs:364-365` (`crypto.createHash('sha256')`) | exact |
| `lib/repro/fixtures/llm-record.mjs` | service | event-driven (append) | `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1861-1913` (`logTokenCall` best-effort append) | exact |
| `lib/repro/fixtures/llm-replay.mjs` | service | request-response | `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1813-1816,1957-1969` (404/200 return style + response contract) | exact |
| `lib/repro/fixtures/harness-record.mjs` | service | batch / file-I/O | `lib/lsl/route/build-trace.mjs:22-28,41-51` (transcript JSONL reader) | role-match |
| `lib/repro/fixtures/clock.mjs` | utility | transform | `_work/rapid-llm-proxy/src/measurement-span.ts:112-161` (null-safe module w/ `Date` usage) | partial |
| `scripts/measurement-start.mjs` (EDIT) | route/CLI | request-response | self (`measurement-start.mjs:57-96`) | self-edit |
| `scripts/measurement-stop.mjs` (EDIT) | route/CLI | request-response | self (`measurement-stop.mjs:393-416`) | self-edit |
| `scripts/repro-restore.mjs` (NEW) | route/CLI | request-response | `scripts/measurement-start.mjs:40-101` (arg parse + prompt + main wrapper) | exact |
| `tests/repro/*.test.mjs` (7 files) | test | — | `tests/experiments/consequential-events.test.mjs` + `run-write.test.mjs` (node:test + isolated store) | exact |
| `tests/repro/_fixtures/` | test fixture | — | `tests/experiments/_fixtures/` + `tests/fixtures/route/` | exact |

## Pattern Assignments

### `lib/repro/git-state.mjs` (utility, transform)

**Analog:** `lib/experiments/evidence-harness.mjs` — the ONLY in-repo `spawnSync('git', …)` with a fixed argv (path-traversal/injection safe, T-73-03-EXEC). Replicate this shape for every git call (`rev-parse HEAD`, `diff HEAD --binary`, `ls-files --others --exclude-standard`, `submodule status`, `worktree add`).

**Core git-invocation pattern** (evidence-harness.mjs:153-166 — copy this exactly):
```javascript
function readDiffStat(repoRoot) {
  try {
    const res = spawnSync('git', ['diff', '--stat'], {
      cwd: repoRoot, encoding: 'utf8', timeout: 10_000,
    });
    if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return null;
    const out = res.stdout.trim();
    return out.length ? out : null;
  } catch { return null; }
}
```
**Replicate for D-03 capture:** `git rev-parse HEAD` → `git-sha.txt`; `git diff HEAD --binary` → `dirty.patch` (`--binary` makes it re-applyable, covers staged+unstaged); `git ls-files --others --exclude-standard` → archive listed paths into `untracked/` (patch does NOT include untracked); `git submodule status` + per-submodule `git -C <path> diff --binary` (repo has 5 submodules). Fixed argv array, never a shell string. `import { spawnSync } from 'node:child_process';` (evidence-harness.mjs:23).

---

### `lib/repro/kb-capture.mjs` (service, file-I/O)

**Analog:** `lib/experiments/store.mjs` (km-core store paths) + the CLAUDE.md km-core hydrate patch note.

**Anti-pattern (Pitfall 5 — do NOT do this):** never open a second `GraphKMStore` on the live `.data/knowledge-graph/` to "read for capture" — LevelDB is single-owner (obs-api holds it). Capture is a **filesystem copy** only.

**Capture pattern (D-02):** `cp -R` / tar the LIVE `.data/knowledge-graph/leveldb/` subdir (NOT the stale `level.db` / `leveldb.before-*` backups — RESEARCH State-of-the-Art) → `kb/leveldb.tar` (byte-exact SC-2 artifact), AND copy the atomically-written `.data/knowledge-graph/exports/general.json` → `kb/exports/` (portable + the km-core-native hydrate source). Use `node:fs` `fs.cpSync(src, dst, { recursive: true })` or system `tar`.

**Sandbox hydrate (restore side):** prefer hydrating a fresh store from `exports/general.json` (compaction-independent — the km-core `persistence.js hydrate()` patch already prefers the JSON export over the LevelDB cache when JSON has more nodes; see CLAUDE.md "km-core node_modules patch"). Open the sandbox store exactly like `store.mjs:43-51` but with `dbPath`/`exportDir` pointing at the **sandbox** `LLM_PROXY_DATA_DIR`, and MUST pass `ontologyDir` (CLAUDE.md rule — else `resolveEntities` throws).

---

### `lib/repro/fixtures/match-key.mjs` (utility, transform) — D-07

**Analog:** `scripts/measurement-stop.mjs:364-365` — the exact repo idiom for content hashing (the `task_hash`/`goal_hash`).

**Hash pattern** (measurement-stop.mjs:364-365):
```javascript
const taskHash = span.goal_sentence
  ? crypto.createHash('sha256').update(span.goal_sentence).digest('hex')
  : null;
```
**Replicate for D-07:** `normalizeReq(body)` drops volatile fields (task_id, subscription, request id), canonicalizes the model name (the proxy uses `canonicalizeModelName`, server.mjs:1857 — normalize on the canonical name so record & replay agree), then `sha256(JSON.stringify({ model, messages, temperature, max_tokens, … }))`. Maintain an in-memory `Map<hash, count>` ordinal so identical repeated calls (retries) replay in recorded order — robust to reordering of *distinct* calls. `import crypto from 'node:crypto';` (measurement-stop.mjs:51).

---

### `lib/repro/fixtures/llm-replay.mjs` + the proxy tap in `server.mjs` (service, request-response) — D-06

**Analog:** `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — the LIVE runtime bridge (NOT `src/` or `dist/` — Pitfall 2; edits to src/dist do not affect the running daemon). Two taps inside the existing `POST /api/complete` handler.

**Where (VERIFIED line anchors):**
- Handler entry: `server.mjs:1683` (`if (req.method === 'POST' && req.url === '/api/complete')`).
- Body parsed by `server.mjs:1684-1698` → `body = { process, messages, model, subscription, provider, … }`.
- **Replay tap** goes right after 1698, before provider-chain resolution at 1754.
- **Record tap** goes at `server.mjs:1853` where `result` is ready (`{ content, model, tokens, provider }` + `latencyMs`), before `res.end` at 1957.
- Single span reader already imported at `server.mjs:44`; reuse `getActiveMeasurement()` — do NOT add a second reader.

**Hard-fail return style** — mirror the existing 404 return (server.mjs:1813-1816):
```javascript
res.writeHead(404, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({ error: `No available provider…`, type: 'PROVIDER_UNAVAILABLE' }));
```
**Replay tap to insert (after body parse ~1698):**
```javascript
const span = getActiveMeasurement();            // single reader (measurement-span.ts:112, imported server.mjs:44)
if (span?.meta?.replay_from) {
  const key = matchKey(normalizeReq(body));     // D-07
  const hit = replayLookup(span.meta.replay_from, key);
  if (!hit) { res.writeHead(409, { 'Content-Type': 'application/json' });   // D-06 hard-fail
    return res.end(JSON.stringify({ error: `replay miss: ${key}`, type: 'REPLAY_MISS' })); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(hit));          // { content, provider, model, tokens, latencyMs }
}
```
**Response contract to serve/record** (server.mjs:1957-1969 — VERIFIED, this is the fixture shape):
```javascript
res.writeHead(200, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({
  content: result.content,
  provider: providerName,
  model: result.model,
  tokens: result.tokens,       // { input, output, total }
  latencyMs,
  ...(typeof result.overheadMs === 'number' ? { overheadMs: result.overheadMs } : {}),
}));
```
**After editing:** restart the daemon — `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (Pitfall 2).

---

### `lib/repro/fixtures/llm-record.mjs` (service, event-driven append) — D-07

**Analog:** `server.mjs:1861-1913` — the `logTokenCall` best-effort append. Same guard style: never let a fixture write fail the LLM call.

**Pattern (server.mjs:1861-1863):**
```javascript
// Persist token usage for the dashboard. Best-effort — never let a DB hiccup fail the LLM call.
if (_tokenDb) {
  logTokenCall(_tokenDb, { timestamp: new Date().toISOString(), provider: providerName, … });
}
```
**Record tap to insert (~1853, guarded by `span?.meta?.record`):**
```javascript
if (span?.meta?.record) recordFixture(span.task_id, matchKey(normalizeReq(body)),
  { content: result.content, provider: providerName, model: result.model, tokens: result.tokens, latencyMs });
```
Append fixtures to the sandbox/span fixtures dir; wrap in try/catch so a record failure never breaks the real call (mirror the `if (_tokenDb)` best-effort contract).

---

### `lib/repro/fixtures/harness-record.mjs` (service, batch) — D-08 WebSearch/WebFetch/MCP

**Analog:** `lib/lsl/route/build-trace.mjs:22-28,41-51` — the transcript-JSONL reader contract (`LSL_CLAUDE_PROJECTS_DIR → ~/.claude/projects`).

**Pattern (build-trace.mjs imports + env-override → home-default):**
```javascript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
// claude : LSL_CLAUDE_PROJECTS_DIR → ~/.claude/projects  (default locator returns a path only when it EXISTS)
```
**Record (feasible):** scrape `~/.claude/projects/-Users-Q284340-Agentic-coding/*.jsonl` for `tool_result`/`toolUseResult` blocks whose `WebSearch`/`WebFetch`/MCP tool_use falls within the span `[started_at, ended_at]` window (inclusive lexical ISO-8601 compare — build-trace.mjs:30-35) → `fixtures/harness/`.
**Replay (INFEASIBLE in-repo):** these tools run in the Claude harness, not the proxy. Ship `record()` (real) + a `replay()` that throws/exits `REPLAY_UNSUPPORTED_CHANNEL: <name>` when armed but no tap exists — never silently degrade (D-06/SC-4). Surface UNSUPPORTED at span-open.

---

### `lib/repro/fixtures/clock.mjs` (utility, transform) — D-08 clock, Claude's discretion

**Analog:** `measurement-span.ts:112-161` (a small null-safe module that reads `Date` and never throws on the hot path).

**Mechanism (freeze-at-snapshot base + monotonic offset):** record `clock_base = Date.now()` at span open into the snapshot. On replay, a small shim (imported FIRST by the replay run's own node entrypoints ONLY — NOT injected into daemons) overrides `Date.now`/`new Date` to return `clock_base + (performance.now() - replayStart)`. Deterministic + monotonic. Do NOT patch `Date` globally in long-running daemons (obs-api, proxy). Proxy fixtures already carry `latencyMs`/`timestamp`, so replayed LLM responses supply their own recorded time.

---

### `scripts/measurement-start.mjs` (EDIT — capture + `--replay` arming) — D-09

**Analog:** itself. Add `captureSnapshot(taskId)` after `startMeasurement()` and thread `--replay <snapshot>` + record-on through the `meta` passthrough.

**Existing dist-import + startMeasurement (measurement-start.mjs:82-87 — extend, don't replace):**
```javascript
const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
const { startMeasurement, resolveMeasurementPaths } = await import(modUrl);
span = startMeasurement({ task_id: taskId, ...(goalSentence ? { goal_sentence: goalSentence } : {}) });
```
**Arming pattern (no schema change — `startMeasurement` accepts `meta`, measurement-span.ts:173-191):**
```javascript
const replayFrom = parseStrArg(args, '--replay');   // reuse parseStrArg (measurement-start.mjs:40-44)
span = startMeasurement({ task_id: taskId,
  ...(goalSentence ? { goal_sentence: goalSentence } : {}),
  meta: { record: true, ...(replayFrom ? { replay_from: replayFrom } : {}) } });
```
The proxy reads `span.meta.record` / `span.meta.replay_from` off the same active span. Add `--clock_base` capture into the snapshot here (span-open = pre-mutation baseline, Pattern 3). Snapshot dir MUST use `sanitizeTaskId` (measurement-span.ts:83) for `.data/run-snapshots/<task_id>/`.

---

### `scripts/measurement-stop.mjs` (EDIT — fixture archive + `snapshot_id` linkage) — D-09

**Analog:** itself (the close orchestrator, measurement-stop.mjs:393-416).

**Existing writeRun call (measurement-stop.mjs:394-398 — thread `snapshot_id` in):**
```javascript
const store = await openExperimentStore();
try {
  await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });
  …
} finally { await store.close(); }
```
Archive `fixtures/` into the snapshot dir at close, then pass `snapshot_id` (the `.data/run-snapshots/<task_id>/` id) into the `tags`/`writeRun` path.

**Reserved field to populate (run-write.mjs:108 — VERIFIED):**
```javascript
snapshot_id: null,   // deferred → Phase 67 (D-13)  ← this phase populates it
```
Change `snapshot_id: null` to read `t.snapshot_id ?? null` (like the other 8 tags at run-write.mjs:102-109), and have measurement-stop pass `snapshot_id` in the `tags` object it builds at measurement-stop.mjs:367-377.

---

### `scripts/repro-restore.mjs` (NEW CLI) — D-04 / D-05

**Analog:** `scripts/measurement-start.mjs` — copy the whole CLI skeleton (shebang, `parseStrArg`, `prompt`, `main()` + `.catch` wrapper, `process.stderr.write` logging).

**CLI skeleton (measurement-start.mjs:40-55,98-101):**
```javascript
function parseStrArg(argv, flag) { const i = argv.indexOf(flag); if (i < 0) return null; return argv[i + 1] || null; }
function prompt(question) {   // readline confirm for --in-place (D-05)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(String(a).trim()); }));
}
main().catch((err) => { process.stderr.write(`FATAL: ${err.stack || err.message}\n`); process.exit(1); });
```
**Restore ordering (RESEARCH Restore Safety):** `git worktree add <sandbox> <sha>` → `git -C <sandbox> submodule update --init --recursive` (5 submodules — worktree does NOT auto-populate) → apply per-submodule patches + reset SHAs → `git apply --binary dirty.patch` → restore `untracked/` → KB into sandbox `LLM_PROXY_DATA_DIR` → env/config → arm replay. `--in-place` (D-05): auto-backup live via the capture routine → `prompt()` confirm → only then write live paths. Default path NEVER touches live checkout/KB.

---

### `tests/repro/*.test.mjs` (7 files) + `tests/repro/_fixtures/`

**Analogs:** `tests/experiments/consequential-events.test.mjs` (node:test convention) + `tests/experiments/run-write.test.mjs` (isolated throwaway store).

**Convention header (consequential-events.test.mjs:13-17 — copy verbatim):**
```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
```
- Use **node:test + node:assert/strict**, NOT jest (Pitfall 6). Run: `node --test tests/repro/<file>.test.mjs`.
- Gate any live-only assertion on an **env var** (e.g. `EXPERIMENTS_LIVE`), NOT a `--live` argv (MEMORY.md node --test argv gotcha; run-write.test.mjs:16-18).
- For `run-link.test.mjs`, reuse the isolated-store helper (run-write.test.mjs:38-58): `mkdtempSync` tmp root, copy the REAL `.data/ontologies-experiment/` in, `openExperimentStore({ repoRoot: tmp })`, close+rm in cleanup. NEVER the real store.
- Test the LLM record/replay as PURE functions (`matchKey`/`replayLookup`/`recordFixture`), no live proxy daemon needed (RESEARCH Wave 0 Gaps).
- Fixtures under `tests/repro/_fixtures/` mirror `tests/experiments/_fixtures/` + `tests/fixtures/route/` (a synthetic `/api/complete` req/resp pair + a redacted transcript-JSONL fragment).

---

## Shared Patterns

### Single-reader span access (reuse, never reimplement)
**Source:** `_work/rapid-llm-proxy/src/measurement-span.ts:112-161` (`getActiveMeasurement`), already imported at `server.mjs:44`.
**Apply to:** the proxy taps (llm-record/llm-replay) and any code that needs the active span.
```javascript
import { getActiveMeasurement } from '../dist/measurement-span.js';
const span = getActiveMeasurement(); // null-safe, never throws; THE only parser
```
Do NOT add a second parser of `active-measurement.json` — measurement-span.ts is deliberately the single reader (SC-4). Arm record/replay via `startMeasurement({ …, meta: { record, replay_from } })` — the `meta` object is persisted and read back unchanged (measurement-span.ts:173-191).

### task_id → filename safety
**Source:** `measurement-span.ts:83-102` (`sanitizeTaskId`).
**Apply to:** every `.data/run-snapshots/<task_id>/` path construction (same threat class as T-68-02-01). Allows only `[A-Za-z0-9._-]`, `path.basename`'d as defense-in-depth.

### Proxy env / data-dir resolution
**Source:** `measurement-span.ts:57-70` (`resolveMeasurementPaths`: `LLM_PROXY_DATA_DIR → cwd/.data`) + `scripts/backfill-raw-observations.mjs:38-42` (`LLM_CLI_PROXY_PORT` default `12435`).
**Apply to:** the sandbox data dir (D-04 is just a different `LLM_PROXY_DATA_DIR`) and any host-side proxy client. Reuse the resolver; do not hand-roll env parsing.

### Dist-import of the measurement surface (ONE reader across the system)
**Source:** `measurement-start.mjs:37-38,82-83` / `measurement-stop.mjs:79-80,189-190`.
**Apply to:** any new operator CLI needing span functions.
```javascript
const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';
const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
const { startMeasurement, stopMeasurement, resolveMeasurementPaths } = await import(modUrl);
```
Import from the LOCAL proxy dist (the same the daemon loads), NOT the pinned tarball in node_modules.

### Content hashing
**Source:** `measurement-stop.mjs:51,364-365` — `crypto.createHash('sha256').update(x).digest('hex')`.
**Apply to:** the D-07 match key. Do not hand-roll a hash.

### Best-effort side-writes on hot paths
**Source:** `server.mjs:1861-1863` (`if (_tokenDb) { logTokenCall(…) }`) + `measurement-span.ts` (never-throw reads).
**Apply to:** the record tap and any capture read — a fixture/capture failure must NEVER fail the underlying LLM call or crash the close. Wrap in try/catch, log via `process.stderr.write` (no-console-log, CLAUDE.md).

### km-core store construction MUST pass ontologyDir
**Source:** `lib/experiments/store.mjs:40-53` (`openExperimentStore`).
**Apply to:** the sandbox KB store in `kb-capture.mjs`/`restore-snapshot.mjs`. Construct `GraphKMStore` with `ontologyDir` (CLAUDE.md km-core rule) or `resolveEntities` throws `opts.classes omitted but store has no ontology registry`. Caller OWNS close (`try { … } finally { await store.close(); }`) — LevelDB is single-owner.

## No Analog Found

None. Every new file maps to an existing analog. Two areas carry residual RESEARCH-only risk (analog exists for the *shape* but the behavior is novel):

| File | Role | Data Flow | Note |
|------|------|-----------|------|
| `lib/repro/fixtures/harness-record.mjs` replay half | service | event-driven | Record has an analog (build-trace transcript reader); REPLAY has no viable tier (harness can't be fed synthetic tool results — A1). Ship as record-present / replay-hard-fails. |
| `lib/repro/fixtures/clock.mjs` | utility | transform | Shim shape is standard, but harness-process clock is out of reach — only node processes we control are virtualizable (documented, not an analog gap). |

## Metadata

**Analog search scope:** `scripts/`, `lib/experiments/`, `lib/lsl/`, `tests/experiments/`, `_work/rapid-llm-proxy/proxy-bridge/`, `_work/rapid-llm-proxy/src/`.
**Files scanned:** ~12 read in full/targeted; grep-confirmed git/child_process + test-fixture inventory.
**Pattern extraction date:** 2026-07-02
