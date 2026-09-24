# InuseLockDetection

**Type:** Detail

## What It Is

InuseLockDetection is the lock-file liveness check implemented in the single function `findLiveLockFile(sessionDir)` within `lib/lsl/live/copilot-events-tail.mjs`. It determines whether a Copilot session directory represents a currently-running process by scanning for files matching `/^inuse\.\d+\.lock$/` and checking their modification time against a staleness threshold. It is a subordinate piece of its parent, LiveCopilotTailWatcher, which uses it as one of two sequential gates (alongside sibling-adjacent ownership logic) before deciding whether a session is worth tailing.

## Architecture and Design

The core pattern is a grace-window staleness check via mtime delta rather than any heartbeat or ping protocol: `now - st.mtimeMs` is compared against the module-level `LOCK_STALE_GRACE_MS` (10 minutes), documented against threat-model entry `T-51-09-RC` as a mitigation for orphaned locks left by hard-crashed Copilot sessions. This is a deliberate trade-off — up to 10 minutes of treating a dead session as live (wasting `TAIL_POLL_INTERVAL_MS` polling cycles) versus the alternative failure of prematurely declaring a slow-but-alive session dead and losing its tail. The module accepts the former as the safer direction.

Architecturally, InuseLockDetection is composed, not merged, with ownership checking. `scanForLiveSessions(sessionStateDir, myUid)` calls `isOwnedByMe(sessionDir, myUid)` first as an outer defense-in-depth gate (`T-51-09-FI`), and only invokes `findLiveLockFile` for directories that pass ownership — non-owned sessions `continue` immediately with a stderr log, never reaching the lock-detection logic at all. This ordering means liveness detection can never be used as a timing side-channel against another user's session on a shared host.

The regex is deliberately full-string anchored (`^...$`) rather than a loose substring match, making it the sole discriminator between "this is a running Copilot process" and any other artifact in the session-state directory (e.g., `.tmp` files). This is an implicit convention dependency: nothing else in the codebase validates this against Copilot's actual lock-naming scheme, and no version-compat matrix exists for it, unlike the explicitly named `T-51-09-PV Parser version drift` concern on the parsing side.

## Implementation Details

`findLiveLockFile` is a pure, synchronous, side-effect-free function returning `string | null`. It calls `fs.readdirSync(sessionDir)`, filters against the anchored regex, then `fs.statSync`s each candidate, returning the first filename found within the grace window or `null` otherwise. Critically, `null` is overloaded: it signals both "no matching lock exists" and "a lock exists but is stale" — the caller cannot distinguish these cases, nor does it need to, since only a boolean live/not-live signal is consumed downstream.

Error handling uses three separate try/catch boundaries rather than one enclosing block. A failed `readdirSync` (directory vanished mid-scan) returns `null` immediately. A failed `statSync` on an individual lock file (e.g., a race where the lock is deleted between `readdirSync` and `statSync`) is caught per-iteration with an explicit `// unreadable lock — skip` comment, allowing the scan to continue over sibling candidates rather than aborting. This granularity matters given `scanForLiveSessions` iterates multiple session directories per poll cycle (`T-51-09-RL`, bounded at 1-5 concurrent sessions typically).

Notably, although the regex captures PID digits via `\d+`, no capturing group is used, so the PID is never extracted — it's dead information. The function returns the whole filename, but `scanForLiveSessions` only uses it as a boolean gate to decide whether `{ sessionId, sessionDir }` is pushed onto the `live` array; the filename itself is discarded. There is no PID validation against the OS process table — liveness is inferred purely from filesystem convention, not confirmed against the actual process.

## Integration Points

InuseLockDetection has exactly one caller: `scanForLiveSessions(sessionStateDir, myUid)`, the core of parent component LiveCopilotTailWatcher. It runs strictly after the `isOwnedByMe` check, forming a two-gate pipeline (ownership → liveness) rather than a single combined predicate — the two guard functions are architecturally independent and composed sequentially. Sessions surviving both gates are handed to `tailEventsFile()`, which performs the actual 200ms-interval polling of `events.jsonl`.

It also functionally coexists with sibling WorkspaceYamlProjectMatch (`projectMatches`), which provides a third filtering dimension (project relevance) applied elsewhere in the same scan flow, conserving tail-poll cycles similarly to how lock detection conserves them by excluding dead sessions.

There is no caching layer: `findLiveLockFile` is invoked fresh on every poll cycle, so liveness is re-derived from disk state each time rather than persisted across scans.

## Usage Guidelines

Developers should treat `findLiveLockFile`'s `null` return as a single "not live" signal — do not attempt to differentiate "missing lock" from "stale lock" without changing the function's contract, since both currently collapse together by design. Any change to Copilot's own lock-file naming convention would silently break detection, since there is no compatibility matrix guarding this regex, unlike parser version drift elsewhere; such a change should be treated as a high-risk, low-visibility breakage point. Do not rely on the returned filename for anything beyond a boolean check, since PID extraction is not implemented and the value is discarded by the sole caller. Finally, respect the existing gate ordering — ownership must be checked before liveness — as this is a deliberate security control (`T-51-09-FI`), not an arbitrary sequencing choice.


## Hierarchy Context

### Parent
- [LiveCopilotTailWatcher](./LiveCopilotTailWatcher.md) -- [LLM] `lib/lsl/live/copilot-events-tail.mjs` is the LiveCopilotTailWatcher implementation itself: `scanForLiveSessions()` walks `~/.copilot/session-state/<uuid>/` directories, keeping only those with a live (non-stale) `inuse.<pid>.lock`, found via `findLiveLockFile()` matching the `/^inuse\.\d+\.lock$/` pattern and a 10-minute `LOCK_STALE_GRACE_MS` grace window that treats an orphaned lock from a hard-crashed session as 'dead' rather than live. Each surviving session directory is then handed to `tailEventsFile()`, which opens a 200ms (`TAIL_POLL_INTERVAL_MS`) `statSync` poll on `events.jsonl`, reading only newly appended bytes via `fs.openSync`/`fs.readSync` at the previously recorded offset and splitting on newlines with a `residual` buffer to hold a partial trailing line across polls.

### Siblings
- [WorkspaceYamlProjectMatch](./WorkspaceYamlProjectMatch.md) -- [LLM] `projectMatches(workspaceYaml, projectRoot)` in `lib/lsl/live/copilot-events-tail.mjs` is the concrete implementation of workspace-to-project matching: it short-circuits to `true` when no `projectRoot` filter is active, otherwise calls the imported `projectFromWorkspace(workspaceYaml)` to derive the session's project name and rejects any session that resolves to the literal string `'unknown'` — the sentinel `projectFromWorkspace` returns when a session directory has no readable `workspace.yaml`. This 'unknown' exclusion is a deliberate resource-conservation decision documented inline: it saves tail-poll cycles on stray Copilot sessions on the same host that don't belong to the project being watched, rather than tailing every live session indiscriminately.
- [CopilotEventsTailPoller](./CopilotEventsTailPoller.md) -- [LLM] No file or function named 'CopilotEventsTailPoller' appears anywhere in the supplied code. The closest implementation is `lib/lsl/live/copilot-events-tail.mjs`, whose exported/internal surface is `scanForLiveSessions()`, `findLiveLockFile()`, `isOwnedByMe()`, `readWorkspace()`, `projectMatches()`, `buildStubObservation()`, and `tailEventsFile()` — none of which is a class or export called `CopilotEventsTailPoller`. The parent-context observations describe this module as 'LiveCopilotTailWatcher', a different name again, suggesting the requested Detail entity is either a rename/alias not reflected in the current source, a documentation label applied at a higher abstraction level, or a component that does not exist as a discrete unit in this codebase.


---

*Generated from 9 observations*
