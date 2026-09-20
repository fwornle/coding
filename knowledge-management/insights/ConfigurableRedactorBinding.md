# ConfigurableRedactorBinding

**Type:** Detail

[LLM] Redaction coverage is demonstrably non-uniform across the three LSL producer paths visible in these files. ObservationWriter.js is the only one that imports and presumably applies `ConfigurableRedactor`. In contrast, lib/lsl/token/opencode-token-rows.mjs's `buildOpencodeTokenRows()` builds `prompt_preview` via `activityFor(rec.id)` → `summarizeParts(parsed)`, which truncates to 240 chars via `snip()` but performs no redaction — the file's imports (`ADAPTER_USER_HASH_OPENCODE`, `DIRECT_ROUTING_SOURCE` from `./token-db.mjs`, plus `better-sqlite3`) contain no reference to any redactor. Similarly, lib/lsl/live/copilot-events-tail.mjs's `buildStubObservation()` embeds `agentDescription.slice(0, 200)` directly into both `summary` and the assistant message `content` field with no redaction call in the visible function body. Since `prompt_preview` and stub-observation content both persist free-text potentially containing file paths, commands, or pasted content, this is a genuine asymmetric-coverage risk: length-capping is not redaction, and two of three producer paths only length-cap.

# ConfigurableRedactorBinding — Technical Insight Document

## What It Is

ConfigurableRedactorBinding refers to the coupling mechanism by which `src/live-logging/ObservationWriter.js` binds redaction behavior into its write path — specifically through the static import `import ConfigurableRedactor from './ConfigurableRedactor.js'` (line 34) and the constructor-time resolution of `this.dbPath`, which is explicitly documented as "a config path, NOT a handle" used to "derive `projectRoot` for the redactor" (lines 33-38). Despite this documentation, no method body in the visible excerpt actually performs the derivation or invokes `ConfigurableRedactor`. This makes the binding a documented contract rather than a demonstrably executed one — the entity captures both the intended architecture and the gap between intent and visible implementation.

As a child of RedactionConfigManager, ConfigurableRedactorBinding represents the concrete, single-writer manifestation of a policy that RedactionConfigManager is meant to govern globally, but which in practice is instantiated ad hoc inside ObservationWriter's constructor rather than injected as an independent, testable dependency.

## Architecture and Design

The dominant pattern is **constructor-time dependency binding**: both the redactor and the km-core store (`GraphKMStore`) are resolved once at construction, not re-checked per write, mirroring the "validate once at startup, trust thereafter" philosophy the parent context attributes to redaction generally. This mirrors other lazy-once-then-cache patterns visible in the same file — the anchor-edge cache (`_anchorId`, `_anchorResolveAttempted`) and the per-construction `_runId` generation — suggesting redaction initialization likely follows the same shape (construct in `init()`, never re-check), even though the redactor's own init code isn't shown.

Critically, this binding is **not uniform** across the system. ObservationWriter is the only one of three LSL producer paths that visibly imports `ConfigurableRedactor`. `lib/lsl/token/opencode-token-rows.mjs` (`buildOpencodeTokenRows()`, `summarizeParts()`, `snip()`) and `lib/lsl/live/copilot-events-tail.mjs` (`buildStubObservation()`) rely solely on length-capping (240 and 200 chars respectively) — a proxy for content safety, not actual redaction. This produces an asymmetric-coverage architecture where the same conceptual guarantee ("PII/secrets won't leak into persisted logs") is enforced in one place and merely approximated elsewhere.

Compounding this, the two write paths — ObservationWriter's km-core/`GraphKMStore` (LevelDB-backed, via `legacyObservationToEntity`/`legacyDigestToEntity`/`legacyInsightToEntity` adapters) and `token-db.mjs`'s direct `better-sqlite3` INSERT into `token-usage.db` — are structurally decoupled with no shared write-interception layer. Any centralized RedactionConfigManager policy must therefore be wired into each backend independently.

## Implementation Details

`insertTokenRow()` in `token-db.mjs` is documented as best-effort and non-throwing (D-08: "a locked DB / malformed row NEVER throws"), and its `text()`/`num()` helpers only null-coalesce (`undefined`/`null` → `''`) — they perform zero content scanning. This means the DB-layer insert boundary used by all three per-agent adapters (`ADAPTER_USER_HASH_CLAUDE`, `ADAPTER_USER_HASH_COPILOT`, `ADAPTER_USER_HASH_OPENCODE`) provides no defense-in-depth; redaction responsibility is pushed entirely upstream to producers like `snip()`.

`copilot-events-tail.mjs`'s `buildStubObservation()` illustrates a degraded-parity case: because sub-agent messages are never persisted to `events.jsonl`, the function synthesizes content from lifecycle metadata only (`agentName`, `agentDescription`, `started_at`, `completed_at`). It embeds `agentDescription.slice(0, 200)` verbatim into both `summary` and message `content` — length-capped but not content-filtered — meaning even this narrower surface still depends on whatever redaction stage exists downstream in ObservationWriter's write path.

By contrast, ObservationWriter enforces a hard throw for `retentionDays < 1` (lines 186-198, per `.planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/CONTEXT.md`), showing that numeric config (retentionDays, userHashLength) receives construction-time validation that redaction config conspicuously lacks — an asymmetry within the same class between two categories of configuration.

## Integration Points

ConfigurableRedactorBinding integrates upward with RedactionConfigManager (parent), which supplies the conceptual policy but has no dedicated class visible in the codebase — its effects are only observable through ObservationWriter's import and `dbPath`-derived `projectRoot`. Sibling producer paths (`opencode-token-rows.mjs`, `copilot-events-tail.mjs`) are notable for their *lack* of integration with this binding, relying instead on `snip()`/`slice()` truncation. Downstream, ObservationWriter's redacted (in theory) output flows through `@fwornle/km-core`'s `legacy*ToEntity` adapters into `GraphKMStore`, entirely separate from the `token-db.mjs` → `token-usage.db` path consumed by proxy-owned dashboards.

## Usage Guidelines

Developers extending or auditing this binding should treat the `ConfigurableRedactor` import in ObservationWriter as necessary but not sufficient — verify at call sites that `dbPath`/`projectRoot` derivation actually occurs, especially when callers override related paths (e.g., passing `kmStoreDbPath` without an equivalent `dbPath`), since this is exactly the kind of override that silently breaks the redaction contract. Any change to redaction policy must be applied to all three producer paths, not just ObservationWriter, and must additionally consider hardening `token-db.mjs`'s `insertTokenRow()` and `text()`/`num()` helpers, since they currently offer no content-safety fallback. Given the absence of a construction-time validation guard for redaction config (unlike `retentionDays`), adding an explicit fail-fast check should be considered a priority maintainability improvement.


## Hierarchy Context

### Parent
- [RedactionConfigManager](./RedactionConfigManager.md) -- [LLM] RedactionConfigManager's actual configuration surface is not visible as a dedicated class in the supplied code files, but its effects are wired directly into the observation-writing hot path: src/live-logging/ObservationWriter.js imports `ConfigurableRedactor` from './ConfigurableRedactor.js' at the top of the module (alongside `getLSLWindow` from lib/lsl/window.mjs and `routeFromArtifacts` from lib/attribution/repo-router.mjs), and the class retains `this.dbPath` specifically as 'a config path, NOT a handle' used to derive `projectRoot` for the redactor. This means redaction configuration resolution is coupled to the writer's constructor-time path setup rather than being an independently injectable dependency, so any consumer of ObservationWriter inherits whatever redaction behavior ConfigurableRedactor derives from that project-relative path.


---

*Generated from 10 observations*
