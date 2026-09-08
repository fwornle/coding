# LoggingConfigSchema

**Type:** Detail

The '_notes' block documents that backend code must import createLogger from '../lib/logging/Logger.js' while frontend code imports Logger from '../utils/logging/Logger', indicating two parallel logger implementations share this one config file

# LoggingConfigSchema: Technical Insight Document

## What It Is

LoggingConfigSchema is the JSON configuration schema backing the logging system, physically embodied in `config/logging-config.json` and consumed by `Logger.js` through its `loadConfig()` function. It is not a code class but a structural contract defining the shape of configuration data that governs logging behavior across both backend and frontend codebases. As a child entity of **BackendLoggerCore**, it represents the declarative counterpart to that component's imperative config-loading logic.

The schema is organized around three top-level concerns: global defaults (`level`, `console`, `file`, `filePath`, `colors`, `timestamp`), per-subsystem overrides (`categories`), and per-environment overrides (`environments`), plus a documentation block (`_notes`) that encodes cross-cutting architectural constraints directly into the config file itself.

## Architecture and Design

The schema follows a **layered override pattern**: global defaults are established at the top level, then selectively overridden by `categories` (subsystem-scoped) and `environments` (deployment-context-scoped) blocks. This allows a single config file to answer "what level should the `database` category log at in `production`?" through layered resolution rather than duplicated per-combination entries. For example, `database` defaults to `'warn'` instead of `'info'`, while `environments.production` separately disables colors — these two override axes are orthogonal and compose independently.

The `categories` object enumerates known subsystems explicitly (health, billing, transcript, knowledge, workflow, database, api, mcp), which signals a **fixed, enumerated subsystem model** rather than an open/dynamic registration scheme — new subsystems require explicit schema updates.

The `environments` block encodes environment-specific operational tuning: development enables file output plus debug-level verbosity (favoring diagnostic richness), production disables colors (appropriate for non-TTY log aggregation), and test disables console output while raising the level to warn (reducing test-run noise). This reflects a deliberate design trade-off between developer ergonomics and production/test cleanliness, all driven from one schema rather than separate config files per environment.

Notably, the schema's `_notes` block is itself an architectural artifact — embedding documentation and constraint references (`_notes.constraints`) inside the config demonstrates a **config-as-documentation** pattern, ensuring the coupling between config, code, and lint enforcement is discoverable directly from the data file.

## Implementation Details

`Logger.js` (BackendLoggerCore) loads `logging-config.json` once via `loadConfig()`, caching the parsed result in a module-level `sharedConfig` variable — a singleton/memoization pattern that avoids redundant file I/O and ensures consistent config state across all loggers created within a process. A `reloadConfig()` function is exposed to force cache invalidation and re-read, supporting scenarios like config hot-reloading or test isolation.

The schema itself has no executable logic; it is consumed and interpreted entirely by the logger implementation(s) that read it. The `_notes` block explicitly documents that **two parallel logger implementations** exist and both share this single config file: backend code imports `createLogger` from `../lib/logging/Logger.js`, while frontend code imports `Logger` from `../utils/logging/Logger`. This is a significant structural insight — the schema acts as a shared contract unifying otherwise-separate backend/frontend logging code paths.

## Integration Points

The primary integration point is **BackendLoggerCore** (Logger.js), which is the direct parent/consumer of this schema — it calls `loadConfig()` to hydrate `sharedConfig` at startup and exposes `reloadConfig()` for refresh semantics. The sibling entity **CreateLoggerFactory** builds on top of this loaded config: consumers such as `lib/agent-api/transcript-api.js` call `createLogger('transcript-api')` to obtain a module-scoped logger, which internally relies on the category/environment resolution defined by this schema (e.g., a logger created for `transcript-api` would resolve against the `transcript` category if mapped, or fall back to global defaults).

Beyond Logger.js, the schema's `_notes.constraints` explicitly ties it to `constraints.yaml`'s enforced lint rules (`no-console-log`, `no-console-error`, `no-console-warn`). This creates a system-wide integration point: **all logging output, regardless of subsystem, must flow through the configured logger** rather than raw `console.*` calls, making this schema an indirect gatekeeper for a lint-enforced coding standard.

The dual-import pattern (`../lib/logging/Logger.js` for backend vs. `../utils/logging/Logger` for frontend) means the schema must remain generic enough to satisfy two independent implementations, constraining future schema changes to stay implementation-agnostic.

## Usage Guidelines

Developers should treat `logging-config.json` as the single source of truth for logging behavior and avoid hardcoding levels or output targets in application code. New subsystems needing category-specific log levels must be added explicitly to the `categories` object — the enumerated list (health, billing, transcript, knowledge, workflow, database, api, mcp) suggests contributions should follow this naming convention.

Because both backend and frontend loggers consume this same schema, any structural change (e.g., renaming a key or adding a new environment) must be validated against both `Logger.js` implementations to avoid silent divergence. When creating loggers, prefer the established factory pattern (`createLogger('module-name')`, per **CreateLoggerFactory**) rather than instantiating logging logic directly, and rely on `reloadConfig()` only when genuine runtime config refresh is needed, since `sharedConfig` is cached for performance.

Finally, since lint rules in `constraints.yaml` forbid raw `console.log/error/warn` calls, all new code must route through the configured logger — this is a hard constraint, not merely a convention, and should be enforced in code review.


## Hierarchy Context

### Parent
- [BackendLoggerCore](./BackendLoggerCore.md) -- Logger.js loads config/logging-config.json once via loadConfig(), caching it in module-level sharedConfig and exposing reloadConfig() to force a refresh

### Siblings
- [CreateLoggerFactory](./CreateLoggerFactory.md) -- Consumers such as lib/agent-api/transcript-api.js call `const logger = createLogger('transcript-api')` to get a module-scoped logger


---

*Generated from 5 observations*
