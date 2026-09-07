# LSLConverter

**Type:** Detail

toJSONL(session) writes a first line tagged `{type: 'metadata', ...session.metadata}` followed by one JSON line per entry, and fromJSONL() reverses this by detecting `parsed.type === 'metadata'` to separate metadata from entries.

# LSLConverter — Technical Insight Document

## What It Is

`LSLConverter` is a class defined in `lsl-converter.js` that serializes and deserializes LSL (Log Session Log) session data into two distinct output formats: human-readable Markdown and machine-parseable JSONL. It sits within the `TranscriptAdapterAPI` component space, functioning as a format-conversion utility that operates on session objects composed of metadata and a sequence of typed entries (`LSLEntryType`), the latter imported from `transcript-api.js`.

## Architecture and Design

The converter follows a **dual-serialization pattern**: a single in-memory session representation is projected into two independent output formats through separate code paths — `toMarkdown(session)` and `toJSONL(session)`/`fromJSONL()`. This keeps concerns cleanly separated: Markdown generation is purely for human consumption (headers, formatted blocks), while JSONL is a round-trippable, line-oriented serialization suitable for storage or streaming.

Within `toMarkdown`, the design uses a **header-plus-body composition pattern**: a metadata header block (Agent, Session ID, Project, Started/Ended, Time Window) is built first, followed by delegation to `entryToMarkdown()` for each entry. This delegation is itself a **type-dispatch (switch-based) rendering pattern**, keyed on `LSLEntryType` (USER, ASSISTANT, TOOL_USE, TOOL_RESULT, SYSTEM, ERROR) — a discriminated-union style approach common where a fixed, closed set of entry kinds each needs distinct formatting logic (e.g., TOOL_USE entries render inputs as fenced JSON blocks).

The JSONL path uses a **self-describing line convention**: the first line is tagged with `type: 'metadata'` and carries `session.metadata`, while subsequent lines are raw entry objects. `fromJSONL()` reverses this by inspecting `parsed.type === 'metadata'` on the first line to reconstitute the split between metadata and entries. This is a lightweight, order-dependent encoding rather than a fully self-describing schema per line — it works but assumes the metadata line always appears first.

As a sibling to `ClaudeParser` and `CopilotParser` under the abstract `TranscriptAdapter` base (in `transcript-api.js`), `LSLConverter` complements those adapters: while `ClaudeParser` and `CopilotParser` deal with locating/reading agent-specific transcript sources (Claude's `.claude/projects` directory naming, Copilot's `COPI_LOG_DIR`/`logDir` resolution), `LSLConverter` handles the downstream concern of turning normalized LSL session data into shareable formats, independent of which agent produced it.

## Implementation Details

`toMarkdown(session)` is the primary human-facing renderer. It emits a fixed metadata header followed by iterative calls to `entryToMarkdown()` per entry. `entryToMarkdown()` is the core dispatch function, switching on `LSLEntryType` values and applying type-specific formatting rules — notably rendering TOOL_USE inputs as fenced ` ```json ` blocks. Options passed into these functions modulate output: `includeToolResults` (default `true`) can suppress TOOL_RESULT entries entirely when disabled, and `maxContentLength` (default `10000`) bounds any entry's content length via a `truncateContent()` helper, preventing unbounded output for long tool results or messages.

`toJSONL(session)` handles the machine-oriented serialization: it writes one JSON-encoded line for metadata (tagged `type: 'metadata'`) followed by one line per entry. `fromJSONL()` performs the inverse operation, parsing line-by-line and using the `type` discriminator on the first parsed object to separate metadata from the entry stream, effectively reconstructing a session object equivalent to the original input.

## Integration Points

`LSLConverter` depends on `LSLEntryType` from `transcript-api.js`, tying its rendering logic directly to the entry taxonomy defined by the abstract `TranscriptAdapter` contract. It operates on `session` objects that are presumably produced by adapters implementing `TranscriptAdapter`'s required methods (`getAgentType`, `readTranscripts`, `convertToLSL`, `getCurrentSession`) — meaning `ClaudeParser` and `CopilotParser` (or any future agent-specific subclass) are the upstream producers of the data this converter consumes. This makes `LSLConverter` an agent-agnostic downstream consumer within the `TranscriptAdapterAPI` ecosystem, decoupled from any single agent's transcript format once data has been normalized into LSL sessions.

## Usage Guidelines

When calling `toMarkdown`, developers should be aware that `includeToolResults` and `maxContentLength` are the two primary levers for controlling output verbosity — disable `includeToolResults` for concise summaries, and tune `maxContentLength` when dealing with large tool outputs to avoid excessively long documents. When using `toJSONL`/`fromJSONL` for persistence or transport, the metadata-first-line convention must be preserved; any code manually constructing or editing JSONL files should ensure the first line remains the `type: 'metadata'` entry, since `fromJSONL()`'s parsing logic depends on this ordering rather than scanning for the metadata line explicitly. Because entry rendering is a closed switch over `LSLEntryType`, adding new entry types requires updating `entryToMarkdown()` in lockstep with any changes to the type enum in `transcript-api.js` to avoid unhandled cases.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- LSLConverter (class) in lsl-converter.js


## Hierarchy Context

### Parent
- [TranscriptAdapterAPI](./TranscriptAdapterAPI.md) -- TranscriptAdapter is an abstract base class in transcript-api.js that throws on direct instantiation via `new.target === TranscriptAdapter` check, forcing agent-specific subclasses to implement getAgentType, readTranscripts, convertToLSL, getCurrentSession

### Siblings
- [TranscriptAdapterAbstractContract](./TranscriptAdapterAbstractContract.md) -- The constructor checks `if (new.target === TranscriptAdapter) throw new Error('TranscriptAdapter is abstract and cannot be instantiated directly')`, preventing direct instantiation.
- [ClaudeParser](./ClaudeParser.md) -- getTranscriptDirectory() computes Claude's directory naming convention: `-${project.replace(/[^a-zA-Z0-9]/g, '-')}` under path.join(os.homedir(), '.claude', 'projects').
- [CopilotParser](./CopilotParser.md) -- getLogDirectory() resolves log location via options.logDir, then COPI_LOG_DIR env var, falling back to path.join(codingPath, 'integrations', 'copi', 'logs').


---

*Generated from 5 observations*
