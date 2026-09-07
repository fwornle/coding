# TranscriptAdapterAbstractContract

**Type:** Detail

The base constructor initializes shared state used by all subclasses: sessionCache (Map), cacheTimestamps (Map), watchers (Set), and watchInterval, defaulting config to enableCache: true and cacheTimeout: 10000.

# TranscriptAdapterAbstractContract — Technical Insight Document

## What It Is

TranscriptAdapterAbstractContract defines the abstract base class `TranscriptAdapter`, implemented in `transcript-api.js` as part of the broader TranscriptAdapterAPI component. It establishes the contract that all agent-specific transcript adapters must fulfill. Rather than being directly usable, this class exists purely to enforce structure: any subclass representing a specific coding agent (such as Claude or Copilot) must implement a defined set of methods, while inheriting shared session-management infrastructure from the base.

## Architecture and Design

The class follows the classic **Template Method / Abstract Base Class pattern** in JavaScript, using `new.target` introspection to prevent direct instantiation — the constructor explicitly checks `if (new.target === TranscriptAdapter) throw new Error(...)`, ensuring `TranscriptAdapter` can only be used as a superclass. This is a common technique for simulating abstract classes in a language without native abstract class support.

The design cleanly separates **abstract contract methods** from **concrete shared behavior**:
- Abstract (subclass-defined): `getAgentType()`, `readTranscripts()`, `convertToLSL()`, `getCurrentSession()` — each stubbed to throw "...must be implemented by subclass" errors.
- Concrete (base-provided): `watchTranscripts(callback, options)` — a fully implemented polling mechanism built atop the abstract `getCurrentSession()`.

This split allows the base class to own cross-cutting concerns (caching, polling, watcher management) while delegating agent-specific parsing/format logic to subclasses. It mirrors the relationship seen in sibling components: ClaudeParser and CopilotParser implement agent-specific directory resolution logic, while LSLConverter handles format conversion output — all specialized concerns layered on top of (or alongside) this shared contract.

## Implementation Details

The constructor initializes shared mutable state that every subclass instance relies on:
- `sessionCache` (a `Map`) and `cacheTimestamps` (a `Map`) for caching session data with expiration tracking.
- `watchers` (a `Set`) to track active watch callbacks/subscriptions.
- `watchInterval` for polling control.
- Default configuration values: `enableCache: true` and `cacheTimeout: 10000` (ms).

The concrete `watchTranscripts(callback, options)` method implements a polling loop via `setInterval` (default interval 1000ms). On each tick, it invokes the subclass-implemented `getCurrentSession()`, compares the returned `session.entries` length against a tracked `lastEntryCount`, and invokes the callback when new entries are detected. This is a **diff-based change detection** strategy rather than event-driven push notification — simple, dependency-free, but inherently polling-based.

The four abstract methods form the minimal required surface: `getAgentType()` (identity), `readTranscripts()` (raw retrieval), `convertToLSL()` (format transformation, presumably delegating to LSLConverter), and `getCurrentSession()` (live session state, consumed internally by `watchTranscripts`).

## Integration Points

This abstract contract is the structural parent of agent-specific adapters, and its parent component TranscriptAdapterAPI relies on it to guarantee a uniform interface across agents. Sibling components illustrate what concrete implementations look like in practice: ClaudeParser's `getTranscriptDirectory()` resolves Claude-specific paths under `~/.claude/projects`, and CopilotParser's `getLogDirectory()` resolves logs via `options.logDir`, `COPI_LOG_DIR`, or a fallback path. These are the kinds of directory/source-resolution details that subclasses would use internally when implementing `readTranscripts()`.

The `convertToLSL()` abstract method implies an integration boundary with LSLConverter, whose `toMarkdown(session)` method renders session headers and per-entry content — suggesting `convertToLSL()` implementations likely produce a session structure consumed downstream by LSLConverter.

## Usage Guidelines

Developers must never instantiate `TranscriptAdapter` directly — doing so throws immediately by design. Instead, create subclasses that implement all four abstract methods (`getAgentType`, `readTranscripts`, `convertToLSL`, `getCurrentSession`); omitting any will surface a clear runtime error identifying the gap. When using `watchTranscripts`, be aware it relies on polling (default 1000ms) and a naive entry-count diff, so it is best suited for append-only transcript growth rather than detecting edits or deletions. Subclasses should also respect the shared caching fields (`sessionCache`, `cacheTimestamps`, `enableCache`, `cacheTimeout`) rather than reimplementing their own caching, to preserve consistent behavior across adapters like the ones ClaudeParser and CopilotParser support.


## Hierarchy Context

### Parent
- [TranscriptAdapterAPI](./TranscriptAdapterAPI.md) -- TranscriptAdapter is an abstract base class in transcript-api.js that throws on direct instantiation via `new.target === TranscriptAdapter` check, forcing agent-specific subclasses to implement getAgentType, readTranscripts, convertToLSL, getCurrentSession

### Siblings
- [ClaudeParser](./ClaudeParser.md) -- getTranscriptDirectory() computes Claude's directory naming convention: `-${project.replace(/[^a-zA-Z0-9]/g, '-')}` under path.join(os.homedir(), '.claude', 'projects').
- [CopilotParser](./CopilotParser.md) -- getLogDirectory() resolves log location via options.logDir, then COPI_LOG_DIR env var, falling back to path.join(codingPath, 'integrations', 'copi', 'logs').
- [LSLConverter](./LSLConverter.md) -- toMarkdown(session) builds a header block (Agent, Session ID, Project, Started/Ended, Time Window) followed by per-entry rendering via entryToMarkdown().


---

*Generated from 4 observations*
