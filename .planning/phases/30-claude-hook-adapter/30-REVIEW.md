---
phase: 30-claude-hook-adapter
reviewed: 2026-04-24T17:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/hooks/knowledge-injection-hook.js
  - .claude/settings.local.json
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-04-24T17:00:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Two files reviewed: the new knowledge-injection hook (`src/hooks/knowledge-injection-hook.js`) and the Claude Code settings file that registers it (`.claude/settings.local.json`).

The hook itself is well-structured. It correctly implements fail-open semantics, uses `safetyTimer.unref()` to avoid blocking the process, byte-accurate `Content-Length` header, and guards against all major failure modes (empty input, parse errors, TTY stdin, short prompts, service unavailability). No security or correctness issues found in the hook logic.

The settings file has two warning-level issues: hardcoded magic numbers in the hook body (minor but worth noting) and a missing `Promise` rejection handler on `main()`. It also contains several malformed/dead allow-list entries that accumulated over time.

## Warnings

### WR-01: Unhandled Promise Rejection on `main()` Call

**File:** `src/hooks/knowledge-injection-hook.js:121`
**Issue:** `main().then(() => process.exit(0))` has no `.catch()` handler. The top-level `try/catch` inside `main()` catches most errors, but if the async generator loop (lines 31-33) throws before reaching the catch, or if `process.stdout.write` throws (e.g., broken pipe), the rejection propagates to the uncaught rejection handler. Node.js will print a warning and — in Node 15+ — terminate with a non-zero exit code, which would cause Claude Code to treat the hook as failed rather than fail-open.

**Fix:**
```js
main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));  // maintain fail-open guarantee
```

### WR-02: HTTP Response Error Status Codes Silently Ignored

**File:** `src/hooks/knowledge-injection-hook.js:102-113`
**Issue:** The `callRetrieval` function reads and parses the response body regardless of HTTP status code. If the retrieval service returns a `500` or `429` with a JSON error body, the code attempts to parse and use it as a valid result. Depending on the server's error response shape, `result.markdown` could be undefined (caught by the null check on line 63) or — if the server returns `{ markdown: "Error: ..." }` in its error format — injected as context.

**Fix:**
```js
(res) => {
  if (res.statusCode < 200 || res.statusCode >= 300) {
    res.resume(); // drain and discard
    resolve(null);
    return;
  }
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => { /* ... */ });
}
```

## Info

### IN-01: Magic Numbers in Request Body

**File:** `src/hooks/knowledge-injection-hook.js:89`
**Issue:** `budget: 1000` and `threshold: 0.75` are inline magic numbers with no named constants. All other tunable values in the file are named constants (lines 16, 20-24).

**Fix:**
```js
const RETRIEVAL_BUDGET = 1000;
const RETRIEVAL_THRESHOLD = 0.75;
// ...
const body = JSON.stringify({ query, budget: RETRIEVAL_BUDGET, threshold: RETRIEVAL_THRESHOLD });
```

### IN-02: Dead / Malformed Allow-List Entries

**File:** `.claude/settings.local.json:128-129, 224`
**Issue:** Several `allow` entries are fragments of multi-line shell constructs split across separate array entries, e.g.:
- Line 128: `"Bash(for pid in 3230 90594 90744 82119 57665)"`
- Line 129: `"Bash(do echo -n \"PID $pid: \")"`
- Line 224: `"Bash(instance already running\", creating a rapid crash-loop that exhausted GPS''s:*)"`

The last entry (line 224) appears to be a log message that was accidentally added as an allow rule. None of these will ever match a real command invocation. They are dead entries that accumulate permission-list noise.

**Fix:** Remove these entries. If the multi-line loops are needed as allowed commands, the full command should be expressed as a single `Bash(...)` entry or a named script.

### IN-03: Hook Registered with Absolute Path (Portability)

**File:** `.claude/settings.local.json:309`
**Issue:** The hook command uses a hardcoded absolute path: `"node /Users/Q284340/Agentic/coding/src/hooks/knowledge-injection-hook.js"`. This is consistent with the rest of the settings file and works correctly on the developer's machine, but will silently do nothing on any other machine or CI environment.

**Fix:** No code change needed for current use. If the project is ever shared or run in CI, consider a repo-relative path helper or environment variable: `node $CODING_REPO/src/hooks/knowledge-injection-hook.js`.

### IN-04: `res.on('error')` Not Handled on Response Stream

**File:** `src/hooks/knowledge-injection-hook.js:103-112`
**Issue:** The `res` (IncomingMessage) object inside the request callback has no `error` event handler. While uncommon, a socket reset mid-response would emit `'error'` on `res`, which would bubble as an uncaught exception since `res` has no listener. The outer `try/catch` in `main()` would not catch this because it originates from an event emitter outside the async call stack.

**Fix:**
```js
res.on('error', () => resolve(null));
res.on('data', (c) => chunks.push(c));
res.on('end', () => { /* ... */ });
```

---

_Reviewed: 2026-04-24T17:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
