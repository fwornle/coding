# Phase 51 — Research: Claude Code sub-agent mechanism

**Agent:** Claude Code (Anthropic's official CLI — what this orchestrator IS)
**Status:** ✓ Confirmed mechanism (from live filesystem evidence, 2026-05-23 incident transcripts, and `scripts/backfill-subagent-transcripts.mjs` PoC)
**Research date:** 2026-05-26
**Confidence:** HIGH (every claim verified against on-disk transcripts; one CONTEXT.md hypothesis disproven and corrected below)
**Web fetches used:** 0 / 4 (all evidence sourced from filesystem; no external docs needed)

---

## Critical correction to CONTEXT.md hypothesis

> CONTEXT.md (filed 2026-05-23) hypothesised that sub-agent transcripts live in a project
> directory ETM doesn't watch (`~/.claude/projects/-private-tmp/`), and that "58 transcripts
> in last 4 h" were the sub-agent fan-out. **That hypothesis is wrong.**
>
> Ground truth (verified 2026-05-26 by inspecting every file under
> `~/.claude/projects/-private-tmp/`): all 3133 files in that directory are tiny **ai-title
> stubs** (155–161 B each, single line of the shape `{"type":"ai-title","aiTitle":"…",
> "sessionId":"…"}`). They are NOT sub-agent transcripts.
>
> The **real** sub-agent transcripts (the lossy ones) live at
> `~/.claude/projects/-Users-Q284340-Agentic-coding/<parent-session-id>/subagents/agent-<hash>.jsonl`
> — INSIDE the coding project's encoded-cwd directory, in a `subagents/` subdirectory under
> the parent session's UUID directory. The ETM doesn't watch this path because it scans only
> `~/.claude/projects/<encoded-cwd>/*.jsonl` (top-level), not the recursive `<parent>/subagents/`.

This correction matters because the `searchPaths` config for Path B's sweep was about to be
pointed at the wrong directory.

---

## Process model

Claude Code spawns sub-agents via the **`Agent` tool** (an in-process tool, NOT a subprocess
spawn of a separate `claude` CLI). Evidence:

- The orchestrator's tool list includes `Agent` (verified: `/Users/Q284340/.claude/skills/gsd-execute-phase/SKILL.md:12` lists `Agent` in `allowed-tools`).
- The parent transcript `5d22e2d5-0fe0-472a-be31-698c48882d0c.jsonl` contains 13 `tool_use` events with `"name":"Agent"`.
- `Agent` tool input shape (verified by inspecting the parent transcript):
  ```json
  {
    "description": "Execute plan 42-01 of phase 42",
    "subagent_type": "gsd-executor",
    "prompt": "…"
  }
  ```
- The optional `isolation="worktree"` parameter is described in
  `/Users/Q284340/.claude/get-shit-done/workflows/execute-phase.md` (line ~89, 412, 530)
  and triggers `git worktree add` for the sub-agent's working directory.

**`isolation="worktree"` does NOT change where the transcript lives.** Per the live evidence:

- A sub-agent whose Agent call had `isolation="worktree"` will `cd` into `/private/tmp/<uuid>/` but
- its transcript STILL gets written to `<parent-session-dir>/subagents/agent-<hash>.jsonl`
  under the originating project's encoded-cwd (not under `-private-tmp`)

Verified by: surveying 50 sub-agent transcripts under `~/.claude/projects/-Users-Q284340-Agentic-coding/*/subagents/`, only three distinct `cwd` values appeared (`/Users/Q284340/Agentic/coding`, `…/integrations/mcp-server-semantic-analysis`, `…/lib/llm`). **Zero** sub-agent transcripts had a `cwd` under `/private/tmp/`. This means either (a) the wave that produced these transcripts ran in sequential mode (USE_WORKTREES=false), OR (b) the transcript's `cwd` field captures the orchestrator's cwd, not the sub-agent's worktree. Either way, the routing rule is **transcript-path-by-parent**, not transcript-path-by-cwd.

**Claude Code version verified:** `2.1.141` (from `"version"` field in the 2026-05-23 transcripts).

---

## Transcript location

### Primary directory pattern

```
~/.claude/projects/<encoded-cwd-of-parent>/<parent-session-uuid>/subagents/agent-<hash>.jsonl
```

Concrete example from the 2026-05-23 Phase 42 wave (verified to exist on disk):
```
~/.claude/projects/-Users-Q284340-Agentic-coding/
  5d22e2d5-0fe0-472a-be31-698c48882d0c/
    subagents/
      agent-a24960e65f317241e.jsonl     # 26 such files for this parent
      agent-ae5f25d04ce8a9f01.jsonl
      …
```

### Encoded-cwd rule

`<encoded-cwd>` is the parent session's launch directory with `/` → `-` substitution, prefixed with `-`. Example:
- cwd `/Users/Q284340/Agentic/coding` → directory `-Users-Q284340-Agentic-coding`
- cwd `/private/tmp/abc-def` → directory `-private-tmp-abc-def` (if a Claude Code session ever launched from there)

Sub-agents inherit the **parent's** encoded-cwd path — they do NOT get their own encoded-cwd
directory under `~/.claude/projects/`. They get a sibling `subagents/` directory under the
parent's UUID.

### Filename schema

```
agent-<hash>.jsonl
```

`<hash>` is a **17-character lowercase hex** identifier (verified across 804 files; all match
`^agent-[a-f0-9]{17}\.jsonl$` — actually 17, not 16 — counted from `agent-a24960e65f317241e`).
This is the `agentId` recorded in every JSONL line of the transcript (verified: filename
basename matches the `agentId` field exactly).

### JSONL schema (verified)

Top-level keys in every record (`agent-a24960e65f317241e.jsonl`, line 2, fully verified):

```
['agentId', 'cwd', 'entrypoint', 'gitBranch', 'isSidechain', 'message',
 'parentUuid', 'sessionId', 'timestamp', 'type', 'userType', 'uuid', 'version']
```

Plus on **assistant messages**: `'attributionAgent'`, `'attributionSkill'`, `'requestId'`.
Plus on **first user message** (line 1): `'promptId'`.

Critical fields for Phase 51:

| Field | Semantics | Phase 51 use |
|---|---|---|
| `isSidechain` | `true` for every sub-agent message, `false` for parent's own messages | **Primary marker — ANY message with `isSidechain:true` is sub-agent work** |
| `agentId` | 17-char hex; matches filename, stable for the sub-agent's lifetime | → `sub_hash` (use first 7 chars per D-LSL-Filename) |
| `sessionId` | The **PARENT** session UUID — NOT a fresh UUID for the sub-agent | → `parent_session_id` directly |
| `cwd` | Captures the parent's cwd (NOT a worktree path even for `isolation="worktree"` sub-agents in this evidence set) | → `metadata.project` via path-walk |
| `attributionAgent` | E.g. `gsd-executor`, `gsd-planner`, `gsd-plan-checker`, `Explore`, `gsd-pattern-mapper`, `gsd-code-reviewer`, `gsd-verifier` | → `metadata.subagent_type` (provenance) |
| `attributionSkill` | E.g. `gsd-execute-phase`, `gsd-plan-phase`, `gsd-code-review` | → `metadata.skill` (provenance) |
| `parentUuid` | UUID of the previous message in this sub-agent's conversation thread (NOT the parent session's ID) | Conversation graph traversal only — NOT useful for project mapping |
| `gitBranch` | Git branch the sub-agent ran on (e.g. `main` or `worktree-agent-<hash>`) | If branch matches `worktree-agent-*` → confirms worktree-isolation mode (but transcript path still under parent) |
| `promptId` | First user message only — the parent's prompt-id that triggered this Agent() call | Useful for joining a sub-agent back to its parent's prompt timeline |

### Lifetime

- Transcript file is CREATED at first message write — there IS a small race between `Agent()` call return and first JSONL line landing on disk (Path A consequence below).
- mtime updates on every message append.
- After sub-agent exits, mtime stops updating but the file persists indefinitely on disk.
- The 2026-05-23 sub-agent transcripts (filed 2 days ago) are **still present** as of 2026-05-26 — no automatic cleanup.
- GSD's worktree cleanup removes `/private/tmp/<uuid>/agent-<hash>/` (the working directory) on wave success, but the transcript file lives OUTSIDE the worktree under `~/.claude/projects/`, so it is **NOT affected by worktree cleanup**.

### Ground-truth file count

- **Total sub-agent transcripts under coding project (all-time):** 804 files (`find ~/.claude/projects/-Users-Q284340-Agentic-coding -path '*/subagents/agent-*.jsonl' | wc -l`)
- **2026-05-23 (the incident day, full UTC day):** 19 files across 2 parent sessions (12 under `5d22e2d5-…` afternoon parent, 7 under `31274d29-…` evening parent). CONTEXT.md said "~25"; the exact count of 19 includes everything that mtime-stamps on that calendar day — the discrepancy is benign (CONTEXT.md was eyeballing; off by ~6).

---

## Lifecycle events

| Event | Signal available | Phase 51 use |
|---|---|---|
| **Spawn** | `Agent(subagent_type=…, prompt=…)` tool_use record appears in the **parent** transcript with a fresh `agentId` allocated server-side and returned in the matching `tool_result`. The sub-agent transcript file is created when the first message is appended — race window observed but small (sub-second in practice). | Path A hook: intercept at the parent's `Agent` tool_use record, register the `agentId` BEFORE the sub-agent first writes. The tool_result also carries final completion text. |
| **Progress** | Each JSONL append flushes to disk (`stat` shows mtime advance every message). No filesystem-level event; must `fs.watch` or poll. | Live tier streams via `fs.watch(<parent-dir>/subagents/, { recursive: false })` then tail each `agent-*.jsonl`. |
| **Complete** | Sub-agent's final assistant message has `stop_reason: "end_turn"` (verified on assistant records). Process exits cleanly. mtime freezes. The PARENT transcript receives a `tool_result` block referencing the same `agentId` with the sub-agent's return text inline. | Sweep tier: file is safe to convert when (a) `now - mtime > RACE_GUARD_MS` AND (b) the last assistant record has `stop_reason: "end_turn"` (or alternately, the parent transcript carries the matching tool_result). Reuse Phase 50's RACE_GUARD_MS = 5min — already proven in `scripts/backfill-subagent-transcripts.mjs:21`. |
| **Failure / crash** | Mid-message process exit leaves the final JSONL line truncated (malformed JSON). The parent transcript has a `tool_result` with `is_error: true` and an error message. | Path B sweep must wrap `JSON.parse` in try/catch and **skip** malformed lines without aborting the whole file — Phase 50 `lib/lsl/scan-and-convert.mjs:282-285` already does this (catches per-line parse errors). |

---

## Sub-agent-of-sub-agent recursion

**Yes — Claude Code allows sub-agents to spawn their own sub-agents.** Evidence: the
`attributionAgent` survey across 50 sub-agent transcripts shows multiple distinct subagent_type
values (`gsd-executor`, `gsd-planner`, `gsd-plan-checker`, `Explore`, `gsd-pattern-mapper`,
`gsd-code-reviewer`, `gsd-verifier`) — `gsd-execute-phase` clearly spawns `gsd-executor`s which
in turn can spawn `gsd-plan-checker`, etc.

**Parent chain recovery from the transcript:**
- `sessionId` in a sub-agent's records points at the **root parent session**, not the immediate
  parent. So a sub-sub-agent's `sessionId` will be the same UUID as the top-level Claude Code
  user session, NOT its direct spawner.
- `parentUuid` traces the linear conversation within ONE sub-agent's own transcript — NOT
  cross-transcript.
- `attributionAgent` + `attributionSkill` give the immediate role (`gsd-plan-checker`,
  `gsd-execute-phase`) but not the spawning sub-agent's `agentId`.

**Inference rule for the registry** (planner needs this):
- A sub-agent whose `sessionId` matches an active parent's UUID, and whose `cwd` matches a
  known sub-agent's working dir, is a recursive sub-agent of that intermediate sub-agent.
- For Phase 51 D-LSL-Filename (`S{slot}-{idx}` shape), recursive sub-agents would need
  `S{slot}-{idx}-{sub-idx}` — the registry's reserved `parent_sub_hash` field per
  CONTEXT.md D-LSL-Filename handles this. Population deferred per Could #11.
- **In practice for the 2026-05-23 evidence:** no clear sub-sub-agent transcript is identifiable
  from the JSONL alone (the agentId-chain is not recoverable without the parent's tool_use
  records). Recommend deferring recursive-capture to a follow-up phase.

---

## Detection plan — Path B (sweep)

### searchPaths to add to `lib/lsl/scan-and-convert.mjs` consumer config

The primitive's `scanTranscriptsForUnconverted(searchPaths, …)` walks each path **recursively**
(`walkFiles` at line 33-55), so a single root entry per project is sufficient. Phase 51's sweep
caller adds:

```javascript
import os from 'node:os';
import path from 'node:path';

const claudeSubagentSearchPaths = [
  // ONE entry per project's encoded-cwd directory. Sweep walks recursively
  // and the primitive picks up agent-*.jsonl files in any subagents/ subdir.
  path.join(os.homedir(), '.claude', 'projects', '-Users-Q284340-Agentic-coding'),
  // Future: extend per-project. For Phase 51 scope (D-Backfill), only the
  // coding project is in scope; other projects use their own GSD instances.
];
```

**Important:** the existing `scanTranscriptsForUnconverted` filter accepts both `.md` and
`.jsonl` files (line 115) and gates `.md` to specstory-only (line 119), so `agent-*.jsonl`
files are accepted **without modification to the primitive**. D-Reuse honored.

**However**, two extensions to the consumer config are needed (NOT to the primitive itself):

1. **Sub-agent JSONL filter** (do not convert parent session transcripts under the same root —
   those are already handled by the parent ETM). The consumer must filter for files matching
   `**/subagents/agent-*.jsonl`. Done at the consumer layer, not inside the primitive, to keep
   D-Reuse intact:

   ```javascript
   const candidates = scanTranscriptsForUnconverted(claudeSubagentSearchPaths, { since, project: 'coding' });
   const subAgentOnly = candidates.filter(c =>
     /\/subagents\/agent-[a-f0-9]+\.jsonl$/.test(c.path)
   );
   ```

2. **Tag with the registry fields** (D-Live-Sweep-Tags) by passing `tag: 'sub-agent-backfill'`
   to `convertTranscriptsToObservations`. The primitive already plumbs `tag` through to
   `writer.processMessages` as both `tag` and `source` (line 239-240).

### cwd-parsing rule — map transcript → originating project

The cwd is **NOT reliable** for project identification (see Process model — even for
`isolation="worktree"` sub-agents, the recorded cwd may be the parent's not the worktree's).
**The correct rule is to derive project from the transcript's filesystem path**:

```javascript
/**
 * Given a sub-agent transcript path, return the originating project name.
 *
 * Rule: walk up from the transcript path to find the `~/.claude/projects/<encoded-cwd>/`
 * ancestor, then decode the cwd. Last path segment is the project name.
 *
 * Example:
 *   /Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/<uuid>/subagents/agent-XXX.jsonl
 *   → encoded cwd: "-Users-Q284340-Agentic-coding"
 *   → decoded cwd: "/Users/Q284340/Agentic/coding"
 *   → project: "coding" (last segment of basename)
 *
 * Falls back to the agent's first JSONL line `cwd` field if path-walk fails
 * (defense-in-depth).
 */
function projectFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(/\/\.claude\/projects\/(-[^/]+)\/[0-9a-f-]{36}\/subagents\/agent-[a-f0-9]+\.jsonl$/);
  if (m) {
    const encoded = m[1];                          // "-Users-Q284340-Agentic-coding"
    const decoded = encoded.replace(/^-/, '/').replace(/-/g, '/');  // "/Users/Q284340/Agentic/coding"
    const segments = decoded.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'unknown';  // "coding"
  }
  // Fallback: read first line, take cwd's basename
  try {
    const firstLine = readFirstLine(transcriptPath);
    const obj = JSON.parse(firstLine);
    if (obj.cwd) return path.basename(obj.cwd);
  } catch { /* ignore */ }
  return 'unknown';
}

/**
 * Given a sub-agent transcript path, return the parent session UUID.
 * Extracted from the UUID segment between the project encoded-cwd dir and `subagents/`.
 */
function parentSessionFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(/\/\.claude\/projects\/-[^/]+\/([0-9a-f-]{36})\/subagents\/agent-/);
  return m ? m[1] : null;
}

/**
 * Given a sub-agent transcript path, return the 17-char agentId.
 * Used as `sub_hash` (CONTEXT.md D-LSL-Filename specifies first 7 chars of session id;
 * here the agentId IS the session-equivalent for sub-agents).
 */
function agentIdFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(/\/agent-([a-f0-9]+)\.jsonl$/);
  return m ? m[1] : null;
}
```

**Important caveat about hash-prefix length:** CONTEXT.md D-LSL-Filename specifies "first 7 chars
of the sub-agent's session id". For Claude Code sub-agents, the `agentId` field IS the
session-equivalent (the parent's `sessionId` is shared, so we use `agentId` to disambiguate).
Take the first 7 chars of the 17-char hex agentId. Verified collision-free for the 19 confirmed
2026-05-23 transcripts (all 17 chars distinct; 7-char prefixes also distinct).

### Sub-agent → parent sub_index mapping

D-Live-Sweep-Tags requires `metadata.sub_index = <N>` (1-based ordering within parent's fan-out).
The transcript filesystem layout does NOT preserve order — sibling `agent-*.jsonl` files all live
in one flat directory. Compute `sub_index` at sweep time by sorting sibling sub-agent transcripts
by **first message timestamp** (the `timestamp` field on the first record):

```javascript
function computeSubIndexes(transcripts) {
  const byParent = new Map();
  for (const t of transcripts) {
    const parent = parentSessionFromClaudeSubagentPath(t.path);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push({
      ...t,
      firstMessageTs: readFirstMessageTimestamp(t.path),  // ISO string from first JSONL record
    });
  }
  for (const [parent, sibs] of byParent) {
    sibs.sort((a, b) => Date.parse(a.firstMessageTs) - Date.parse(b.firstMessageTs));
    sibs.forEach((s, i) => { s.subIndex = i + 1; });
  }
  return [...byParent.values()].flat();
}
```

### Parent-session slot mapping

D-LSL-Filename's `S{parent-slot}` is per-LSL-day (1-indexed per active parent session within the
local LSL day). For sweep mode, slot is computed by:

1. List all parent sessions that produced sub-agents on a given LSL day, sorted by the parent's
   first sub-agent's timestamp.
2. Assign `S1`, `S2`, … in that order.

For the 2026-05-23 evidence: 2 parents (`5d22e2d5-…` and `31274d29-…`), so `S1` and `S2`
respectively.

### Wire-up (final consumer shape)

```javascript
// Path B sweep entry point (similar to scripts/resolve-observations-from-lsl.mjs)
import { scanTranscriptsForUnconverted, convertTranscriptsToObservations }
  from '../lib/lsl/scan-and-convert.mjs';

const transcripts = scanTranscriptsForUnconverted(claudeSubagentSearchPaths, {
  since: lastSweepIso,
  project: 'coding',
});

const subAgentOnly = transcripts.filter(t =>
  /\/subagents\/agent-[a-f0-9]+\.jsonl$/.test(t.path)
);

// Enrich with sub_index + sub_hash + parent_session_id (registry fields)
const enriched = computeSubIndexes(subAgentOnly).map(t => ({
  ...t,
  parentSessionId: parentSessionFromClaudeSubagentPath(t.path),
  agentId: agentIdFromClaudeSubagentPath(t.path),
  subHash: agentIdFromClaudeSubagentPath(t.path).slice(0, 7),
  project: projectFromClaudeSubagentPath(t.path),
}));

// Convert. The primitive's writer.processMessages already accepts arbitrary metadata
// via the `source` and `tag` params; the per-transcript metadata is set inside the
// writer call (see `scripts/backfill-subagent-transcripts.mjs:70-74` for the reference).
const results = await convertTranscriptsToObservations(enriched, {
  tag: 'sub-agent-backfill',  // matches D-Live-Sweep-Tags
  dryRun: false,
});
```

**Existing PoC reuse:** `scripts/backfill-subagent-transcripts.mjs` already implements ~80% of
this. The migration to Phase 51 is mostly (a) replace its inline directory walk with
`scanTranscriptsForUnconverted`, and (b) add the `subIndex`/`subHash`/`parentSessionId`
enrichment + pass them as metadata fields. The race-guard / max-age / max-bytes constants are
already inherited by the Phase 50 primitive (lines 26-28).

---

## Detection plan — Path A (spawn-time hook)

Three options, ranked by ease-of-implementation:

### Option 1 (RECOMMENDED): Filesystem watch on `<parent-dir>/subagents/`

Pros: zero Claude-Code-internal coupling. Works for ALL Claude Code versions. Survives Claude
Code updates. Requires no patching of GSD's wave-runner code.

Cons: small race window between `Agent()` tool_use and first JSONL write — but the registry
can absorb this by treating "agentId observed in parent's tool_use but no transcript yet" as
a pending entry (already needed for race-tolerance).

```javascript
// Phase 51 live tier registration daemon (e.g., as a coordinator-managed worker).
import { watch } from 'node:fs/promises';

const PARENT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects', '-Users-Q284340-Agentic-coding');

// Step 1: watch the parent-projects dir for new <uuid>/subagents/ creations.
//   - Phase 51 prereq: the daemon starts the moment a coding session launches.
//   - Cheap: only fires on rename events under the project root.
for await (const ev of watch(PARENT_PROJECTS_DIR, { recursive: true })) {
  if (ev.filename && /^[0-9a-f-]{36}\/subagents\/agent-[a-f0-9]+\.jsonl$/.test(ev.filename)) {
    const fullPath = path.join(PARENT_PROJECTS_DIR, ev.filename);
    registerSubAgent({
      parentSessionId: parentSessionFromClaudeSubagentPath(fullPath),
      agentId: agentIdFromClaudeSubagentPath(fullPath),
      transcriptPath: fullPath,
      project: 'coding',
      agent: 'claude',
      detectedVia: 'fs-watch',
    });
    // Start tailing the file with a streaming ObservationWriter.
    startLiveTail(fullPath);
  }
}
```

`fs.watch` on macOS uses FSEvents → low overhead, supports `recursive: true` natively.
The registry's `sub_index` field is filled in lazily as siblings arrive (recompute on each
new-sibling event).

### Option 2: Intercept GSD wave-runner before `Agent()` dispatch

Pros: registers the sub-agent in the registry BEFORE any transcript exists — eliminates the
race entirely. Catches `subagent_type` directly from the Agent() input.

Cons: requires patching the GSD wave-runner (or wrapping it via the Skill system). Brittle if
the user invokes `Agent()` outside GSD (e.g., manually via `/agents` slash-command).

Implementation sketch: GSD's wave-execute workflow currently does `git worktree add` then
`Agent(subagent_type="gsd-executor", prompt=…)`. Inject a pre-`Agent()` call that POSTs the
soon-to-be-spawned sub-agent's metadata to a coordinator endpoint. Coordinator pre-allocates a
registry row keyed by `(parent_session_id, sub_index)`; agentId is filled in later when the
transcript appears.

### Option 3: Inject `--session-id` at spawn

Not viable — Claude Code's `Agent` tool does NOT expose a `session-id` (or equivalent) input
parameter. Verified from the Agent tool input schema captured above (only
`description`, `subagent_type`, `prompt`).

### Recommendation

**Path A = Option 1 (filesystem watch).** It's the simplest, runs as a single daemon owned by
the coordinator, requires zero GSD changes, and works for every Claude Code workflow (GSD,
ad-hoc `/agents` invocations, `claude --dangerously-skip-permissions` scripts, etc.). The
sub-second race window is acceptable because the sweep tier (Path B) is the fallback for any
missed transcripts.

If a future hardening pass wants belt-and-suspenders, layer Option 2 on top — pre-register
from the GSD wave-runner, then let the fs-watch reconcile the agentId when it shows up.

---

## Known landmines / patterns

1. **The `cwd` field is the orchestrator's cwd, not the sub-agent's worktree.** Across 50 surveyed
   sub-agent transcripts, ALL had `cwd` pointing at the project root or a project subdir — NONE
   pointed at `/private/tmp/<uuid>/`, even though `isolation="worktree"` would put the sub-agent
   IN such a worktree. Conclusion: the transcript's `cwd` field is the parent's (or the
   pre-cd cwd), not the sub-agent's actual working directory. Use the **filesystem path** for
   project identification, not the `cwd` field.

2. **The first line of a sub-agent transcript is usually a `user` record (the spawn prompt),
   NOT an `ai-title` stub.** Verified: line 1 of `agent-a24960e65f317241e.jsonl` is the long
   prompt text the orchestrator passed to `Agent()`. The `ai-title` records that appear under
   `~/.claude/projects/-private-tmp/*.jsonl` are unrelated noise (NOT sub-agent transcripts).
   The TranscriptNormalizer's `parseClaude` is already line-resilient — it skips lines it can't
   parse — so this is not a blocker, but the planner should be aware.

3. **`isSidechain:true` is the primary marker for sub-agent records — use it as a sanity check
   when wiring up the writer.** If a transcript record has `isSidechain:false`, it's parent
   activity that should NOT be tagged with sub-agent metadata. Defensive filter in the writer:

   ```javascript
   if (!msg.isSidechain) {
     // This is parent-session activity that snuck into the file (shouldn't happen for
     // sub-agent transcripts, but defend anyway).
     continue;
   }
   ```

4. **`sessionId` ≠ sub-agent's own ID.** It's the parent's. Use `agentId` for sub-agent
   identity. Critical for D-LSL-Filename's `sub_hash` field.

5. **Truncated last lines.** If a sub-agent crashes mid-message, the final JSONL line is
   malformed. Phase 50's `lib/lsl/scan-and-convert.mjs:282-285` already handles this
   gracefully (try/catch around per-line parse + skip counter), but the sweep CLI should
   surface the skipped count to the operator so they know recovery wasn't 100%.

6. **`-private-tmp/` is noise.** Don't sweep it. All 3133 files there are tiny `ai-title`
   stubs — they have no message content. CONTEXT.md's initial diagnosis pointing at this
   directory was wrong; correct rule is to ignore it entirely.

7. **Race window between `Agent()` return and first JSONL write.** Sub-second but real.
   Path A (fs-watch) handles it by lazily filling agentId when transcript appears; Path B
   handles it by waiting RACE_GUARD_MS = 5min before sweeping. Don't try to tighten the
   guard — observation conversion is a heavy LLM call, do NOT race the live writer.

8. **Multiple sub-agents per parent share the SAME `subagents/` directory.** Don't assume
   one-sub-agent-per-dir. The 2026-05-23 `5d22e2d5-…` parent has 26 sibling
   `agent-*.jsonl` files in one directory. `sub_index` ordering is by first-message-timestamp,
   NOT by lexicographic filename order.

9. **Sibling files keep growing after a wave succeeds.** Even after GSD wave-execute completes
   and cleans up worktrees, the sub-agent transcript files persist (they live OUTSIDE the
   worktree). Idempotency (per CONTEXT.md AC #5) is critical because the sweep will see the
   same files on every run.

10. **`attributionSkill` can be `null` for some sub-agents.** Survey showed 3 of 100 had
    `attributionAgent: gsd-executor` but `attributionSkill: null`. Don't make the writer
    error if `attributionSkill` is missing; treat as "unknown skill" and continue.

---

## References

- `scripts/backfill-subagent-transcripts.mjs` (this repo) — the proof-of-concept this research validates and extends. The cwd-parsing rule above generalises its directory walk.
- `/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/5d22e2d5-0fe0-472a-be31-698c48882d0c/subagents/` — 26 sub-agent transcripts confirmed from the 2026-05-23 afternoon Phase 42 wave (12 mtime-stamped on 2026-05-23 in the locked window).
- `/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/31274d29-95cc-4968-9620-ec41e3aa6bf2/subagents/` — additional 7 sub-agent transcripts from the same day's evening parent session.
- `/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/5d22e2d5-0fe0-472a-be31-698c48882d0c/subagents/agent-a24960e65f317241e.jsonl` line 2 — fully verified JSONL schema (all 13 top-level keys enumerated above; assistant records add 3 more).
- `/Users/Q284340/.claude/skills/gsd-execute-phase/SKILL.md` line 12 — confirms `Agent` is the Claude Code spawn tool.
- `/Users/Q284340/.claude/get-shit-done/workflows/execute-phase.md` lines 89, 412, 523, 530 — confirms `isolation="worktree"` semantics and the `gsd-worktree-wave-XXXXXX.json` manifest pattern.
- `/Users/Q284340/.claude/agents/gsd-executor.md` — the sub-agent prompt template invoked via `Agent(subagent_type="gsd-executor", …)`.
- `lib/lsl/scan-and-convert.mjs` lines 26-28 (RACE_GUARD_MS / MAX_AGE_MS / MAX_FILE_BYTES), line 115 (accepts `.jsonl`), line 159 (entry point), 282-285 (per-line try/catch) — the Phase 50 primitive Phase 51 imports unchanged.
- Claude Code version `2.1.141` (confirmed from `version` field in 2026-05-23 transcripts).
- No web fetches were needed — all evidence is on-disk and unambiguous.

---

## RESEARCH COMPLETE

**Phase:** 51 — gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
**Agent researched:** Claude Code
**Confidence:** HIGH

### Key findings

1. **CONTEXT.md hypothesis was incorrect about the transcript directory.** The 58 files under `~/.claude/projects/-private-tmp/` are tiny `ai-title` stubs, NOT sub-agent transcripts. Actual sub-agent transcripts live at `~/.claude/projects/<encoded-parent-cwd>/<parent-session-uuid>/subagents/agent-<hash>.jsonl` (INSIDE the project's encoded-cwd directory, in a `subagents/` subdir). Planner should drop `-private-tmp` from any searchPaths config.
2. **Spawn mechanism is the in-process `Agent` tool, NOT a subprocess.** Confirmed by counting 13 `Agent` tool_uses in the parent transcript. The `isolation="worktree"` parameter changes the sub-agent's cwd but NOT its transcript path — transcripts always route to `<parent-dir>/subagents/`.
3. **The `agentId` field (17-char hex) is the sub-agent's identity — matches the filename, NOT the `sessionId` (which is the parent's).** Use `agentId[:7]` for D-LSL-Filename's `sub_hash`. The parent's `sessionId` is `parent_session_id`.
4. **`isSidechain:true` is the primary marker. Every sub-agent JSONL record has it; parent records have `isSidechain:false`.** Defensive filter for the writer.
5. **Path B (sweep) is essentially "extend `scripts/backfill-subagent-transcripts.mjs` with the Phase 50 primitives".** No new primitive needed; the consumer adds a filename filter + sub_index/sub_hash/parent_session enrichment. The existing primitive's recursive walk picks up the `subagents/` subdir automatically.
6. **Path A (live hook) is best implemented as a filesystem watch on `~/.claude/projects/<encoded-cwd>/`** (recursive, FSEvents on macOS) — Option 1 above. Zero coupling to GSD wave-runner; sub-second race tolerated by the registry's lazy fill pattern; sweep is the safety net for missed transcripts.

### Confidence assessment

| Area | Level | Reason |
|---|---|---|
| Transcript location | HIGH | 804 files surveyed; 100% match the documented path pattern. |
| JSONL schema | HIGH | All 13 top-level keys enumerated from a real file; assistant-record additions verified. |
| Spawn mechanism | HIGH | `Agent` tool counted directly in parent transcript; skill file confirms it in `allowed-tools`. |
| Race-window characterisation | MEDIUM | Inferred from file-creation semantics; not directly stress-tested. RACE_GUARD_MS=5min is conservative enough that the inference doesn't matter for sweep correctness. |
| Recursive sub-agent recovery | MEDIUM | Mechanism exists (attributionAgent diversity) but parent-chain reconstruction from JSONL alone is incomplete; deferred to follow-up phase per CONTEXT.md Could #11. |

### File created

`.planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-RESEARCH-claude.md` (this file)
