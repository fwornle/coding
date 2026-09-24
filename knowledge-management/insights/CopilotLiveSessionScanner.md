# CopilotLiveSessionScanner

**Type:** Detail

# CopilotLiveSessionScanner

## What It Is

CopilotLiveSessionScanner is implemented in `lib/lsl/live/copilot-events-tail.mjs`, concretely as the function `scanForLiveSessions(sessionStateDir, myUid)`. It enumerates directory entries under a Copilot `session-state` directory (via `fs.readdirSync(..., { withFileTypes: true })`), filters to directories, and for each candidate applies two gates — `isOwnedByMe(sessionDir, myUid)` and `findLiveLockFile(sessionDir)` — retaining only sessions that pass both, and emitting `{sessionId, sessionDir}` pairs. Structurally it sits beneath `LslConfigValidator` in the component hierarchy, alongside sibling extraction/writer components `OpenCodeTokenRowExtractor` and `TokenUsageDbWriter`, though (per observation 7 and 11) it shares no imports or call paths with them — it is architecturally adjacent, not functionally coupled.

## Architecture and Design

The core pattern is poll-based liveness detection anchored to filesystem artifacts rather than any live IPC or process table check: `findLiveLockFile` regex-matches `^inuse\.\d+\.lock$` files and accepts only those whose `mtimeMs` falls within `LOCK_STALE_GRACE_MS` (10 minutes). This grace window is a deliberate, documented trade-off ("RESEARCH-copilot.md landmine #5") between fast detection of new live sessions and false positives from orphaned locks left by hard-crashed Copilot processes.

A second pattern is the two-stage pipeline: discovery (`scanForLiveSessions`) is fully decoupled from consumption (`tailEventsFile`). The scanner's job ends at producing a list of live, owned session directories; a separate polling tailer (200ms via `TAIL_POLL_INTERVAL_MS`) then reads `events.jsonl` per session. This separation means the scanner can be reasoned about, and reused, independently of tailing semantics.

Security is handled as defense-in-depth applied per-candidate rather than as a single upfront directory-level check: `isOwnedByMe` is invoked inside the enumeration loop, failing closed on stat errors or uid mismatch but failing open when `myUid` is null (non-POSIX platforms). Non-owned sessions are skipped with a stderr diagnostic, not aborted — the scan continues across the rest of the candidate set, addressing threat T-51-09-FI (cross-user traversal into another user's `~/.copilot/session-state/<uuid>` tree).

Finally, an optional scope-narrowing filter (`readWorkspace` + `projectMatches`, using `projectFromWorkspace` from `../adapters/copilot-events.mjs`) lets a caller bound the scanner to one project's sessions by comparing workspace-resolved project name against `path.basename(projectRoot)`, skipping `'unknown'` sessions when a filter is active.

## Implementation Details

- `scanForLiveSessions(sessionStateDir, myUid)` — the entry point; directory walk + ownership + lock-liveness composition.
- `findLiveLockFile(sessionDir)` — regex + mtime staleness check encoding the 10-minute grace window as `LOCK_STALE_GRACE_MS`.
- `isOwnedByMe(sessionDir, myUid)` — uid-based ownership guard, fail-closed/fail-open logic described above.
- `tailEventsFile({eventsPath, onSubagentStarted, onSubagentEnded, onError, onTokenRow})` — the downstream consumer of scan results, polling at `TAIL_POLL_INTERVAL_MS`, recording an initial `fs.statSync` size on open and deliberately never processing pre-existing content (backfill is delegated elsewhere, to a Plan 51-04 sweep).
- `buildStubObservation(...)` — because Copilot CLI persists only lifecycle events (`subagent.started`/`.completed`/`.failed`) and never actual sub-agent messages/reasoning, this function fabricates a 2-message `userMsg`/`asstMsg` exchange from spawn metadata and a truncated `agentDescription` (`.slice(0, 200)`), stamping every result `lsl_incomplete: true` per the "D-Live-Sweep-Tags" convention.
- `readWorkspace` / `projectMatches` — optional project-scope filtering logic.

All operator-facing signalling goes through `process.stderr.write` (e.g., `[live-copilot] skipping non-owned session <id>`), never `console.*`, consistent with the file's own no-console-log header annotation.

## Integration Points

The scanner's direct downstream consumer is `tailEventsFile` in the same module, which depends on the scanner having already validated ownership and liveness before it begins polling `events.jsonl`. Beyond that module boundary, the observations tie the scanner's output quality directly to a documented downstream continuity mechanism: the LSL Session Continuity Bootstrap (`/sl` command) work treats LiveLoggingSystem transcript output as authoritative, but for Copilot specifically that input is exactly the degraded `lsl_incomplete` stub observations this scanner's pipeline produces — not full transcripts (observation 9). Project-scope filtering integrates with `../adapters/copilot-events.mjs` via `projectFromWorkspace`. The scanner is otherwise structurally isolated from sibling components `OpenCodeTokenRowExtractor` (`opencode-token-rows.mjs`) and `TokenUsageDbWriter` (`token-db.mjs`) — no shared imports or call paths were found, despite all three sitting under the same LiveLoggingSystem/LslConfigValidator lineage.

## Usage Guidelines

Callers should treat `scanForLiveSessions` strictly as a discovery mechanism bounded by ownership and staleness rules — it will silently (from stderr, not thrown errors) skip non-owned sessions and will not surface sessions whose lock files are stale beyond the 10-minute grace window. Consumers must not assume tailed content is complete: any observation carrying `lsl_incomplete: true` reflects a structural limitation (Copilot never writes sub-agent reasoning to disk) with no code-level remediation, only a `lsl_incomplete_marker_present` heartbeat surfaced elsewhere. Backfill of pre-existing `events.jsonl` content is explicitly out of scope for `tailEventsFile` and must be handled by the separate Plan 51-04 sweep. When operating on a shared multi-project host, pass a `projectRoot` to activate the project-match filter and avoid wasting resources tailing stray sessions from unrelated projects. Any new diagnostics added to this module should continue to use `process.stderr.write` rather than `console.*`, per the file's own convention.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'LSL Session Continuity Bootstrap (/sl command)' work record establishes that LiveLoggingSystem's transcript output is treated as the authoritative source of truth for reconstructing session state — a downstream consumer whose input, for Copilot specifically, is exactly the degraded (`lsl_incomplete`) stub observations this scanner's tailer produces, not a full transcript. This connects the scanner's known output quality to a concrete downstream continuity mechanism, without describing the scanner's own implementation.

## Hierarchy Context

### Parent
- [LslConfigValidator](./LslConfigValidator.md) -- [CGR] LSLConfigValidator (class) in validate-lsl-config.js

### Siblings
- [OpenCodeTokenRowExtractor](./OpenCodeTokenRowExtractor.md) -- [LLM] The code graph supplied for this entity is empty — no class or function named `OpenCodeTokenRowExtractor` (or anything else) appears in `<code_graph>` — so no [LLM+CGR] observation can be grounded here. However, the retrieved file `lib/lsl/token/opencode-token-rows.mjs` is a direct functional match for the entity's name: it exports `buildOpencodeTokenRows(dbPath, ctx)`, the module docstring calls it 'the pure EXTRACTION layer that turns the OpenCode SQLite session store (`~/.local/share/opencode/opencode.db`) into `TokenUsageRow`-shaped objects', and every helper in the file (`ownedDbPath`, `extractTokens`, `summarizeParts`, `activityFor`) exists solely to serve that one exported function. The component is implemented as an exported function within a module rather than as a standalone class — the KG's Detail-level entity name is a description of the module's role, not a literal class identifier, which is why the code graph (which appears to index class/function declarations) has nothing under that exact name.
- [TokenUsageDbWriter](./TokenUsageDbWriter.md) -- [LLM] `lib/lsl/token/token-db.mjs` is, functionally, the TokenUsageDbWriter: `insertTokenRow(db, row)` is the sole write path into the proxy-owned `.data/llm-proxy/token-usage.db`, and its docstring is explicit that this file is 'the ONLY host-side file that touches' that database as a second writer alongside the rapid-llm-proxy daemon. The id-allocation strategy (`NEXT_ID_SQL = 'SELECT COALESCE(MAX(id), 0) + 1 ... WHERE user_hash = ?'`) is scoped per adapter `user_hash` (`cladpt`, `copadt`, `opnadt`) specifically so this writer's own `MAX(id)+1` never races the proxy daemon's in-memory id counter — a concurrency design built around NOT owning the table's primary writer role.


---

*Generated from 12 observations*
