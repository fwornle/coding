---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
reviewed: 2026-05-27T12:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - launchd/com.coding.sub-agent-live-claude.plist
  - launchd/com.coding.sub-agent-live-copilot.plist
  - launchd/com.coding.sub-agent-live-opencode.plist
  - scripts/install-sub-agent-launchd.sh
  - tests/integration/sub-agent-launchd-install.test.js
  - lib/lsl/adapters/opencode-sqlite.mjs
  - scripts/sweep-sub-agents.mjs
  - scripts/sub-agent-live-opencode.mjs
  - tests/integration/sub-agent-live-opencode.test.js
  - tests/integration/opencode-adapter-limit.test.js
  - lib/lsl/live/claude-fs-watch.mjs
  - tests/integration/claude-fs-watch-observations-written.test.js
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 51: Code Review Report (Re-review after gap-closure plans 51-12..51-15)

**Reviewed:** 2026-05-27
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This re-review targets the 12 files delivered by gap-closure plans 51-12 through 51-15 that addressed four Critical findings from the original review. All four prior criticals are confirmed closed:

- **CR-01** (OpenCode adapter ignores `--limit`): Closed. `discover()` now destructures `limit` as a top-level parameter (`opencode-sqlite.mjs:226`) and the dispatcher forwards it at `sweep-sub-agents.mjs:143`. Test coverage added in `opencode-adapter-limit.test.js`.
- **CR-02** (OpenCode live daemon omits `registry_rows`): Closed. `sub-agent-live-opencode.mjs:254-259` now emits `registry_rows: registry.listByAgent('opencode').map(...)` in every heartbeat payload. Test coverage added in `sub-agent-live-opencode.test.js`.
- **CR-03** (`claude-fs-watch.mjs` stale-ref `observations_written` increment): Closed. `claude-fs-watch.mjs:522-528` now performs a single atomic `registry.upsert({ ..., observations_written: (cur.observations_written || 0) + 1 })` instead of mutating the stale `cur` reference after `upsert({})` had already replaced the Map slot. Test coverage in `claude-fs-watch-observations-written.test.js`.
- **CR-04** (Plist `ProgramArguments[0]` = `/usr/local/bin/node` absent on Apple Silicon): Closed. All three live-daemon plists now use the `/bin/sh -c 'exec node "$@"' node <script>` wrapper strategy. `ProgramArguments[0] = /bin/sh` exists on every macOS host. Test 8a in `sub-agent-launchd-install.test.js` gates future regressions.

No new Critical issues were introduced by the fix commits. Five Warnings (two correctness risks in `opencode-sqlite.mjs`, one portability issue in the installer, one code-divergence risk, one test contract over-constraint) and six Info items follow.

---

## Warnings

### WR-01: `convertToObservations` double-closes the SQLite `db` handle on every error path

**File:** `lib/lsl/adapters/opencode-sqlite.mjs:463-477`
**Issue:** In the error path of the `try/catch/finally` block that wraps `openReadonlyDb` + `assertSupportedSchema`, the `catch` handler explicitly calls `db.close()` then executes `continue`. Because `finally` always runs before control transfers out of the block (even with `continue`), the `finally` block also calls `db.close()` — producing a double-close on every session that fails schema validation or DB open. `better-sqlite3` throws `"Database is not open."` on a second `close()` call; the inner `try/catch` in `finally` silences that, but this is still a latent logic error. If the catch-block's close is ever removed (or the finally silencing removed), the double-close becomes an observable crash or misleading error message.

```js
// Current (broken):
} catch (err) {
  results.push({ ... error: err.message });
  if (db) { try { db.close(); } catch { /* */ } }  // close #1
  continue;   // <-- finally still runs
} finally {
  if (db) { try { db.close(); } catch { /* */ } }  // close #2 (double-close)
}
```

**Fix:** Remove the explicit `db.close()` from the `catch` block entirely and rely on `finally` alone:
```js
} catch (err) {
  results.push({ sub_hash: row.sub_hash, observations_written: 0, skipped: 0, error: err.message });
  continue;
} finally {
  if (db) { try { db.close(); } catch { /* */ } }
}
```

---

### WR-02: `convertToObservations` proceeds with an uninitialized `ObservationWriter` when `init()` fails

**File:** `lib/lsl/adapters/opencode-sqlite.mjs:433-439`
**Issue:** If `writer.init()` throws, the error is logged to stderr and execution continues into the per-row loop where `writer.processMessages()` is called on an uninitialized writer. Whether this produces silent data loss, a throw on the first call, or corrupt writes depends on `ObservationWriter`'s internal state after a failed init. None of those outcomes are surfaced to the caller — the rows will either error silently or return spurious `observations_written: 0` results. The correct behavior is to fail fast and return all rows as errored.

```js
// Current:
try { await writer.init(); } catch (err) {
  process.stderr.write(`[opencode-adapter] ObservationWriter.init failed: ${err.message}\n`);
  // execution falls through to processMessages() on broken writer
}
```

**Fix:**
```js
try {
  await writer.init();
} catch (err) {
  process.stderr.write(`[opencode-adapter] ObservationWriter.init failed: ${err.message}\n`);
  return rows.map((row) => ({
    sub_hash: row.sub_hash,
    observations_written: 0,
    skipped: 0,
    error: `writer.init failed: ${err.message}`,
  }));
}
```

---

### WR-03: `install-sub-agent-launchd.sh` hardcodes `REPO_ROOT` — installer silently deploys wrong paths on any non-Q284340 machine

**File:** `scripts/install-sub-agent-launchd.sh:47`
**Issue:** `REPO_ROOT="/Users/Q284340/Agentic/coding"` is a literal absolute path baked into the installer. All four plists also embed this path verbatim in `<string>` values for `ProgramArguments`, `WorkingDirectory`, `StandardErrorPath`, and `StandardOutPath`. If this script is run on a different machine (CI, another developer, or after moving the repo), `plutil -lint` passes on the copied (but wrong-path) plists, the bootstrap succeeds, and launchd spawns a job pointing at a non-existent script. The `ENOENT` surfaces only in the daemon's first log line — which is silent until the operator reads `.data/live-*.log`.

**Fix:** Derive `REPO_ROOT` from the script's location at runtime:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
```
Add an early sanity guard:
```bash
if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
  log "ERROR: REPO_ROOT=${REPO_ROOT} does not look like the coding repo root"
  exit 1
fi
```
The plist files must either be generated from templates (replacing the hardcoded path at install time via `sed -i`) or converted to relative references. This is a pre-existing issue in the original phase — the gap-closure plans did not worsen it, but they also did not fix it when the plists were touched for CR-04.

---

### WR-04: `discover()` inlines row-shape construction instead of delegating to `buildSubAgentRow()` — silent divergence risk

**File:** `lib/lsl/adapters/opencode-sqlite.mjs:282-303`
**Issue:** `buildSubAgentRow()` was exported at line 174 specifically so the sweep path and the live-watcher produce identical row shapes. The sweep adapter's own `discover()` still inlines the same construction verbatim rather than calling `buildSubAgentRow(r, { dbPath, detectedVia: 'sweep', subIndex: nextIdx })`. The two copies currently produce identical output because `discover()` uses `project: basename` (line 291) and `buildSubAgentRow()` calls `projectFromOpencodeRow(row)` — which also returns `basename`. However, the duplication means future changes to `projectFromOpencodeRow` (e.g., trimming trailing slashes, normalizing case) will not be reflected in the sweep path without a second edit. This is a maintainability trap that has already produced a minor inconsistency: `discover()` passes an empty string when `directory` is falsy (line 270: `path.basename(r.directory || '')`), while `projectFromOpencodeRow` returns `'unknown'`.

**Fix:**
```js
rows.push(buildSubAgentRow(r, {
  dbPath,
  detectedVia: 'sweep',
  subIndex: nextIdx,
}));
```

---

### WR-05: Test `sub-agent-live-opencode.test.js` Test 2 asserts `parent_session_id` is always a string, excluding the valid `null` case

**File:** `tests/integration/sub-agent-live-opencode.test.js:199`
**Issue:** The assertion `expect(['string'].includes(typeof row.parent_session_id)).toBe(true)` rejects `null`. The registry contract (`registry.mjs:109`) explicitly stores `parent_session_id: row.parent_session_id ?? null`, and `buildSubAgentRow()` passes `opencodeRow?.parent_id ?? null`. If the fixture is ever extended with sessions whose `parent_id` is NULL in the database (e.g., to test the top-level-session exclusion logic), this test produces a false failure. The current fixture always seeds rows with a non-null `parentId`, so the assertion passes today but is brittle.

**Fix:**
```js
// parent_session_id is null (top-level session) or string (sub-session).
expect(row.parent_session_id === null || typeof row.parent_session_id === 'string').toBe(true);
```

---

## Info

### IN-01: `sub-agent-launchd-install.test.js` Test 6 has a TOCTOU window in the closed-port probe

**File:** `tests/integration/sub-agent-launchd-install.test.js:195-209`
**Issue:** The test allocates a port via `listen(0)`, records it, then closes the server — using the now-released port as a "closed" endpoint. Between `tmp.close()` and the child process's `curl`/connect attempt, the OS may reclaim and reassign the port to another process, causing `ECONNREFUSED` to become a successful connection and the `proxy unreachable` assertion to fail spuriously. This is a known TOCTOU pattern in port-probe tests.

**Suggestion:** Use a port outside the OS ephemeral range (e.g., `65533`) or stub the proxy reachability check via an env var that bypasses the network entirely, rather than relying on a specific port being closed.

---

### IN-02: `discover()` re-derives `basename` independently instead of calling `projectFromOpencodeRow(r)`

**File:** `lib/lsl/adapters/opencode-sqlite.mjs:270`
**Issue:** `discover()` calls `path.basename(r.directory || '')` and `isAllowedDirectoryBasename(basename)` separately (lines 270-271), then assigns `project: basename` (line 291). This is functionally equivalent to `projectFromOpencodeRow(r)` but bypasses the exported helper. The two diverge when `directory` is falsy: `discover()` produces `project: ''` (empty string) while `projectFromOpencodeRow` returns `'unknown'`. An empty string `project` will pass the registry's upsert but may cause silent misses downstream if any consumer compares `project === 'coding'` rather than `project?.toLowerCase() === 'coding'`.

**Suggestion:** Replace lines 270-291's project derivation with `const project = projectFromOpencodeRow(r);` and skip the row when `project === 'unknown'` (consistent with the helper's semantics).

---

### IN-03: `sub-agent-live-opencode.mjs` help text hardcodes `/Users/Q284340/Agentic/coding`

**File:** `scripts/sub-agent-live-opencode.mjs:105`
**Issue:** The `--help` banner prints the literal path `/Users/Q284340/Agentic/coding` as the default for `--project-root`. `defaultProjectRoot()` correctly resolves via env var + `os.homedir()` at runtime, so the actual behavior is portable — only the help text is wrong on other machines.

**Suggestion:** Either inject the resolved default into the help string, or replace with a platform-neutral description like `~/.../Agentic/coding (resolved via LSL_PROJECT_ROOT_CODING or os.homedir())`.

---

### IN-04: `sub-agent-live-opencode.test.js` Test 2 tolerance loop (re-read after empty `registry_rows`) is duplicated in Test 3

**File:** `tests/integration/sub-agent-live-opencode.test.js:186-192, 236-241`
**Issue:** Both Test 2 and Test 3 contain an identical pattern: check `registry_rows.length === 0` → wait 2 seconds → re-read heartbeat file → use `rows` from the fresh read. This 2-second fallback adds 2 seconds to each test that hits the slow path and is repeated twice. If the tolerance strategy changes, it must be updated in two places.

**Suggestion:** Extract a `waitForNonEmptyRows(stateFile, maxWaitMs)` helper that combines `waitForHeartbeat` with the re-read loop.

---

### IN-05: `claude-fs-watch-observations-written.test.js` Test 3 hardcodes encoded-cwd `-Users-Q284340-Agentic-coding`

**File:** `tests/integration/claude-fs-watch-observations-written.test.js:237`
**Issue:** `ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid)` embeds a machine-specific URL-encoded path literal. The test's correctness depends on `SUBAGENT_PATH_RE` matching this encoded form and `projectFromClaudeSubagentPath` extracting `coding` from it. On CI with a different `os.homedir()` the encoding would differ and the regex would not match, causing the watcher to silently not register the sub-agent and `row` to be `undefined` at line 251 — a confusing failure unrelated to the CR-03 fix being tested.

**Suggestion:** Derive the encoded form at test time from `os.homedir()` using the same encoding logic Claude Code uses, or extract the encoding function into a testable utility and call it here.

---

### IN-06: `sub-agent-launchd-install.test.js` Test 8a checks executability but not the identity of `ProgramArguments[0]`

**File:** `tests/integration/sub-agent-launchd-install.test.js:254-255`
**Issue:** `fs.accessSync(programArg0, fs.constants.X_OK)` confirms that whatever path is in `ProgramArguments[0]` is executable — but it does not assert that the path is one of the known-safe shell executables (`/bin/sh`, `/bin/bash`). A future regression that sets `ProgramArguments[0]` to an arbitrary user-installed executable would pass this test as long as the file exists and is executable. The test's own comment says it "gates future regressions" from hardcoded node paths, but the assertion does not enforce the constraint narrowly enough to catch a different hardcoded path.

**Suggestion:**
```js
const SAFE_EXECUTABLES = new Set(['/bin/sh', '/bin/bash']);
expect(SAFE_EXECUTABLES.has(programArg0)).toBe(true);
expect(() => fs.accessSync(programArg0, fs.constants.X_OK)).not.toThrow();
```

---

_Reviewed: 2026-05-27T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
