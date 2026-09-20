# DegradedParityStub

**Type:** Detail

# DegradedParityStub — Technical Insight Document

## What It Is

DegradedParityStub is the concrete data-loss contract embedded in `lib/lsl/live/copilot-events-tail.mjs`, implemented primarily through two constants and one function: `COPILOT_LSL_INCOMPLETE_REASON`, `COPILOT_LSL_INCOMPLETE_NOTE`, and `buildStubObservation()`. Rather than attempting to reconstruct or approximate a real Copilot CLI transcript, this component formally acknowledges that "inner reasoning is FOREVER LOST — no live mitigation possible," and instead synthesizes a stand-in two-message exchange (`userMsg`/`asstMsg`) from lifecycle spawn metadata — `agentName`, `agentDescription`, `started_at`, `completed_at`, `completion_status`. Every observation produced this way is stamped with `lsl_incomplete: true`, making the degradation explicit and machine-detectable rather than silently absorbed into normal-looking data.

As a Detail under the parent CopilotLiveTail, DegradedParityStub is the specific mechanism through which that component's broader "permanent data-loss boundary" philosophy is made concrete and queryable in code.

## Architecture and Design

The defining architectural pattern here is **degraded-parity acceptance**: instead of treating the absence of inner-reasoning events as a defect to be chased, the design declares it a permanent contract and builds observability around the gap rather than around a (structurally impossible) fix. This is reinforced by explicit in-code direction: future work should target Plan 51-11's `lsl_incomplete_marker_present` heartbeat field, not attempt transcript recovery — a rare case of code comments actively steering future engineering effort away from a dead end.

This stub sits downstream of the liveness and filtering guards implemented by sibling components. Before any stub is built, `scanForLiveSessions()` must clear both UidOwnershipGuard's `isOwnedByMe()` check and LockStaleDetection's `findLiveLockFile()`/`LOCK_STALE_GRACE_MS` freshness window, and ProjectFiltering's `projectMatches()` may further exclude sessions lacking a resolved project. Only sessions surviving all three gates ever reach the point where `tailEventsFile()` and `buildStubObservation()` operate — meaning DegradedParityStub's output quality is entirely contingent on upstream filtering correctness.

## Implementation Details

`buildStubObservation()` is deliberately narrow in scope: it does not parse or infer conversational content, it maps a fixed set of spawn-metadata fields into a synthetic exchange shape. This keeps the function simple and auditable but also means its output is only as rich as the lifecycle event schema (`subagent.started/completed/failed`) allows — there is no path to enriching it further without violating the "forever lost" premise.

The stub's shape is not a private implementation detail but an **externally locked contract**: the header comment states it is "Locked by Test 6 + the plan's `<interfaces>` stub-observation shape," and `COPILOT_LSL_INCOMPLETE_NOTE`'s exact string is asserted verbatim by tests. This creates a fragile coupling point — any developer refactoring the wording for clarity, without first grepping for usages, risks silently breaking an unseen test assertion. This is a maintainability hazard specific to this component that doesn't exist for the surrounding liveness/ownership logic.

The stub-building path also participates in the two-tier capture split: `tailEventsFile()` stamps live-path observations (including stubs) with `metadata.source = 'sub-agent'`, while a separate backfill/sweep path (Plan 51-04) independently stamps `metadata.source = 'sub-agent-backfill'`. No single function or module — including this one — owns full-session coverage; `buildStubObservation()` only covers the forward-looking, live-tail slice of a session's lifetime.

## Integration Points

DegradedParityStub depends on Plan 51-04's Copilot-specific adapter helpers (`parseWorkspaceYaml`, `projectFromWorkspace`, `stripToolCallIdPrefix` from `../adapters/copilot-events.mjs`) and the shared `parseCopilot` parser from `../../../src/live-logging/TranscriptNormalizer.js`, reflecting a scoped reuse boundary: vendor-specific parsing is shared across live and backfill paths, but Phase 50's generic LSL primitives (`lib/lsl/window.mjs`, `lib/lsl/scan-and-convert.mjs`) are explicitly not imported, since generic cross-agent windowing doesn't fit Copilot's lifecycle-only event stream.

Downstream, the stub observation feeds into the same primary write path guarded by D-08 failure isolation — the `onTokenRow` side channel is wrapped so its failures never propagate into the subagent `onError` path, a pattern independently mirrored in `lib/lsl/token/token-db.mjs`'s `insertTokenRow()`. While DegradedParityStub itself isn't the token accounting mechanism, it shares the same primary-path/side-channel boundary within `tailEventsFile()`.

## Usage Guidelines

Developers extending or "fixing" this component should not attempt to recover richer transcript data — the design explicitly forecloses that path and redirects effort toward the `lsl_incomplete_marker_present` heartbeat surface instead. Any edits to `COPILOT_LSL_INCOMPLETE_NOTE` or the stub observation shape must first be checked against the test suite ("Test 6") referenced in the header comment, since the string and shape are locked contracts, not free-form documentation. Finally, because the stub only covers the live-tail slice of a session, developers reasoning about "did we capture everything" must also account for the sweep/backfill path (`metadata.source = 'sub-agent-backfill'`) — DegradedParityStub answers "what do we do about lost data during the live window," not "is this session fully captured."


## Hierarchy Context

### Parent
- [CopilotLiveTail](./CopilotLiveTail.md) -- [LLM] The component's central architectural decision is a permanent, documented data-loss boundary rather than a bug to be fixed: copilot-events-tail.mjs states in its header that 'Copilot CLI emits ONLY subagent.started/subagent.completed/subagent.failed lifecycle events on disk' and that inner reasoning/tool calls are 'NEVER persisted to events.jsonl' — meaning 'The inner reasoning is FOREVER LOST — no live mitigation possible.' The code operationalizes this acceptance by stamping every observation with `lsl_incomplete: true` (constant `COPILOT_LSL_INCOMPLETE_REASON`) and building a synthetic two-message stub via `buildStubObservation()` instead of a real transcript, and by exposing the gap externally through a `lsl_incomplete_marker_present` heartbeat field referenced in the file's own comments. This is a deliberate degraded-parity contract, not an oversight, and any future 'fix' attempt should be redirected toward the heartbeat/health surface rather than toward trying to recover data that structurally does not exist on disk.

### Siblings
- [LockStaleDetection](./LockStaleDetection.md) -- [LLM] The stale-lock detection logic in `lib/lsl/live/copilot-events-tail.mjs` is implemented as two composed, single-purpose predicates rather than one combined check: `findLiveLockFile(sessionDir)` regex-matches `^inuse\.\d+\.lock$` filenames and compares `fs.statSync(lockPath).mtimeMs` against `Date.now()` within `LOCK_STALE_GRACE_MS` (a module-level constant hardcoded to `10 * 60 * 1000`), while `isOwnedByMe(sessionDir, myUid)` independently gates on filesystem uid. `scanForLiveSessions()` then short-circuits per-entry: a non-owned directory is skipped with a `process.stderr.write` warning (`[live-copilot] skipping non-owned session ${sessionId}`) *before* the lock-staleness check ever runs, meaning ownership is a harder gate than freshness — an owned-but-crashed session is silently dropped (no stderr line at all), while a foreign session is dropped loudly. This asymmetry in observability (warn on security-relevant skips, stay silent on staleness-relevant skips) means an operator debugging 'why isn't my session being tailed' has no log signal at all if the cause is a stale lock rather than a permissions mismatch.
- [ProjectFiltering](./ProjectFiltering.md) -- [LLM] The `projectMatches()` function in lib/lsl/live/copilot-events-tail.mjs implements an opt-in, fail-closed filtering policy: when a `projectRoot` filter is supplied, it calls `projectFromWorkspace(workspaceYaml)` and explicitly rejects any session whose resolved project is falsy or the sentinel string `'unknown'` — the comment states this 'saves resources for stray Copilot sessions that don't belong to this project.' This means a session lacking a readable `workspace.yaml` (returned by `readWorkspace()` when the file is absent or fails to parse) is silently dropped from consideration the moment a filter is active, rather than being included by default — a deliberate bias toward under-inclusion over accidentally tailing another project's events.
- [UidOwnershipGuard](./UidOwnershipGuard.md) -- [LLM] The `isOwnedByMe()` function in lib/lsl/live/copilot-events-tail.mjs implements a fail-closed-on-error but permissive-by-default ownership check: it returns `true` immediately when `myUid == null` (non-POSIX platforms like Windows skip the check entirely), returns `false` on any `fs.statSync` failure (treating an unreadable directory as untrusted rather than as 'unknown'), and otherwise compares `st.uid` against the caller's uid. This is an asymmetric trust model — the absence of a uid concept (Windows) is treated as safe, while the presence of a stat error is treated as unsafe — which only makes sense if POSIX uid checks are considered the only meaningful attack surface for this guard; a Windows deployment gets zero traversal protection from this function, relying entirely on OS-level filesystem ACLs instead.


---

*Generated from 10 observations*
