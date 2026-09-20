# OwnedDbPathGuard

**Type:** Detail

# OwnedDbPathGuard: Technical Insight Document

## What It Is

OwnedDbPathGuard is not a single class or module but a cross-cutting *idiom* realized independently in at least two concrete locations: `ownedDbPath()` in `lib/lsl/token/opencode-token-rows.mjs` (lines ~130-148) and `isOwnedByMe()` in `lib/lsl/live/copilot-events-tail.mjs` (lines ~108-119). A comment in `opencode-token-rows.mjs` explicitly references a third sibling, `readOwnedFile()` in `copilot-token-rows.mjs`, which is not present in the supplied code but is named as the pattern's origin point. The shared intent across all realizations is the same: call `fs.statSync` on a target path (a session directory, an `events.jsonl` file, or a database file like `opencode.db`), compare the returned `uid` against `process.getuid()`, and refuse access on any mismatch — a fail-closed ownership check guarding against one OS user reading or corrupting another's files on a shared host.

## Architecture and Design

The dominant architectural pattern here is **convention-based duplication** rather than shared abstraction — no single utility module exists to import. This is explicitly confirmed in the Architecture Notes: "No shared utility import exists between `copilot-events-tail.mjs` and `opencode-token-rows.mjs` for this logic — both re-derive `fs.statSync` + `process.getuid()` from scratch." As the parent component `MultiUserFileManager` observation states, there is no literal class by that name; the responsibility is distributed across independent guards, meaning a developer searching for "the multi-user file manager" must instead know to search for the `isOwnedByMe`/`ownedDbPath` idiom.

This design is also **inconsistently applied in strength** across sibling adapters. `openTokenDb()` in `lib/lsl/token/token-db.mjs` (~line 200) sits architecturally adjacent to but outside the OwnedDbPathGuard pattern entirely — it performs no uid check, relying only on `{ fileMustExist: true }` and a documented assumption that the adapter "never creates the proxy DB." Any ownership violation there surfaces much later, inside `insertTokenRow`'s try/catch, swallowed per the D-08 never-throw contract as a generic `[token-adapter] insert failed (non-fatal)` line — a strictly weaker guarantee than the explicit `[token-adapter-opencode] skipping non-owned` message the true guards produce.

The sibling component `IsOwnedByMeGuard` documents the same duplication at a finer grain, confirming that `isOwnedByMe` and `ownedDbPath` are "two different spellings of the identical platform-detection intent." Both are fail-closed by construction (per Architectural Patterns: uid comparison before any file access, never throws), but the failure-handling design is uniformly silent-degradation: stderr log plus a safe empty/false return.

## Implementation Details

The two concrete guards diverge subtly in sequencing. `ownedDbPath` calls `fs.statSync` unconditionally, then checks `typeof process.getuid === 'function'` only *after* the stat succeeds; both stat failure and uid mismatch collapse to the same outcome (stderr log + return `''`). `isOwnedByMe`, by contrast, short-circuits to `true` when `process.getuid` is unavailable (non-POSIX platforms) *before* ever calling `fs.statSync`, and otherwise collapses stat failure and uid mismatch to `false`. This means a POSIX-specific stat failure would produce different stderr messages and different downstream behavior between the two guards despite representing "the same" conceptual check.

Neither guard performs symlink resolution before `fs.statSync` — since `statSync` follows symlinks by default, a session directory or DB path that is itself a symlink into another user's tree would report the target's uid, not the symlink's. The `copilot-events-tail.mjs` docstring flags this defense-in-depth intent under `T-51-09-FI` without addressing symlink handling, and a fix applied to one copy would not automatically propagate to the other.

Failure propagation also differs by caller. `ownedDbPath` returning `''` causes `buildOpencodeTokenRows()` to return `[]` immediately (`if (!resolved) return [];`), silently zeroing an entire adapter pass. `isOwnedByMe` returning `false` inside `scanForLiveSessions()` instead causes a `continue`, skipping only the one offending session directory while siblings still process — a partial skip versus a total abort for nominally the same violation.

Stderr logging (per CLAUDE.md's no-console-log rule) is applied uniformly but with an information-exposure asymmetry: `ownedDbPath`'s message includes both the file's uid and the current process uid (`file uid=${st.uid} != ${me}`), while `isOwnedByMe`'s caller logs only the session ID — the former leaks numeric uid values that could aid host enumeration.

## Integration Points

OwnedDbPathGuard sits alongside two sibling concerns at the same architectural level: `IsOwnedByMeGuard` (the finer-grained view of the same idiom) and `LiveLockStalenessCheck`, realized by `findLiveLockFile()` in `copilot-events-tail.mjs`, which uses `inuse.<pid>.lock` file mtimes against a `LOCK_STALE_GRACE_MS` (10-minute) threshold as a heuristic liveness proxy rather than an actual `kill(pid, 0)` check. Both concerns protect access to live session state but via orthogonal mechanisms — ownership vs. staleness.

Downstream, `ownedDbPath`'s return value directly gates `buildOpencodeTokenRows()`, and `isOwnedByMe`'s gates `scanForLiveSessions()`. `openTokenDb()` in `token-db.mjs` is a related-but-weaker integration point, deferring enforcement to `insertTokenRow`'s error handling instead of an upfront check.

## Usage Guidelines

Any maintainer patching "the ownership check" in one copy must independently verify the fix in every other copy — `ownedDbPath`, `isOwnedByMe`, and the referenced `readOwnedFile` — since none share code. Particular attention should go to: aligning stat-failure vs. uid-mismatch ordering, closing the symlink-resolution gap consistently, and normalizing stderr messages to avoid leaking uid numbers as `ownedDbPath` currently does. Given the `mstadt` hash constant referenced in `token-db.mjs` hinting at a future adapter, new adapters should be expected to reimplement this pattern again absent a deliberate refactor into a shared utility — a known scalability/maintainability risk explicitly called out in the observations as "duplication ... only as strong as the weakest of its two copies."


## Hierarchy Context

### Parent
- [MultiUserFileManager](./MultiUserFileManager.md) -- [LLM] No file or class literally named `MultiUserFileManager` appears anywhere in the evidence provided (the code graph is empty and none of the four supplied files declare such a class). The responsibility implied by that name — routing file/database access safely across multiple OS users — is instead DISTRIBUTED across several independent guards: `validateUserEnvironment()` (referenced in the parent LiveLoggingSystem observations) derives a per-user hash to namespace session files, `isOwnedByMe()` in lib/lsl/live/copilot-events-tail.mjs checks file uid ownership before tailing another user's Copilot session directory, and `ownedDbPath()` in lib/lsl/token/opencode-token-rows.mjs performs the identical uid-check pattern before opening `opencode.db`. This SubComponent is therefore best understood as a cross-cutting concern realized by convention across the codebase rather than a single class — a developer looking for 'the multi-user file manager' would need to know to search for the `isOwnedByMe`/`ownedDbPath` idiom, not a single module.

### Siblings
- [IsOwnedByMeGuard](./IsOwnedByMeGuard.md) -- [LLM] The `IsOwnedByMeGuard` component is not a class but a recurring idiom instantiated independently in `isOwnedByMe(sessionDir, myUid)` (lib/lsl/live/copilot-events-tail.mjs) and `ownedDbPath(dbPath)` (lib/lsl/token/opencode-token-rows.mjs). Both functions call `fs.statSync` on a target path, compare `st.uid` against the current process uid (`process.getuid()`), and return a falsy sentinel (`false` or `''`) on any mismatch or stat failure. `isOwnedByMe` explicitly special-cases non-POSIX platforms by returning `true` when `myUid == null` (Windows has no uid concept), while `ownedDbPath` guards the same case with `typeof process.getuid === 'function'` before comparing — two different spellings of the identical platform-detection intent, confirming the parent's observation that this is convention, not a shared module.
- [LiveLockStalenessCheck](./LiveLockStalenessCheck.md) -- [LLM] The LiveLockStalenessCheck is realized by `findLiveLockFile()` in lib/lsl/live/copilot-events-tail.mjs, which treats an `inuse.<pid>.lock` file's filesystem mtime as the sole liveness signal for a Copilot session directory. It lists the directory with `fs.readdirSync`, filters names against the regex `/^inuse\.\d+\.lock$/`, and for each match compares `Date.now() - st.mtimeMs` against `LOCK_STALE_GRACE_MS` (10 minutes, `10 * 60 * 1000`). This is a heuristic proxy for process liveness rather than an actual liveness check — there is no `kill(pid, 0)`-style syscall or `/proc` lookup against the pid embedded in the lock filename; the pid digits are matched by the regex but never parsed or used, only the timestamp matters.


---

*Generated from 9 observations*
