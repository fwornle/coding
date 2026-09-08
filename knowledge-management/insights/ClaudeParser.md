# ClaudeParser

**Type:** Detail

parseFile() reads .jsonl line by line, delegating per-line conversion to `this.converter.fromClaudeEntry(claudeEntry)`, and handles cases where a single Claude entry expands into an array of LSL entries (e.g., assistant messages with tool calls).

# ClaudeParser: Technical Insight Document

## What It Is

ClaudeParser is implemented in `claude-parser.js`, exposing both a `ClaudeParser` class and a factory function `createClaudeParser`. It serves as the Claude-specific implementation of the `TranscriptAdapter` abstraction defined in `transcript-api.js`, responsible for locating, reading, and converting Claude's on-disk transcript files (`.jsonl`) into the system's internal LSL (Log/Session Language, inferred from `LSLConverter`) representation.

## Architecture and Design

ClaudeParser follows the abstract-base-class-with-subclass pattern established by `TranscriptAdapter`: the parent throws via a `new.target === TranscriptAdapter` guard, forcing ClaudeParser (and its sibling `CopilotParser`) to independently implement transcript discovery and conversion logic tailored to their respective agents' storage conventions. This is a classic Template Method-adjacent design where the abstract contract (`TranscriptAdapterAbstractContract`) defines the required surface (`getAgentType`, `readTranscripts`, `convertToLSL`, `getCurrentSession`) while each adapter owns its own directory-resolution and parsing strategy.

Structurally, ClaudeParser composes an internal `LSLConverter` instance rather than inheriting or receiving it via injection — the class constructs its own converter "with the same options" it receives, coupling ClaudeParser directly to the conversion layer. This is a deliberate simplicity/coupling trade-off: it avoids a dependency-injection layer but means any change to `LSLConverter`'s constructor signature has direct ripple effects on ClaudeParser.

## Implementation Details

Three core behaviors define ClaudeParser's mechanics:

- **Directory resolution** (`getTranscriptDirectory()`): Computes Claude's project-specific directory name by sanitizing the project identifier — replacing all non-alphanumeric characters with `-` — and prefixing with a dash, then joining with `os.homedir()`, `.claude`, `projects`. This hardcodes Claude's specific naming convention distinct from `CopilotParser`'s `COPI_LOG_DIR`-based resolution.
- **Staleness detection** (`findCurrentTranscript()`): Applies a `maxSessionAge` threshold (default 7,200,000ms / 2 hours) against the most recent file's `mtime` to determine whether it qualifies as the "current" session. This guards against treating abandoned/stale transcript files as active sessions.
- **Line-based parsing** (`parseFile()`): Reads the `.jsonl` file line by line, delegating each line's conversion to `this.converter.fromClaudeEntry(claudeEntry)`. Notably, it handles the case where a single Claude entry (e.g., an assistant message containing tool calls) expands into an *array* of LSL entries rather than a 1:1 mapping — meaning the parsing loop must flatten or accumulate variable-cardinality results per line.

## Integration Points

ClaudeParser sits under `TranscriptAdapterAPI` as a concrete implementation alongside sibling adapters `CopilotParser`. It shares the `LSLConverter` dependency conceptually with the rest of the system (LSLConverter also independently supports `toMarkdown()` rendering for sessions), though ClaudeParser holds its own private instance rather than a shared one. Its adherence to the `TranscriptAdapter` abstract contract means external callers can treat it polymorphically alongside `CopilotParser` without knowing Claude-specific directory or staleness logic.

## Usage Guidelines

- Always instantiate via `createClaudeParser` rather than directly using `new ClaudeParser(...)` where possible, to keep construction consistent with factory conventions used elsewhere in the adapter API.
- Be aware that `findCurrentTranscript()`'s 2-hour default staleness window is a business-logic assumption; callers needing different session-liveness semantics should pass an explicit `maxSessionAge` option rather than relying on the default.
- When consuming `parseFile()` output, always account for entries expanding into arrays (tool-call-bearing assistant messages) — treat the per-line result as potentially multi-valued rather than assuming a strict 1:1 line-to-entry mapping.
- Since directory naming logic is Claude-specific and hardcoded (unlike `CopilotParser`'s env-var-driven `getLogDirectory()`), any changes to Claude's actual on-disk convention require updating `getTranscriptDirectory()` directly — there is no external configuration override evident from current observations.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ClaudeParser (class) in claude-parser.js
- createClaudeParser (function) in claude-parser.js


## Hierarchy Context

### Parent
- [TranscriptAdapterAPI](./TranscriptAdapterAPI.md) -- TranscriptAdapter is an abstract base class in transcript-api.js that throws on direct instantiation via `new.target === TranscriptAdapter` check, forcing agent-specific subclasses to implement getAgentType, readTranscripts, convertToLSL, getCurrentSession

### Siblings
- [TranscriptAdapterAbstractContract](./TranscriptAdapterAbstractContract.md) -- The constructor checks `if (new.target === TranscriptAdapter) throw new Error('TranscriptAdapter is abstract and cannot be instantiated directly')`, preventing direct instantiation.
- [CopilotParser](./CopilotParser.md) -- getLogDirectory() resolves log location via options.logDir, then COPI_LOG_DIR env var, falling back to path.join(codingPath, 'integrations', 'copi', 'logs').
- [LSLConverter](./LSLConverter.md) -- toMarkdown(session) builds a header block (Agent, Session ID, Project, Started/Ended, Time Window) followed by per-entry rendering via entryToMarkdown().


---

*Generated from 6 observations*
