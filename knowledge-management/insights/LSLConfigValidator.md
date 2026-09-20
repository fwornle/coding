# LSLConfigValidator

**Type:** SubComponent

[Architecture Notes] LSLConfigValidator's identity is purely a JS class (validate-lsl-config.js), while LiveLoggingSystem's conceptual/semantic identity is defined declaratively in ontology JSON — these are two separate 'sources of truth' a developer must reconcile; Config validated by LSLConfigValidator (lsl-config.json, redaction-config.yaml) has downstream consumers in entirely different files/subsystems (ConfigurableRedactor.js, lib/lsl/window.mjs) with no shared schema type enforcing the contract between validator and consumer; Per-agent capability differences (e.g., Copilot's degraded lifecycle-only event stream in copilot-events-tail.mjs) exist outside LSLConfigValidator's validation surface — config correctness and agent capability correctness are validated by entirely separate mechanisms; The 6-character truncated-hash identity scheme recurs in two independent places (LSLConfigValidator's userHashLength bound and token-db.mjs's ADAPTER_USER_HASH_* constants / proxy's user_hash charset) without a single shared constant or validator tying them together; Multiple LSL-adjacent writers (ObservationWriter.js, token-db.mjs's insertTokenRow) are built around 'never throw / best-effort' semantics, implying LSLConfigValidator's role is to catch misconfiguration upfront since downstream code is deliberately permissive at runtime

# LSLConfigValidator — Technical Insight Document

## What It Is

`LSLConfigValidator` is implemented as a single JavaScript class in `validate-lsl-config.js`. Notably, this is the *only* entity the code graph confirms for this component — everything else about its internals (constructor behavior, `this.schemas.lslConfig.constraints`, `validateUserEnvironment()`, and its seven-category validation surface covering environment variables, directory structure, redaction config content, user-hash setup, system health, performance, and security) is derived from prior LLM analysis of the file rather than graph-confirmed entities. This is itself an important signal: the graph's coverage of this validator is sparse, and a developer relying purely on graph tooling would see only a class boundary, not its actual validation logic.

Architecturally, LSLConfigValidator sits as a SubComponent beneath LiveLoggingSystem, whose own identity is defined not in code but declaratively in the ontology registry chain (`upper.json` → `coding-ontology.json` → `coding.lower.json`). This creates a notable asymmetry between parent and child: LiveLoggingSystem's semantic identity lives in JSON ontology files, while LSLConfigValidator's identity is a concrete JS class — two different "sources of truth" a developer must reconcile depending on whether they're reasoning about classification/ontology or runtime validation behavior.

![LSLConfigValidator — Architecture](images/lslconfig-validator-architecture.png)

## Architecture and Design

The defining architectural feature of LSLConfigValidator is its **category-based validation design**: rather than a monolithic check, validation is split into separable units (environment, directory structure, redaction config, user hash, health, performance, security). This matters because each category maps to a distinct downstream consumer elsewhere in the codebase, making the validator's structure load-bearing rather than cosmetic — a failure in one category has a traceable, specific blast radius rather than a generic "config broken" signal.

This category split also mirrors a recurring **defensive boundary-validation** house style visible across sibling subsystems: `token-db.mjs`'s `insertTokenRow` uses parameterized `?` SQL placeholders against injection, `opencode-token-rows.mjs`'s `ownedDbPath` and `copilot-events-tail.mjs`'s `isOwnedByMe` perform uid-ownership gating before trusting a file path, and LiveLoggingSystem's L2 classification uses token-boundary regex matching to guard against hallucinated substring matches. LSLConfigValidator's numeric bounds-checking on `lsl-config.json` is the same defensive posture applied to configuration inputs rather than runtime data or file paths — validate narrow, purpose-built gates immediately before consumption, rather than trusting inputs at face value.

A key design boundary: LSLConfigValidator verifies that *configuration* is well-formed and safe, but it structurally cannot verify that a given agent's underlying event stream satisfies the logging contract that configuration describes. This is illustrated by `lib/lsl/live/copilot-events-tail.mjs`'s "DEGRADED LSL PARITY" condition (`lsl_incomplete: true`), where Copilot CLI only emits lifecycle bookend events, never full transcript content — a capability gap entirely outside any of the validator's seven categories.

## Implementation Details

The validator's most consequential numeric guardrail is `userHashLength` (6–12 characters), which polices the format that the **anonymized multi-user hashing** scheme depends on structurally. This 6-character truncated-hash identity scheme recurs independently in `token-db.mjs`, where `ADAPTER_USER_HASH_CLAUDE = 'cladpt'`, `ADAPTER_USER_HASH_COPILOT = 'copadt'`, and `ADAPTER_USER_HASH_OPENCODE = 'opnadt'` are each 6-character strings matching the proxy's `/^[a-z][a-z0-9]{5}$/` charset, used as part of the `token_usage` table's composite `(user_hash, id)` primary key. If LSLConfigValidator's bounds were loosened or violated, a `user_hash` could silently collide with or fall outside the charset that SQLite schema and id-allocation logic (`NEXT_ID_SQL`, `insertTokenRow`) assume — a cross-file invariant the validator protects without any shared constant tying the two together.

Similarly, the 'redaction config content' validation category is designed to check `.specstory/config/redaction-config.yaml` before the system runs, in anticipation of `ObservationWriter.js`'s `init()`, which imports and instantiates `ConfigurableRedactor` as the concrete consumer of that YAML. And the 'directory structure' / 'system health' categories anticipate `ObservationWriter.js`'s import of `getLSLWindow` from `lib/lsl/window.mjs`, used for session windowing (grouping related conversation turns) — if the assumed `.specstory` layout is wrong, every windowed observation write is affected.

## Integration Points

![LSLConfigValidator — Relationship](images/lslconfig-validator-relationship.png)

LSLConfigValidator is contained within LiveLoggingSystem and functions as an upfront gatekeeper for configuration consumed by several sibling subcomponents, though notably with **no shared schema type or code-level coupling** — each relationship is implicit:

- **RedactionConfigManager** and `ObservationWriter.js`'s `ConfigurableRedactor` independently assume the same shape for `redaction-config.yaml` that LSLConfigValidator checks; schema drift on either side would pass validation yet break redaction, or vice versa.
- **MultiUserHashManager**'s `ADAPTER_USER_HASH_*` constants in `token-db.mjs` depend on the same 6-character charset convention that LSLConfigValidator's `userHashLength` bound polices, again without a shared constant.
- **LiveTranscriptWatchers** (Copilot's polled tail vs. OpenCode's pull-based SQLite reader) and **TokenUsageAdapters** operate as "second writer" / best-effort compensation subsystems that never throw on failure — this reinforces that LSLConfigValidator's role is to catch misconfiguration *upfront*, precisely because downstream code (`insertTokenRow`, `ObservationWriter`) is deliberately permissive at runtime and won't surface config errors on its own.
- **ObservationWriter**, the concrete class importing both `ConfigurableRedactor` and `getLSLWindow`, is the primary practical consumer whose correct operation depends on LSLConfigValidator having passed.

## Usage Guidelines

Developers should treat LSLConfigValidator as the single upfront checkpoint for `lsl-config.json` and `redaction-config.yaml` correctness, since downstream writers (`ObservationWriter.js`, `token-db.mjs`'s `insertTokenRow`) are intentionally fail-silent and will not surface misconfiguration themselves. Any change to the `userHashLength` bound (6–12 chars) must be cross-checked against `token-db.mjs`'s `ADAPTER_USER_HASH_*` constants and the proxy's user_hash charset, since no shared constant enforces this alignment today. Likewise, any change to the redaction config schema must be mirrored manually in both LSLConfigValidator's validation logic and `ConfigurableRedactor.js`'s parsing expectations. Finally, developers should not expect LSLConfigValidator to catch agent-specific capability gaps (like Copilot's degraded lifecycle-only event stream) — that is a distinct concern validated nowhere in this component and would require separate agent-capability checks alongside the ontology-driven identity of LiveLoggingSystem itself.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- LSLConfigValidator (class) in validate-lsl-config.js

**Other:**
- The code graph confirms exactly one concrete entity for this component: the `LSLConfigValidator` class in `validate-lsl-config.js`. Everything else describing its internals (constructor logic, `this.schemas.lslConfig.constraints`, `validateUserEnvironment()`) comes from prior LLM analysis of that file rather than from entities present in the graph itself, which is a useful signal about how sparse the graph's coverage of this validator currently is — a developer relying solely on the graph to understand LSLConfigValidator would see only the class boundary, not its validation categories or numeric guardrails.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] LiveLoggingSystem's identity within the Coding ontology is defined declaratively rather than through code inheritance: it is registered as an L2 class in .data/ontologies/coding.lower.json, extending the 'Component' L1 carrier that is itself one of three L1 carriers (Component/SubComponent/Detail) shared across all L2 subsystems. This means a new developer looking for a 'LiveLoggingSystem class' in the traditional OOP sense will not find one directly — instead, the concept is materialized through the ontology registry chain (upper.json → coding-ontology.json → coding.lower.json), loaded at runtime by OntologyRegistry from the @fwornle/km-core package. Any change to LiveLoggingSystem's semantic definition, description text used for classification, or its relationship to sibling classes must be made in these JSON ontology files, not in TypeScript source.

### Siblings
- [RedactionConfigManager](./RedactionConfigManager.md) -- [LLM] RedactionConfigManager's actual configuration surface is not visible as a dedicated class in the supplied code files, but its effects are wired directly into the observation-writing hot path: src/live-logging/ObservationWriter.js imports `ConfigurableRedactor` from './ConfigurableRedactor.js' at the top of the module (alongside `getLSLWindow` from lib/lsl/window.mjs and `routeFromArtifacts` from lib/attribution/repo-router.mjs), and the class retains `this.dbPath` specifically as 'a config path, NOT a handle' used to derive `projectRoot` for the redactor. This means redaction configuration resolution is coupled to the writer's constructor-time path setup rather than being an independently injectable dependency, so any consumer of ObservationWriter inherits whatever redaction behavior ConfigurableRedactor derives from that project-relative path.
- [MultiUserHashManager](./MultiUserHashManager.md) -- [LLM] Multi-user isolation in the live-logging/token subsystem is implemented via distinct per-adapter hash constants rather than a single shared user identity: lib/lsl/token/token-db.mjs defines ADAPTER_USER_HASH_CLAUDE ('cladpt'), ADAPTER_USER_HASH_COPILOT ('copadt'), and ADAPTER_USER_HASH_OPENCODE ('opnadt'), each conforming to the proxy's `/^[a-z][a-z0-9]{5}$/` charset validation (referenced in the comment at token-usage.ts:46-47). This design (documented as decision D-06 'id-collision avoidance') deliberately partitions the id space so that `insertTokenRow`'s `MAX(id)+1` allocation per adapter hash never races the proxy daemon's own in-memory id counter — a form of manual sharding of a shared SQLite composite primary key `(user_hash, id)` across multiple concurrent writers (the proxy plus up to three adapters).
- [LiveTranscriptWatchers](./LiveTranscriptWatchers.md) -- [LLM] The 'LiveTranscriptWatchers' subcomponent is realized across two structurally different watcher implementations that share no code: lib/lsl/live/copilot-events-tail.mjs implements a polled file-tail (statSync + interval polling at TAIL_POLL_INTERVAL_MS=200ms) against ~/.copilot/session-state/<uuid>/events.jsonl, while the OpenCode side (lib/lsl/token/opencode-token-rows.mjs) is not a live tail at all but a pull-based SQLite reader against ~/.local/share/opencode/opencode.db invoked at measurement-stop rather than continuously. This means 'watcher' is a loose term covering two very different consistency models — push-like polling for Copilot vs on-demand snapshot query for OpenCode — and a developer extending live transcript capture to a third agent must first decide which model fits that agent's on-disk artifact shape rather than assuming a single reusable watcher abstraction exists.
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] The TokenUsageAdapters component solves a specific asymmetry in the Coding project's LLM accounting: the rapid-llm-proxy at :12435 is the primary source of truth for token_usage.db, but three foreground agents (Claude Code, Copilot CLI, OpenCode) each have paths where calls bypass the proxy entirely. lib/lsl/token/copilot-events-tail.mjs, lib/lsl/token/opencode-token-rows.mjs, and lib/lsl/token/token-db.mjs form a 'second writer' subsystem that reconstructs token rows after the fact from each agent's own persistence layer (Copilot's events.jsonl, OpenCode's SQLite opencode.db) rather than intercepting the network call. This is an inherently lossy, best-effort compensation strategy rather than a clean instrumentation point — the code repeatedly documents (in token-db.mjs's insertTokenRow docstring) that failures must never propagate, since the adapters are patching a gap in an otherwise-authoritative pipeline.
- [ObservationWriter](./ObservationWriter.md) -- [CGR] ObservationWriter (class) in ObservationWriter.js


---

*Generated from 10 observations*
