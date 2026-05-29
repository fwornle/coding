# RedactionConfigLoader

**Type:** Detail

The authoritative pattern registry lives at `.specstory/config/redaction-config.yaml`, as established by the RedactionEngine sub-component context; all agent adapters rely on this single config file for consistent sensitive-data definitions.

# RedactionConfigLoader — Technical Insight Document

## What It Is

`RedactionConfigLoader` is a configuration parsing and validation component within the `RedactionEngine`, responsible for reading `.specstory/config/redaction-config.yaml` — the authoritative pattern registry for sensitive data across the entire LiveLoggingSystem. Its primary responsibility is to deserialize that YAML file, validate its schema, and produce structured redaction rules that downstream components can consume reliably.

It sits at the entry point of the `RedactionEngine` pipeline: nothing in the redaction flow operates until `RedactionConfigLoader` has successfully parsed and validated the configuration. All agent adapters that participate in the LiveLoggingSystem depend on the rules this component surfaces.

## Architecture and Design

The design reflects a **single-source-of-truth** principle. Rather than allowing individual agent adapters to define or cache their own sensitive-data patterns, the entire system converges on `.specstory/config/redaction-config.yaml`. `RedactionConfigLoader` is the sole gatekeeper that reads this file, which means changes to what constitutes sensitive data are made in one place and propagate uniformly to all consumers.

Within the `RedactionEngine`, `RedactionConfigLoader` occupies the first stage of a linear pipeline: load → validate → match → sanitize → persist. This ordering is a deliberate design decision — pattern matching and content sanitization steps are never reached unless the configuration has been validated, preventing the system from operating in an undefined or partially-configured state.

The encapsulation of config loading inside `RedactionEngine` (rather than exposing it directly to agent adapters) is a meaningful boundary decision. Agent adapters receive already-structured redaction rules; they are shielded from the mechanics of YAML parsing and schema validation. This reduces coupling and means the config format can evolve without requiring changes across every adapter.

## Implementation Details

`RedactionConfigLoader` performs two distinct operations: **parsing** and **schema validation**. The parsing phase reads `.specstory/config/redaction-config.yaml` and deserializes it into an in-memory representation. The validation phase checks that the deserialized content conforms to the expected schema before any rules are handed off downstream — this is a fail-fast mechanism that surfaces misconfiguration early, before log entries are processed.

The structured output consists of two categories of rules derived from the config: **patterns** (definitions of what constitutes sensitive data) and **replacement strategies** (how matched content should be sanitized). Both are passed into the downstream stages of `RedactionEngine` — pattern matching consumes the patterns, and content sanitization applies the replacement strategies.

No code symbols were available for inspection, so the internal class and function structure cannot be detailed beyond what the observations establish. What is clear is that the component's contract is well-defined: it takes a file path as implicit input and produces validated, structured rules as output.

## Integration Points

`RedactionConfigLoader` integrates with the broader system at two boundaries:

1. **Upstream — the config file**: It has a hard dependency on `.specstory/config/redaction-config.yaml` being present and well-formed. If the file is absent or invalid, the entire `RedactionEngine` pipeline cannot initialize.

2. **Downstream — `RedactionEngine` pipeline stages**: The structured rules it produces flow directly into pattern matching and content sanitization. Agent adapters in the LiveLoggingSystem consume the final sanitized output, but they have no direct interface with `RedactionConfigLoader` itself — that mediation is handled by `RedactionEngine`.

This containment within `RedactionEngine` means `RedactionConfigLoader` has no public surface area to external components; it is an internal implementation detail of its parent.

## Usage Guidelines

Developers modifying sensitive-data definitions should work exclusively in `.specstory/config/redaction-config.yaml`. Because `RedactionConfigLoader` validates schema on load, any structural changes to the config file must remain compatible with the expected schema — breaking schema changes will prevent the `RedactionEngine` from initializing and will block all downstream log persistence.

When introducing new pattern types or replacement strategies, the schema validation logic within `RedactionConfigLoader` should be updated in tandem with the config file to ensure the new fields are recognized and enforced rather than silently ignored.

Because all agent adapters ultimately depend on the rules this component loads, testing changes to `.specstory/config/redaction-config.yaml` should be treated as a system-wide concern, not a local one. A misconfiguration here has blast radius across every adapter in the LiveLoggingSystem.

---

**Architectural Patterns Identified:** Single-source-of-truth configuration registry; linear pipeline with a validated entry gate; encapsulation of infrastructure concerns (YAML parsing, schema validation) behind a parent component boundary.

**Key Design Trade-off:** Centralizing all sensitive-data definitions in one file and one loader simplifies consistency but creates a single point of failure at startup. The fail-fast validation is the mitigation strategy.

**Scalability Consideration:** The current design assumes configuration is loaded at initialization time. If the volume of patterns grows significantly or hot-reloading becomes a requirement, `RedactionConfigLoader` would need to evolve to support incremental or watched reloading without pipeline restarts.

**Maintainability Assessment:** High, given the tight scope — one file in, structured rules out. The primary maintenance risk is schema drift between the YAML file and the validator if they are not updated atomically.


## Hierarchy Context

### Parent
- [RedactionEngine](./RedactionEngine.md) -- RedactionEngine is configured via `.specstory/config/redaction-config.yaml`, which acts as the authoritative pattern registry for what constitutes sensitive data across all agent adapters


---

*Generated from 3 observations*
