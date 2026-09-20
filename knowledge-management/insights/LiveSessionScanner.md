# LiveSessionScanner

**Type:** Detail

[Architecture Notes] Tight coupling to Copilot's undocumented on-disk lock/session-state layout (~/.copilot/session-state/<uuid>/inuse.<pid>.lock, workspace.yaml) with no abstraction layer shielding the rest of LSL from that shape; opencode-token-rows.mjs directly imports the better-sqlite3 driver and issues raw SQL (SELECT ... ORDER BY rowid DESC LIMIT ?) against a foreign process's live database (~/.local/share/opencode/opencode.db) rather than going through any OpenCode-provided API; No shared base class or interface unifies the two watcher implementations — 'watcher' is a documentation-level concept only, each file independently reimplements ownership checks, fail-closed error handling, and stderr diagnostics; Cross-file reuse does exist selectively: copilot-events-tail.mjs imports parseWorkspaceYaml/projectFromWorkspace/stripToolCallIdPrefix from ../adapters/copilot-events.mjs (a Plan 51-04 artifact) and parseCopilot from src/live-logging/TranscriptNormalizer.js, showing partial but not full architectural convergence; token-db.mjs's schema-shape detection (insertShapeFor(), probing PRAGMA table_info at runtime, cached per-db via a WeakMap) decouples the adapter from a hard dependency on the proxy's routing-column migration having run, at the cost of a per-open runtime introspection query; ObservationWriter.js shows the write-side consumer of these observations routes through km-core's GraphKMStore rather than SQLite directly (Phase 44 cutover), meaning the LiveSessionScanner's stub/real observations ultimately funnel into a different persistence system than the raw token rows in token-db.mjs — two separate storage backends for related telemetry

# LiveSessionScanner — Technical Insight Document

## What It Is

LiveSessionScanner is the umbrella concept (realized under the parent component **LiveTranscriptWatchers**) for detecting and capturing "live" agent sessions across two structurally unrelated backends: `lib/lsl/live/copilot-events-tail.mjs` for Copilot CLI sessions, and `lib/lsl/token/opencode-token-rows.mjs` for OpenCode sessions. Despite sharing a conceptual name, these are two independent implementations with no shared base class — "watcher" is a documentation-level abstraction, not a code-level one. The Copilot side walks `~/.copilot/session-state/<uuid>/` directories and tails `events.jsonl` via polling; the OpenCode side (sibling **OpencodeTokenRows**, via `buildOpencodeTokenRows()`) performs a single bounded SQLite query against `~/.local/share/opencode/opencode.db` at measurement-stop. Both ultimately feed telemetry into the broader LSL system, but through different persistence paths — `token-db.mjs` for token rows and, per `src/live-logging/ObservationWriter.js`, km-core's `GraphKMStore` for observations (a Phase 44 cutover), meaning related telemetry currently lands in two separate storage backends.

## Architecture and Design

The dominant pattern on the Copilot side (sibling **CopilotEventsTail**) is stdlib-only polling rather than event subscription: `scanForLiveSessions()` and `tailEventsFile()`'s inner `listener()` compare file size against a closured `lastSize` on a fixed `TAIL_POLL_INTERVAL_MS = 200` cadence, with no `fs.watch`/inotify involved. This is an explicit "zero new package installs" trade-off (T-51-09-SC) accepting up to 200ms detection lag and per-session syscall overhead, bounded in practice to "typically 1-5" concurrent sessions (T-51-09-RL). OpenCode's `buildOpencodeTokenRows()` inverts this entirely into a pull-based snapshot model, invoked once at measurement-stop with `MESSAGE_SCAN_LIMIT = 4000`, trading live latency for zero background CPU — architecturally the polar opposite design decision solving a superficially similar "watch live session" problem.

A **temporal firewall** pattern separates live-tail responsibility from backfill: `tailEventsFile()` seeds `lastSize` from the file's current size at attach-time, guaranteeing the live path is strictly forward-looking; pre-existing bytes are explicitly deferred to a separate sweep (Plan 51-04, not in scope here), reconciled through the D-Live-Sweep-Tags convention (`metadata.source = 'sub-agent'` vs `'sub-agent-backfill'`, both stamped `lsl_incomplete = true`).

A **fail-closed ownership guard** pattern recurs independently in both watchers: `isOwnedByMe()`/`ownedDbPath()` check `fs.statSync().uid` against `process.getuid()` before any read, resolve errors to empty results rather than throwing, and emit a single stderr diagnostic (never `console.*`). The duplication across files, rather than a shared helper, signals this is an unwritten project convention enforced by discipline, not by shared code.

## Implementation Details

`findLiveLockFile()` uses `LOCK_STALE_GRACE_MS = 10 * 60 * 1000` as a pure heuristic against `mtimeMs` to work around orphaned `inuse.<pid>.lock` files from crashed sessions ("RESEARCH landmine #5") — it does not verify pid liveness via `kill(pid, 0)`, consciously preferring to risk missing a genuinely idle session over leaking scans on dead ones.

`buildStubObservation()` fabricates a synthetic two-message user/assistant exchange from spawn metadata (`agentName`, `agentDescription`, timestamps, `completion_status`) because Copilot CLI persists only lifecycle bookends (`subagent.started/completed/failed`), never message content. The fabricated text is locked verbatim via `COPILOT_LSL_INCOMPLETE_NOTE`, asserted by tests — an "honest degradation" choice over silent omission. `projectMatches()` further skips sessions resolving to `sessionProject === 'unknown'` when a project filter is active.

On the OpenCode side, `BYPASS_PROVIDERS = Object.freeze(new Set(['github-copilot']))` gates which assistant messages are read at all — any `providerID` outside this set is skipped to preserve the no-double-count invariant (D-04), since other providers are assumed already captured by rapid-llm-proxy's wire-level accounting. This invariant is enforced purely by code comment and developer discipline, not runtime cross-check.

Underneath both, `token-db.mjs` opens with `{ fileMustExist: true }` (never creates the proxy's DB) and a 5s `busy_timeout`, using namespaced `user_hash` values (`ADAPTER_USER_HASH_COPILOT='copadt'`, `ADAPTER_USER_HASH_OPENCODE='opnadt'`) so its own `MAX(id)+1` sequence can't race the proxy's counter (D-06/D-07). `insertTokenRow()` retries up to `INSERT_ID_RETRY_ATTEMPTS=3` on `SQLITE_CONSTRAINT`, distinguishing genuine dedup hits from lost id-allocation races.

## Integration Points

`copilot-events-tail.mjs` selectively reuses `parseWorkspaceYaml`/`projectFromWorkspace`/`stripToolCallIdPrefix` from `../adapters/copilot-events.mjs` and `parseCopilot` from `src/live-logging/TranscriptNormalizer.js` — partial, not full, architectural convergence. `opencode-token-rows.mjs` bypasses any OpenCode API entirely, issuing raw `better-sqlite3` SQL directly against a foreign process's live database. `token-db.mjs`'s `insertShapeFor()` probes `PRAGMA table_info` at runtime (cached via WeakMap) to decouple from the proxy's migration state. Downstream, `ObservationWriter.js` routes observations into km-core's `GraphKMStore`, distinct from the raw token rows persisted via `token-db.mjs` — two parallel telemetry backends for related data.

## Usage Guidelines

Developers extending live capture to a third agent must first determine which consistency model fits that agent's on-disk artifact shape — polling-tail (per **CopilotEventsTail**) or pull-snapshot (per **OpencodeTokenRows**) — rather than assuming a shared watcher interface exists. Any new watcher touching foreign process state should replicate the uid-ownership-check + fail-closed + stderr-only-diagnostic contract even though it isn't factored into a shared helper. Extending `BYPASS_PROVIDERS` requires verifying the new provider never touches the proxy's own accounting, or risk silent system-wide double-counting. Given `LOCK_STALE_GRACE_MS` and `buildStubObservation()` are known accuracy compromises, treat their outputs (`lsl_incomplete = true`) as provisional data requiring the separate backfill/sweep process for completeness.


## Hierarchy Context

### Parent
- [LiveTranscriptWatchers](./LiveTranscriptWatchers.md) -- [LLM] The 'LiveTranscriptWatchers' subcomponent is realized across two structurally different watcher implementations that share no code: lib/lsl/live/copilot-events-tail.mjs implements a polled file-tail (statSync + interval polling at TAIL_POLL_INTERVAL_MS=200ms) against ~/.copilot/session-state/<uuid>/events.jsonl, while the OpenCode side (lib/lsl/token/opencode-token-rows.mjs) is not a live tail at all but a pull-based SQLite reader against ~/.local/share/opencode/opencode.db invoked at measurement-stop rather than continuously. This means 'watcher' is a loose term covering two very different consistency models — push-like polling for Copilot vs on-demand snapshot query for OpenCode — and a developer extending live transcript capture to a third agent must first decide which model fits that agent's on-disk artifact shape rather than assuming a single reusable watcher abstraction exists.

### Siblings
- [CopilotEventsTail](./CopilotEventsTail.md) -- [LLM] The `TAIL_POLL_INTERVAL_MS = 200` constant in lib/lsl/live/copilot-events-tail.mjs defines a statSync-based polling loop (`tailEventsFile()`) rather than an OS-level file watcher (fs.watch/inotify). The header comment justifies this as 'comfortable for human-interactive Copilot sessions' since file growth is only a few KB per turn, but this is a deliberate trade-off: polling costs a syscall every 200ms per live session regardless of activity, bounded per the file's own T-51-09-RL threat-model note to 'typically 1-5' concurrent Copilot sessions. This is architecturally distinct from the OpenCode side (lib/lsl/token/opencode-token-rows.mjs), which never polls at all — it performs a single bounded SQLite query (`MESSAGE_SCAN_LIMIT = 4000` rows, ORDER BY rowid DESC) at measurement-stop, trading live latency for zero background CPU cost.
- [OpencodeTokenRows](./OpencodeTokenRows.md) -- [CGR] buildOpencodeTokenRows (function) in opencode-token-rows.mjs


---

*Generated from 10 observations*
