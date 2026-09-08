# CreateLoggerFactory

**Type:** Detail

lib/agent-api/transcripts/claude-parser.js, copilot-parser.js, and lsl-converter.js each instantiate their own named logger via createLogger, e.g. createLogger('claude-parser'), createLogger('copilot-parser'), createLogger('lsl-converter')

# CreateLoggerFactory: Technical Insight Document

## What It Is

CreateLoggerFactory is a factory function exposed as part of BackendLoggerCore (implemented in Logger.js) that serves as the standard entry point for obtaining named, module-scoped logger instances across the codebase. Rather than modules invoking `console.log` directly or constructing logger objects manually, they call `createLogger(<name>)` to receive a logger instance tagged with an identifying string. This pattern is used consistently across the agent-api and integrations layers, as seen in lib/agent-api/transcript-api.js, the transcript parser modules, and lib/integrations/specstory-adapter.js.

## Architecture and Design

The dominant pattern here is the **Factory Pattern** combined with **named/scoped logging**, a common convention in Node.js backend systems for producing loggers that self-identify their source module in log output. Each consumer supplies a short, human-readable label (e.g., `'transcript-api'`, `'claude-parser'`, `'copilot-parser'`, `'lsl-converter'`, `'specstory'`) that presumably gets embedded in emitted log lines, making it easier to trace behavior back to its originating module without manual string concatenation at each call site.

This factory sits within BackendLoggerCore, which also owns configuration loading responsibilities — Logger.js reads config/logging-config.json once via `loadConfig()`, caches the result in a module-level `sharedConfig`, and exposes `reloadConfig()` for forcing a refresh. This implies CreateLoggerFactory-produced loggers are not independently configured per call; instead, they likely share the single cached configuration object, ensuring uniform behavior (log level, console/file output, timestamp formatting) across all named loggers unless the config is explicitly reloaded.

## Implementation Details

While no internal code symbols for CreateLoggerFactory itself were included in the current observation set, its usage pattern is unambiguous: `createLogger(name)` is called once per module, typically at the top of the file, and the returned logger is bound to a local `logger` variable for reuse throughout that module (e.g., `const logger = createLogger('transcript-api')`). This suggests a lightweight, stateless-per-call factory — each invocation likely constructs (or retrieves) a logger object parameterized by the name string, drawing on the shared configuration cached by the parent BackendLoggerCore's `loadConfig()`/`sharedConfig` mechanism.

The naming convention observed — short, kebab-case identifiers matching the file or module purpose (`claude-parser`, `copilot-parser`, `lsl-converter`, `specstory`) — indicates a lightweight convention rather than an enforced schema, relying on developer discipline for consistency.

## Integration Points

CreateLoggerFactory is the primary integration seam between BackendLoggerCore and the rest of the application. It's consumed by:
- lib/agent-api/transcript-api.js
- lib/agent-api/transcripts/claude-parser.js, copilot-parser.js, and lsl-converter.js
- lib/integrations/specstory-adapter.js

Its behavior is indirectly governed by its sibling entity, LoggingConfigSchema, which defines the top-level configuration keys (`level`, `console`, `file`, `filePath`, `colors`, `timestamp`) consumed when Logger.js loads configuration. Since these settings are loaded once and cached as `sharedConfig`, all loggers produced by CreateLoggerFactory inherit identical baseline behavior, with `reloadConfig()` as the only mechanism to propagate configuration changes at runtime.

## Usage Guidelines

Developers adding new modules should follow the established convention: instantiate a module-scoped logger once via `createLogger('<module-name>')` near the top of the file, rather than calling console methods directly or creating ad hoc logging utilities. The naming string should be short and descriptive of the module's role (mirroring examples like `'claude-parser'` or `'specstory'`) to preserve traceability in log output. Because configuration is cached at the BackendLoggerCore level, changes to config/logging-config.json will not take effect for existing logger instances until `reloadConfig()` is invoked — this should be considered when diagnosing why a config change isn't reflected in running logger behavior.


## Hierarchy Context

### Parent
- [BackendLoggerCore](./BackendLoggerCore.md) -- Logger.js loads config/logging-config.json once via loadConfig(), caching it in module-level sharedConfig and exposing reloadConfig() to force a refresh

### Siblings
- [LoggingConfigSchema](./LoggingConfigSchema.md) -- Top-level keys 'level', 'console', 'file', 'filePath', 'colors', 'timestamp' set the default logging behavior consumed when Logger.js calls loadConfig()


---

*Generated from 3 observations*
