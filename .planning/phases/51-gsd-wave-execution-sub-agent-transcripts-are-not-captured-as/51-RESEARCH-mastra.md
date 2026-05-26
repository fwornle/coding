# Phase 51 — Research: Mastra sub-agent mechanism

**Agent:** Mastra / Mastracode (TypeScript AI agent framework + standalone TUI agent `mastracode`)
**Status:** ⚠ — capture path partially built, sub-agent path NOT built
**Project-use status:** **Currently used in this project** — launchable via `coding --mastra` (`scripts/launch-mastra.sh` + `config/agents/mastra.sh`); `mastracode` CLI installed via `npm install -g mastracode`; transcript-reader (`src/live-logging/MastraTranscriptReader.js`) and lifecycle-hook bridge (`scripts/mastra-hooks/transcript-writer.py`) are real, in-tree, and reference live writers. The Mastra **framework** (`@mastra/*` npm packages) is NOT a runtime dependency of this repo — it powers `mastracode` (the bundled TUI), not the host. **Sub-agent capture is unimplemented** — `MastraTranscriptReader` reads a single flat NDJSON file per session and has no notion of a child agent.

---

## Process model

Two distinct runtime paths exist for "Mastra" in this codebase, only one of which is wired up:

### 1. `coding --mastra` → `mastracode` TUI (current production path)

- `bin/coding --mastra` resolves to `scripts/launch-mastra.sh` (`bin/coding:191`), which sources `launch-agent-common.sh` and `config/agents/mastra.sh`. [VERIFIED: file read]
- `mastracode` is **a separate Node CLI binary** installed globally via `npm install -g mastracode` (`config/agents/mastra.sh:20`), invoked as the agent's TUI process. It is *not* an in-process Mastra workflow. [VERIFIED: file read]
- The launcher writes `~/.mastracode/hooks.json` registering shell-command hooks for `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse` (`config/agents/mastra.sh:147-156`). Each hook calls `python3 scripts/mastra-hooks/transcript-writer.py` with `MASTRA_TRANSCRIPT_FILE=<project>/.observations/transcripts/mastra-transcript.jsonl`. The hooks receive the event payload **on STDIN as JSON** (per the comment block at `config/agents/mastra.sh:73-81`). [VERIFIED: file read]
- Sub-agent spawning: `mastracode`'s README documents a `/subagents` slash command "to configure subagent model defaults" [CITED: github.com/mastra-ai/mastra/blob/main/mastracode/README.md per WebFetch result]. **No documented `Task`-tool-equivalent that fans out parallel sub-processes**. The lifecycle-hook surface (`SessionStart`/`Stop`/`PreToolUse`/etc.) is **single-session-scoped** — the hook only knows the current session_id.

### 2. The Mastra framework (`@mastra/core`, `@mastra/libsql`) — NOT directly installed

- No `mastra` or `@mastra/*` entry in any `package.json` under the repo root, `lib/`, `src/`, `scripts/`, or `integrations/` (`find ... -name package.json | xargs grep -l mastra` → empty). [VERIFIED: filesystem grep]
- The only references to `@mastra/*` are in `scripts/test-coding.sh:1882, 2246-2307` which probe for `@mastra/opencode` and `@mastra/libsql` as transitive deps **if OpenCode was launched with the Mastra plugin** (Phase 20 milestone, ref. `.specstory/history/2026/03/2026-03-29_1600-1700-1_c197ef.md` Phase 20 discussion log). [VERIFIED: grep + file read]
- A `knowledge-injection-mastra.js` adapter (`src/hooks/knowledge-injection-mastra.js`) writes `<cwd>/.mastra/context.md` — this is the *injection* surface for a hypothetical in-process Mastra workflow, not a *capture* surface. The directory `/Users/Q284340/Agentic/coding/.mastra/` exists but is empty. [VERIFIED: ls]
- Mastra framework docs confirm: "Memory **requires** a storage provider", default `@mastra/libsql` quickstart uses `url: ':memory:'` (no persistent default) [CITED: mastra.ai/docs/memory/overview via WebFetch].

**Project-use conclusion:** Phase 51's Mastra support is for **`mastracode` (case 1 — in production)**, NOT for the `@mastra/*` framework (case 2 — speculative / not used). The single-flat-NDJSON transcript that `mastracode` produces is the artifact Phase 51's sub-agent capture must extend.

---

## Transcript location

**Primary (mastracode TUI):**

```
<TARGET_PROJECT_DIR>/.observations/transcripts/mastra-transcript.jsonl
```

- Concretely for the `coding` project: `/Users/Q284340/Agentic/coding/.observations/transcripts/mastra-transcript.jsonl`
- Format: **NDJSON** — one JSON object per line, one event per `mastracode` lifecycle-hook fire
- Created on-demand by `_generate_mastra_hooks_config()` at `config/agents/mastra.sh:90` (`mkdir -p "$transcript_dir"`)
- **Single file per project** — there is no per-session rotation; every `mastracode` session for a given project appends to the same file. Session boundaries are marked by `{type:"session_start"|"session_end", sessionId, ...}` records.
- `MastraTranscriptReader` (`src/live-logging/MastraTranscriptReader.js:354-356`) treats `.jsonl` AND `.ndjson` as transcript files — supports directory-scanning multiple files but currently only one is written.
- Live status (snapshot from `ls -la .observations/transcripts/`): **directory empty** at research time. `mastracode` has been launched (per `.specstory/history` evidence Phase 20 prompts: "now, in the mastra session, I expected to see mastra logged content") but no transcripts persisted in coding's `.observations/transcripts/` — possibly because the session was run against a different `TARGET_PROJECT_DIR` or because `mastracode`'s hook delivery is unreliable (see Landmines). [VERIFIED: ls]

**Secondary (mastracode's own SQLite store):**

`mastracode` independently maintains a SQLite database at:
- macOS: `~/Library/Application Support/mastracode/`
- Linux: `~/.local/share/mastracode/`
- Windows: `%APPDATA%/mastracode/`

Threads are "automatically scoped to your project based on Git remote URL or absolute path" [CITED: github.com/mastra-ai/mastra mastracode/README.md per WebFetch]. **Phase 51 does NOT consume this** — the NDJSON transcript at `.observations/transcripts/` is the canonical capture surface; the SQLite store is `mastracode`'s internal session memory and is OUT OF SCOPE for the capture pipeline (per the agent-agnostic architecture: every agent writes NDJSON, the project consumes NDJSON).

**Tertiary (`@mastra/*` framework, speculative):**

If a future Mastra workflow integration is added (per the Phase 20 OKM-style plan referenced in `.specstory/history/2026/03/2026-03-29_1600-1700-1_c197ef.md`), the storage provider would be `@mastra/libsql` with a project-chosen path (likely `<project>/.observations/observations.db` per Phase 20 D-Storage decision "Per-project `.observations/`"). The threads/messages tables are LibSQL-managed. **Out of scope for this research.**

---

## Lifecycle events

`mastracode`'s lifecycle hooks (per `config/agents/mastra.sh:73-156`):

| Hook | When | Available payload (STDIN JSON) | Maps to NDJSON record |
|---|---|---|---|
| `SessionStart` | TUI launch | `{ session_id, cwd, hook_event_name }` | `{"type":"session_start","sessionId":"...","cwd":"...","timestamp":"..."}` |
| `SessionEnd` | TUI exit | `{ session_id, cwd, hook_event_name }` | `{"type":"session_end",...}` |
| `UserPromptSubmit` | each user message | `{ ..., user_message }` | `{"type":"message","role":"user","content":"...",...}` |
| `Stop` | each assistant turn end | `{ ..., assistant_message, stop_reason }` | `{"type":"message","role":"assistant","content":"...","reason":"...",...}` |
| `PreToolUse` | before tool execution | `{ ..., tool_name, tool_input }` | `{"type":"onToolCall","tool":"...","input":"...",...}` |
| `PostToolUse` | after tool execution | `{ ..., tool_name, tool_input, tool_output }` | `{"type":"onToolResult","tool":"...","output":"...",...}` |

**Key gaps:**
- **No "sub-agent spawned" hook.** `mastracode`'s `/subagents` slash command is a CONFIG command (sets defaults), not a lifecycle event. Even if `mastracode` internally invokes a sub-agent (the docs are ambiguous on this), no hook fires to externalize that.
- **No "agent invocation" hook in `@mastra/core`.** Mastra's framework hooks (`onStepFinish`, `onToolCall`, `onToolResult` per `MastraTranscriptReader._normalizeEvent`'s lines 263-291) are workflow-step events, not sub-agent events. When one agent calls another agent-as-tool, it appears as a regular `onToolCall` with `tool: "<subAgentName>"`. The reader currently encodes that as a normal tool call with no special handling.

**Detection signal for sub-agent boundary (best available):**
1. **Process model:** `mastracode` runs as a single TUI process. A "sub-agent" in `mastracode` terms is most likely an in-process LLM call with a different system prompt, NOT a separate process or transcript file. The current evidence does not support detecting it via filesystem or process inspection.
2. **Tool-call inspection:** if/when `mastracode` exposes sub-agent invocations as `onToolCall`/`PreToolUse` events with a specific `tool_name` convention (e.g. `tool_name: "subagent.<name>"`), the existing hook surface could distinguish them. **No evidence this convention exists today.**

---

## Sub-agent-of-sub-agent recursion

**Not applicable to current `mastracode` capture.** `mastracode`'s sub-agent surface (if any) is in-process — no transcript-level recursion. The single NDJSON file mixes all activity for one TUI session.

**Speculative for `@mastra/*` framework:** Mastra workflows can compose recursively (`agent.generate()` then calls another `agent.generate()` then calls a third), and per `mastra.ai/docs/agents/overview` "agents can be called from workflow steps, tools, or other agents." This recursion is **invisible at the transcript layer** unless the application explicitly opts into per-agent threads and writes them to discrete storage. **Deferred until/unless a Mastra framework integration ships.**

---

## Detection plan — Path B (sweep)

Phase 51's sweep tier extends `lib/lsl/scan-and-convert.mjs`'s `searchPaths` config. For mastracode:

**searchPaths addition:**

```javascript
// Mastra (mastracode) transcripts — one NDJSON per project.
{
  agent: 'mastra',
  searchPath: path.join(projectDir, '.observations', 'transcripts'),
  filePattern: /\.(jsonl|ndjson)$/,  // matches MastraTranscriptReader._isTranscriptFile
  projectHintRule: 'parent-of-.observations',  // <project>/.observations/transcripts -> projectName = basename(<project>)
  parentSessionRule: 'inline-session-start-event',  // sessionId comes from the {"type":"session_start","sessionId":"..."} record in-file, NOT the filename
}
```

**Cwd / project mapping rule** — the NDJSON records carry `cwd` on each event (added by `transcript-writer.py:111`: `cwd = d.get("cwd", "")`). Use this for the cross-check. If `cwd` is missing (older records or empty TARGET_PROJECT_DIR), fall back to deriving project from the file's parent directory:

```
<project>/.observations/transcripts/mastra-transcript.jsonl
parent.parent.basename = "coding" (or whatever project owns the .observations dir)
```

The existing `deriveProjectHint()` in `lib/lsl/scan-and-convert.mjs:60-78` already handles `.claude/projects/-Users-...-coding/` paths but **does NOT yet handle `.observations/transcripts/`**. Add a third branch:

```javascript
const obsIdx = filePath.indexOf('/.observations/transcripts/');
if (obsIdx > 0) {
  const owner = filePath.slice(0, obsIdx);
  return path.basename(owner);
}
```

**Sub-agent identification within the NDJSON:**
- **There is no sub-agent designator in current mastracode transcripts.** Every record belongs to the single parent session whose `sessionId` appears in the `session_start` event.
- For Phase 51 Path B to write `metadata.sub_index` / `metadata.sub_hash` for mastra entries, **it must currently fall back to treating the whole transcript as parent-only**. This is correct behavior given the evidence — mastracode has no sub-agent transcripts to capture in the first place.
- **Forward compatibility hook:** if a future mastracode version emits sub-agent events (e.g. `{"type":"subagent_start","parent_session_id":"...","sub_index":N,"sub_session_id":"..."}`), `MastraTranscriptReader._normalizeEvent` would need a new branch, and the sweep would emit one parent observation + N sub-agent observations per file. Document the schema we'd expect (so the planner can decide whether to ship a stub branch now or defer):

```ndjson
{"type":"subagent_start","sessionId":"<parent>","subAgentSessionId":"<sub>","subIndex":1,"subName":"reviewer","timestamp":"..."}
{"type":"message","role":"assistant","content":"...","sessionId":"<sub>","subAgentSessionId":"<sub>","timestamp":"..."}
{"type":"subagent_end","sessionId":"<parent>","subAgentSessionId":"<sub>","timestamp":"..."}
```

**Idempotency:** sweep keys on `(sessionId, lineNumber)` per `lib/lsl/scan-and-convert.mjs`'s existing race-guard (`RACE_GUARD_MS = 5 minutes`, `MAX_AGE_MS = 48h`). Mastra NDJSON appends — each line is uniquely addressable.

**Backfill scope (D-Backfill):** sweep covers `coding`'s `.observations/transcripts/mastra-transcript.jsonl` if present. **Currently empty** (verified via `ls -la`) — so the 2026-05-23 backfill effectively has zero mastra records to recover. The sweep is correct behavior (no-op when no records) and forward-compatibility for the next mastra session.

---

## Detection plan — Path A (spawn-time hook)

**Recommendation: sweep-only for Mastra. Defer Path A indefinitely.**

Rationale:
1. **No sub-agent boundary in current transcripts** — there is nothing to spawn-hook into. The whole point of Path A is to register a sub-agent's transcript path at spawn time so the live writer can tail it. For mastracode, the parent's transcript IS the only transcript, and the existing `MastraTranscriptReader` already tails it (if ETM is configured per `findMastraTranscriptDir()` at `scripts/enhanced-transcript-monitor.js:1113-1131`).
2. **No spawn-time signal** to hook into. `mastracode` doesn't fire a "sub-agent started" lifecycle event; the closest signal is a `PreToolUse` with `tool_name: "subagent.*"`, and **no evidence this convention exists**. Hooking arbitrary `PreToolUse` would generate massive false positives (every Bash/Read/Write tool call would look like a sub-agent spawn).
3. **`MastraTranscriptReader` is unmaintained for sub-agents.** The reader (`src/live-logging/MastraTranscriptReader.js:326-349`) detects parent-only `user -> assistant` exchanges. Even if we wanted to wire it in, the parent-session lifecycle plumbing already covers what we'd get.

**If Path A is required for completeness (e.g. for the D-Statusline cleanup to source `subMt` uniformly across all 4 agents), the cheapest hook is:**

- Watch for new entries in `.observations/transcripts/` directory (not just the single `mastra-transcript.jsonl`) — if mastracode ever rotates or per-session-files, the new file appearing IS the spawn signal.
- Coupled with a `session_start` event in the NDJSON content (which IS already fired by `mastracode`), the registry can record `{ parent_session_id, sub_index: null, transcript_path }` per session start.
- This is **session-level capture, not sub-agent-level capture.** It's the right granularity for the dashboard subMt-freshness signal (the 2026-05-24 mitigation cleanup), but does not address the conceptual gap that mastracode has no sub-agents.

**Implementation pointer if needed:** extend `findMastraTranscriptDir()` (`scripts/enhanced-transcript-monitor.js:1109-1131`) to register the directory in the Phase 51 registry on first detection, then let the existing `MastraTranscriptReader.start()` provide the live-tail. Cost: trivial (~10 lines). Value: low (sweep already covers it).

---

## Known landmines / patterns

1. **Mastra-the-framework is not mastracode-the-CLI is not @mastra/opencode-the-plugin.** Three different products from the same vendor, all called "mastra" in casual speech. The repo's `MastraTranscriptReader.js` was written for **mastracode lifecycle hooks** (case 1). The `knowledge-injection-mastra.js` adapter was written for **@mastra/opencode plugin context** (case 3 — Phase 20). The Phase 51 CONTEXT.md's "Mastra workflows can spawn agents programmatically" framing assumes **the framework** (case 2). These don't fully match — the planner needs to know which one each plan targets.

2. **Empty `.observations/transcripts/` is the norm right now.** Even though `coding --mastra` is wired up, no transcript records exist on disk at research time. Possible causes:
   - `mastracode` was never launched against the `coding` project (only test runs or different `TARGET_PROJECT_DIR`)
   - The hook delivery via stdin-JSON is silently failing (per the `transcript-writer.py:106` `except: return` — silently skips invalid stdin)
   - First-run auth flow at `config/agents/mastra.sh:34-66` requires interactive setup; users may have aborted before any session ran
   - **Implication:** Phase 51 cannot use existing mastra transcripts as fixture data. Either generate fresh ones in a test session, or leave the mastra branch under-tested.

3. **`MastraTranscriptReader` swallows session_start/end as side-effect emits.** Lines 295-308 emit `session_start`/`session_end` EventEmitter events but `_normalizeEvent` returns `null` — meaning these never produce messages, and a sweep that only inspects message-level records will miss session boundaries. Phase 51's sweep must parse the raw NDJSON directly (not via the reader's `_normalizeEvent`) to extract `sessionId` + `cwd` from the session_start record. Pattern: `lib/lsl/scan-and-convert.mjs` already does raw NDJSON parsing — the new mastra-specific branch should `JSON.parse` each line and pick `sessionId` from the first `type:"session_start"` record.

4. **`hook_event_name` precedence.** `transcript-writer.py:108` reads the event name from stdin JSON, **then falls back to env var `MASTRA_HOOK_EVENT`**. If stdin is malformed (e.g. mastracode hook protocol changes in a future version), the env-var fallback could silently mis-categorize events. Sweep parsing should not trust the `type` field blindly — cross-check against `role` / `tool` / `step` fields.

5. **Per-project NDJSON is shared across all sessions.** Unlike Claude Code (one transcript file per session), mastracode appends every session to one project-wide file. The sweep must distinguish sessions by parsing for `session_start` boundaries. Sessions can interleave if the user runs concurrent `mastracode` instances against the same project (unlikely but not prevented). **Defensive sweep design:** if two interleaved sessions have overlapping records, partition by `sessionId` field on EACH record, not by file-position.

6. **The reader exists but the writer pipeline is incomplete.** `MastraTranscriptReader` is imported NOWHERE in the runtime path (verified by grepping for `MastraTranscriptReader` outside its own definition — only test files reference it, per `find . -name '*.test.js' | xargs grep MastraTranscriptReader`). The ETM at `scripts/enhanced-transcript-monitor.js:314-325` directly reads `.jsonl` files from `findMastraTranscriptDir()` — bypassing the reader class entirely. **Implication:** the existing `MastraTranscriptReader` code is dead-ish; Phase 51 should NOT build on it. Use the raw NDJSON shape directly.

7. **`mastracode` is an external dependency** (npm: `mastracode`). Version drift in `mastracode`'s lifecycle-hook protocol (stdin schema, event names) WILL break the `transcript-writer.py` mapping silently. Phase 51's sweep should be defensive against unrecognized `type` values (treat as opaque, store raw) rather than dropping unknown records.

8. **No `@mastra/*` package is in the runtime tree.** `scripts/test-coding.sh` probes `@mastra/opencode` and `@mastra/libsql` as **integration tests** for the OpenCode-with-mastra-plugin path, but the host `coding` repo's `package.json` does not depend on them. Any plan that says "use @mastra/core in this repo" is **out of scope** for Phase 51 — it's a Phase 20-era milestone not fully shipped.

---

## References

### File evidence (in-repo, verified)

- `scripts/launch-mastra.sh` — entry point for `coding --mastra`
- `config/agents/mastra.sh` — agent definition: command `mastracode`, transcript format `mastra`, session var `MASTRA_SESSION_ID`, hook protocol (stdin JSON), `_generate_mastra_hooks_config()` writes `~/.mastracode/hooks.json` (lines 81-161)
- `scripts/mastra-hooks/transcript-writer.py` — referenced by the generated hooks.json; writes NDJSON to `MASTRA_TRANSCRIPT_FILE`. Auto-generated by `_generate_mastra_hooks_config()` from the heredoc at `config/agents/mastra.sh:95-141`.
- `src/live-logging/MastraTranscriptReader.js` — NDJSON file-watcher + parser; exists but dead-code (no runtime importer)
- `src/live-logging/TranscriptNormalizer.js` — references `'claude' | 'copilot' | 'mastra'` agent metadata field
- `src/hooks/knowledge-injection-mastra.js` — session-start adapter for `@mastra/opencode` plugin context (Phase 20 artifact, separate concern)
- `scripts/enhanced-transcript-monitor.js:314-325, 1074-1131, 1688-1693` — ETM mastra-source integration (parallel processing, transcript selection by mtime, mastra Stop-hook completion detection)
- `.observations/config.json` — per-agent token budgets including mastra entry (Phase 20 artifact)
- `scripts/test-coding.sh:1882, 2246-2307` — integration tests for `@mastra/opencode` + `@mastra/libsql` (OpenCode-with-mastra-plugin path)
- `bin/coding:126,141,191` — `--mastra` flag handling

### External (cited, verified via WebFetch)

- mastra.ai/docs/agents/overview — confirms "agents can be called from workflow steps, tools, or other agents" + memory works at instance level
- mastra.ai/docs/memory/overview — confirms "Memory **requires** a storage provider", quickstart `@mastra/libsql` with `url: ':memory:'`, no documented persistent default
- github.com/mastra-ai/mastra mastracode/README.md — confirms SQLite store at `~/Library/Application Support/mastracode/` (macOS), thread scoping by Git remote URL / absolute path, `/subagents` slash command exists (config-only, not lifecycle event)

### Project history

- `.specstory/history/2026/03/2026-03-29_1600-1700-1_c197ef.md` — Phase 20 OKM milestone discussion log: established the OpenCode-mastra-plugin path, the `.observations/` directory convention, per-project SQLite, network-adaptive LLM routing
- `/Users/Q284340/.claude/history.jsonl:2226-2308` — user prompts confirming `mastracode` was launched at least once, with reported confusion about where mastra logged content goes

### Phase 51 contract dependencies

- `.planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-CONTEXT.md` § D-Reuse — Phase 50 primitives imported unchanged
- `lib/lsl/scan-and-convert.mjs:60-78` (`deriveProjectHint`) — must extend for `/.observations/transcripts/` path pattern
- `lib/lsl/scan-and-convert.mjs:24-26` constants (`RACE_GUARD_MS`, `MAX_AGE_MS`, `MAX_FILE_BYTES`) — mastra NDJSON files are small (one project's worth of events) and respect these limits naturally

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `mastracode` has no `Task`-tool-equivalent that spawns sub-process agents | Process model | If wrong, Path A could hook the spawn point; sweep would still cover it |
| A2 | The `/subagents` slash command is config-only (sets defaults), not a runtime spawn | Lifecycle events | If wrong, there IS a sub-agent boundary to detect — would need fresh research on mastracode source |
| A3 | `.observations/transcripts/mastra-transcript.jsonl` is the **only** transcript surface for mastracode in this project | Transcript location | If wrong (e.g. mastracode also writes to its own `~/Library/Application Support/mastracode/` SQLite that should be ingested), would need to add SQLite ingest to sweep — significant new work |
| A4 | `MastraTranscriptReader` is dead-code (not imported at runtime) | Landmines #6 | If wrong, removing it would break something — verify with `grep -r "import.*MastraTranscriptReader" --include='*.js'` before any cleanup |
| A5 | Empty `.observations/transcripts/` directory means no historical mastra data to backfill (per D-Backfill) | Detection plan — Path B | If wrong (data exists elsewhere), need to revise backfill scope |
| A6 | `mastracode`'s hook stdin-JSON protocol is stable across versions documented in this repo | Landmines #7 | Future mastracode version could break `transcript-writer.py` silently |

---

## Confidence

- **Process model (mastracode):** HIGH — directly verified from `config/agents/mastra.sh` and the generated `transcript-writer.py`
- **Process model (`@mastra/*` framework, not used here):** HIGH — verified absent from all package.json files
- **Transcript location:** HIGH — file paths verified by `ls`
- **Lifecycle events:** HIGH — events enumerated from `_generate_mastra_hooks_config()` heredoc
- **Sub-agent recursion:** MEDIUM — relies on external docs (mastracode README) for the "no Task-tool" claim; could be wrong if mastracode added the feature recently
- **Detection plan — Path B:** HIGH — extends Phase 50 primitives in a way that mechanically matches the file shape
- **Detection plan — Path A:** MEDIUM-LOW — recommendation is "skip"; if forced to ship, the design is correct but value is unclear
- **Landmines:** HIGH — all directly observed in code
