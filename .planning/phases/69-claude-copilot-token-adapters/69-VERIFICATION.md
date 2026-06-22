---
phase: 69-claude-copilot-token-adapters
verified: 2026-06-22T15:30:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
gaps: []
human_verification:
  - test: "Trigger a live Claude session while com.coding.sub-agent-live-claude is running, then confirm a per-turn token_usage row (agent='claude', user_hash='cladpt') appears in .data/llm-proxy/token-usage.db within ~30 seconds of the session producing an assistant turn."
    expected: "At least one row with granularity_tier='per-turn' and agent='claude' is visible via: sqlite3 .data/llm-proxy/token-usage.db \"SELECT id,agent,granularity_tier,task_id,tool_call_id FROM token_usage WHERE user_hash='cladpt' ORDER BY id DESC LIMIT 5;\""
    why_human: "Cannot verify live daemon emission without running the daemon and producing a real Claude session JSONL event; programmatic grep can only verify the wiring code exists, not that the IPC path fires under the actual supervisor."
  - test: "Trigger a live Copilot session that closes (session.shutdown) while com.coding.sub-agent-live-copilot is running, then confirm a per-session-aggregate token_usage row (agent='copilot', user_hash='copadt') appears."
    expected: "At least one row with granularity_tier='per-session-aggregate' and agent='copilot' is visible via: sqlite3 .data/llm-proxy/token-usage.db \"SELECT id,agent,granularity_tier,task_id FROM token_usage WHERE user_hash='copadt' ORDER BY id DESC LIMIT 5;\""
    why_human: "Cannot verify live Copilot session.shutdown dispatch without a running session under the daemon; the session.shutdown branch wiring is verified at code level but not runtime."
  - test: "Run sub-agent-sweep-job.sh (or 'node scripts/sweep-sub-agents.mjs --project coding --since 2026-06-21T00:00:00Z') and confirm completed Claude and Copilot sessions emit rows with task_id backfilled where timestamps fall in archived measurement spans."
    expected: "Script exits 0; stderr log shows 'claude token rows emitted=N deduped=M task_id-backfilled=K' and 'copilot token rows emitted=P deduped=Q task_id-backfilled=R' with N > 0 and K >= 0; no duplicate (user_hash, tool_call_id) rows exist."
    why_human: "The sweep runs against real on-disk JSONL files and the live token-usage.db; cannot verify end-to-end row production without executing the full sweep pipeline against actual session data."
---

# Phase 69: Claude + Copilot Token Adapters Verification Report

**Phase Goal:** Claude Code and Copilot CLI token spend lands in `token_usage` on the shared Phase-68 contract at the best granularity each surfaces, with sub-agents linked to their parent.
**Verified:** 2026-06-22T15:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Claude session JSONL `usage` blocks are ingested as `per-turn` rows, with `per-reasoning-step` rows emitted for extended-thinking blocks carrying estimated `reasoning_tokens` separate from input/output | ✓ VERIFIED | `lib/lsl/token/claude-token-rows.mjs` exports `buildClaudeTokenRows` + `estimateReasoningTokens`; emits `granularity_tier='per-turn'` (line 189) and `granularity_tier='per-reasoning-step'` (line 224); `tokens_estimated=1` on reasoning rows; `reasoning_tokens=estimateReasoningTokens(thinkingText)` (D-05 length-estimate, never native extraction); 5 jest suites covering per-turn/per-reasoning-step pass (39/39) |
| 2 | Claude sub-agent JSONLs are linked to their parent turn via `parent_call_id`; in-progress sessions are live-tailed and completed sessions are swept by the sweep adapter | ✓ VERIFIED | `parent_call_id` derived from `parentSessionFromClaudeSubagentPath` (claude-jsonl-tree.mjs reuse, D-02, grep count=3); `isSidechain:false` gate honored (returns []); live wiring: `onTokenRow` hook in `claude-fs-watch.mjs` (line 548) wired into `sub-agent-live-claude.mjs` (lines 217-260); sweep wiring: `buildClaudeTokenRows` called in `sweep-sub-agents.mjs` (line 147) with `runSweep`/`loadArchivedSpans` reuse (line 127) |
| 3 | Copilot CLI `events.jsonl` is ingested at `per-session-aggregate` granularity from `session.shutdown.modelMetrics` | ✓ VERIFIED | `lib/lsl/token/copilot-token-rows.mjs` exports `buildCopilotTokenRows`; emits one row per model entry in `session.shutdown.modelMetrics` with `granularity_tier='per-session-aggregate'` (line 189); `parseCopilot` reuse confirmed (grep count=11); live wiring: `session.shutdown` branch in `copilot-events-tail.mjs` (lines 294-318) wired into `sub-agent-live-copilot.mjs` (lines 233-278); sweep wiring: `buildCopilotTokenRows` in `sweep-sub-agents.mjs` (line 239) |
| 4 | The Phase-1 Copilot event-vocabulary check is performed (distinct `type:` values listed, per-turn usage payload presence confirmed); if per-turn payloads exist the adapter upgrades to `per-turn` rows | ✓ VERIFIED | `checkCopilotVocabulary(eventsJsonlPath)` exported from `copilot-token-rows.mjs` (line 221); returns `{ types, perTurnUsagePresent, verdict }`; `COPILOT_PROBED_VERSION = '1.0.63'` baked in (D-09); `verdict='per-session-aggregate'` for v1.0.63 (no per-turn usage on `assistant.*` events); `per-turn` upgrade branch present (line 269) but inert on installed CLI; `warnOnVersionDrift` emits on version change; `copilot-vocab.test.js` 5/5 PASS |
| 5 | Both adapters stamp rows with the active `task_id` (live) or backfill it by timestamp join (sweep) per the TELEM resolution rules | ✓ VERIFIED | Live: `resolveLiveTaskIdSafe()` from `task-id.mjs` (single-reader D-03, no second JSON parser); stamps `row.task_id = liveTaskId` in `sub-agent-live-claude.mjs:224` and `sub-agent-live-copilot.mjs:240`; `''` when no span open. Sweep: `row.task_id = ''` at insert, then `runSweep`/`loadArchivedSpans` from `backfill-task-id-by-timestamp.mjs` (locked D-03 join, no re-implementation) stamps in-window rows; `WHERE task_id = ''` clause is idempotent |

**Score:** 5/5 truths verified

### Locked Decision Compliance

| Decision | What It Requires | Verified |
|----------|-----------------|----------|
| D-05 | `reasoning_tokens` ESTIMATED from content length (`ceil(chars/4)`), NOT native extraction; every per-reasoning-step row stamps `tokens_estimated=1` | YES — `estimateReasoningTokens` at line 57; no `usage.reasoning` read anywhere; `tokens_estimated=1` at line 218; `grep -n "usage\.reasoning"` returns zero matches |
| D-06 | Distinct adapter `user_hash`: `ADAPTER_USER_HASH_CLAUDE='cladpt'`, `ADAPTER_USER_HASH_COPILOT='copadt'` | YES — both match `/^[a-z][a-z0-9]{5}$/`; token-db.mjs lines 42-43 |
| D-07 | `busy_timeout = 5000` set on every adapter DB open; WAL acceptance test passes | YES — `db.pragma('busy_timeout = 5000')` at token-db.mjs:86; WAL test: `ok=50 busy=0 rowsReadBack=50 cleanup=50` |
| D-08 | Token writes best-effort/failure-isolated; onTokenRow failures never reach `opts.onError` or crash LSL path | YES — claude-fs-watch.mjs:548-553 has dedicated catch that does NOT call `opts.onError`; copilot-events-tail.mjs:310-318 mirrors this; sub-agent-live-* wrap all token operations in try/catch; best-effort.test.js 4/4 PASS |
| D-03 | No second `active-measurement.json` parser; only `resolveLiveTaskId` from proxy dist | YES — `grep -c "active-measurement.json" lib/lsl/token/task-id.mjs` = 0 |
| D-02 | Sub-agent `parent_call_id` derived from `parentSessionFromClaudeSubagentPath` reuse | YES — imported from `claude-jsonl-tree.mjs`, grep count=3, no `readdir` of subagents dir |
| D-09 | `COPILOT_PROBED_VERSION='1.0.63'` baked in; `warnOnVersionDrift` emits on change | YES — line 62 of copilot-token-rows.mjs; warnOnVersionDrift at lines 283-290 |
| D-04 | Copilot fallback tier is `per-session-aggregate`; upgrade path present but inert on v1.0.63 | YES — `verdict = perTurnUsagePresent ? 'per-turn' : 'per-session-aggregate'` at line 269; v1.0.63 never sets `perTurnUsagePresent=true` |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `lib/lsl/token/token-db.mjs` | Best-effort INSERT helper, distinct user_hash, busy_timeout | ✓ VERIFIED | Exports `openTokenDb`, `insertTokenRow`, `ADAPTER_USER_HASH_CLAUDE='cladpt'`, `ADAPTER_USER_HASH_COPILOT='copadt'`; 21-col INSERT verified (Python count=21); no console.log |
| `lib/lsl/token/task-id.mjs` | Single-reader live task_id resolver, no second parser | ✓ VERIFIED | Exports `resolveLiveTaskIdSafe`; dynamic import of `measurement-span.js` via `pathToFileURL`; memoized; `active-measurement.json` string count=0 |
| `lib/lsl/token/claude-token-rows.mjs` | per-turn + per-reasoning-step rows + parent linkage | ✓ VERIFIED | Exports `buildClaudeTokenRows`, `estimateReasoningTokens`; uid-check gate (`process.getuid()`); isSidechain gate; D-05 estimation; no console.log |
| `lib/lsl/token/copilot-token-rows.mjs` | per-session-aggregate rows + vocab check + version-keyed verdict | ✓ VERIFIED | Exports `buildCopilotTokenRows`, `checkCopilotVocabulary`, `warnOnVersionDrift`, `COPILOT_PROBED_VERSION`; parseCopilot reuse; `reasoningOpaque` never decoded; no console.log |
| `lib/lsl/live/claude-fs-watch.mjs` | `onTokenRow` hook isolated from observation path | ✓ VERIFIED | Lines 548-553: `onTokenRow` invoked separately from observation path, catch does NOT call `opts.onError` |
| `scripts/sub-agent-live-claude.mjs` | Token modules wired into supervisor with dynamic import guard | ✓ VERIFIED | Lines 190-260: guarded dynamic import, `onTokenRow` function, `startClaudeWatcher({onTokenRow})` |
| `lib/lsl/live/copilot-events-tail.mjs` | `session.shutdown` branch with isolated `onTokenRow` hook | ✓ VERIFIED | Lines 294-318: `session.shutdown` branch fires `cfg.onTokenRow`, isolated catch |
| `scripts/sub-agent-live-copilot.mjs` | Token modules wired into Copilot supervisor | ✓ VERIFIED | Lines 187-278: guarded dynamic import, `onTokenRow` function, `checkCopilotVocabulary` at startup |
| `scripts/sweep-sub-agents.mjs` | Claude + Copilot sweep emission + dedup + reused backfill | ✓ VERIFIED | Claude: lines 108-178; Copilot: lines 197-271; dedup `SELECT 1 ... WHERE user_hash=? AND tool_call_id=?` (parameterized); `runSweep`/`loadArchivedSpans` reuse (D-03) |
| `tests/token-adapters/wal-concurrency.test.mjs` | WAL guardrail acceptance test | ✓ VERIFIED | Passes: `ok=50 busy=0 rowsReadBack=50 cleanup=50`; live body gated on `LLM_PROXY_LIVE=1` |
| `tests/token-adapters/fixtures/claude-session-sample.jsonl` | Claude per-turn + thinking-block fixture | ✓ VERIFIED | `grep -c '"thinking"'` = 2; parses as line-delimited JSON |
| `tests/token-adapters/fixtures/claude-subagent-sample.jsonl` | Subagent fixture with `isSidechain:true` first record | ✓ VERIFIED | First line contains `"isSidechain":true` |
| `tests/token-adapters/fixtures/copilot-events-sample.jsonl` | Copilot events with `session.shutdown.modelMetrics` | ✓ VERIFIED | `grep -c '"session.shutdown"'` = 1; `grep -c '"reasoningTokens"'` = 1 (mixed-model pitfall 5 coverage) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `claude-fs-watch.mjs` | `claude-token-rows.mjs + token-db.mjs + task-id.mjs` | `onTokenRow` callback (lines 548-553) | ✓ WIRED | Hook fires alongside observation path, NOT in observation try/catch |
| `sub-agent-live-claude.mjs` | `claude-token-rows.mjs, token-db.mjs, task-id.mjs` | Guarded dynamic import + `startClaudeWatcher({onTokenRow})` | ✓ WIRED | Imports verified; `onTokenRow` passed to watcher at line 260 |
| `copilot-events-tail.mjs` | `copilot-token-rows.mjs + token-db.mjs + task-id.mjs` | `session.shutdown` branch → `cfg.onTokenRow` | ✓ WIRED | `session.shutdown` branch at line 308; onTokenRow fires; isolated catch |
| `sub-agent-live-copilot.mjs` | `copilot-token-rows.mjs, token-db.mjs, task-id.mjs` | Guarded dynamic import + watcher call with `onTokenRow` | ✓ WIRED | Lines 187-278; `onTokenRow` passed to tail watcher at line 278 |
| `sweep-sub-agents.mjs` | `backfill-task-id-by-timestamp.mjs runSweep` | `import { runSweep, loadArchivedSpans }` (D-03 reuse) | ✓ WIRED | Both Claude (line 127) and Copilot (line 219) sweep branches import and call `runSweep` |
| `claude-token-rows.mjs` | `claude-jsonl-tree.mjs` | `import { SUBAGENT_PATH_RE, parentSessionFromClaudeSubagentPath }` | ✓ WIRED | Reuse confirmed; grep count=3; no `readdir` of subagents dir |
| `copilot-token-rows.mjs` | `src/live-logging/TranscriptNormalizer.js parseCopilot` | `import { parseCopilot }` (line 53) | ✓ WIRED | parseCopilot called on every line as recognized-primitive gate; grep count=11 |
| `task-id.mjs` | `_work/rapid-llm-proxy/dist/measurement-span.js` | `dynamic import(pathToFileURL(...).href)` | ✓ WIRED | LLM_PROXY_DIST_DIR env override + locked default; memoized module cache |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `token-db.mjs insertTokenRow` | `row.user_hash / row.input_tokens / row.reasoning_tokens` | Caller-supplied row from `buildClaudeTokenRows` / `buildCopilotTokenRows` | Yes — real JSONL field values coalesced | ✓ FLOWING |
| `claude-token-rows.mjs buildClaudeTokenRows` | `usage.input_tokens, usage.output_tokens, block.thinking` | Reads JSONL file via `fs.readFileSync` | Yes — actual Claude session JSONL content | ✓ FLOWING |
| `copilot-token-rows.mjs buildCopilotTokenRows` | `data.modelMetrics.<model>.usage.*` | `session.shutdown` event in `events.jsonl` | Yes — actual Copilot session aggregate | ✓ FLOWING |
| `task-id.mjs resolveLiveTaskIdSafe` | return value of `resolveLiveTaskId()` | Proxy dist `measurement-span.js` → `.data/active-measurement.json` | Yes — real active span reader | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| WAL concurrency: 50 second-writer INSERTs, zero SQLITE_BUSY | `node --test tests/token-adapters/wal-concurrency.test.mjs` | `ok=50 busy=0 rowsReadBack=50 cleanup=50` | ✓ PASS |
| All 11 jest suites / 39 tests green | `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/token-adapters/` | `11 suites, 39 tests passed` | ✓ PASS |
| No console.log in any token module | `grep -v '^[[:space:]]*//' lib/lsl/token/*.mjs \| grep -c "console.log"` | 0 in all 4 modules | ✓ PASS |
| D-05: no native reasoning extraction | `grep "usage\.reasoning" lib/lsl/token/claude-token-rows.mjs` | 0 matches | ✓ PASS |
| D-03: no second JSON parser in task-id.mjs | `grep -c "active-measurement.json" lib/lsl/token/task-id.mjs` | 0 | ✓ PASS |
| `COPILOT_PROBED_VERSION='1.0.63'` baked in | `grep -E "COPILOT_PROBED_VERSION.*1\.0\.63"` | 1 match | ✓ PASS |

### Probe Execution

Step 7c: Not applicable. Phase 69 has no declared `probe-*.sh` scripts. The WAL concurrency test (`wal-concurrency.test.mjs`) is the phase's equivalent probe and was run directly (see Behavioral Spot-Checks above).

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ADAPT-01 | 69-01, 69-02, 69-03, 69-05 | Claude Code token rows at per-turn + per-reasoning-step; sub-agents linked via parent_call_id; live-tail + sweep | ✓ SATISFIED | SC#1 (per-turn + per-reasoning-step rows), SC#2 (parent linkage + live/sweep), SC#5 (task_id stamp) all VERIFIED; 5 jest suites specific to Claude pass |
| ADAPT-02 | 69-01, 69-02, 69-04, 69-06 | Copilot CLI token rows at per-session-aggregate; Phase-1 vocabulary check with per-turn upgrade path | ✓ SATISFIED | SC#3 (per-session-aggregate), SC#4 (vocab check + version-keyed verdict), SC#5 (task_id stamp) all VERIFIED; 3 jest suites specific to Copilot pass |

**Bookkeeping inconsistency (WARNING):** REQUIREMENTS.md lines 34-35 show `- [ ] ADAPT-01` and `- [ ] ADAPT-02` with unchecked checkboxes, while the traceability table at lines 86-87 shows both as `Complete`. The checkbox lines were NOT updated to `[x]` at phase completion. This is a documentation-only discrepancy — the implementation is complete — but should be reconciled by updating lines 34-35 to `- [x]`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.planning/REQUIREMENTS.md` | 34-35 | `[ ]` checkboxes for ADAPT-01/02 remain unchecked despite traceability table (lines 86-87) marking both `Complete` | ℹ Info | Documentation inconsistency only; no code impact |

No stub patterns, placeholder returns, unresolved debt markers (TBD/FIXME/XXX), or console.log calls found in any Phase 69 files.

### Human Verification Required

#### 1. Live Claude Token Emission

**Test:** While `com.coding.sub-agent-live-claude` is running, trigger a real Claude session (start any `claude-mcp` session), let it produce at least one assistant turn, then query the DB.
**Expected:** At least one row with `granularity_tier='per-turn'`, `agent='claude'`, `user_hash='cladpt'` appears within ~30 seconds:
```sql
SELECT id, agent, granularity_tier, task_id, tool_call_id
FROM token_usage
WHERE user_hash = 'cladpt'
ORDER BY id DESC LIMIT 10;
```
**Why human:** Cannot verify live IPC between `claude-fs-watch.mjs` `onTokenRow` hook and the actual daemon file-system event without running the supervisor and producing a real session JSONL event.

#### 2. Live Copilot Token Emission

**Test:** While `com.coding.sub-agent-live-copilot` is running, complete a Copilot CLI session (which triggers `session.shutdown`), then query the DB.
**Expected:** At least one row with `granularity_tier='per-session-aggregate'`, `agent='copilot'`, `user_hash='copadt'` appears:
```sql
SELECT id, agent, granularity_tier, task_id, model
FROM token_usage
WHERE user_hash = 'copadt'
ORDER BY id DESC LIMIT 10;
```
**Why human:** Cannot verify the `session.shutdown` branch fires in the real Copilot tail daemon without running a live session that shuts down.

#### 3. Sweep Emission and task_id Backfill

**Test:** Run the sweep manually targeting recent sessions:
```bash
node scripts/sweep-sub-agents.mjs --since 2026-06-21T00:00:00Z --project coding --dry-run
# then without --dry-run
```
**Expected:** Stderr shows `[sweep] claude token rows emitted=N deduped=M task_id-backfilled=K` and `[sweep] copilot token rows emitted=P deduped=Q task_id-backfilled=R` with N > 0; in-window rows have non-empty `task_id`; no duplicate `(user_hash, tool_call_id)` rows.
**Why human:** The sweep requires real on-disk `~/.claude/projects/*/` session JSONLs and `~/.copilot/*/events.jsonl` files, plus an actual token-usage.db. Integration cannot be verified without running the full pipeline against real session data.

### Gaps Summary

No gaps found. All 5 ROADMAP success criteria are satisfied by substantive, wired implementation. The 11 jest suites / 39 tests pass. The WAL concurrency guardrail passes. All 9 locked decisions (D-01 through D-09) are honored. No debt markers, stubs, or missing wiring detected.

The 3 human verification items are operational smoke tests — they require a running daemon environment and real session data to confirm the live-wiring fires end-to-end. The automated tests cover all code paths that can be verified without running services.

---

_Verified: 2026-06-22T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
