# RedactionEngine

**Type:** SubComponent

RedactionEngine reads its rule set from .specstory/config/redaction-config.yaml, meaning redaction behavior is fully externalized and can be changed without code deployment, but an invalid config can block all persistence if LSLConfigValidator rejects it

# RedactionEngine — Technical Insight Document

## What It Is

RedactionEngine is a SubComponent of the LiveLoggingSystem responsible for stripping sensitive data from LSL-format log entries before they are persisted to disk. Its rule set is sourced exclusively from `.specstory/config/redaction-config.yaml`, making it a fully externalized, configuration-driven redaction stage rather than a hard-coded filter. The engine sits in the persistence pipeline immediately after `TranscriptAdapter.convertToLSL()` (defined in `lib/agent-api/transcript-api.js`) and immediately before any file-write or SessionWindowManager routing operation, giving it a single, well-defined position in the data flow.

Structurally, RedactionEngine is composed of two child components that the engine delegates to: LSLConfigValidator, which validates the YAML schema before any rules become active, and ExternalizedRuleStore, which represents the `.specstory/config/redaction-config.yaml` file as the authoritative source of all pattern-match and keyword-based rules. Together these establish a "validate-then-apply" model in which redaction logic and redaction policy are cleanly separated.

![RedactionEngine — Architecture](images/redaction-engine-architecture.png)

## Architecture and Design

The architecture follows a **declarative rules + gating validator** pattern. The ExternalizedRuleStore (the `.specstory/config/redaction-config.yaml` file) holds the declarative pattern definitions — likely regular expressions and keyword lists — while LSLConfigValidator stands between the file and the engine's runtime, gating activation of any rule set that fails schema validation. This means RedactionEngine itself contains no embedded secret patterns; it is a pure execution engine over an external policy. The trade-off is significant: an invalid `redaction-config.yaml` can block the entire persistence pipeline, because rejected rules prevent content from advancing past the validator. This is a deliberate fail-closed design — it is preferable to halt logging than to silently leak sensitive data through a partially-configured rule set.

The engine's placement in the LiveLoggingSystem pipeline is strict and ordered. Upstream, `TranscriptAdapter.convertToLSL()` produces normalized LSL-format records; RedactionEngine operates *only* on this LSL form, not on raw transcript text. As a consequence, redaction patterns must be authored against the LSL schema's field structure rather than free-form conversational strings — a design that makes patterns more precise (they can target specific LSL fields) but also tightly couples the rule store to the LSL schema. Downstream of RedactionEngine, SessionWindowManager — a sibling component — assigns the now-redacted entries to hourly time-window buckets (e.g., `'0800-0900'`) embedded in LSL metadata. Because the window label becomes part of the persisted file identity, any redaction-induced re-write of an entry must produce stable output, or session bucket assignment could drift.

A critical architectural constraint inherited from the parent LiveLoggingSystem is that `TranscriptAdapter.watchTranscripts()` in `lib/agent-api/transcript-api.js` tracks only entry *counts* via an in-memory `lastEntryCount` cursor — not content hashes or timestamps. Since this cursor is reset on every adapter instantiation and not persisted across process restarts, the polling loop will replay all transcript entries from the beginning after a restart. This forces **idempotency** onto RedactionEngine: re-processing the same entry must produce byte-identical redacted output, or the persisted log will diverge between runs.

## Implementation Details

RedactionEngine's runtime mechanics center on three concerns: configuration loading, validation, and deterministic application of rules. The configuration loading step reads from the single canonical file `.specstory/config/redaction-config.yaml`, which the parent L2 description explicitly names as the sole source of truth. The ExternalizedRuleStore child entity encapsulates this file access, ensuring there is no ambient or environment-based rule override path — a single file is the single source.

The LSLConfigValidator child performs schema validation on the parsed YAML and acts as a **mandatory pipeline stage**, not an optional check. Per the parent description, content flows through redaction only *after* the config schema has been validated, which means LSLConfigValidator's verdict directly gates whether RedactionEngine can do its work at all. If validation fails, the redaction stage refuses to pass content through, which in turn blocks persistence — the chain is intentionally tight.

Because RedactionEngine operates on the post-`convertToLSL()` representation, its pattern definitions are field-aware. The YAML format implies declarative entries that bind a pattern (regex or keyword) to one or more LSL fields, rather than a flat blacklist scan over raw text. This makes rule authoring extensible: adding a new secret type (for example, a new cloud-provider token format) requires only an edit to `redaction-config.yaml`, with no engine-code change and no deployment.

Idempotency is enforced implicitly by the design — there is no caching or "already-redacted" marker. Instead, every rule must be a deterministic function of input, and patterns must not depend on processing order, timestamps, or external state. This invariant is a direct downstream consequence of `watchTranscripts()` count-based replay behavior.

![RedactionEngine — Relationship](images/redaction-engine-relationship.png)

## Integration Points

RedactionEngine integrates with three classes of neighbors. **Upstream**, it depends on the output contract of `TranscriptAdapter.convertToLSL()`, one of the five abstract methods (alongside `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, and `getCurrentSession()`) declared by the TranscriptAdapterBase sibling in `lib/agent-api/transcript-api.js`. Every concrete adapter — for Claude Code, Copilot CLI, and any future agent integration — must produce LSL records that RedactionEngine's field-targeted patterns can match. The LSL schema thus becomes a shared contract between TranscriptAdapterBase implementations and the RedactionEngine rule store.

**Downstream**, RedactionEngine feeds the SessionWindowManager sibling, which handles hourly bucket assignment, and the file-write step that materializes LSL entries to disk. Because SessionWindowManager embeds the window label into the persisted file's identity, RedactionEngine must complete its work before bucket routing — there is no opportunity to re-redact after persistence without invalidating the bucket assignment.

**Internally**, RedactionEngine depends on its two children: LSLConfigValidator (gating validator) and ExternalizedRuleStore (the `.specstory/config/redaction-config.yaml` file). These children are not optional — LSLConfigValidator is described in the parent L2 documentation as the component that "must approve" a parsed config before its rules become active, making it a mandatory pipeline stage rather than a passive checker.

## Usage Guidelines

Developers extending or operating RedactionEngine should treat `.specstory/config/redaction-config.yaml` as production-critical. Because LSLConfigValidator fails closed, any malformed edit — a stray indent, a missing required field, an invalid regex — can halt persistence across the entire LiveLoggingSystem. Validate YAML changes locally against LSLConfigValidator's schema before deploying.

When authoring new redaction rules, express patterns against **LSL fields**, not against assumed conversational text. The engine never sees raw transcript content; it only sees the structured LSL output of `TranscriptAdapter.convertToLSL()`. A rule written as if scanning a chat string will silently fail to match.

Preserve idempotency in every rule. Because the parent's `watchTranscripts()` polling loop tracks only entry counts via `lastEntryCount` (reset on adapter instantiation), restarts cause full replay of transcript entries. Any pattern that depends on a timestamp, a random nonce, or processing order will produce divergent persisted output across restarts and corrupt the log's integrity.

For scalability, the externalized YAML design scales well for *rule count* — adding new secret types is an O(1) configuration change — but rule evaluation cost is borne on every entry before persistence. Authors should keep individual regex patterns bounded and avoid catastrophic backtracking, since RedactionEngine sits on the critical path between LSL conversion and file write. For maintainability, the clean separation between engine logic, validator, and rule store means the engine code itself rarely needs modification; nearly all policy evolution happens in the YAML file, which is the intended extension surface.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The TranscriptAdapter abstract base class in lib/agent-api/transcript-api.js enforces a strict interface contract via five abstract methods: getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession(). Concrete adapters for Claude Code and Copilot CLI must implement all five. The base class itself provides the polling infrastructure via watchTranscripts(), which calls setInterval at a default 1000ms cadence, reads transcripts, compares the new entry count against an in-memory lastEntryCount cursor, and fires all registered callbacks (stored in a Set) only when new entries are detected. This design means the polling loop is entirely stateless with respect to entry content — it tracks only counts, not hashes or timestamps — so any adapter that reorders or replaces existing entries without changing the total count would silently suppress callbacks. New developers should be aware that lastEntryCount is reset only on adapter instantiation, not across process restarts persisted to disk, meaning a restart always replays all entries from the beginning unless the adapter's readTranscripts() implementation itself filters already-processed entries.

### Children
- [LSLConfigValidator](./LSLConfigValidator.md) -- LSLConfigValidator is explicitly named in the L2 parent description as the component that must approve a parsed redaction-config.yaml before its rules become active in the engine — making it a mandatory pipeline stage, not an optional check.
- [ExternalizedRuleStore](./ExternalizedRuleStore.md) -- The parent L2 description explicitly names '.specstory/config/redaction-config.yaml' as the sole source of redaction rules, establishing a single file as the authoritative rule store for all pattern-match and keyword-based redaction.

### Siblings
- [SessionWindowManager](./SessionWindowManager.md) -- SessionWindowManager assigns LSL session entries to hourly time-window buckets (e.g., '0800-0900') that are embedded directly in LSL metadata, meaning the window label becomes part of the persisted file identity rather than a query-time annotation
- [TranscriptAdapterBase](./TranscriptAdapterBase.md) -- TranscriptAdapter in lib/agent-api/transcript-api.js declares five abstract methods — getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession() — that every concrete adapter must implement, providing a single extension point for adding new agent integrations


---

*Generated from 6 observations*
