---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
reviewed: 2026-05-27T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - launchd/com.coding.sub-agent-live-claude.plist
  - launchd/com.coding.sub-agent-live-copilot.plist
  - launchd/com.coding.sub-agent-live-opencode.plist
  - launchd/com.coding.sub-agent-sweep.plist
  - lib/lsl/adapters/claude-jsonl-tree.mjs
  - lib/lsl/adapters/copilot-events.mjs
  - lib/lsl/adapters/index.mjs
  - lib/lsl/adapters/mastra-ndjson.mjs
  - lib/lsl/adapters/opencode-sqlite.mjs
  - lib/lsl/live/claude-fs-watch.mjs
  - lib/lsl/live/copilot-events-tail.mjs
  - lib/lsl/live/opencode-sqlite-poll.mjs
  - lib/lsl/registry-reader.mjs
  - lib/lsl/registry.mjs
  - lib/lsl/sub-agent-lsl-writer.mjs
  - lib/lsl/sub-agent-slot-allocator.mjs
  - scripts/backfill-subagent-transcripts.mjs
  - scripts/combined-status-line.js
  - scripts/health-coordinator.js
  - scripts/install-sub-agent-launchd.sh
  - scripts/sub-agent-live-claude.mjs
  - scripts/sub-agent-live-copilot.mjs
  - scripts/sub-agent-live-opencode.mjs
  - scripts/sub-agent-sweep-job.sh
  - scripts/sweep-sub-agents.mjs
  - scripts/write-sub-agent-lsl.mjs
  - src/live-logging/TranscriptNormalizer.js
findings:
  critical: 3
  blocker: 0
  warning: 9
  info: 6
  total: 18
status: issues_found
---

# Phase 51: Code Review Report

**Reviewed:** 2026-05-27
**Depth:** standard
**Files Reviewed:** 27 (plus brief skim of 14 test files)
**Status:** issues_found

## Summary

Phase 51 adds the agent-agnostic sub-agent capture pipeline — four Path-B sweep adapters, three Path-A live daemons, a slot-aware LSL writer, a registry-reader for the statusline, and launchd plists. The code is mostly defensive (uid-checks, atomic writes, fail-closed gates, error budgets), but adversarial review surfaced three correctness defects that will silently produce wrong behavior in production:

1. `lib/lsl/adapters/opencode-sqlite.mjs` reads `searchPaths.limit` from an Array → always `undefined` → the dispatcher's `--limit` flag and the sweep-job's `SUB_AGENT_SWEEP_LIMIT` cap are silently ignored for OpenCode (always defaults to 100). Same dispatcher code uses `--since`, which OpenCode honors via `time_updated > ?` — but the limit drop is invisible.
2. `scripts/sub-agent-live-opencode.mjs` heartbeat payload omits `registry_rows`, but `lib/lsl/registry-reader.mjs` enumerates running sub-agents *only* from that field. Net result: the statusline + health-coordinator's `sub_agent_capture.live_registrations.opencode.running` will always be 0 — even when OpenCode is actively running sub-agents. The bug renders the entire Plan 51-10/51-11 OpenCode signal dead in production.
3. `lib/lsl/live/claude-fs-watch.mjs:515-526` increments `observations_written` via a stale Map-row reference. The empty `upsert({})` replaces the Map slot with a freshly-merged object; the subsequent mutation runs on the now-orphaned object. The registry counter stays at 0 forever, so `markCompleted({ observations_written: row.observations_written })` (line 544) ALWAYS falls through to `exchangesEmitted` — making the counter both observable-via-side-channel and provably broken if anyone reads it mid-tail.

Two further high-risk Warnings: (4) copilot sweep adapter ignores `--since` despite the sweep-job depending on it for windowing — every 30-minute launchd tick re-scans every Copilot session; (5) copilot live tail uses unbounded `Buffer.alloc(curr.size - lastSize)` with no cap, exposing a memory DoS vector on a large append. Plus several quality issues (dead flag, variable shadowing, lifecycle pairing assumption).

No security vulnerabilities (no SQL injection — all SQLite queries are parameterized; no eval; no hardcoded secrets; uid-checks are consistent). No test files ship console.log/credentials (verified via grep — EmbeddingClassifier.test.js console.log is out of scope).

## Critical Issues

### CR-01: OpenCode adapter silently ignores `--limit` (reads property off Array)

**File:** `lib/lsl/adapters/opencode-sqlite.mjs:231`
**Issue:**
```js
const limit = Number.isFinite(searchPaths.limit) ? searchPaths.limit : 100;
```
`searchPaths` is an `Array<{type:'sqlite', dbPath:string}>` per the contract in `lib/lsl/adapters/index.mjs:107` and the guard at line 220 (`!Array.isArray(searchPaths)`). Arrays don't carry a `.limit` property, so `searchPaths.limit` is always `undefined`, `Number.isFinite(undefined)` is `false`, and `limit` is always the 100 default — regardless of the `--limit` flag the dispatcher passes to OpenCode or the `SUB_AGENT_SWEEP_LIMIT` env var the launchd job sets. The Plan 51-03 spec says `LIMIT 100 default; --limit flag overrides at dispatcher tier` (T-51-03-RL) — the override is dead.

The dispatcher `scripts/sweep-sub-agents.mjs` enforces its own `discovered.slice(0, limit)` *after* the adapter returns rows, so the user-facing `--limit` does still cap the output. But the SQL `LIMIT ?` on the DB query is hard-pinned to 100, which means OpenCode's `--limit 500` doesn't actually retrieve 500 rows from SQLite. A user setting `--limit 500` to backfill a larger window will only ever see the 100 oldest rows.
**Fix:**
```js
// The limit is a discover() opt, not a property of the searchPaths array.
// Plumb it through the adapter contract instead:
async function discover({ searchPaths, project, since, limit } = {}) {
  // ...
  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
  // ...
  const sessionRows = db
    .prepare(DISCOVER_SQL)
    .all(projectRoot, dirPrefix, sinceMsArg, sinceMsArg, effectiveLimit);
}
```
And update the dispatcher to forward `limit` into `adapter.discover()`:
```js
discovered = await adapter.discover({ searchPaths, project, since, limit });
```

---

### CR-02: OpenCode live daemon never writes `registry_rows` → registry-reader always reports 0 running

**File:** `scripts/sub-agent-live-opencode.mjs:232-242` (also see `lib/lsl/registry-reader.mjs:145-147`)
**Issue:** The OpenCode daemon's heartbeat payload contains only `{ agent, last_heartbeat_at, polls, registered, last_poll_at, errors }`. It does NOT include the `registry_rows: [...]` array that the Claude (`scripts/sub-agent-live-claude.mjs:129-133`) and Copilot (`scripts/sub-agent-live-copilot.mjs:226-230`) daemons emit. The registry-reader at `lib/lsl/registry-reader.mjs:145` does:
```js
const rows = Array.isArray(hb.registry_rows) ? hb.registry_rows : [];
for (const row of rows) {
  if (!row || row.status !== 'running') continue;
  // ...
}
```
For OpenCode this loop is always over `[]`. Every downstream consumer (the statusline's `getProjectSubMt`, `getFreshSubAgents`, and `pollSubAgentCapture` in `scripts/health-coordinator.js:688-691`) computes `running:0` for OpenCode regardless of how many sub-agents the daemon is actually tailing. `pollSubAgentCapture`'s aggregate decision at line 724 (`anyFresh`) still treats the file mtime as fresh — so `status` becomes `'healthy'` even when registry_rows is missing — but the user-visible `live_registrations.opencode.running` is permanently wrong.

Worst case: an operator looking at `/health/state` to verify OpenCode capture is working will see `running: 0` and assume the daemon is broken when it's actually working fine.
**Fix:** Mirror the Claude/Copilot pattern. In `scripts/sub-agent-live-opencode.mjs:232-250`:
```js
function writeHeartbeat(extra = {}) {
  const stats = handle.getStats();
  const payload = {
    agent: 'opencode',
    last_heartbeat_at: new Date().toISOString(),
    polls: stats.polls,
    registered: stats.registered,
    last_poll_at: stats.last_poll_at,
    errors: stats.errors,
    // Mirror Plans 51-07/51-09: emit the registry rows so registry-reader
    // can enumerate live sub-agents per project.
    registry_rows: registry.listByAgent('opencode').map((r) => ({
      sub_hash: r.sub_hash,
      parent_session_id: r.parent_session_id,
      status: r.status,
      project: r.project,
    })),
    ...extra,
  };
  // ...
}
```
Note: the Claude/Copilot writers also omit `project` from registry_rows; the reader's project filter at `lib/lsl/registry-reader.mjs:153` and `:189` treats missing project as a match (defensive default), so omitting it is acceptable but reduces resolution if multiple projects share a daemon. Including `project` makes the filter correct rather than permissive.

---

### CR-03: `observations_written` counter never increments in claude-fs-watch (stale Map reference)

**File:** `lib/lsl/live/claude-fs-watch.mjs:515-527`
**Issue:**
```js
// Increment registry's observations_written counter (best-effort).
const cur = opts.registry.get('claude', subHash);
if (cur) {
  opts.registry.upsert({
    agent: 'claude',
    sub_hash: subHash,
    // observations_written is preserved by upsert (it's not in the
    // overrideable list) — increment manually via the row's prior
    // value.
  });
  // Mutate via the row reference returned by get() — observations_written
  // is a numeric counter on the registry row.
  cur.observations_written = (cur.observations_written || 0) + 1;
}
```
The upsert at line 517 internally does `const merged = { ...existing, ...row }; this._rows.set(key, merged);` (see `lib/lsl/registry.mjs:83-96`). That replaces the Map slot with a **new** merged object — the `cur` reference now points to the *previous* slot's object, which is no longer in the registry. The mutation at line 526 modifies the orphaned object; the new map slot still has whatever `observations_written` the existing row had (typically 0).

Net effect: `observations_written` on the live row is stuck at 0 forever. The downstream consumer at line 544 (`onClose`) checks `row && row.observations_written ? row.observations_written : exchangesEmitted` — since the truthy check on 0 fails, it always falls through to `exchangesEmitted`. So the *final* `markCompleted` is right by accident, but any tooling that reads `observations_written` mid-tail (the heartbeat doesn't currently, but Plan 10/11 might extend it) will see permanent 0.

The comment at line 520-522 is also misleading — claiming `observations_written` "is preserved by upsert (it's not in the overrideable list)" but registry.mjs has no such allowlist; the spread `{ ...existing, ...row }` preserves it only because the `row` parameter doesn't carry it.
**Fix:** Mutate via upsert, not via a stale reference:
```js
const cur = opts.registry.get('claude', subHash);
if (cur) {
  // Single atomic upsert that both touches the slot AND increments the counter.
  opts.registry.upsert({
    agent: 'claude',
    sub_hash: subHash,
    observations_written: (cur.observations_written || 0) + 1,
  });
}
```
Or extend the registry with a dedicated `incrementObservationsWritten(agent, sub_hash)` method to encapsulate the mutate-in-place semantics. Either way, drop the comment claim about "overrideable list" since no such mechanism exists.

## Warnings

### WR-01: Copilot sweep adapter ignores `--since` — every launchd tick re-scans all sessions

**File:** `lib/lsl/adapters/copilot-events.mjs:243-249`
**Issue:** The adapter declares `since` as a documented parameter (line 243: `currently advisory (every events.jsonl is read); reserved for the live-tier plan that adds mtime-based filtering`) but never actually filters by it. The sweep job `scripts/sub-agent-sweep-job.sh:60-82` computes `--since` from the persisted state file (defaulting to 7 days ago on first run) precisely to bound the scan window. With this adapter ignoring `since`:

1. Every 30-minute launchd tick re-reads every `events.jsonl` in `~/.copilot/session-state/<uuid>/` (potentially hundreds of files over time).
2. Every previously-seen sub-agent invocation gets re-stitched and re-converted on each tick.
3. The downstream ObservationWriter relies on dedup to prevent duplicate observations — but it spends CPU re-doing the work every time.

The sweep job *thinks* the `--since` argument is bounding the work. It isn't.
**Fix:** Honor the `since` parameter — filter sessions by their `events.jsonl` mtime against `sinceMs`:
```js
async function discover({ searchPaths, project, since } = {}) {
  // ...
  const sinceMs = since ? Date.parse(since) : null;
  for (const entry of sessionEntries) {
    // ... existing uid-check + lock guard ...
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) continue;
    if (sinceMs != null) {
      try {
        const st = fs.statSync(eventsPath);
        if (st.mtimeMs < sinceMs) continue;  // session quiet since --since
      } catch { continue; }
    }
    // ...
  }
}
```

### WR-02: Copilot live tail allocates unbounded buffer for new bytes

**File:** `lib/lsl/live/copilot-events-tail.mjs:274-276`
**Issue:**
```js
const len = curr.size - lastSize;
const buf = Buffer.alloc(len);
fs.readSync(fd, buf, 0, len, lastSize);
```
There is no cap on `len`. If Copilot writes (or an attacker symlinks into) an events.jsonl file with a large append between `lastSize` and `curr.size` (e.g. GB-scale), the daemon allocates that buffer in one shot — guaranteed OOM on a 64GB workstation if `len` ≥ available RAM. The Plan 51-07 sibling (`claude-fs-watch.mjs:204`) caps the read at 1 MiB with explicit comment: `// Cap a single read at 1 MiB to bound memory.` The copilot tail lost that guard.

T-51-09-RL claims "CPU bounded by concurrent Copilot sessions (typically 1-5)" but the memory bound on append size is missing.
**Fix:** Mirror the Claude pattern:
```js
const newBytes = Math.max(0, curr.size - lastSize);
const cap = Math.min(newBytes, 1024 * 1024);  // 1 MiB cap per tick
const buf = Buffer.alloc(cap);
const n = fs.readSync(fd, buf, 0, cap, lastSize);
lastSize += n;  // advance only by what we actually read
// Remaining bytes (newBytes - n) will be picked up on the next tick.
```

### WR-03: Copilot live tail advances `lastSize` past unread bytes on partial readSync

**File:** `lib/lsl/live/copilot-events-tail.mjs:276-277`
**Issue:**
```js
fs.readSync(fd, buf, 0, len, lastSize);
lastSize = curr.size;          // <-- ignores actual bytes read
```
The return value of `fs.readSync` (the actual byte count returned by the OS) is discarded. If the kernel returns fewer bytes than requested (transient EAGAIN, file truncation mid-read, etc.), the buffer has zero-filled tail (Buffer.alloc), but `lastSize` jumps to `curr.size` regardless. Any bytes that *would* have been read on the next tick are now skipped — events lost forever.

Same root cause as WR-02; both bugs disappear if you use the `n = fs.readSync(...)` return value and `lastSize += n`.
**Fix:** See WR-02 — track actual bytes read and advance `lastSize` only by that amount.

### WR-04: claude-fs-watch's `pushExchangeIfReady` flushes ANY 2 messages as user/assistant pair

**File:** `lib/lsl/live/claude-fs-watch.mjs:114-124`
**Issue:**
```js
function pushExchangeIfReady() {
  if (exchangePair.length === 0) return null;
  if (exchangePair.length >= 2) {
    const out = exchangePair.slice();
    exchangePair = [];
    return out;
  }
  return null;
}
```
`exchangePair` is filled with `{role, content, timestamp}` records as they arrive. The flush triggers when *any* 2 entries accumulate — not specifically a `[user, assistant]` pair. Claude sub-agent sidechains can have multiple consecutive `user` records (tool_result interleaving) or back-to-back `assistant` continuations on long messages. The flushed exchange will then be passed to `ObservationWriter.processMessages` as if it were a complete user/assistant turn, when it's actually two consecutive userside records or two assistant continuations.

The downstream effect depends on what ObservationWriter does with malformed pairs — at minimum, the LSL anchors and observation tagging will be off; at worst, the dedupe key will collide unpredictably.
**Fix:** Pair on role boundaries, not on count:
```js
function pushExchangeIfReady() {
  // Find the first [user, assistant] pair in the buffer; flush + clear up to it.
  for (let i = 0; i + 1 < exchangePair.length; i++) {
    if (exchangePair[i].role === 'user' && exchangePair[i + 1].role === 'assistant') {
      const out = exchangePair.slice(i, i + 2);
      exchangePair = exchangePair.slice(i + 2);
      return out;
    }
  }
  return null;
}
```
Or buffer until role transitions and emit segments at every assistant→user boundary.

### WR-05: `write-sub-agent-lsl.mjs --historical` flag is dead code

**File:** `scripts/write-sub-agent-lsl.mjs:155, 187`
**Issue:**
```js
const historical = hasFlag(argv, '--historical');
// ...
const sinceArg = historical ? null : null;
```
Both branches of the ternary return `null`, so `--historical` has zero effect. The comment at line 184-186 explains this is intentional ("`--historical` is a documented opt-in for future adapters that might apply a default since=24h ago"), but a CLI flag that doesn't do anything is misleading. Either remove the flag or wire it through to mean something different from the default.
**Fix:** Remove the flag entirely from `parseArgs` and the help text, OR commit to a different default (e.g. without `--historical`, pass `since=Date.now() - 24h`; with the flag, pass `null`). Pick one and document it.

### WR-06: `combined-status-line.js` lazy registry-reader import races on first concurrent load

**File:** `scripts/combined-status-line.js:23-28`
**Issue:**
```js
let _registryReader = null;
async function getRegistryReader() {
  if (_registryReader) return _registryReader;
  _registryReader = await import('../lib/lsl/registry-reader.mjs');
  return _registryReader;
}
```
Two concurrent callers reach `getRegistryReader()` before `_registryReader` is assigned; both trigger separate `import()` calls. ESM module cache deduplicates the actual load, so functionally this is benign — but the `_registryReader` reassignment can clobber a more recent value. The pattern that avoids the race is to memoize the *promise*:
```js
let _registryReaderPromise = null;
function getRegistryReader() {
  if (!_registryReaderPromise) {
    _registryReaderPromise = import('../lib/lsl/registry-reader.mjs');
  }
  return _registryReaderPromise;
}
```
This is a minor nit — ESM's cache makes the bug benign in practice — but the pattern is wrong.
**Fix:** Memoize the promise, not the resolved module.

### WR-07: `sub-agent-live-claude.mjs` `--state-file` default disagrees with launchd plist convention

**File:** `scripts/sub-agent-live-claude.mjs:52` (CONFIRMED in `lib/lsl/registry-reader.mjs:45-52` comment)
**Issue:** The daemon's default `--state-file` is `.data/sub-agent-live-state.json` (no `-claude` suffix). The launchd plist `launchd/com.coding.sub-agent-live-claude.plist` correctly passes `--state-file .data/sub-agent-live-state-claude.json`, but anyone running the daemon by hand without the explicit flag writes to `sub-agent-live-state.json`, which the registry-reader at `lib/lsl/registry-reader.mjs:54` doesn't know about. The reader's HEARTBEAT_FILES map only has `claude → sub-agent-live-state-claude.json`.

The Plan 51-10 docstring at registry-reader.mjs:45-51 explicitly acknowledges this gap — but accepting an inconsistency rather than fixing it ships a footgun. Any operator debug-running the daemon (`node scripts/sub-agent-live-claude.mjs`) sees the heartbeat file appear but the statusline/health-API never picks it up.
**Fix:** Change the daemon default to match the convention:
```js
const DEFAULT_STATE_FILE = path.join('.data', 'sub-agent-live-state-claude.json');
```
And update the help text. Note the `sub-agent-live-copilot.mjs:87` and `sub-agent-live-opencode.mjs:145` already use the agent-suffixed defaults — Claude is the odd one out.

### WR-08: `health-coordinator.js` sweep state file read is not uid-checked consistently

**File:** `scripts/health-coordinator.js:702-716`
**Issue:** The block uid-checks the sweep state file (line 706-707: `if (myUid === null || stat.uid === myUid)`), but the file is created by `scripts/sub-agent-sweep-job.sh` via `mv "${TMP_FILE}" "${STATE_FILE}"`. The shell script never validates that `STATE_FILE`'s parent dir is owned by the right uid before writing — symlink attack: if an attacker plants `.data/sub-agent-sweep-state.json` as a symlink to a file they don't own, the `mv` may follow the link. On macOS `mv` semantics for symlinks vary; `printf > "${TMP_FILE}"` followed by `mv "${TMP_FILE}" "${STATE_FILE}"` is generally safe because the TMP write happens in the controlled `.data/` dir, but the design depends on `.data/` being uid-locked. There's no check.

This is a hardening Warning, not a Critical, because the threat model assumes the operator's `.data/` is uid-isolated (matches all the other adapters' uid-check patterns). But it's inconsistent: the registry-reader uid-checks the heartbeat files (line 96-99), the adapters uid-check their transcripts, but the sweep state file is written via shell with no such guard.
**Fix:** Add a `[[ -O "${STATE_FILE}" ]]` check in `scripts/sub-agent-sweep-job.sh` before the `mv`, or pre-create the dir with `chmod 700`. Document the threat model gap in the script header.

### WR-09: `mastra-ndjson.mjs` import `os` is unused

**File:** `lib/lsl/adapters/mastra-ndjson.mjs:50` (was at line 50 — let me re-check)
**Issue:** Actually scanning the file: line 49-52 imports `fs`, `path`, `readline`, `process`. `os` is NOT imported here — strike that. Lower-priority unused imports: `import os from 'node:os'` *is* imported in `index.mjs:32` and used at lines 127/132. Re-checking `mastra-ndjson.mjs` — no unused imports.

Real WR-09: `scripts/write-sub-agent-lsl.mjs:50-54` imports `allocateSlot as _allocateSlot` from the slot allocator with the comment "re-exported for visibility — not used directly here". This is unused dead code. The CLI never calls `_allocateSlot` directly; `writeSubAgentLSL` calls it internally.
**File:** `scripts/write-sub-agent-lsl.mjs:50-54`
**Fix:** Drop the import:
```js
import {
  loadSlotState,
  saveSlotState,
  DEFAULT_STATE_PATH,
} from '../lib/lsl/sub-agent-slot-allocator.mjs';
```
The "for visibility" rationale doesn't justify shipping unused code — the dependency edge is already documented by the writer's import.

## Info

### IN-01: `sweep-sub-agents.mjs` imports `convertTranscriptsToObservations` only for documentation

**File:** `scripts/sweep-sub-agents.mjs:55-56`
**Issue:**
```js
// eslint-disable-next-line no-unused-vars
import { convertTranscriptsToObservations } from '../lib/lsl/scan-and-convert.mjs';
```
A linter-bypassed unused import "to keep the dependency edge visible" is a documentation smell — comments serve that purpose. Importing a function only to suppress lint creates a hidden runtime cost (the module is loaded and parsed) for zero behavioral value, and the next reader has to figure out why it's there.
**Fix:** Replace with a comment block referencing the path; remove the import + the lint disable.

### IN-02: `copilot-events.mjs` `parseWorkspaceYaml` field-by-field regex is fragile

**File:** `lib/lsl/adapters/copilot-events.mjs:56-70`
**Issue:** The regex `new RegExp(`^${field}:\\s+(.+)$`, 'm')` requires at least one whitespace char after the colon (`\s+`). Standard YAML allows zero whitespace (`field:value`) or multiple. If Copilot ever emits `id:abc-123` (no space), the field falls through to "absent" and `git_root` may then default to undefined → project resolution silently drops to 'unknown'. RESEARCH landmine #6 noted "regex parser, no js-yaml dep" was the intent; this is the cost.
**Fix:** Use `\\s*` instead of `\\s+`, and add a test case with no-space colon to lock the behavior.

### IN-03: `sub-agent-live-copilot.mjs` unused `prev` parameter

**File:** `lib/lsl/live/copilot-events-tail.mjs:265`
**Issue:**
```js
const listener = (curr, prev) => { ... };
```
`prev` is never used. Same in `claude-fs-watch.mjs:234`. fs.watchFile callbacks pass `(curr, prev)`; leaving `prev` named in the parameter list is harmless but the linter may flag it.
**Fix:** Either drop the parameter (`const listener = (curr) => { ... }`) or prefix with underscore (`_prev`) per convention.

### IN-04: `combined-status-line.js` _effectiveActivityMtime is `static` but called via Class.prototype

**File:** `scripts/combined-status-line.js:479` (declared `static`), `:531, :1000, :1154` (called as `CombinedStatusLine._effectiveActivityMtime`)
**Issue:** The method is correctly declared static and called as a class-level reference. No bug, but the leading underscore convention typically signals "private/internal" — yet static + accessible-from-anywhere is the opposite. Consider either dropping the underscore or moving it out of the class to a module-private function.
**Fix:** Stylistic — pick a convention and stick with it.

### IN-05: Magic numbers across daemons (heartbeat interval, error budget, stale grace)

**Files:** Multiple
**Issue:** `DEFAULT_HEARTBEAT_INTERVAL_S = 30`, `ERROR_BUDGET_LIMIT = 10`, `ERROR_BUDGET_WINDOW_MS = 60_000`, `LOCK_STALE_GRACE_MS = 10 * 60 * 1000`, `DEFAULT_MAX_AGE_MS = 90_000`, `CHUNK_THRESHOLD_BYTES = 100 * 1024`, `TAIL_POLL_INTERVAL_MS = 200` — all are well-documented at their declaration sites, but the cross-cutting relationship (e.g. registry-reader's 90s stale threshold = 3× daemon heartbeat at 30s) isn't enforced. A change to one without the other silently breaks freshness assumptions.
**Fix:** Move to a shared config module (`lib/lsl/config.mjs`) and import from both writers and readers, OR add an integration test that asserts `DEFAULT_MAX_AGE_MS === 3 * DEFAULT_HEARTBEAT_INTERVAL_S * 1000`.

### IN-06: `parseClaudeExchanges` uses `fs.readFileSync` for entire JSONL — defeats memory bounds

**File:** `lib/lsl/adapters/claude-jsonl-tree.mjs:359-365`
**Issue:** The `parseClaudeExchanges` helper does `fs.readFileSync(jsonlPath, 'utf-8')` — reads the entire transcript into memory. Large sub-agent transcripts (Claude's continuous reasoning can produce >100MB JSONL) will OOM in a single allocation. The cousin `parseAndAccumulate` path in the live watcher correctly streams via fixed-size buffer reads. The sweep path doesn't.

This is `Info` rather than `Warning` because sub-agent transcripts are typically <10MB (one-shot tasks) and the writer's chunking caps individual LSL output at 100KB, but the read is unbounded.
**Fix:** Use `readline.createInterface` on a `fs.createReadStream` — same pattern as the copilot adapter's `readSubAgentEvents`:
```js
const stream = fs.createReadStream(jsonlPath, { encoding: 'utf-8' });
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
for await (const line of rl) { /* parse */ }
```

## Cross-file consistency observations (informational, not numbered findings)

- The three live daemons (Claude/Copilot/OpenCode) have near-identical CLI surfaces (`--state-file`, `--heartbeat-interval`, signal handlers, atomic writes, error budgets) but each implements them independently with minor divergence (Claude uses `setTimeout` recursion; Copilot uses `setInterval`; OpenCode uses `setInterval`). Considering extracting a shared `lib/lsl/daemon-harness.mjs` would reduce drift. Not a defect in this review — but it explains why CR-02 (missing `registry_rows` in OpenCode heartbeat) slipped through: the daemons are copy-paste cousins, and the copy-paste author dropped the field. A shared harness would have surfaced it.
- The four adapters all have `convertToObservations` that lazy-import ObservationWriter. The signatures diverge (Claude uses `convertTranscriptsToObservations` per-row; OpenCode and Mastra call `writer.processMessages` directly; Copilot synthesizes a 2-message exchange). Locked decision per CONTEXT.md D-Reuse — not a defect — but the dispatcher's `results` aggregation (sweep-sub-agents.mjs:179-191) assumes a uniform shape (`r.observations_written` / `r.skipped` / `r.error`); Claude returns `{ sub_hash, observations_written, skipped, error }`, OpenCode returns `{ sub_hash, transcript_path, observations_written, skipped, error? }` (note `transcript_path` is extra; harmless), Mastra returns `{ sub_hash, observations_written, skipped, error }`, Copilot returns `{ row, observations, error? }` (NOTE: uses `observations` not `observations_written`, and `row` not `sub_hash`!). The dispatcher at line 182 does `registry.markCompleted(agentId, r.sub_hash, ...)` — for Copilot, `r.sub_hash` is undefined, so `registry.markCompleted` will throw `Error: no row for copilot:undefined` (registry.mjs:165). **This is borderline-critical** but caught by the outer try/catch at sweep-sub-agents.mjs:174 → continues to next agent, so the sweep doesn't crash but Copilot observations are written with no registry transition. Treating this as a follow-up cross-file finding because the dispatcher catches it; flag it as **WR-10 candidate** if you want it tracked.

---

_Reviewed: 2026-05-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Addendum (hands-on verification finding) — 2026-05-27

### CR-04 — Plan 51-11 plists hardcode `/usr/local/bin/node` — fails on Apple Silicon

**Severity:** Critical
**Files:** `launchd/com.coding.sub-agent-live-claude.plist:9`, `launchd/com.coding.sub-agent-live-copilot.plist:9`, `launchd/com.coding.sub-agent-live-opencode.plist:9`, `launchd/com.coding.sub-agent-sweep.plist:9`
**Discovered:** During Plan 51-11 Task 3 launchd install + smoke verify by the operator on an Apple Silicon Mac (`/opt/homebrew/bin/node` exists, `/usr/local/bin/node` does not).
**Symptom:** All 4 launchd jobs fail with exit code 78 (EX_CONFIG) on every spawn attempt. No log lines from launchd-spawned daemons appear in `.data/live-*.log` — the executable can't even start. `launchctl kickstart -k` hangs because launchd keeps retrying behind ThrottleInterval=60s with the broken path.

**Why this isn't caught by the integration tests:** `tests/integration/sub-agent-launchd-install.test.js` checks plist *structure* (Label, ProgramArguments shape, KeepAlive presence, StandardErrorPath redirect) but does NOT verify that ProgramArguments[0] resolves to an executable file on the host. Tests pass on the worktree host where `/usr/local/bin/node` may exist (e.g. CI), but fail on Apple Silicon dev machines.

**Fix recipe (gap-closure plan candidate):**
1. `scripts/install-sub-agent-launchd.sh` should detect `node` via `command -v node` or `which node` at install time and substitute the absolute path into the plists before copying them to `~/Library/LaunchAgents/`.
2. Alternatively, use a wrapper shell script (`scripts/sub-agent-sweep-job.sh` is one — the same pattern can wrap each live daemon) and have the plist invoke `/bin/sh -c '<wrapper>'` so the shell PATH (already set in `EnvironmentVariables`) does the resolution.
3. Add a test that asserts `[ -x "$(node -e 'process.stdout.write(require(\"fs\").readFileSync(...).match(...))')" ]` — i.e. the plist's first ProgramArgument is executable on the install host.

**Impact:** Phase 51's entire Path A (live capture) is non-functional on Apple Silicon Macs as shipped. Path B (sweep) is similarly broken since `com.coding.sub-agent-sweep.plist` has the same hardcoded path. Effectively this nullifies Plan 51-11's value-add until fixed.

**Status:** Recorded here; a gap-closure phase (51.1 or equivalent) should bundle CR-01..CR-04 + the high-risk Warnings for a single fix-cycle.
