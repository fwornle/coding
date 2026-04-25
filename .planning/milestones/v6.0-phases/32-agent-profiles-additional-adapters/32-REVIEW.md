---
phase: 32-agent-profiles-additional-adapters
reviewed: 2026-04-24T17:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - config/agent-profiles.json
  - src/retrieval/rrf-fusion.js
  - scripts/write-session-state.js
  - src/retrieval/working-memory.js
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 32: Code Review Report

**Reviewed:** 2026-04-24T17:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

This phase introduces per-agent tier weight profiles (`agent-profiles.json`), applies them in the RRF fusion pipeline (`rrf-fusion.js`), and adds cross-agent session state continuity (`write-session-state.js`, `working-memory.js`). The overall design is sound and the fail-open patterns are consistently applied. No critical security or data-loss issues were found.

Four warnings were identified: a silent cache corruption risk in `loadAgentProfiles`, a token-budget breach that can occur when `buildPreviousSessionSection` is appended after the budget is already at its ceiling, a subtle state mutation bug in `rrfFuse` that corrupts items when they appear in multiple ranked lists, and a risk in `write-session-state.js` of reading up to 5×20 = many more than 20 files due to the ordering of the slice. Four informational items cover the hardcoded VKB URL, the `_comment` key leaking into profile lookups, the regex lookahead edge case in `parseStateFrontmatter`, and the rebuilt array in `buildPreviousSessionSection` diverging from the original structure.

---

## Warnings

### WR-01: `loadAgentProfiles` caches the empty-object sentinel on every error

**File:** `src/retrieval/rrf-fusion.js:36-46`

**Issue:** On any error (missing file, malformed JSON), `_agentProfilesCache` is set to `{}` and the result is cached permanently for the lifetime of the process. If the config file is temporarily absent at startup (e.g., during a Docker volume mount race) the module will silently serve zero-weight profiles for all subsequent calls, including after the file becomes available. There is no way to invalidate the cache short of a restart.

This is a silent failure: callers receive `{}`, agent profile multipliers are all treated as `1.0`, and no log message is emitted to indicate the problem.

**Fix:**
```js
} catch (err) {
  process.stderr.write(`[rrf-fusion] Failed to load agent profiles: ${err.message}\n`);
  // Do NOT cache — leave _agentProfilesCache null so the next call retries
  return {};
}
```
Remove the `_agentProfilesCache = {}` assignment from the catch block. If retry-on-every-call is too expensive, cache a `{ _loadFailed: true }` sentinel and add a separate retry interval.

---

### WR-02: Cross-agent session section appended without budget enforcement

**File:** `src/retrieval/working-memory.js:401-413`

**Issue:** After `truncateToFit` enforces the 300-token ceiling for the main working memory block, `buildPreviousSessionSection` is appended unconditionally (lines 409-410). `SESSION_STATE_TOKEN_BUDGET` is 100 tokens, so the final output can reach up to 400 tokens — 33% above the D-05 ceiling of 300. The combined token count is computed and returned on line 412, but nothing enforces the combined total against `WM_BUDGET`.

**Fix:**
```js
if (sessionState) {
  const sessionSection = buildPreviousSessionSection(sessionState);
  const sessionTokens = countTokens(sessionSection);
  const remainingBudget = WM_BUDGET - tokens;
  if (sessionTokens <= remainingBudget) {
    markdown += sessionSection;
    tokens += sessionTokens;
  } else {
    // Still log the intent even if we can't inject
    process.stderr.write(
      `[working-memory] Cross-agent section (${sessionTokens} tokens) exceeds remaining budget (${remainingBudget}); skipping injection\n`
    );
  }
}
```
Alternatively, raise `WM_BUDGET` to 400 to explicitly account for the session section, and document the combined ceiling.

---

### WR-03: `rrfFuse` mutates shared item objects across ranked lists

**File:** `src/retrieval/rrf-fusion.js:63-89`

**Issue:** When the same item `id` appears in multiple ranked lists, the first occurrence sets `existing.item` to the item object from that list (line 68). On line 88, `{ ...e.item, rrfScore: e.score }` spreads the object — that part is safe. However, on line 76 and 83, `entry.item.tier` is read from the same stored reference. If callers pass mutable item objects and mutate them between calls (or in the same event loop tick via async callers), the `tier` read on line 76 may not match the original tier.

More concretely: the `existing` object is `{ score, item }` where `item` is a direct reference to the caller's object. If the caller later modifies that object's `tier` field (reasonable in a pipeline), the tier weight multiplication will apply the wrong multiplier. A shallow clone on insertion would prevent this.

**Fix:**
```js
// Line 68 — clone item on first insertion
const existing = scores.get(item.id) || { score: 0, item: { ...item } };
```

---

### WR-04: `git diff HEAD~5` fails silently on repos with fewer than 5 commits

**File:** `scripts/write-session-state.js:28-41`

**Issue:** `git diff --name-only HEAD~5` requires at least 6 commits in history. On a freshly initialised project or a shallow clone, git exits non-zero and the entire `recentFiles` block is swallowed by the inner `try/catch`, producing an empty `recent_files` array. The session state is still written, but with no file context — the cross-agent continuity feature silently degrades.

The `2>/dev/null` redirect in the command string suppresses the error message, so there is no observable signal that the fallback fired.

**Fix:** Use `git diff --name-only HEAD` (unstaged/staged changes) or `git log --name-only --pretty="" -5` to list files touched in the last 5 commits regardless of history depth:
```js
const output = execSync(
  'git log --name-only --pretty="" -5 2>/dev/null || git diff --name-only HEAD 2>/dev/null',
  { cwd: projectDir, timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
);
```

---

## Info

### IN-01: Hardcoded `localhost:8080` VKB URL is not configurable

**File:** `src/retrieval/working-memory.js:29`

**Issue:** `const VKB_BASE = 'http://localhost:8080'` is a magic string with no environment variable fallback. If the VKB is ever moved to a different port or host (e.g., in CI, a different developer's machine, or a Docker network), the module silently returns empty working memory with no indication that the configuration is wrong.

**Fix:**
```js
const VKB_BASE = process.env.VKB_BASE_URL || 'http://localhost:8080';
```

---

### IN-02: `_comment` key in `agent-profiles.json` is treated as an agent name

**File:** `config/agent-profiles.json:2` / `src/retrieval/rrf-fusion.js:80-84`

**Issue:** `agent-profiles.json` includes a `"_comment"` key at the top level (line 2). `loadAgentProfiles` returns the entire parsed JSON, including this key. While callers use the profile by agent name (e.g., `profiles['claude']`), if any code ever iterates over all profile keys — for validation, logging, or dashboarding — it will encounter `"_comment"` as an apparent agent name.

**Fix:** Either strip non-agent keys after parsing, or move the comment into a JSON5/JSONC file, or use a nested structure:
```json
{
  "agents": {
    "claude": { ... },
    "opencode": { ... }
  }
}
```
Alternatively, document that `_comment` is intentional and add a filter in `loadAgentProfiles` if iteration is ever added.

---

### IN-03: `parseStateFrontmatter` regex anchor may miss Windows-style line endings

**File:** `src/retrieval/working-memory.js:84`

**Issue:** The frontmatter regex `^---\n([\s\S]*?)\n---` matches Unix line endings (`\n`) only. If `STATE.md` is checked out on Windows or edited by a tool that introduces `\r\n`, the match will fail and `parseStateFrontmatter` returns `null`. The fail-open design means this is silent.

**Fix:**
```js
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
```
Also update the inner `get` regex:
```js
const m = fm.match(new RegExp('^' + key + ':\\s*(.+?)\\r?$', 'm'));
```

---

### IN-04: `buildPreviousSessionSection` truncation loop rebuilds only part of the original structure

**File:** `src/retrieval/working-memory.js:343-362`

**Issue:** The truncation while-loop (lines 343-361) rebuilds the section from scratch, but slices `files` to 5 entries (`files.slice(0, 5)`) regardless of how many `decisions` have been popped. The initial section (built at line 340) uses up to 10 files (`files.slice(0, 10)` on line 326). When the loop runs even once, the rebuilt section drops from 10 to 5 files — which may itself satisfy the token budget — but the loop condition only checks `decisions.length > 0`, so it may overshoot by dropping decisions before realising the file truncation was sufficient.

This can result in a section that is smaller than necessary (decisions were dropped that could have fit). Not a correctness bug, but a degradation in the quality of injected context.

**Fix:** Separate the file truncation step from the decision truncation step, or rebuild with the full `files` array and only reduce it as a later step.

---

_Reviewed: 2026-04-24T17:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
