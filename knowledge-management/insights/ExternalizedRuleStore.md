# ExternalizedRuleStore

**Type:** Detail

Because the YAML is the only rule source and an invalid file causes LSLConfigValidator to block all persistence, the file carries operational risk disproportionate to its size: a syntax error or schema violation in redaction-config.yaml becomes a full system outage vector.

# ExternalizedRuleStore

## What It Is

The ExternalizedRuleStore is the configuration artifact located at `.specstory/config/redaction-config.yaml`. It is not a runtime service or a class, but a declarative YAML file that serves as the **sole source of truth** for all pattern-match and keyword-based redaction rules consumed by its parent component, RedactionEngine. By externalizing rules into this single file rather than embedding them in code, the system separates rule authorship from binary releases — rule changes flow through configuration management rather than through the software delivery pipeline.

Functionally, the ExternalizedRuleStore is the input side of a configuration-driven redaction subsystem. The RedactionEngine reads the file, parses it, and applies its rules to data flowing through the engine. Because the file is referenced by an explicit, fixed path under the `.specstory/config/` directory, its location is conventional and discoverable — operators and developers know exactly where to look when investigating or modifying redaction behavior.

The "ExternalizedRuleStore" name captures the key architectural intent: rules are *externalized* — pulled out of the codebase — and stored in a managed, human-editable form. This makes redaction policy a first-class operational concern rather than an engineering one.

## Architecture and Design

The design follows the classic **externalized configuration pattern**: behavior that is expected to change at a different cadence than code is moved out of source files and into a separate, declarative artifact. In this case, redaction rules — which often evolve in response to compliance requirements, new sensitive data classes, or incident response — live in `.specstory/config/redaction-config.yaml` rather than in Go/Python/etc. source files. The parent RedactionEngine consumes this file as data rather than embedding logic, achieving a clean separation between *mechanism* (the engine) and *policy* (the rules).

A second pattern visible in the design is the **validated-config gateway**: the ExternalizedRuleStore does not flow directly into the engine's active rule set. Its sibling component, LSLConfigValidator, sits between the parsed YAML and the engine's active state as a mandatory pipeline stage. The L2 parent description makes this explicit — LSLConfigValidator must approve a parsed redaction-config.yaml before its rules become active. This is not an optional sanity check; it is a hard gate. If LSLConfigValidator rejects the file, the rules do not load, and (per the parent description) all persistence can be blocked downstream.

The result is a two-stage configuration flow: the ExternalizedRuleStore provides declarative content, and the LSLConfigValidator enforces structural and semantic correctness before that content takes effect. The RedactionEngine itself remains agnostic to file format and parsing details — its dependency is on the validated rule set, not on the YAML file directly.

## Implementation Details

The implementation centers on a single file at the fixed path `.specstory/config/redaction-config.yaml`. The YAML format is chosen for human editability and for its native support of structured constructs (lists of patterns, keyed keyword groups) that map cleanly to redaction-rule semantics. The file content is read and applied dynamically rather than compiled into the binary — the parent RedactionEngine description explicitly notes that redaction behavior can be changed "without code deployment," which implies the file is loaded at process startup or on a configuration reload event.

The rules themselves fall into two categories established by the parent component: **pattern-match rules** (e.g., regex-style patterns matching things like credit card numbers, tokens, or identifiers) and **keyword-based rules** (literal strings or term lists that should be redacted on appearance). Both categories are expressed declaratively in the YAML, allowing rule authors to extend either dimension without engineering involvement.

Because the YAML is parsed and then handed to LSLConfigValidator before activation, the schema implicit in the file is enforced at validation time, not at runtime. This means parsing errors (malformed YAML) and schema violations (missing required fields, invalid pattern syntax, unknown rule types) are both surfaced before any redaction logic executes against the new ruleset. The file itself contains no executable code — only data — which constrains the surface area an attacker or careless editor can affect through it.

## Integration Points

The ExternalizedRuleStore has two direct integration relationships within its containing hierarchy. First, it is *contained by* RedactionEngine: the engine is the consumer that reads the file and uses its rules to drive redaction operations. Second, it is *gated by* its sibling LSLConfigValidator, which validates the parsed contents before they become active in the engine. These two relationships together define the file's entire integration surface within the documented architecture.

The downstream impact extends beyond the engine itself. Per the parent description, an invalid configuration that LSLConfigValidator rejects can block all persistence — meaning the ExternalizedRuleStore is not just an input to redaction, but a *prerequisite* for data flow through the system. This makes the file a critical coupling point: components that have no direct knowledge of redaction rules (persistence layers, write paths) nonetheless depend on the ExternalizedRuleStore being in a valid state for their own operations to proceed.

This creates an operational risk profile disproportionate to the file's apparent simplicity. A single trailing-colon typo, indentation slip, or unknown field name in `.specstory/config/redaction-config.yaml` can — through LSLConfigValidator's hard rejection — become a full system outage vector. The file is small, but its blast radius is large.

## Usage Guidelines

Developers and operators editing `.specstory/config/redaction-config.yaml` should treat it with the same rigor as production code, despite its data-only nature. The single most important guideline is to **validate before deploying**: any change to the file should be run through LSLConfigValidator (or an equivalent local check) before being committed to a path where the live RedactionEngine will pick it up. Because LSLConfigValidator can block all persistence on rejection, an unvalidated push is an outage waiting to happen.

When adding new rules, prefer extending existing pattern or keyword sections over restructuring the file, since structural changes increase the surface for schema-validation failures. Each new pattern-match or keyword-based entry should be reviewed against the implicit schema enforced by LSLConfigValidator — pattern syntax must parse, required fields must be present, and rule identifiers must be unique where the schema demands it.

Because the ExternalizedRuleStore is the *sole* source of redaction rules, there is no fallback or override mechanism implied by the observations: if a rule is not in this file, it does not exist in the engine. Conversely, any rule added here will be applied broadly to all data flowing through RedactionEngine. This makes the file a centralized policy artifact — appropriate for change-controlled review, version tracking, and audit. Rule changes should be paired with documentation explaining *why* the rule exists, because the file itself carries only the *what*.

Finally, because behavior changes here propagate "without code deployment," the file effectively grants production-impacting capability to anyone who can edit it. Access controls and review processes around `.specstory/config/redaction-config.yaml` should reflect that reality — the same standards applied to deployable code should apply to this configuration.


## Hierarchy Context

### Parent
- [RedactionEngine](./RedactionEngine.md) -- RedactionEngine reads its rule set from .specstory/config/redaction-config.yaml, meaning redaction behavior is fully externalized and can be changed without code deployment, but an invalid config can block all persistence if LSLConfigValidator rejects it

### Siblings
- [LSLConfigValidator](./LSLConfigValidator.md) -- LSLConfigValidator is explicitly named in the L2 parent description as the component that must approve a parsed redaction-config.yaml before its rules become active in the engine — making it a mandatory pipeline stage, not an optional check.


---

*Generated from 3 observations*
