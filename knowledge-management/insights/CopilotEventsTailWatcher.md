# CopilotEventsTailWatcher

**Type:** Detail

# CopilotEventsTailWatcher — Technical Insight Document

## What It Is

CopilotEventsTailWatcher is implemented in `lib/lsl/live/copilot-events-tail.mjs` (with sibling references also appearing under `lib/lsl/token/copilot-events-tail.mjs` in parent-context discussion) as a forward-looking, poll-based file tailer for Copilot CLI's session log format. It watches `~/.copilot/session-state/<uuid>/events.jsonl` files and their companion `inuse.<pid>.lock` files to reconstruct token-usage and lifecycle events for sessions that bypass the rapid-llm-proxy at :12435. As the concrete adapter within the **TokenUsageAdapters** component, it exists specifically because Copilot CLI's own persistence layer — not the proxy — is the only available source of truth for these bypassing calls, making this watcher a "second writer" that patches a gap rather than a clean instrumentation point.

## Architecture and Design

The module is built around several distinguishable architectural patterns. First, a **dual-path live/backfill design**: `tailEventsFile()` explicitly refuses to process pre-existing file content at start ("Path A is strictly forward-looking"), deferring historical backfill entirely to a separate sweep mechanism (Plan 51-04). This mirrors the live-vs-backfill split elsewhere in the LSL subsystem, tagged via `metadata.source = 'sub-agent'` vs `'sub-agent-backfill'`, and keeps this file's state machine narrowly scoped at the cost of depending on a companion component for full coverage.

Second, a **liveness/ownership gating pipeline** in `scanForLiveSessions()` layers `isOwnedByMe()` (uid-based ownership) and `findLiveLockFile()` (mtime-based staleness heuristic) before a session is considered watchable. Both gates favor availability over strict correctness: `isOwnedByMe()` fail-opens (`returns true`) on non-POSIX platforms where `myUid` is null, and `findLiveLockFile()` treats any lock file touched within `LOCK_STALE_GRACE_MS` (10 minutes) as evidence of a live process rather than performing a real `kill(pid, 0)` check — a tradeoff the code itself labels "landmine #5" from RESEARCH-copilot.md.

Third, a **manual poll-based tailing algorithm** rather than a streaming reader — a deliberate consequence of a "Zero new package installs" constraint (T-51-09-SC) that pushes correctness burden (partial UTF-8 splits, residual buffering) into this module.

Fourth, **lossy stub reconstruction** via `buildStubObservation()`, and fifth, **best-effort failure isolation**, where the newer `onTokenRow` hook is bolted onto the pre-existing subagent lifecycle tailer with its own dedicated stderr error path, distinct from the shared `onError` channel.

## Implementation Details

`findLiveLockFile()` globs `inuse.<pid>.lock` entries in a session directory and accepts any within the staleness grace window based on `mtimeMs`, a soft substitute for a hard process-liveness check. `isOwnedByMe()` compares `process.getuid()` against the session directory owner and is used as a POSIX-only defense-in-depth guard (T-51-09-FI). `scanForLiveSessions()` composes both checks but logs asymmetrically: ownership failures emit `[live-copilot] skipping non-owned session ${sessionId}` to stderr, while stale-lock failures are silent, producing an observability gap despite identical outcomes.

`buildStubObservation()` fabricates a synthetic two-message user/assistant exchange from only `agentName`, `agentDescription`, `started_at`, `completed_at`, and `completion_status`, none of which carry real conversational content. It backs the `COPILOT_LSL_INCOMPLETE_NOTE` mechanism but notably does not itself stamp `lsl_incomplete: true` — that marker must be applied at an external call site, decoupling data fabrication from incompleteness signaling.

`tailEventsFile()` reads only the byte range between `lastSize` and current file size via `fs.openSync`/`fs.readSync`, splits on `\n`, and retains a partial trailing segment in a `residual` buffer across polls — a hand-rolled line-buffered reader. Its `onTokenRow` callback parameter, added per Phase 69 atop a Phase 51-era lifecycle tailer, increases the function's cyclomatic complexity by serving two orthogonal concerns (lifecycle dispatch and token aggregation) in one code path.

## Integration Points

The watcher reuses parsing/adapter helpers from `../adapters/copilot-events.mjs` and the shared `TranscriptNormalizer.js` (`../../../src/live-logging/TranscriptNormalizer.js`), but by explicit design choice (D-Reuse) does not reuse Phase 50 primitives like `lib/lsl/window.mjs` or `lib/lsl/scan-and-convert.mjs`. Reconstructed token rows feed into `lib/lsl/token/token-db.mjs`'s `insertTokenRow()`, sibling **TokenDbWriter**, which handles the eventual persistence with its own racy retry/dedup logic around `SELECT MAX(id)+1 THEN INSERT`. Both this watcher and sibling **OpencodeTokenRows** (`buildOpencodeTokenRows` in `opencode-token-rows.mjs`) implement the same "second writer" pattern for different agents (Copilot vs. OpenCode), and both ultimately write through the shared token-db layer, reflecting the parent **TokenUsageAdapters**' broader compensation strategy for calls that bypass the rapid-llm-proxy.

## Usage Guidelines

Developers should treat this watcher's liveness signals as heuristic, not authoritative: a 10-minute stale-lock window means dead sessions can appear live and idle-but-alive sessions can appear dead. The ownership guard provides no protection on Windows, so non-POSIX deployments should not assume this defense-in-depth layer is active. Any future refactor calling `buildStubObservation()` must independently ensure `lsl_incomplete: true` is stamped at the call site, since the function does not enforce this itself. Because `tailEventsFile()` is strictly forward-looking, any consumer needing complete historical coverage must ensure Plan 51-04's sweep component is running. Finally, since `onTokenRow` failures are isolated from subagent dispatch failures, new instrumentation added to this function should preserve — not collapse — that separation to avoid destabilizing the core session-logging path.


## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] The TokenUsageAdapters component solves a specific asymmetry in the Coding project's LLM accounting: the rapid-llm-proxy at :12435 is the primary source of truth for token_usage.db, but three foreground agents (Claude Code, Copilot CLI, OpenCode) each have paths where calls bypass the proxy entirely. lib/lsl/token/copilot-events-tail.mjs, lib/lsl/token/opencode-token-rows.mjs, and lib/lsl/token/token-db.mjs form a 'second writer' subsystem that reconstructs token rows after the fact from each agent's own persistence layer (Copilot's events.jsonl, OpenCode's SQLite opencode.db) rather than intercepting the network call. This is an inherently lossy, best-effort compensation strategy rather than a clean instrumentation point — the code repeatedly documents (in token-db.mjs's insertTokenRow docstring) that failures must never propagate, since the adapters are patching a gap in an otherwise-authoritative pipeline.

### Siblings
- [OpencodeTokenRows](./OpencodeTokenRows.md) -- [CGR] buildOpencodeTokenRows (function) in opencode-token-rows.mjs
- [TokenDbWriter](./TokenDbWriter.md) -- [LLM] token-db.mjs's insertTokenRow() implements a retry loop (INSERT_ID_RETRY_ATTEMPTS = 3) around a non-atomic 'SELECT MAX(id)+1 THEN INSERT' sequence (NEXT_ID_SQL, recomputed on every attempt inside the for-loop). The code's own comment (WR-05 re-review) acknowledges this is racy: a concurrent writer into the same adapter's user_hash space between the SELECT and INSERT throws SQLITE_CONSTRAINT on the composite (user_hash, id) primary key. Rather than surfacing that as a hard failure, the catch block runs a secondary disambiguation query (`SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1`) to decide whether the constraint violation represents a genuine duplicate (return false, drop) or a lost id race (loop again with a freshly recomputed id). This conflates two distinct failure semantics — idempotent dedup vs. optimistic-concurrency retry — into a single exception branch keyed off SQLITE_CONSTRAINT's error code prefix, which is brittle if a future schema change (e.g. adding another unique index) changes what 'constraint violation' means at that call site.


---

*Generated from 10 observations*
