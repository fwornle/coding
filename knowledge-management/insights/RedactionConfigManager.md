# RedactionConfigManager

**Type:** SubComponent

# RedactionConfigManager — Technical Insight Document

## What It Is

RedactionConfigManager, as a SubComponent of LiveLoggingSystem, does not exist as a standalone class in the codebase — it is a conceptual/architectural entity whose real implementation is distributed across two concrete artifacts: `ConfigurableRedactor` (imported at `src/live-logging/ObservationWriter.js:37-40`) and its child component, ConfigurableRedactorBinding, which represents the constructor-time wiring between `ObservationWriter`'s `dbPath` and the redactor's runtime behavior. The nominal source of truth for redaction *policy* is `redaction-config.yaml`, described in parent-context observations as living at a fixed, non-configurable path (`configDir = path.join(projectPath, '.specstory', 'config')`) and validated by the sibling component LSLConfigValidator's category-based checks. RedactionConfigManager, then, is best understood as the seam between that validated YAML configuration and its consumption inside the observation-writing hot path — a seam that, per the ConfigurableRedactorBinding observations, is asserted by documentation more than demonstrated by visible code.

## Architecture and Design

The dominant pattern is **constructor-time dependency wiring for a cross-cutting concern**: `ConfigurableRedactor` is derived once when `ObservationWriter` is instantiated, using `this.dbPath` — retained explicitly as "a config path, NOT a handle" — to compute `projectRoot`. This is a deliberate move away from per-field, per-call redaction decisions, centralizing policy at the writer boundary rather than distributing it through every write site.

![RedactionConfigManager — Architecture](images/redaction-config-manager-architecture.png)

This produces a **two-stage architecture**: schema validation happens "offline" via LSLConfigValidator (environment, directory structure, redaction content, user hash, health, performance, security categories), while runtime enforcement happens inside `ObservationWriter` via `ConfigurableRedactor`. Critically, there is no evidence of the writer re-validating or defending against a malformed `redaction-config.yaml` at call time — the system trusts that validation already occurred, a "validate once at startup, trust thereafter" philosophy also visible in the writer's fail-fast `retentionDays < 1` guard.

## Implementation Details

The concrete implementation surface is thin but consequential. `ObservationWriter.js` imports `ConfigurableRedactor` alongside `getLSLWindow` (from `lib/lsl/window.mjs`) and `routeFromArtifacts` (from `lib/attribution/repo-router.mjs`). The class retains `dbPath` purely as a legacy field repurposed post-SQLite-cutover — no SQLite handle exists anymore; all persistence flows through km-core's `GraphKMStore` via `legacyObservationToEntity`/`legacyDigestToEntity`/`legacyInsightToEntity` adapters. This means any redaction-related metadata must survive translation through the legacy-ingest adapter layer to reach the canonical store.

Notably, per the ConfigurableRedactorBinding observations, no method body in the visible excerpt actually performs the `dbPath → projectRoot → ConfigurableRedactor` derivation — the binding is documented, not demonstrated, in the supplied code surface. This is an important caveat: the contract could silently break if a caller overrides `dbPath` without an equivalent adjustment (e.g., a test supplying `kmStoreDbPath` alone).

## Integration Points

RedactionConfigManager's reach is narrower than its name implies. It governs the `ObservationWriter` ingestion path specifically, not the LSL system uniformly. Sibling TokenUsageAdapters — `lib/lsl/token/opencode-token-rows.mjs` (`summarizeParts()`/`snip()`, 240-char cap) and `lib/lsl/token/token-db.mjs` — show no import of `ConfigurableRedactor`, relying instead on length-capping as a lightweight sanitation substitute. Similarly, sibling LiveTranscriptWatchers' `lib/lsl/live/copilot-events-tail.mjs` truncates `agentDescription` to 200 characters in `buildStubObservation()` but never routes content through redaction. This asymmetry — explicit in ObservationWriter's imports, absent elsewhere — means redaction coverage is not uniform across LSL producers.

![RedactionConfigManager — Relationship](images/redaction-config-manager-relationship.png)

The component also implicitly depends on sibling MultiUserHashManager's namespace isolation (`ADAPTER_USER_HASH_CLAUDE`/`COPILOT`/`OPENCODE`) and coexists with sibling LSLConfigValidator, which validates the YAML file this manager's runtime half consumes — though no direct code-level cross-check between the two stages is visible.

## Usage Guidelines

Developers extending LSL producers should not assume redaction is automatically applied — only content flowing through `ObservationWriter` benefits from `ConfigurableRedactor`. Any new agent adapter (following the Copilot/OpenCode pattern) must explicitly decide whether to route through the writer or implement its own sanitation, mirroring the existing length-capping fallback. When modifying `ObservationWriter`'s constructor, `dbPath` must not be decoupled from `projectRoot` derivation without preserving the redactor binding — this is precisely the kind of implicit contract that breaks silently, risking PII leakage. Finally, since validation (LSLConfigValidator) and consumption (ConfigurableRedactor) are architecturally separate with no runtime cross-check, any change to `redaction-config.yaml`'s schema must be coordinated across both the validator script and the writer's expectations — a coupling risk not enforced by code today.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] LiveLoggingSystem's identity within the Coding ontology is defined declaratively rather than through code inheritance: it is registered as an L2 class in .data/ontologies/coding.lower.json, extending the 'Component' L1 carrier that is itself one of three L1 carriers (Component/SubComponent/Detail) shared across all L2 subsystems. This means a new developer looking for a 'LiveLoggingSystem class' in the traditional OOP sense will not find one directly — instead, the concept is materialized through the ontology registry chain (upper.json → coding-ontology.json → coding.lower.json), loaded at runtime by OntologyRegistry from the @fwornle/km-core package. Any change to LiveLoggingSystem's semantic definition, description text used for classification, or its relationship to sibling classes must be made in these JSON ontology files, not in TypeScript source.

### Children
- [ConfigurableRedactorBinding](./ConfigurableRedactorBinding.md) -- [LLM] The redaction contract is architecturally invisible at the boundary that matters most: src/live-logging/ObservationWriter.js constructs `this.dbPath` in its constructor purely as a string ('.observations/observations.db' default) that is documented as 'a config path, NOT a handle', and the class-level comment states it is 'used to derive `projectRoot` for the redactor' — yet no method body shown in the supplied excerpt actually performs that derivation or invokes `ConfigurableRedactor` with it. This means the binding between the writer's constructor-time path and the redactor's runtime behavior is asserted by documentation rather than demonstrated by code in the visible surface, which is exactly the kind of implicit contract that breaks silently when `dbPath` is overridden by a caller (e.g. a test passing `kmStoreDbPath` without an equivalent `dbPath`) without anyone noticing until PII leaks.

### Siblings
- [LSLConfigValidator](./LSLConfigValidator.md) -- [CGR] LSLConfigValidator (class) in validate-lsl-config.js
- [MultiUserHashManager](./MultiUserHashManager.md) -- [LLM] Multi-user isolation in the live-logging/token subsystem is implemented via distinct per-adapter hash constants rather than a single shared user identity: lib/lsl/token/token-db.mjs defines ADAPTER_USER_HASH_CLAUDE ('cladpt'), ADAPTER_USER_HASH_COPILOT ('copadt'), and ADAPTER_USER_HASH_OPENCODE ('opnadt'), each conforming to the proxy's `/^[a-z][a-z0-9]{5}$/` charset validation (referenced in the comment at token-usage.ts:46-47). This design (documented as decision D-06 'id-collision avoidance') deliberately partitions the id space so that `insertTokenRow`'s `MAX(id)+1` allocation per adapter hash never races the proxy daemon's own in-memory id counter — a form of manual sharding of a shared SQLite composite primary key `(user_hash, id)` across multiple concurrent writers (the proxy plus up to three adapters).
- [LiveTranscriptWatchers](./LiveTranscriptWatchers.md) -- [LLM] The 'LiveTranscriptWatchers' subcomponent is realized across two structurally different watcher implementations that share no code: lib/lsl/live/copilot-events-tail.mjs implements a polled file-tail (statSync + interval polling at TAIL_POLL_INTERVAL_MS=200ms) against ~/.copilot/session-state/<uuid>/events.jsonl, while the OpenCode side (lib/lsl/token/opencode-token-rows.mjs) is not a live tail at all but a pull-based SQLite reader against ~/.local/share/opencode/opencode.db invoked at measurement-stop rather than continuously. This means 'watcher' is a loose term covering two very different consistency models — push-like polling for Copilot vs on-demand snapshot query for OpenCode — and a developer extending live transcript capture to a third agent must first decide which model fits that agent's on-disk artifact shape rather than assuming a single reusable watcher abstraction exists.
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] The TokenUsageAdapters component solves a specific asymmetry in the Coding project's LLM accounting: the rapid-llm-proxy at :12435 is the primary source of truth for token_usage.db, but three foreground agents (Claude Code, Copilot CLI, OpenCode) each have paths where calls bypass the proxy entirely. lib/lsl/token/copilot-events-tail.mjs, lib/lsl/token/opencode-token-rows.mjs, and lib/lsl/token/token-db.mjs form a 'second writer' subsystem that reconstructs token rows after the fact from each agent's own persistence layer (Copilot's events.jsonl, OpenCode's SQLite opencode.db) rather than intercepting the network call. This is an inherently lossy, best-effort compensation strategy rather than a clean instrumentation point — the code repeatedly documents (in token-db.mjs's insertTokenRow docstring) that failures must never propagate, since the adapters are patching a gap in an otherwise-authoritative pipeline.
- [ObservationWriter](./ObservationWriter.md) -- [CGR] ObservationWriter (class) in ObservationWriter.js


---

*Generated from 9 observations*
