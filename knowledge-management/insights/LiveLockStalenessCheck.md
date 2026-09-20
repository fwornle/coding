# LiveLockStalenessCheck

**Type:** Detail

# LiveLockStalenessCheck — Technical Insight Document

## What It Is

LiveLockStalenessCheck is not a standalone class but a small, self-contained mechanism implemented inside `lib/lsl/live/copilot-events-tail.mjs`, centered on the function `findLiveLockFile(sessionDir)` and the module-level constant `LOCK_STALE_GRACE_MS` (`10 * 60 * 1000`, i.e., 10 minutes). Its job is to determine whether a Copilot session directory represents a "live" session before the code begins tailing its `events.jsonl` file. The mechanism works by scanning the session directory with `fs.readdirSync`, filtering entries against the regex `/^inuse\.\d+\.lock$/`, and comparing each matching lock file's filesystem mtime (`st.mtimeMs`) against the current time. If the elapsed time exceeds the grace window, the lock — and by extension the session — is treated as stale.

Critically, this is a heuristic, not a true liveness check. The pid embedded in the lock filename is matched syntactically by the regex but never parsed or used to perform an actual process check (no `kill(pid, 0)`, no `/proc` lookup). Liveness is inferred entirely from a timestamp, making this a time-window heuristic standing in for real process introspection.

## Architecture and Design

The check is structurally part of a larger, informally distributed subsystem that the codebase treats as `MultiUserFileManager` — a cross-cutting concern realized by convention rather than a single class. Within this space, LiveLockStalenessCheck sits alongside sibling guards `IsOwnedByMeGuard` and `OwnedDbPathGuard`, both of which independently implement uid-ownership checks (`isOwnedByMe` and `ownedDbPath` respectively). Just as those two guards duplicate the same ownership-checking idiom with subtly different edge-case handling, LiveLockStalenessCheck introduces a third independently-scoped convention: filesystem-lock freshness, tied to the `inuse.<pid>.lock` naming pattern and existing only in this one file, with no equivalent freshness convention found in the OpenCode or token-db subsystems (which instead rely on SQLite-level ownership/id-namespacing).

Within `scanForLiveSessions(sessionStateDir, myUid)`, the staleness check is deliberately gated behind the ownership check: `isOwnedByMe(sessionDir, myUid)` runs first, and only sessions passing ownership proceed to `findLiveLockFile(sessionDir)`. This is a short-circuited two-factor filter (ownership AND freshness), not a merged check — the code's own threat-model comment (`T-51-09-FI uid-check on session dirs + events.jsonl files`) groups ownership with file-integrity concerns, treating staleness as an orthogonal, separately-motivated guard that happens to compose sequentially.

## Implementation Details

`findLiveLockFile` fails closed at two levels. If `fs.readdirSync` throws on an unreadable `sessionDir`, the function returns `null` immediately. If `fs.statSync` throws on an individual lock file mid-scan (e.g., a race where the lock is deleted concurrently), the exception is swallowed in an empty `catch` and that candidate is simply skipped rather than assumed live. Both behaviors mirror the fail-closed philosophy documented for the broader LiveLoggingSystem: ambiguous or error states are resolved toward "not live" rather than risking misattribution of another user's or a dead session's state.

The 10-minute grace window is explicitly justified by the file's threat-model comments as a mitigation for a scenario nicknamed "RESEARCH landmine #5": a hard-crashed Copilot session leaves an orphaned `inuse.<pid>.lock` on disk with no cleanup routine, so pure presence-based detection would treat every crashed session as permanently live. The grace window bounds this failure mode but introduces its own asymmetric trade-off — a crashed session may be polled as live for up to 10 minutes, while a genuinely live but idle session risks misclassification as stale if nothing refreshes the lock file's mtime during a long idle period. Notably, no code in this file actively refreshes the lock as a heartbeat; the mechanism trusts an external process (the Copilot CLI itself) to maintain the timestamp.

Finally, the check is evaluated only once, at discovery time inside `scanForLiveSessions`. Once a session passes and `tailEventsFile()` begins polling `events.jsonl` at `TAIL_POLL_INTERVAL_MS` (200ms), there is no shown mechanism to re-invoke `findLiveLockFile` for the lifetime of that tail. A session that crashes mid-tail is not detected by this staleness logic at all — only observable indirectly as tail silence, requiring separate logic outside this file.

## Integration Points

LiveLockStalenessCheck integrates directly with `scanForLiveSessions`, which composes it with `isOwnedByMe` from the `IsOwnedByMeGuard` idiom to form the full session-discovery gate. It has no dependency on `ownedDbPath` (`OwnedDbPathGuard`, in `lib/lsl/token/opencode-token-rows.mjs`) or the token-db subsystem — those rely on SQLite-based ownership rather than filesystem mtime freshness, reinforcing that this check is scoped specifically to the Copilot live-tail path. Its only downstream consumer is the tail-initiation logic (`tailEventsFile`), which depends on it purely as a discovery-time gatekeeper, not a continuously-consulted service.

## Usage Guidelines

Developers extending or debugging this mechanism should recognize its two defining constraints: it is a point-in-time heuristic, not a continuous health check, and it depends entirely on an external process correctly maintaining lock-file mtimes — nothing in `copilot-events-tail.mjs` refreshes the lock itself. Anyone building long-lived monitoring on top of it should not assume staleness will be detected mid-tail; additional silence-detection logic is required for that. When modifying `LOCK_STALE_GRACE_MS`, consider the asymmetric trade-off between crash-detection latency and false-positive staleness for idle-but-live sessions. Finally, because the ownership and staleness guards are independently defined and only compose via short-circuit ordering in `scanForLiveSessions`, changes to one (e.g., ownership semantics) should not be assumed to affect the other — and given the demonstrated duplication pattern across `isOwnedByMe`, `ownedDbPath`, and this staleness convention, any future refactor toward a shared utility module should carefully reconcile their subtly divergent edge-case behaviors rather than assuming they are already equivalent.


## Hierarchy Context

### Parent
- [MultiUserFileManager](./MultiUserFileManager.md) -- [LLM] No file or class literally named `MultiUserFileManager` appears anywhere in the evidence provided (the code graph is empty and none of the four supplied files declare such a class). The responsibility implied by that name — routing file/database access safely across multiple OS users — is instead DISTRIBUTED across several independent guards: `validateUserEnvironment()` (referenced in the parent LiveLoggingSystem observations) derives a per-user hash to namespace session files, `isOwnedByMe()` in lib/lsl/live/copilot-events-tail.mjs checks file uid ownership before tailing another user's Copilot session directory, and `ownedDbPath()` in lib/lsl/token/opencode-token-rows.mjs performs the identical uid-check pattern before opening `opencode.db`. This SubComponent is therefore best understood as a cross-cutting concern realized by convention across the codebase rather than a single class — a developer looking for 'the multi-user file manager' would need to know to search for the `isOwnedByMe`/`ownedDbPath` idiom, not a single module.

### Siblings
- [IsOwnedByMeGuard](./IsOwnedByMeGuard.md) -- [LLM] The `IsOwnedByMeGuard` component is not a class but a recurring idiom instantiated independently in `isOwnedByMe(sessionDir, myUid)` (lib/lsl/live/copilot-events-tail.mjs) and `ownedDbPath(dbPath)` (lib/lsl/token/opencode-token-rows.mjs). Both functions call `fs.statSync` on a target path, compare `st.uid` against the current process uid (`process.getuid()`), and return a falsy sentinel (`false` or `''`) on any mismatch or stat failure. `isOwnedByMe` explicitly special-cases non-POSIX platforms by returning `true` when `myUid == null` (Windows has no uid concept), while `ownedDbPath` guards the same case with `typeof process.getuid === 'function'` before comparing — two different spellings of the identical platform-detection intent, confirming the parent's observation that this is convention, not a shared module.
- [OwnedDbPathGuard](./OwnedDbPathGuard.md) -- [LLM] `ownedDbPath()` in lib/lsl/token/opencode-token-rows.mjs (lines ~130-148) and `isOwnedByMe()` in lib/lsl/live/copilot-events-tail.mjs (lines ~108-119) are the two concrete realizations of the 'OwnedDbPathGuard' idiom, but they diverge in a subtle way beyond naming: `ownedDbPath` treats `fs.statSync` failure and a uid mismatch as the SAME outcome (both log to stderr and return `''`), whereas `isOwnedByMe` also collapses stat failure and uid mismatch to `false`, but additionally short-circuits to `true` when `process.getuid` is unavailable (non-POSIX) BEFORE ever calling `fs.statSync`. `ownedDbPath` instead calls `fs.statSync` unconditionally and only checks `typeof process.getuid === 'function'` after the stat succeeds — meaning on a platform where `statSync` itself throws for a POSIX-specific reason, the two guards would produce different stderr messages and different callers' downstream behavior for what is nominally 'the same' check.


---

*Generated from 9 observations*
