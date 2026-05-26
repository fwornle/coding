# Phase 51 — Research: GitHub Copilot sub-agent mechanism

**Agent:** GitHub Copilot (CLI primary; VS Code Chat secondary; Workspace not in scope)
**Status:** ✓ (transcripts ARE accessible on the local filesystem)
**Surface chosen for Phase 51 scope:** **GitHub Copilot CLI (`copilot`, v1.0.48)** — this is the surface the user actually runs against this codebase (`~/.copilot/config.json` shows `lastLoggedInUser.host = "https://bmw.ghe.com"`, 593 sessions exist, the cwd of recent sessions is `/Users/Q284340/Agentic/coding/*`). VS Code Copilot Chat is also installed but its session content is encrypted/opaque inside VS Code's `globalStorage` — out of scope for Phase 51's sweep tier.

> **Major correction to CONTEXT.md's hypothesis.** CONTEXT.md called Copilot the
> "likely sweep-only agent" and asked to confirm storage location under
> `~/.config/github-copilot/`. **Both guesses are wrong.** The actual Copilot CLI
> stores everything at `~/.copilot/` (no `github-` prefix), and it emits a rich
> per-event JSONL stream with first-class `subagent.started` / `subagent.completed`
> lifecycle events. Copilot is NOT sweep-only — both Path A (event tailing) and
> Path B (post-hoc events.jsonl scan) are viable.

---

## Process model

GitHub Copilot CLI v1.0.48 is a long-running Node.js process (binary at
`~/.copilot/pkg/universal/1.0.48/`) installed and updated by the VS Code Copilot
Chat extension (the shim that puts `copilot` on PATH is
`/Users/Q284340/Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli/copilotCLIShim.js`).
A session is a single interactive `copilot` invocation pinned to one cwd; each
session gets a fresh UUIDv4 session id at start.

**Sub-agent spawning is a first-class concept.** The CLI's session-events schema
(`~/.copilot/pkg/universal/1.0.48/copilot-sdk/generated/session-events.d.ts`, lines 1-2)
enumerates these sub-agent lifecycle events as members of the top-level
`SessionEvent` union:

- `SubagentStartedEvent`
- `SubagentCompletedEvent`
- `SubagentFailedEvent`
- `SubagentSelectedEvent`
- `SubagentDeselectedEvent`

The SDK index (`~/.copilot/pkg/universal/1.0.48/sdk/index.d.ts`) further declares
a `SubagentSessionBoundary` type (line 36934) with `sessionBoundaryType: "start" | "end" | "failed"`
and an `agentId` field, plus an `AgentTask` type modelling background sub-agents
with `id`, `toolCallId`, `agentType`, `prompt`, `result`, `modelOverride`. The
`McpTaskInfo` type's docstring (line ~278) reads:
*"MCP-task-specific data when this agent represents an MCP task created via
`tools/call` with task augmentation. Absent for normal subagents."* — confirming
two sub-agent paths: (a) normal sub-agents and (b) MCP-task-augmented ones.

Empirically (sampled from `~/.copilot/session-state/00b9c9f4-…/events.jsonl`),
sub-agents are emitted as `type: "subagent.started"` events carrying:
```json
{"type":"subagent.started",
 "data":{"toolCallId":"toolu_vrtx_01GPw…",
         "agentName":"general-purpose",
         "agentDisplayName":"General Purpose Agent",
         "agentDescription":"Full-capability agent running in a subprocess. …"},
 "id":"2c8c4efb-…", "timestamp":"2026-03-05T12:30:53.149Z",
 "parentId":"bbbad551-…"}
```

Two important runtime observations:

1. **Each sub-agent has a `toolCallId`, not a session id.** Start and complete
   are correlated via the same `toolCallId`. There is NO separate per-sub-agent
   `events.jsonl` file — the sub-agent's lifecycle events appear in the parent
   session's events.jsonl. The Copilot agentDescription claims sub-agents "run in
   a separate context window" / "in a subprocess" but the on-disk transcript shape
   treats them as nested tool invocations inside the parent's event stream.
2. **The sub-agent's intermediate messages are NOT in the parent stream.** In the
   sampled session (1062 events, 10 sub-agents), there are no `subagent.user.message`
   or `subagent.assistant.message` events on disk — only the bookending
   `subagent.started` / `subagent.completed`. The sub-agent's actual reasoning
   trace appears to be either (a) discarded after the sub-agent returns, (b) only
   summarized in the parent's `tool.execution_complete` for the orchestrating
   tool call, or (c) optionally written via the `SubagentSessionBoundary` event
   which has not been observed in any of the 283 sessions on disk that contain
   sub-agent events.

**The asymmetry vs. Claude Code:** Claude Code writes a full sub-agent JSONL at
`<parent>/subagents/agent-<hash>.jsonl`. Copilot CLI does NOT — it emits only
lifecycle bookends, and the sub-agent's internal reasoning is lost or compressed.
This has direct consequences for Phase 51's "observation parity" acceptance
criterion (see Known Landmines).

---

## Transcript location

**Primary path (definitive):**

```
~/.copilot/session-state/<session-uuid>/events.jsonl
```

Authority: confirmed by direct filesystem inspection on this machine
(2026-05-26). 593 session directories present, all line up with rows in
`~/.copilot/session-store.db::sessions`. Each non-empty session also contains:

- `events.jsonl` — the canonical per-event stream (one JSON object per line)
- `workspace.yaml` — small YAML with `id`, `cwd`, `git_root`, `repository`, `branch`, `created_at`, `updated_at`
- `checkpoints/index.md` + `checkpoints/<N>.md` — periodic plan/state snapshots (analogous to Claude Code's checkpoint hooks)
- `files/` — copies of small files Copilot has read (cached for re-reads)
- `research/` — empty in most sessions; presumably populated by `/research` workflow
- `inuse.<pid>.lock` — present only while the session process is alive

**Secondary path (SQLite mirror, NOT primary):**

```
~/.copilot/session-store.db
```

Tables: `sessions(id, cwd, repository, host_type, branch, summary, created_at, updated_at)`,
`turns(session_id, turn_index, user_message, assistant_response, timestamp)`,
`checkpoints(session_id, checkpoint_number, title, overview, history, work_done, technical_details, important_files, next_steps)`,
`session_files`, `session_refs`, plus an `fts5` `search_index` virtual table.

This is a **post-processed compressed mirror** of the events.jsonl stream:
`turns` collapses each user.message + assistant.message pair into one row, dropping
all `subagent.*`, `tool.execution_*`, `assistant.turn_start`, `session.compaction_*`
event types. **For sub-agent capture, the SQLite is useless** — sub-agent events
are not preserved in `turns`. Sweep tier MUST read `events.jsonl` directly.

**Project mapping rule:** parse each session's `workspace.yaml`:
```yaml
id: d5611a90-874c-4b08-accc-224d04604593
cwd: /Users/Q284340/Agentic/coding/integrations/llm-cli-proxy
git_root: /Users/Q284340/Agentic/coding
repository: fwornle/coding
branch: main
```
Use `cwd` (or `git_root` when present) for project mapping — match the prefix
against known project roots. For the `coding` project, the prefix is
`/Users/Q284340/Agentic/coding`. `repository` (`fwornle/coding`) is a secondary
sanity check.

**Negative findings (confirmed do-not-exist on this machine):**
- `~/.config/github-copilot/` — does NOT exist (CONTEXT.md's guess was wrong)
- `~/Library/Application Support/GitHubCopilot/` — does NOT exist
- `~/.vscode/extensions/github.copilot*` — does NOT exist (Copilot Chat is installed via VS Code's extension manager, not the legacy dotfile path)

**VS Code Copilot Chat session storage (out of scope, documented for completeness):**

`~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/`
contains:
- `ask-agent/Ask.agent.md` + `plan-agent/Plan.agent.md` + `explore-agent/Explore.agent.md`
  — these are **agent definitions** (system prompts + tool allow-lists), not
  transcripts. They are the same shape as Claude's `.claude/agents/*.md`.
- `vscode-sessions-<uuid>/diff.index` — a single binary file, NOT a usable
  transcript. VS Code Copilot Chat stores conversation history in VS Code's
  internal storage system (LevelDB inside `state.vscdb` per workspace), which is
  encrypted/proprietary and not parseable from the filesystem.
- `copilotCli/copilotCLIShim.js` — the shim that launches the standalone
  `copilot` CLI, bridging it back into VS Code's chat panel.

**Decision:** Phase 51's Copilot Path B sweep targets `~/.copilot/session-state/`
only. VS Code Copilot Chat (the in-IDE panel) is NOT addressable from the
filesystem.

---

## Lifecycle events

The full event vocabulary on disk (sampled from one 1062-event session) is rich
and useful for Phase 51:

| Event type | Use for Phase 51 |
|---|---|
| `session.start` | Session opened — emit `sub-agent.spawned` for the registry (treating each new Copilot session in a project's cwd as analogous to a new agent process; not actually a sub-agent in the GSD sense) |
| `session.error` | Session crashed mid-run |
| `session.compaction_start` / `…_complete` | Context window compaction — affects observation window selection |
| `session.truncation` | Older turns evicted — important for LSL parity (Phase 50's primitives assume full history is parseable) |
| `user.message` | One half of a turn pair — feeds ObservationWriter exchange grouping |
| `assistant.turn_start` / `assistant.turn_end` | Turn boundaries — use turn_end as the "exchange complete" signal |
| `assistant.message` | Assistant reply (one per turn; multiple assistant messages can appear inside a single turn between turn_start and turn_end) |
| `tool.execution_start` / `…_complete` | Tool call boundaries (would-be observation metadata) |
| `skill.invoked` | Built-in skill (`/research`, `/gsd-*`, etc.) was called |
| **`subagent.started`** | **First-class sub-agent spawn** — registry inserts row keyed on `toolCallId` |
| **`subagent.completed`** | Sub-agent finished — close the registry row, mark `status: completed` |
| **`subagent.failed`** | Sub-agent errored — close the registry row, mark `status: failed`, capture `error` field |
| **`subagent.selected` / `subagent.deselected`** | (SDK declares these — not observed on disk; presumably UI-only "which sub-agent is currently focused in the timeline view") |

**For real-time (Path A) detection:** tail `events.jsonl` of any active session
(detect by presence of `inuse.<pid>.lock`). One sub-agent's full lifecycle =
one `subagent.started` + zero-or-more in-between events (none observed in
practice — see Process model) + one `subagent.completed` OR `subagent.failed`.

**For post-hoc (Path B) detection:** scan `~/.copilot/session-state/*/events.jsonl`
sorted by mtime descending; for each file, count `subagent.started` events and
match them with terminal `subagent.completed`/`subagent.failed` to compute
per-sub-agent duration and outcome.

---

## Sub-agent-of-sub-agent recursion

**Status:** Not observed in 283 sessions on disk. Schema permits it (the
`SubagentSessionBoundary` type takes an `agentId` and the parent linkage in the
`parentId` event field could theoretically chain, since `parentId` references
the *previous event*, not the parent agent).

**Conclusion:** Treat as Could (CONTEXT.md Could #11) — defer until observed.
If it ever appears, the detection rule is: a `subagent.started` event whose
`parentId` resolves (via event-graph walking back up the chain) to an event
inside another `subagent.started`/`subagent.completed` window in the same
`events.jsonl`. The registry's reserved `parent_sub_hash` field (D-LSL-Filename)
would be the `toolCallId` of the enclosing sub-agent.

**No separate session id.** Because sub-agents do not get their own session uuid
(they share the parent's session id and only carry a `toolCallId`), the proposed
LSL filename rule `{sub-hash}` = `first 7 chars of the sub-agent's session id`
**does not work for Copilot as-written.** D-LSL-Filename needs an agent-specific
adapter: for Copilot, derive `{sub-hash}` from `first 7 chars of the toolCallId`
(strip the `toolu_vrtx_` prefix first if present — Copilot CLI proxies through
Anthropic's tool-call naming convention).

This is a downstream-planner concern that flows directly from this research and
must be flagged in the per-agent LSL filename derivation logic.

---

## Detection plan — Path B (sweep)

This is the immediate, definitive Phase 51 plan for Copilot.

**1. Add to `searchPaths` in the agent-agnostic registry config:**
```javascript
{
  agent: 'copilot',
  searchPaths: [path.join(os.homedir(), '.copilot', 'session-state')],
  scanPattern: '*/events.jsonl',
  // Project-mapping reads sibling workspace.yaml
}
```

**2. Extend `lib/lsl/scan-and-convert.mjs` (no behavior change — just config):**

The existing `scanTranscriptsForUnconverted()` walks any provided root and
returns all `.md` / `.jsonl` files. To make it work for Copilot:

- Pass `~/.copilot/session-state` as one of the searchPaths.
- The existing `walkFiles` recursion already descends into the per-session
  subdirectories and finds the `events.jsonl` files.
- The existing parser dispatch in `convertTranscriptsToObservations`
  detects `.jsonl` files and routes through `processLineStream` with
  either `parseClaude` or `parseCopilot`. **The current logic
  (`scan-and-convert.mjs:206`) selects `parseCopilot` only when the
  filename contains the substring `"events"`** — `events.jsonl` matches.
  Good — no code change needed for filename routing.

**3. Fix `parseCopilot` (REQUIRED — current parser is broken for live Copilot CLI events):**

The current `parseCopilot` in `src/live-logging/TranscriptNormalizer.js:198-247`
expects an older event shape:
- Looks for `parsed.event || parsed.type` and matches against `COPILOT_CONVERSATION_EVENTS`
- Extracts content from `data.content` (string), `data.message.content`, or
  `data.choices[0].(message|delta).content`

The actual Copilot CLI v1.0.48 events.jsonl uses:
- `type: "user.message"` / `type: "assistant.message"` (dotted names, lowercase, NOT in `COPILOT_CONVERSATION_EVENTS` per the field naming the parser checks)
- User content at `data.content` (string) — happens to match the current parser's first branch, BUT…
- Assistant content at `data.content` (string, NOT a chat-completions `choices` array)
- Each event carries a top-level `id`, `timestamp`, `parentId` (event-graph parent, not agent parent)

**Required parser fix (planner task):** Update `parseCopilot` to:
- Match the dotted event types (`user.message`, `assistant.message`,
  `assistant.turn_end`) from the v1.0.48 schema. The `COPILOT_CONVERSATION_EVENTS`
  set needs the new constants.
- Extract content from `data.content` for both user and assistant messages.
- Extract role from the type prefix (`user.*` → "user", `assistant.*` → "assistant").
- Use the top-level `timestamp` field (ISO 8601 string) — NOT a synthesized one.
- Emit a new event-type branch for `subagent.started` / `subagent.completed` /
  `subagent.failed` returning a structured sub-agent record (not a chat message).
  The sweep should write these into the agent-agnostic registry, NOT pass them
  to `writer.processMessages()` as conversation turns.

This work belongs in the Copilot-specific Plan within Phase 51 (NOT in Phase 50's
locked primitives, per D-Reuse).

**4. Project-mapping rule (deriveProjectHint extension):**

`lib/lsl/scan-and-convert.mjs::deriveProjectHint` currently knows about
`.specstory/history/` and `.claude/projects/-…` paths. It needs a Copilot branch:

- For a file matching `~/.copilot/session-state/<uuid>/events.jsonl`, read the
  sibling `workspace.yaml` to extract `cwd` (or `git_root`).
- Match the cwd against known project roots (or, simpler: take `path.basename(cwd)`
  / `path.basename(git_root)` and return that as the project hint).
- For sessions whose `workspace.yaml` is missing or unreadable, fall back to
  reading the SQLite mirror: `SELECT cwd, repository FROM sessions WHERE id = ?`
  — but only as a degraded fallback (most sessions have workspace.yaml).

**5. Sub-agent registry population (the heart of the sweep):**

For each Copilot `events.jsonl`:
1. Stream-parse the file.
2. For each `subagent.started` event, open a registry row keyed on
   `(session_id, toolCallId)` with:
   - `parent_session_id` = the session uuid (from path)
   - `sub_hash` = first 7 chars of `toolCallId` (per D-LSL-Filename adapted for Copilot)
   - `agent` = `copilot`
   - `sub_index` = ordinal among `subagent.started` events in this file
   - `status` = `running`
   - `agent_name` = `data.agentName` (`general-purpose`, …)
   - `started_at` = event `timestamp`
3. On `subagent.completed`/`subagent.failed`, close the row: set `status`,
   `completed_at`, `error` (if failed).

**6. LSL parity for Copilot sub-agents (Phase 51 AC):**

This is where Copilot's lifecycle-only event model creates the biggest
challenge. Since the sub-agent's inner messages are NOT in events.jsonl, we
**cannot write a faithful sub-agent LSL** with the sub-agent's reasoning.
Options:

  a. **Write a stub LSL** containing only the spawn metadata and the
     sub-agent's final result (extracted from the parent's
     `tool.execution_complete` event that closes the orchestrating tool call,
     if present). Mark the file with `agent: copilot, lsl_incomplete: true` in
     frontmatter so consumers know.

  b. **Don't write a sub-agent LSL at all** for Copilot — instead emit ONE
     observation per sub-agent run with `metadata.source = "sub-agent-backfill"`,
     `metadata.agent = copilot`, `metadata.sub_summary = <agentName + duration + outcome>`.
     Skip the LSL parity tier for this agent.

  c. **Use the `vscode.metadata.json` sidecar** (if present — observed in some
     sessions) for additional context. Not yet researched in depth.

Recommendation: (a) for the first Phase 51 ship; revisit if (b) is operationally
sufficient. Either way, surface the limitation in the Copilot-specific plan's
acceptance criteria — `D-Live-Sweep-Tags` already supports tagging
`metadata.agent = "copilot"`, so dashboard consumers can filter / annotate.

**7. Idempotency:**

D-Backfill AC #5 requires sub-agent uniqueness key = sub-agent session UUID +
message UUID. For Copilot, that key shape doesn't quite fit (no sub-agent
session UUID). The adapter rule: **idempotency key = `<parent_session_id>:<toolCallId>`**
for sub-agent rows, and the per-observation key remains the parent's event
`id` (a UUID, present on every event in events.jsonl).

---

## Detection plan — Path A (spawn-time hook)

Path A for Copilot is **feasible but more complex than Claude Code's worktree
hook**, because Copilot doesn't expose a per-process "I'm spawning a sub-agent"
hook to external observers. Three viable approaches, ranked by complexity:

**A1 — File-watch tail (recommended for first ship):**

Use `fs.watch()` or `chokidar` to tail every `~/.copilot/session-state/*/events.jsonl`
whose parent directory contains an `inuse.<pid>.lock` (= currently-live session).
On any new line containing `"type":"subagent.started"`, parse the event and
register immediately. On `subagent.completed`/`subagent.failed`, close the
registry row.

Detection latency: file-system event latency (≤ 1 second on macOS).
Resource cost: one watcher per live Copilot session; typically 1-5 at peak.
Cleanup: when `inuse.<pid>.lock` disappears, drop the watcher.

**A2 — Copilot CLI hook API (cleanest, requires Copilot-side config):**

The SDK (`sdk/index.d.ts`) declares `AgentStopHook` types and a
`transcriptPath` field on hook inputs. Copilot CLI exposes a hooks-config
file (analogous to Claude Code's hooks). The skill list in `~/.copilot/skills/`
shows the user already has 70+ GSD skills installed. If Copilot CLI supports
a `subagent_started` hook, the cleanest Path A is a hook that POSTs to the
GSD coordinator. **Research gap:** confirming this requires reading
`~/.copilot/pkg/universal/1.0.48/builtin-skills/` and the hooks schema —
deferred to plan-phase as a 30-minute spike inside the Copilot Path A plan.

**A3 — MCP server (the over-engineered option):**

Copilot CLI is an MCP client. A new MCP server that registers a custom tool
"register sub-agent with GSD" could be auto-invoked at spawn time. This
requires changing the Copilot agent system prompt to call the tool, which is
beyond Phase 51's scope. **Rejected.**

**Recommendation:** Ship A1 in the Copilot-Path-A plan; spike A2 in a follow-up.

---

## Known landmines / patterns

1. **The current `parseCopilot` is broken against the live v1.0.48 events.jsonl
   format.** The constant set `COPILOT_CONVERSATION_EVENTS` and the event-type
   field name (`event` vs `type`) both diverged. Phase 51 plans MUST include a
   parser-fix task BEFORE the sweep can produce real observations. Verify the fix
   against `~/.copilot/session-state/394aba6f-…/events.jsonl` as a fixture
   (10 KB, well-formed, contains user + assistant + tool + subagent events).

2. **Sub-agent inner content is lost on disk.** Between `subagent.started` and
   `subagent.completed`, Copilot does NOT write the sub-agent's user/assistant
   messages or tool calls to events.jsonl. This means LSL parity for Copilot
   sub-agents is fundamentally degraded vs. Claude Code. The dashboard needs to
   know this — surface as a known-limitation in the registry's
   `agent_capabilities` field (proposed schema addition):
   ```json
   {"agent": "copilot", "sub_agent_inner_capture": false, "reason":
    "Copilot CLI emits only subagent.started/completed lifecycle events; "
    "the inner reasoning is not persisted to events.jsonl"}
   ```

3. **No per-sub-agent session uuid.** Sub-agents share the parent's session
   uuid. D-LSL-Filename's `{sub-hash}` derivation (first 7 chars of sub-agent
   session id) doesn't apply — use `first 7 chars of toolCallId` instead.
   Strip Anthropic's `toolu_vrtx_` prefix before slicing, otherwise every
   sub-hash starts with `toolu_vr` and uniqueness collapses to the next byte.

4. **The SQLite mirror is a trap.** `~/.copilot/session-store.db::turns` does
   NOT include sub-agent events. Anyone reading turns and assuming it's the
   full transcript will silently miss every sub-agent. Sweep code MUST read
   events.jsonl, period. The SQLite mirror is acceptable only for fast metadata
   lookups (cwd, repository) when workspace.yaml is missing.

5. **Lock-file races.** `inuse.<pid>.lock` is the only indicator a Copilot
   session is live. If the Copilot process crashes hard (SIGKILL), the lock
   file is stale and the sweep cannot rely on it for "session ended" detection.
   Use the lock file's mtime + a 10-minute grace window before treating an
   "active" session as actually-dead. The 5-min RACE_GUARD_MS already in
   `lib/lsl/scan-and-convert.mjs:26` is on the low end for this; consider
   parameterizing per-agent (Copilot wants ~10 min; Claude jsonl wants 5 min).

6. **`workspace.yaml` is YAML, not JSON.** All current LSL/Claude tooling
   in this repo uses `JSON.parse`. Phase 51's project-mapping for Copilot needs
   to either (a) parse YAML (add `js-yaml` — heavy for one tiny file), or (b)
   extract the 6 fields via regex on the well-formed file. (b) is safer — these
   are auto-generated by Copilot CLI and have a stable, simple flat shape.

7. **Multiple Copilot versions side-by-side.** `~/.copilot/pkg/universal/`
   contains 9 Copilot versions from `1.0.28` through `1.0.48`. Sessions on disk
   reference older versions in their `session.start` event's `copilotVersion`
   field. The parser must NOT assume v1.0.48 schema — older sessions
   (notably `1.0.12` in the sampled file) MAY have slightly different event
   shapes. Run the parser against at least one session from each of (1.0.12,
   1.0.28, 1.0.47, 1.0.48) as a regression matrix. The v1.0.12 schema sampled
   above uses the same dotted event names — so the schema appears stable
   across the observed range, but the planner should pick test fixtures from
   the actual span.

8. **VS Code Copilot Chat is NOT addressable.** Anyone reading this and
   thinking "we should also capture VS Code Copilot Chat" — that's a separate
   research project. VS Code stores chat history inside its `state.vscdb`
   LevelDB which is not safely concurrent-readable while VS Code is running
   and uses an undocumented schema. Out of scope for Phase 51.

9. **The agent-definition `.agent.md` files are not transcripts.** The
   `~/.../globalStorage/github.copilot-chat/ask-agent/Ask.agent.md` etc. files
   are system prompts (analogous to a `.claude/agents/<name>.md` file). They
   define WHAT sub-agents do, not WHAT was done. Don't index them as
   transcripts.

10. **No 2026-05-23 incident analogue.** Unlike Claude Code's `/private/tmp/`
    worktree explosion that surfaced this bug, no equivalent untracked Copilot
    state exists. The 593 sessions on disk are all in their permanent canonical
    location and have been there since session start. **Conclusion:** the
    immediate-value "backfill the 2026-05-23 incident" plan (D-Backfill) is
    Claude-Code-specific and does NOT have a Copilot counterpart. Copilot's
    Path B sweep is a steady-state recurring job, not an incident-response
    bulk-load.

11. **`bmw.ghe.com` enterprise host.** This machine's Copilot CLI is
    authenticated against BMW's GitHub Enterprise host
    (`config.json::lastLoggedInUser.host = "https://bmw.ghe.com"`). Some
    Copilot Workspace / coding-agent features may behave differently on a
    GHES host vs. github.com — out of scope for events.jsonl reading (the
    file format is local and the same), but flag this if any future Path A
    work touches Copilot's GitHub Actions integration.

12. **Mixed-language project paths.** Some recent sessions are in
    `/Users/Q284340/Agentic/coding/integrations/llm-cli-proxy` — a
    sub-directory of the `coding` project. The project-mapping rule must
    walk up to find the nearest `.git` root (or `git_root` field in
    workspace.yaml). Don't take the last segment of the cwd as the project
    name — `llm-cli-proxy` is a *component* of `coding`, not its own project.

---

## References

**Primary (HIGH confidence — local filesystem evidence):**

- `~/.copilot/pkg/universal/1.0.48/copilot-sdk/generated/session-events.d.ts` line 1
  — full `SessionEvent` union enumerating `SubagentStartedEvent`,
  `SubagentCompletedEvent`, `SubagentFailedEvent`, `SubagentSelectedEvent`,
  `SubagentDeselectedEvent`.
- `~/.copilot/pkg/universal/1.0.48/sdk/index.d.ts` line 36934
  — `SubagentSessionBoundary` type definition.
- `~/.copilot/pkg/universal/1.0.48/sdk/index.d.ts` line 300
  — `AgentTask` type modelling background sub-agents.
- `~/.copilot/pkg/universal/1.0.48/changelog.json` lines 269, 674, 738, 1294, 1656
  — historical mentions of "sub-agents", "subagent", confirming first-class
  concept across recent Copilot CLI releases.
- `~/.copilot/session-state/00b9c9f4-15dd-443f-842e-cd7fd188be6a/events.jsonl`
  — confirmed sample with 10 `subagent.started` + 10 `subagent.completed`
  events; full event type distribution measured (1062 events across 16 types).
- `~/.copilot/session-state/394aba6f-2868-4782-b836-3238a8a3970b/events.jsonl`
  — 10 KB sample; confirms event shape `{"type": "session.start", "data":
  {…, "copilotVersion": "1.0.12"}, "id": …, "timestamp": …, "parentId": null}`.
- `~/.copilot/session-state/<uuid>/workspace.yaml` — confirmed shape with
  `id`, `cwd`, `git_root`, `repository`, `branch` fields.
- `~/.copilot/session-store.db` (schema_version 3) — confirmed SQLite mirror;
  `turns` table proven to NOT contain sub-agent events.
- `~/.copilot/config.json` — confirmed `lastLoggedInUser.host = "https://bmw.ghe.com"`,
  `firstLaunchAt = "2026-03-11T00:00:00.000Z"`.

**Secondary (existing project code — directly relevant):**

- `lib/adapters/copilot.js` — existing `CoPilotAdapter` class. It does NOT
  read transcripts; only configures memory/browser/logging fallback services.
  Phase 51 leaves this file alone.
- `scripts/convert-transcripts.js` (1-80) — declares a `copilot` subcommand
  expecting `~/.config/github-copilot/events.jsonl` (a path that doesn't exist
  on this machine). The path needs updating to `~/.copilot/session-state/*/events.jsonl`,
  and `parseCopilot` needs the fixes documented above.
- `src/live-logging/TranscriptNormalizer.js:198-247` — current `parseCopilot`.
  Confirmed to be incompatible with v1.0.48 events.jsonl format — needs the
  parser-fix task in Phase 51's Copilot plan.
- `lib/lsl/scan-and-convert.mjs:206` — confirmed routing rule: `.jsonl`
  files with `events` in basename go through `parseCopilot`. `events.jsonl`
  matches as-is.
- `lib/lsl/scan-and-convert.mjs:104-145` — `scanTranscriptsForUnconverted` —
  walks any provided root. Adding `~/.copilot/session-state` to searchPaths is
  the entire integration on the discovery side.
- `lib/lsl/scan-and-convert.mjs:63-78` — `deriveProjectHint` — needs a new
  branch for `~/.copilot/session-state/<uuid>/events.jsonl` → read sibling
  `workspace.yaml` → extract `cwd` or `git_root`.

**Tertiary (web — not fetched, budget reserved):**

- `https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-coding-agent`
  — 404 on direct WebFetch. The authoritative reference for Copilot CLI's
  agent model is the local SDK type definitions (cited above), which are
  generated from the canonical schema. Web docs would only restate this.

**Negative findings (sources checked and confirmed-absent — HIGH confidence):**

- `~/.config/github-copilot/` (CONTEXT.md's guess) — does NOT exist.
- `~/Library/Application Support/GitHubCopilot/` — does NOT exist.
- `~/.vscode/extensions/github.copilot*` — does NOT exist (VS Code uses a
  different extension storage path on this machine).
- `subagent_session_boundary` events in any of the 283 sessions on disk that
  contain `subagent.*` events — schema exists, runtime never emits it.

---

## RESEARCH COMPLETE

**Phase:** 51 — sub-agent capture (Copilot researcher)
**Confidence:** HIGH (direct filesystem evidence + SDK type definitions in
local bundle; no web round-trip needed).

### Key findings

- **CONTEXT.md's Copilot guess was wrong on two counts.** Storage is at
  `~/.copilot/`, not `~/.config/github-copilot/`. And Copilot is NOT
  sweep-only — both Path A (file-tail) and Path B (events.jsonl scan) are
  viable.
- **Copilot CLI emits first-class sub-agent lifecycle events** as
  `subagent.started` / `subagent.completed` / `subagent.failed` inside each
  session's `events.jsonl`. Confirmed live: 283 sessions on this machine
  currently contain sub-agent events.
- **Sub-agent inner reasoning is NOT persisted to disk.** Between start and
  complete, the sub-agent's user/assistant messages/tool calls are absent
  from events.jsonl. LSL parity is fundamentally degraded vs. Claude Code,
  and the planner must decide between stub-LSL (option a) and single-summary-
  observation (option b) — recommendation: stub-LSL with
  `lsl_incomplete: true` frontmatter.
- **The existing `parseCopilot` parser is broken against current Copilot CLI
  events.jsonl.** It was written against an older event schema. The
  Copilot Phase 51 plan MUST include a parser-update task.
- **D-LSL-Filename's `{sub-hash}` rule doesn't apply to Copilot** —
  sub-agents share the parent's session uuid. Use `first 7 chars of
  toolCallId` (after stripping the `toolu_vrtx_` prefix) instead.
- **Project mapping for Copilot reads `workspace.yaml`** (or the SQLite
  mirror as fallback), NOT a path-encoded cwd convention. Add a YAML-parse
  branch to `deriveProjectHint`.

### File created

`.planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-RESEARCH-copilot.md`

### Confidence assessment

| Area | Level | Reason |
|---|---|---|
| Transcript location | HIGH | Direct fs inspection + schema_version table confirms ~/.copilot/session-store.db is current; events.jsonl format verified across 2 samples spanning v1.0.12 and v1.0.48 |
| Sub-agent mechanism | HIGH | SDK type union enumerates 5 sub-agent events; 283 sessions on disk contain real subagent.* events; full lifecycle observed |
| Inner-content gap | MEDIUM-HIGH | Confirmed by counting event types in one 1062-event session and checking for `subagent_session_boundary` across 283 sessions (zero hits). Edge case: a Copilot CLI flag we haven't tested might enable inner capture |
| Parser fixes needed | HIGH | Current parseCopilot's constant set doesn't match v1.0.48 dotted event names; verified by reading source + sample event |
| Path A feasibility | MEDIUM-HIGH | File-tail is straightforward; hook-based A2 path is speculative pending plan-phase spike |
| Project mapping | HIGH | workspace.yaml + SQLite cwd both verified, both stable across versions |

### Open questions (for plan-phase, not for further research)

1. **Stub-LSL vs. single-observation for Copilot sub-agents** — pick before
   writing the Copilot Path B plan. Recommendation: stub-LSL.
2. **Copilot hooks API (A2 Path A path)** — 30-min spike inside the
   Copilot-Path-A plan to confirm whether `~/.copilot/pkg/universal/1.0.48/builtin-skills/`
   or a separate hooks config exposes a `subagent_started` event hook. If yes,
   prefer A2 over A1 in the Path A plan.
3. **Cross-version parser regression matrix** — pick 4 fixture files spanning
   v1.0.12 → v1.0.48 for the parseCopilot test suite.

### Ready for planning

Research complete. Planner can write the Copilot Path B plan immediately
(using items 1-7 of "Detection plan — Path B"), and the Copilot Path A plan
once the recommendation between A1/A2 lands.
