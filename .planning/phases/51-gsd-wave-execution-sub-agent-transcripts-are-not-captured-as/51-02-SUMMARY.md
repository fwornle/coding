---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 02
subsystem: lsl
tags: [phase-51, claude-code, sweep, path-b, backfill, adapter, lsl, sub-agent-capture]

# Dependency graph
requires:
  - phase: 51-01
    provides: "Adapter loader (lib/lsl/adapters/index.mjs AGENTS + loadAdapter + getAgentSearchPaths) + registry (lib/lsl/registry.mjs createRegistry/upsert/markCompleted) + dispatcher (scripts/sweep-sub-agents.mjs) — Plan 51-02 plugs the first concrete adapter (claude-jsonl-tree) into this surface."
  - phase: 50
    provides: "Phase 50 LSL primitives lib/lsl/scan-and-convert.mjs (scanTranscriptsForUnconverted + convertTranscriptsToObservations). The Claude adapter imports convertTranscriptsToObservations unchanged per CONTEXT.md D-Reuse."
provides:
  - "lib/lsl/adapters/claude-jsonl-tree.mjs — Claude Code Path B sweep adapter implementing the locked Plan 51-01 contract."
  - "Path-parsing primitive helpers (projectFromClaudeSubagentPath / parentSessionFromClaudeSubagentPath / agentIdFromClaudeSubagentPath / subHashFromAgentId / readFirstMessageTimestamp / computeSubIndexes) — exported for re-use by Plan 51-07 (live-tier hook) + 51-06 (LSL parity writer)."
  - "tests/live-logging/adapter-claude.test.js — 12-test contract spec for any future Claude adapter variant (storage-tag refactors, hashtag-length tweaks, etc.) to regression-test against."
  - "scripts/backfill-subagent-transcripts.mjs — now a 27-line thin wrapper around scripts/sweep-sub-agents.mjs; preserves the legacy invocation surface so existing operator runbooks keep working."
affects: [phase-51-03, phase-51-04, phase-51-05, phase-51-06, phase-51-07]

# Tech tracking
tech-stack:
  added: []  # zero new package installs (T-51-02-SC mitigation; package.json unchanged)
  patterns:
    - "Adapter Option-A: delegate to Phase 50 primitive once per row, weaving per-row metadata into transcript-arg fields (parent_session_id/sub_index/sub_hash) the primitive ignores but downstream stamp passes can read."
    - "Per-adapter path-parsing helpers exported individually so live-tier hook + LSL parity writer can reuse them without duplicating the regex."
    - "Defense-in-depth two-layer gates: filesystem uid-check (T-51-02-FI) + first-record isSidechain:false rejection (RESEARCH-claude.md landmine #3). Both fire stderr forensic lines."

key-files:
  created:
    - lib/lsl/adapters/claude-jsonl-tree.mjs
    - tests/live-logging/adapter-claude.test.js
    - .planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-02-SUMMARY.md
  modified:
    - scripts/backfill-subagent-transcripts.mjs  # 132 → 27 lines; thin wrapper

key-decisions:
  - "Option A over Option B for convertToObservations() — call Phase 50 primitive once per row (writer.init overhead is acceptable for hourly sweeps of <100 rows) rather than duplicating ~30 lines of processLineStream logic in the adapter (D-Reuse spirit)."
  - "Per-row metadata channel: pass sub_hash + parent_session_id + sub_index as additional fields on the transcript object handed to convertTranscriptsToObservations. The Phase 50 primitive ignores extras at the public surface so the contract stays unchanged, but Plan 51-06 can read them off the same array."
  - "Project-name allowlist regex /^[a-z0-9-]+$/i applied AFTER path-decoded extraction (T-51-02-PI). Rejects '/', '..', control chars, and decoded names containing anything outside [a-z0-9-]."
  - "Attribution scan bounded at 10 lines (RESEARCH-claude.md landmine #10) — attributionSkill may be null on some sub-agents; do not throw."

patterns-established:
  - "Per-agent adapter file naming: <agentId>-<storageType>.mjs (Plan 51-01 lock). Claude takes the 'jsonl-tree' tag; opencode='sqlite', copilot='events-jsonl', mastra='ndjson' per CONTEXT.md."
  - "Internal helper-field convention: __firstMessageTs and __mtimeMs prefixed with double underscores on row objects, stripped before discover() returns to caller. Keeps the row shape pure for registry.upsert without duplicating disk reads."

requirements-completed: []  # plan frontmatter requirements list is empty

# Metrics
duration: 7min
completed: 2026-05-26
---

# Phase 51 Plan 02: Claude Code Path B sweep adapter Summary

**Claude Code sub-agent transcripts under `~/.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl` are now sweep-discoverable through a 460-line adapter that plugs into the Phase 51 dispatcher; backward-compat `scripts/backfill-subagent-transcripts.mjs` is preserved as a 27-line thin wrapper.**

## What was built

### `lib/lsl/adapters/claude-jsonl-tree.mjs` (new — 460 lines)

Implements the Plan 51-01 locked adapter contract for Claude Code. Two public methods + six exported helpers:

- **`adapter.discover({ searchPaths, project, since })`** — walks each search path recursively, filters for the `SUBAGENT_PATH_RE` layout, applies the fs uid-check gate (T-51-02-FI), reads the first JSONL line for the `isSidechain` defense-in-depth check (landmine #3) AND the first-message timestamp (for `sub_index` ordering), bounds-checks the project name against `/^[a-z0-9-]+$/i` (T-51-02-PI), and returns rows shaped for `registry.upsert()`. Sub-indexes are assigned per-parent-UUID-group in first-message-timestamp ascending order. Rows are returned sorted by `mtimeMs` ascending so callers can prioritize oldest backlog first.

- **`adapter.convertToObservations(rows, { dryRun, tag })`** — invokes Phase 50's `convertTranscriptsToObservations()` once per row (Option A per the plan's recommendation). Per-row metadata (`parent_session_id`, `sub_index`, `sub_hash`, `agent='claude'`, `project`) is woven into the transcript object passed to the primitive; the primitive ignores these extras at its public surface but downstream metadata-stamp passes (Plan 51-06) can read them.

- **Path-parsing helpers** (verbatim regex from RESEARCH-claude.md):
  - `SUBAGENT_PATH_RE = /\/\.claude\/projects\/(-[^/]+)\/([0-9a-f-]{36})\/subagents\/agent-([a-f0-9]+)\.jsonl$/`
  - `projectFromClaudeSubagentPath` — decodes encoded-cwd; falls back to first-line `cwd` field if path-walk fails; returns `'unknown'` if both routes fail.
  - `parentSessionFromClaudeSubagentPath`, `agentIdFromClaudeSubagentPath`, `subHashFromAgentId` (first 7 chars per CONTEXT.md D-LSL-Filename Claude override), `readFirstMessageTimestamp`, `computeSubIndexes`.

### `tests/live-logging/adapter-claude.test.js` (new — 386 lines, 12 tests)

12 of 12 tests pass:

| # | Coverage |
|---|----------|
| 1 | `projectFromClaudeSubagentPath` decodes encoded-cwd to last segment |
| 2 | `parentSessionFromClaudeSubagentPath` returns 36-char UUID |
| 3 | `agentIdFromClaudeSubagentPath` returns full hex id |
| 4 | `subHashFromAgentId('a24960e65f317241e')` returns `'a24960e'` |
| 5 | `discover()` returns 3 rows for 3 fixtures across 2 parent dirs (proves recursive walk + multi-parent grouping) |
| 6 | `sub_index` ordering is by first-message timestamp, NOT lexicographic |
| 7 | fs uid-check gate — non-owned file is skipped + stderr `'skipping non-owned'` (T-51-02-FI) |
| 8 | `isSidechain:false` filter — non-sidechain file is skipped + stderr `'skipped non-sidechain'` (landmine #3) |
| 9 | Truncated last line does not throw — row still produced (landmine #5) |
| 10 | `convertToObservations()` delegates to Phase 50 primitive with `tag='sub-agent-backfill'` |
| 11 | Per-row metadata reaches the Phase 50 primitive call args |
| 12 | Adapter exports the locked `{agentId, storageType, discover, convertToObservations}` contract |

Mocking: `jest.unstable_mockModule('../../lib/lsl/scan-and-convert.mjs')` so Phase 50 delegation can be asserted without touching the real DB.

### `scripts/backfill-subagent-transcripts.mjs` (modified — 132 → 27 lines)

Thin wrapper around `scripts/sweep-sub-agents.mjs --agent claude --project coding --limit 100`. Emits a stderr deprecation notice on every invocation. Forwards arbitrary extra args (`--dry-run`, `--since`, `--help`, `--historical`) and exit code.

## How to verify

```bash
# Adapter tests
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest \
  tests/live-logging/adapter-claude.test.js --no-coverage
# Expected: 12 of 12 passed.

# Full Phase 50 + Phase 51 regression
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest \
  tests/live-logging/scan-and-convert.test.js \
  tests/live-logging/lsl-window.test.js \
  tests/live-logging/sub-agent-registry.test.js \
  tests/live-logging/sweep-sub-agents-dispatcher.test.js \
  tests/live-logging/resolve-observations-from-lsl.test.js \
  tests/live-logging/adapter-claude.test.js --no-coverage
# Expected: 57 of 57 passed across 6 suites.

# Smoke dry-run vs live filesystem
node scripts/sweep-sub-agents.mjs --agent claude --project coding --dry-run
# Expected: discovered=N (currently 624 in the live data), converted=0 (dry-run).
```

## Smoke-run results (host-side, live filesystem)

```
$ node scripts/sweep-sub-agents.mjs --agent claude --project coding --dry-run
[sweep] agent=claude limit hit (624 -> 100); oldest 100 retained
[sweep] agent=claude dry-run discovered=100 converted=0 skipped=0 failed=0
[sweep] aggregate discovered=100 converted=0 skipped=0 failed=0 registry_size=100
```

The adapter found **624 candidate sub-agent transcripts** under `~/.claude/projects/-Users-Q284340-Agentic-coding/*/subagents/`. The dispatcher's default `--limit 100` capped the discovery, so the oldest 100 were retained and registered. The full 624-row pass is one CLI flag away (`--limit 800`).

```
$ node scripts/backfill-subagent-transcripts.mjs --help
[backfill] deprecated; delegating to scripts/sweep-sub-agents.mjs --agent claude --project coding
Usage: sweep-sub-agents.mjs [options]
…
```

Backward-compat invocation works.

## Verification gates

| Gate | Command | Result |
|------|---------|--------|
| AC: SUBAGENT_PATH_RE present | `grep -c "const SUBAGENT_PATH_RE =" lib/lsl/adapters/claude-jsonl-tree.mjs` | 1 |
| AC: uid-check gate (T-51-02-FI) | `grep -c "fs.statSync\|st.uid" lib/lsl/adapters/claude-jsonl-tree.mjs` | 3 |
| AC: isSidechain defense-in-depth | `grep -c "isSidechain" lib/lsl/adapters/claude-jsonl-tree.mjs` | 3 |
| AC: subHashFromAgentId(slice(0,7)) | `grep -F "agentId.slice(0, 7)" lib/lsl/adapters/claude-jsonl-tree.mjs` | 1 line |
| AC: Phase 50 primitive imported | `grep -F "from '../scan-and-convert.mjs'" lib/lsl/adapters/claude-jsonl-tree.mjs` | 1 line |
| AC: D-Reuse cumulative gate | `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` | 0 files changed |
| AC: no-console (CLAUDE.md) | `grep -c "console\." lib/lsl/adapters/claude-jsonl-tree.mjs` | 0 |
| AC: project-name allowlist (T-51-02-PI) | `grep -cE "/\^\[a-z0-9-\]\+\\\$" lib/lsl/adapters/claude-jsonl-tree.mjs` | 1 |
| AC: wrapper line count ≤ 40 | `wc -l scripts/backfill-subagent-transcripts.mjs` | 27 |
| AC: wrapper delegates | `grep -F "scripts/sweep-sub-agents.mjs" scripts/backfill-subagent-transcripts.mjs` | 3 hits |
| AC: wrapper uses child_process | `grep -F "child_process" scripts/backfill-subagent-transcripts.mjs` | 1 |
| AC: deprecated marker | `grep -F "deprecated" scripts/backfill-subagent-transcripts.mjs` | 1 |
| AC: 3 commits total | `git log --oneline -3` | test(51-02) + feat(51-02) + refactor(51-02) ✓ |

## Decisions Made

1. **Adapter Option A (per-row Phase 50 invocation)** — chosen over Option B's processLineStream duplication. Per-call writer overhead is acceptable for hourly sweeps of <100 rows; D-Reuse spirit honored.
2. **Per-row metadata channel via transcript-object extras** — added `parent_session_id`, `sub_index`, `sub_hash`, `agent`, `project` to the transcript object handed to `convertTranscriptsToObservations`. The primitive ignores extras at the public surface (it only reads `.path` and `.mtime`), so the contract stays unchanged and Plan 51-06's metadata-stamp pass has the data it needs.
3. **Internal helper-field stripping** — `__firstMessageTs` and `__mtimeMs` are double-underscored row fields used during discovery for ordering and then deleted before returning to caller. Keeps the row shape pure for `registry.upsert` without duplicating disk reads.
4. **First-line + bounded-prefix file reads** — `readFirstLine()` opens with `fs.openSync` + `readSync` into a 64-KB buffer rather than streaming the entire file. Sub-agent transcripts can be megabytes; we only need the first line for the gates and timestamp.
5. **Attribution scan bounded at 10 lines** — RESEARCH-claude.md landmine #10 noted `attributionSkill` can be `null` on some sub-agents. Don't throw; populate as `null`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug fix] Test fixture path prefix corrected for SUBAGENT_PATH_RE anchor**
- **Found during:** Task 1 GREEN phase (first jest run after writing the adapter)
- **Issue:** Initial test fixtures wrote transcripts at `<tmpDir>/<encoded-cwd>/<uuid>/subagents/...`, which the adapter's SUBAGENT_PATH_RE (anchored on `/.claude/projects/`) correctly rejected. Tests 5/6/7/8/9 all returned 0 rows.
- **Fix:** Added `claudeRoot()` helper that mirrors the production layout: `<tmpDir>/.claude/projects/<encoded-cwd>/<uuid>/subagents/...`. All five tests now produce the expected fixtures.
- **Files modified:** tests/live-logging/adapter-claude.test.js (writeSubAgent + Test 8/9 path construction).
- **Commit:** 0220b65b8 (combined with GREEN — test changes are scoped to fixture paths; the spec behaviors were not altered).

**2. [Rule 1 — Bug fix] Test 6 fixture ids switched from `zzz...` to `fff...` for hex compliance**
- **Found during:** Task 1 GREEN phase (Test 6 reported 1 of 2 rows).
- **Issue:** Initial Test 6 used `zzzzzzzzzzzzzzzzz` as an agent id. The adapter's SUBAGENT_PATH_RE captures `agent-([a-f0-9]+)\.jsonl` — `z` is not hex, so the regex rejected the path.
- **Fix:** Swapped to `fffffffffffffffff` (lex-greater) + `aaaaaaaaaaaaaaaaa` (lex-lesser). The test still proves sub_index follows first-msg-timestamp order, NOT lexicographic order (now fff=1 ts-earlier, aaa=2 ts-later — the opposite of lex order).
- **Files modified:** tests/live-logging/adapter-claude.test.js (Test 6 body only).
- **Commit:** 0220b65b8.

### Out of scope (not auto-fixed)

**3. [Rule 4 — Architectural decision] `--historical` flag plumbing deferred**
- **Found during:** Task 2 implementation review of the planner's <action> block.
- **Issue:** The plan's Task 2 prescribes a `--historical` flag that propagates `bypassAgeGate:true` through to the adapter's `convertToObservations()`, instructing the adapter to bypass the Phase 50 primitive's `MAX_AGE_MS=48h` gate for the 2026-05-23 incident transcripts. The dispatcher (`scripts/sweep-sub-agents.mjs`) currently forwards only `{ dryRun: false, tag: 'sub-agent-backfill' }` to the adapter — arbitrary flags do not yet propagate, and the adapter's `convertToObservations` does not yet honor a `bypassAgeGate` option.
- **Why deferred:** Implementing bypassAgeGate would require (a) extending the dispatcher to forward arbitrary opts, (b) extending the adapter to read `opts.bypassAgeGate` and route past the Phase 50 primitive into a direct `writer.processMessages` call — which DUPLICATES ~30 lines of Phase 50 processLineStream logic (Option B that the plan's own RECOMMENDATION rejects). This is an architectural decision the planner should reaffirm in light of the Option-A spirit.
- **Recommended action:** Capture as a small Plan 51-02 follow-up OR fold into Plan 51-06 (LSL parity writer) where the 2026-05-23 backfill is the primary success criterion. Either route lets the historical backfill ride on the LSL parity writer's per-row metadata pipe rather than punching through the Phase 50 race-guard.
- **Files affected:** lib/lsl/adapters/claude-jsonl-tree.mjs (would need a `bypassAgeGate` branch), scripts/sweep-sub-agents.mjs (would need opt-forwarding).
- **No commit:** deferred. SUMMARY records this so the verifier sees the gap before running `/gsd-verify-phase 51`.

**4. [Rule 1 — Bug fix] Planner gate `^/\^\[a-z0-9-\]\+\$` is mistyped**
- **Found during:** Acceptance criteria grep run.
- **Issue:** The plan's auto-verifier grep `grep -cE "^/\\^\\[a-z0-9-\\]\\+\\$" lib/lsl/adapters/claude-jsonl-tree.mjs >= 1` requires the literal line to BEGIN with `/^[a-z0-9-]+$` — impossible in a JS source file (line beginnings need a keyword or whitespace). The intent is "the project-name allowlist regex must be present somewhere". My code has `const PROJECT_NAME_ALLOW = /^[a-z0-9-]+$/i;` on line 45 — the regex IS present. Running the grep WITHOUT the leading `^` anchor (`grep -cE "/\^\[a-z0-9-\]\+\\\$"`) returns 1.
- **Fix:** None — the regex is implemented as the plan intends. Documenting the gate's leading-anchor typo so the verifier doesn't flag a false-negative.
- **No commit:** deferred (gate-spec edit).

## Known Stubs

None. The adapter is complete to the locked contract; the only unimplemented item is `bypassAgeGate` which is a planned future extension, not a stub.

## Self-Check: PASSED

- ✓ `lib/lsl/adapters/claude-jsonl-tree.mjs` exists (460 lines, see git diff in commit 0220b65b8)
- ✓ `tests/live-logging/adapter-claude.test.js` exists (12 of 12 tests pass)
- ✓ `scripts/backfill-subagent-transcripts.mjs` modified (27 lines, see git diff in commit 36e0b8390)
- ✓ Commit 66f3926ca exists (`test(51-02): add failing tests for claude-jsonl-tree adapter`)
- ✓ Commit 0220b65b8 exists (`feat(51-02): implement claude-jsonl-tree adapter (Path B sweep)`)
- ✓ Commit 36e0b8390 exists (`refactor(51-02): thin-wrap backfill-subagent-transcripts.mjs around sweep dispatcher`)
- ✓ D-Reuse cumulative gate: `lib/lsl/window.mjs` and `lib/lsl/scan-and-convert.mjs` unchanged.
- ✓ Phase 50 47-test regression suite still green (verified via the 6-suite jest run above; 57 tests across Phase 50 + Phase 51 Wave 1 + this plan = 57/57 pass).
