# TurnActivitySummary

**Type:** Detail

## What It Is

TurnActivitySummary is the concept implemented by `summarizeParts` and its calling closure `activityFor(messageId)`, both defined in `lib/lsl/token/opencode-token-rows.mjs`. It produces a single bounded string that human-readably describes what happened in a conversational turn: a leading text snippet followed by a compact list of tool invocations. This string is written into each emitted row as `prompt_preview: activityFor(rec.id)`, and is not a standalone module or class — it is a function-level capability embedded inside the parent component, OpenCodeTokenExtraction (`buildOpencodeTokenRows`).

## Architecture and Design

The design centers on lazy, gated computation: `activityFor` is only invoked after a message has passed OpenCodeTokenExtraction's `BYPASS_PROVIDERS` check and the zero-token placeholder filter, so the cost of a `partStmt.all(messageId)` query plus per-part `JSON.parse` is paid only for messages that will actually surface as `TokenUsageRow`s — never for the proxy-routed (`anthropic`) messages skipped under the D-04 no-double-count invariant. This mirrors the pre-open gating philosophy of the sibling OpenCodeDbOwnershipGate (`ownedDbPath`), which short-circuits the entire pass before any handle is opened — both components favor cheap upstream checks before expensive downstream work.

A layered defensive-degradation pattern runs through the implementation: missing `part` table → `partStmt` set to `null` → empty summaries; query failure → empty summary; individual malformed JSON blob → skip that part only. None of these failures abort row emission, only degrade the summary's richness.

Bounding is enforced twice via a shared `snip()` helper — once per tool-argument/lead-text segment, once on the final joined string (240-char cap) — guaranteeing the summary can never grow unbounded regardless of pathological input.

## Implementation Details

`summarizeParts` walks a time-ordered array of parsed `part` blobs (ordered by `time_created ASC` in the underlying query), extracts the first `type: 'text'` part as a lead snippet (capped 140 chars), then renders up to 8 subsequent tool calls as `tool(arg)` descriptors joined with `, `, appending a `+N` marker for overflow beyond 8. Argument extraction follows a priority-fallback chain: `input.filePath` (basename via `.split('/').pop()`) first, then `input.description || input.pattern || input.command || input.url` — privileging file-identity for edit/read/write-style tools and falling back to a single best-guess field for search/shell/fetch-style tools, taking the first truthy match rather than combining fields.

`activityFor` wraps this in three nested layers of defense: a try/catch around the one-time `db.prepare(...)` for `partStmt`, a narrower try/catch around `partStmt.all(messageId)`, and a per-part try/catch around `JSON.parse(pr.data)` inside the loop.

## Integration Points

The summary's only consumer downstream is `insertTokenRow` in `lib/lsl/token/token-db.mjs`, which coalesces `row.prompt_preview` via `text()` (defaulting to `''`) as the 11th positional bind into the `BASE_COLUMNS` INSERT against the NOT-NULL `prompt_preview` TEXT column. This durably couples a UI-display artifact to token-usage.db's cross-adapter accounting schema — the same column the parent's evidence says feeds the Performance-tab timeline. There is a hard, unabstracted dependency on OpenCode's own SQLite schema (`part` table, `time_created` column), and no session-scoping predicate exists anywhere in this path — consistent with the still-open "opencode Session Filtering (currentOpencodeSession)" work item, meaning summaries are built without regard to session boundaries.

## Usage Guidelines

Treat the summary as a derived, bounded, human-scannable projection only — never re-parse it as structured data; no JSON variant exists by design. When extending tool-argument extraction, preserve the first-truthy-match priority ordering rather than merging fields, since it assumes at most one field is meaningfully populated per tool call. Any schema change to OpenCode's `part` table should be accompanied by verifying the existing try/catch layers still degrade gracefully rather than throwing, since the extraction intentionally has no abstraction layer isolating it from schema drift. If session-scoped summaries are ever required, this is the function that needs a `session_id` predicate added to its query.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- `summarizeParts` in lib/lsl/token/opencode-token-rows.mjs is the concrete implementation of the turn-activity-summary concept: it walks a time-ordered array of parsed `part` blobs and builds a single string composed of a lead text snippet (the first `type: 'text'` part, capped to 140 chars via `snip`) followed by up to 8 tool-call descriptors rendered as `tool(arg)`, joined with `, ` and suffixed with a `+N` overflow marker when more than 8 tool calls occurred in the turn. The whole result is re-clamped to 240 chars by a final `snip(segs.join(' '), 240)` call — a double-bounding scheme (per-segment cap, then whole-string cap) that guarantees the summary can never grow unbounded even if a single tool argument or the lead text is unusually long.

**Other:**
- The summary is not computed eagerly for every row scanned — it is produced lazily via the `activityFor(messageId)` closure defined inside `buildOpencodeTokenRows`, which is only invoked once a message has already passed the `BYPASS_PROVIDERS` gate and the zero-token placeholder check. This ties the cost of building a turn summary (a `partStmt.all(messageId)` query plus per-part `JSON.parse`) to only the messages that will actually be emitted as `TokenUsageRow`s, avoiding wasted work on the majority of scanned rows that are proxy-routed (`anthropic`) and skipped under the D-04 no-double-count invariant.
- `activityFor` is defensively guarded against schema drift: `partStmt` is prepared once with a try/catch around `db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC')`, and if the `part` table doesn't exist (an older OpenCode store), `partStmt` is set to `null` and `activityFor` short-circuits to `''` — token rows still get emitted, just without an activity summary. A second, narrower try/catch wraps `partStmt.all(messageId)` itself, and a third failure mode — an individual malformed `data` JSON blob — is caught per-part inside the loop (`try { parsed.push(JSON.parse(pr.data)) } catch { /* skip */ }`) so one corrupt part record degrades the summary rather than aborting extraction for that message.
- Tool-argument extraction inside `summarizeParts` follows a priority order tailored to what's most identifying for each tool type: `input.filePath` (basename only, via `.split('/').pop()`) takes precedence, falling back to `input.description || input.pattern || input.command || input.url`. This ordering privileges file-editing/reading tools (Edit/Read/Write-style) with a path-based identifier and treats search/shell/fetch-style tools (Grep/Bash/WebFetch-style) as a fallback chain — a heuristic that assumes at most one of these fields is meaningfully populated per tool call, since the code takes the first truthy match rather than combining them.
- The produced summary flows into the row as `prompt_preview: activityFor(rec.id)` and is subsequently persisted by `insertTokenRow` in lib/lsl/token/token-db.mjs, which coalesces it via `text(row.prompt_preview)` (defaulting to `''` for the NOT-NULL `prompt_preview` TEXT column) as the 11th positional bind in the `BASE_COLUMNS` INSERT. This is the same column the parent component's evidence describes as feeding 'the Performance-tab timeline' per-turn — meaning a turn's activity summary is durably attached to its token-usage row rather than being a transient in-memory artifact of the extraction pass.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'opencode Session Filtering (currentOpencodeSession)' notes that session-scoped filtering for OpenCode has not yet been implemented; `activityFor`/`summarizeParts` inherit that same session-agnostic posture — the `part` query is keyed purely on `message_id`, with no session-id predicate, meaning a turn's activity summary is built without any awareness of which OpenCode session (current vs. historical) the message belongs to, consistent with the extraction layer's stated design as a flat, unscoped scan.

## Hierarchy Context

### Parent
- [OpenCodeTokenExtraction](./OpenCodeTokenExtraction.md) -- [LLM+CGR] `buildOpencodeTokenRows` in lib/lsl/token/opencode-token-rows.mjs is the core extraction function: it opens `~/.local/share/opencode/opencode.db` read-only via better-sqlite3, scans the most recent `MESSAGE_SCAN_LIMIT` (4000) rows of the `message` table by `rowid DESC`, and for each assistant message whose `providerID`/`provider` field is in `BYPASS_PROVIDERS = Set(['github-copilot'])` emits one `TokenUsageRow`-shaped object via `extractTokens(d)`. Messages from proxy-routed providers (e.g. `anthropic`) are explicitly skipped — this is the D-04 no-double-count invariant stated in the file's header comment: a message already captured as a proxy wire row must never be reconstructed a second time from OpenCode's own store.

### Siblings
- [OpenCodeDbOwnershipGate](./OpenCodeDbOwnershipGate.md) -- [LLM] The ownership gate for OpenCode's SQLite store is `ownedDbPath` in lib/lsl/token/opencode-token-rows.mjs — it runs `fs.statSync(dbPath)` before any read, and when `process.getuid` is available it compares the file's `st.uid` against `process.getuid()`, returning `''` and writing a `[token-adapter-opencode] skipping non-owned ...` stderr line on mismatch. This function is called as the very first line of `buildOpencodeTokenRows`, so a non-owned or missing `opencode.db` short-circuits the entire extraction pass before a single `better-sqlite3` handle is opened, meaning the uid check is a pre-open gate, not a post-open validation.


---

*Generated from 10 observations*
