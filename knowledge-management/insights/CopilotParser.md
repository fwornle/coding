# CopilotParser

**Type:** Detail

parseFile() distinguishes special line types 'session_start'/'metadata' and 'session_end' from regular entries, extracting session-level metadata (projectPath, userHash) separately before converting remaining lines via `this.converter.fromCopiEntry(copiEntry)`.

# CopilotParser — Technical Insight Document

## What It Is

CopilotParser is implemented in `copilot-parser.js` as a class (`CopilotParser`), accompanied by a factory function `createCopilotParser` for instantiation. It serves as the Copilot-specific transcript adapter within the `TranscriptAdapterAPI`, responsible for locating, listing, and parsing Copilot log files into the system's internal representation. As a concrete implementation under the abstract `TranscriptAdapter` contract, CopilotParser exists specifically to handle the log format and directory conventions used by GitHub Copilot's coding agent logs (referred to internally as "copi" entries).

## Architecture and Design

CopilotParser follows the same abstract-subclass pattern established by `TranscriptAdapter` (in `transcript-api.js`), which throws on direct instantiation via the `new.target === TranscriptAdapter` check. This forces agent-specific parsers — CopilotParser alongside its sibling `ClaudeParser` — to implement the required interface (`getAgentType`, `readTranscripts`, `convertToLSL`, `getCurrentSession`), ensuring a uniform contract across differing log formats.

A key design decision is CopilotParser's layered configuration resolution strategy, applied both to log directory discovery and coding path discovery. `getLogDirectory()` resolves location through a prioritized fallback chain: `options.logDir` → `COPI_LOG_DIR` environment variable → a computed default of `path.join(codingPath, 'integrations', 'copi', 'logs')`. Similarly, `codingPath` itself resolves through `CODING_TOOLS_PATH` → `CODING_REPO` → `path.join(os.homedir(), 'Agentic', 'coding')`. This cascading-fallback pattern maximizes configurability (explicit option, then env var, then sane default) while avoiding hard failures when configuration is incomplete.

Another notable design divergence from its sibling ClaudeParser is CopilotParser's tolerance for multiple file formats: `listLogs()` accepts `.jsonl`, `.log`, and `.json` extensions, whereas ClaudeParser restricts itself to `.jsonl` only. This suggests Copilot's log-producing ecosystem is less standardized or has evolved multiple output formats that the parser must accommodate.

## Implementation Details

The core parsing logic lives in `parseFile()`, which distinguishes between structural/metadata lines and regular conversation entries. It specifically detects `session_start`/`metadata` and `session_end` line types, extracting session-level metadata (`projectPath`, `userHash`) separately from the entry stream. Remaining lines are treated as regular entries and converted via `this.converter.fromCopiEntry(copiEntry)` — indicating a delegation pattern where CopilotParser owns file/line-level parsing and orchestration, while an injected/associated converter object (implied `this.converter`) owns the entry-to-internal-format transformation logic.

This separation of concerns — session metadata extraction vs. per-entry conversion — mirrors the general LSL pipeline design seen in `LSLConverter`, which builds session headers (Agent, Session ID, Project, Started/Ended, Time Window) separately from per-entry rendering via `entryToMarkdown()`. CopilotParser's `parseFile()` performs the analogous separation on the ingestion side: pulling out session-level fields before handing off individual entries for conversion.

## Integration Points

CopilotParser is a direct child of `TranscriptAdapterAPI`, alongside `ClaudeParser` and `LSLConverter` as siblings in the transcript adapter hierarchy. It relies on the `converter` component (via `fromCopiEntry`) to transform raw Copilot log entries into the shared internal entry format, which presumably feeds into `LSLConverter` downstream for markdown/session rendering. Its directory and path resolution logic depends on environment variables (`COPI_LOG_DIR`, `CODING_TOOLS_PATH`, `CODING_REPO`) and Node's `path`/`os` modules, tying its runtime behavior to the host environment's configuration rather than hardcoded assumptions.

## Usage Guidelines

Developers should not instantiate CopilotParser directly without going through `createCopilotParser` or the expected TranscriptAdapter subclassing conventions, consistent with the abstract base class's enforcement pattern. When configuring log discovery, explicit `options.logDir` should be preferred for deterministic behavior in tests or CI, falling back to `COPI_LOG_DIR` for environment-level overrides, and only relying on the computed default path in typical developer setups. Because `listLogs()` accepts three extensions, consumers should be aware that CopilotParser may pick up a broader set of files than ClaudeParser in shared directories — care should be taken to avoid extension collisions if Copilot and other tools share a logs folder. Finally, when extending or debugging `parseFile()`, developers should remember that `session_start`/`metadata` and `session_end` lines are structurally special and must not be routed through `fromCopiEntry` as regular entries.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- CopilotParser (class) in copilot-parser.js
- createCopilotParser (function) in copilot-parser.js


## Hierarchy Context

### Parent
- [TranscriptAdapterAPI](./TranscriptAdapterAPI.md) -- TranscriptAdapter is an abstract base class in transcript-api.js that throws on direct instantiation via `new.target === TranscriptAdapter` check, forcing agent-specific subclasses to implement getAgentType, readTranscripts, convertToLSL, getCurrentSession

### Siblings
- [TranscriptAdapterAbstractContract](./TranscriptAdapterAbstractContract.md) -- The constructor checks `if (new.target === TranscriptAdapter) throw new Error('TranscriptAdapter is abstract and cannot be instantiated directly')`, preventing direct instantiation.
- [ClaudeParser](./ClaudeParser.md) -- getTranscriptDirectory() computes Claude's directory naming convention: `-${project.replace(/[^a-zA-Z0-9]/g, '-')}` under path.join(os.homedir(), '.claude', 'projects').
- [LSLConverter](./LSLConverter.md) -- toMarkdown(session) builds a header block (Agent, Session ID, Project, Started/Ended, Time Window) followed by per-entry rendering via entryToMarkdown().


---

*Generated from 6 observations*
