# WorkspaceYamlProjectMatch

**Type:** Detail

## What It Is

WorkspaceYamlProjectMatch is the project-filtering mechanism implemented in `lib/lsl/live/copilot-events-tail.mjs`, centered on two functions: `projectMatches(workspaceYaml, projectRoot)` and its I/O counterpart `readWorkspace(sessionDir)`. Together they determine whether a live Copilot session belongs to the project currently being watched, so that the parent component, LiveCopilotTailWatcher, only tails `events.jsonl` for sessions relevant to the caller's `projectRoot`. It is not a standalone class but a pair of orchestration functions within the tail-watcher module, relying on parsing/derivation logic imported from a sibling adapter file.

## Architecture and Design

The design follows a guard-chain / pipeline filtering pattern documented explicitly in the observations: ownership (`isOwnedByMe`) → liveness (`findLiveLockFile`, shared conceptually with sibling InuseLockDetection) → project-match (`projectMatches`/`readWorkspace`). Each stage short-circuits before the next runs, meaning workspace.yaml is only read for sessions already confirmed to be uid-owned and live — project matching is deliberately the last, cheapest-to-skip filter rather than the first.

A second key pattern is adapter reuse, labeled "D-Reuse" in the module header: `parseWorkspaceYaml` and `projectFromWorkspace` are imported from `../adapters/copilot-events.mjs` rather than reimplemented, keeping `copilot-events-tail.mjs` as a pure orchestrator over WHEN and HOW these primitives are invoked, not a parser itself.

Fail-safe defaulting is the third pattern: any unreadable or corrupt `workspace.yaml` resolves to the sentinel `'unknown'`, which `projectMatches` always rejects. This favors excluding an ambiguous session over risking a false match or crashing the poll loop.

## Implementation Details

`readWorkspace(sessionDir)` handles I/O: it existence-checks `path.join(sessionDir, 'workspace.yaml')` with `fs.existsSync`, reads it via `fs.readFileSync(..., 'utf8')`, and delegates parsing to `parseWorkspaceYaml`, catching failures and returning `null` — never throwing.

`projectMatches(workspaceYaml, projectRoot)` is the pure comparison half: it short-circuits to `true` when no `projectRoot` filter is active; otherwise it calls `projectFromWorkspace(workspaceYaml)` to derive `sessionProject` and rejects the literal `'unknown'`. Critically, the comparison is a basename equality check — `path.basename(projectRoot)` against `sessionProject` — not a full-path or git-root comparison. This lets `projectRoot` be either an absolute path (`/path/to/coding`) or a bare name (`coding`), trading precision (it can't distinguish two differently-located checkouts sharing a directory name) for caller tolerance. This exact-basename approach echoes a broader project precedent against fuzzy/time-window matching (seen in the Cold-Store Backfill work record), favoring exact-key matches over speculative inclusion.

## Integration Points

WorkspaceYamlProjectMatch is invoked from within `scanForLiveSessions()`, the core loop of parent LiveCopilotTailWatcher, only after sessions pass ownership and liveness checks — meaning it never runs against dead or non-owned sessions discovered alongside sibling InuseLockDetection's `findLiveLockFile`. Its only external dependency is `../adapters/copilot-events.mjs`, from which `parseWorkspaceYaml`, `projectFromWorkspace`, and `stripToolCallIdPrefix` are imported. The `'unknown'` sentinel returned by `projectFromWorkspace(null)` is the contract point tying `readWorkspace`'s null-on-failure behavior to `projectMatches`'s rejection logic.

## Usage Guidelines

Callers should be aware that `projectRoot` comparison is basename-only, so passing two absolute paths with the same final directory name will incorrectly match — this is a known, accepted trade-off, not a bug to "fix" without considering callers that rely on bare names. Any change to `parseWorkspaceYaml`/`projectFromWorkspace` in the adapter module directly affects matching behavior here, since no parsing logic is duplicated locally. When extending the guard chain, preserve the ordering (ownership → liveness → project-match) since project-match assumes upstream filters have already run, and preserve the fail-to-'unknown' default rather than allowing exceptions or permissive fallbacks to propagate into the tail loop.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'Cold-Store Backfill — Artifacts Field Recovery' established a project precedent against fuzzy/time-window matching for after-the-fact reconstruction, favoring exact-key matches; `projectMatches()`'s exact-basename comparison (rather than any substring/prefix/fuzzy path matching) is consistent with that same risk posture — a stray Copilot session with a similarly-named-but-different project would be excluded rather than speculatively included.

## Hierarchy Context

### Parent
- [LiveCopilotTailWatcher](./LiveCopilotTailWatcher.md) -- [LLM] `lib/lsl/live/copilot-events-tail.mjs` is the LiveCopilotTailWatcher implementation itself: `scanForLiveSessions()` walks `~/.copilot/session-state/<uuid>/` directories, keeping only those with a live (non-stale) `inuse.<pid>.lock`, found via `findLiveLockFile()` matching the `/^inuse\.\d+\.lock$/` pattern and a 10-minute `LOCK_STALE_GRACE_MS` grace window that treats an orphaned lock from a hard-crashed session as 'dead' rather than live. Each surviving session directory is then handed to `tailEventsFile()`, which opens a 200ms (`TAIL_POLL_INTERVAL_MS`) `statSync` poll on `events.jsonl`, reading only newly appended bytes via `fs.openSync`/`fs.readSync` at the previously recorded offset and splitting on newlines with a `residual` buffer to hold a partial trailing line across polls.

### Siblings
- [InuseLockDetection](./InuseLockDetection.md) -- [LLM] The InuseLockDetection logic lives entirely in `findLiveLockFile(sessionDir)` in lib/lsl/live/copilot-events-tail.mjs: it calls `fs.readdirSync(sessionDir)`, filters names against the regex `/^inuse\.\d+\.lock$/`, and for each match `fs.statSync`s the lock file and compares `now - st.mtimeMs` against the module-level `LOCK_STALE_GRACE_MS` constant (10 minutes, i.e. `10 * 60 * 1000`). It returns the lock's filename on the first match found within the grace window, or `null` if the directory is unreadable, has no matching lock, or every matching lock is stale — there is no distinction in the return value between 'no lock present' and 'lock present but expired', both collapse to the same negative signal.
- [CopilotEventsTailPoller](./CopilotEventsTailPoller.md) -- [LLM] No file or function named 'CopilotEventsTailPoller' appears anywhere in the supplied code. The closest implementation is `lib/lsl/live/copilot-events-tail.mjs`, whose exported/internal surface is `scanForLiveSessions()`, `findLiveLockFile()`, `isOwnedByMe()`, `readWorkspace()`, `projectMatches()`, `buildStubObservation()`, and `tailEventsFile()` — none of which is a class or export called `CopilotEventsTailPoller`. The parent-context observations describe this module as 'LiveCopilotTailWatcher', a different name again, suggesting the requested Detail entity is either a rename/alias not reflected in the current source, a documentation label applied at a higher abstraction level, or a component that does not exist as a discrete unit in this codebase.


---

*Generated from 9 observations*
