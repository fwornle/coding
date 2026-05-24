# LSLConfigValidator

**Type:** Detail

Because redaction behavior is described as 'fully externalized' to .specstory/config/redaction-config.yaml, LSLConfigValidator is the sole enforcement point ensuring that externalized changes do not introduce silent data-leakage from misconfigured patterns.

# LSLConfigValidator — Technical Insight Document

## What It Is

LSLConfigValidator is a mandatory validation stage within the RedactionEngine subsystem responsible for approving parsed redaction configuration before any of its rules are permitted to become active in the engine. It operates on the configuration data sourced from `.specstory/config/redaction-config.yaml`, the externalized rule store for the entire redaction pipeline. The validator is not an optional or advisory check — the L2 parent description explicitly designates it as the gatekeeper whose approval is required before redaction rules influence runtime behavior.

Structurally, LSLConfigValidator sits between the configuration-loading step (handled by RedactionConfigLoader, which reads the YAML file from disk) and the rule-application step (performed by PatternMatchRedactor, which executes pattern-match logic against persisted data). This positions it as a narrow chokepoint: every configuration change — whether a corrected typo, an added pattern, or a wholesale rule rewrite — must traverse this validator before any downstream component will honor the changes.

Because no concrete code symbols or key files were surfaced for this component in the available observations, the analysis below is grounded in the architectural role and contract described by the parent RedactionEngine and sibling ExternalizedRuleStore documentation rather than specific implementation symbols.

## Architecture and Design

The architectural pattern at work here is a **validate-then-activate gate** combined with a **fail-closed safety policy**. LSLConfigValidator acts as a contract-enforcement layer between an externally-mutable source of truth (the YAML file managed by ExternalizedRuleStore) and the active rule set in memory. This separation embodies a classic configuration-pipeline pattern: *load → validate → activate*, where validation is non-bypassable.

The design decision to make validator rejection halt the entire persistence layer — described in the parent observation as "block all persistence" — is a deliberate trade-off favoring **data-leak prevention over availability**. Rather than degrading gracefully to a permissive default (which could allow unredacted sensitive data through to storage), the system chooses to stop persisting altogether. This is the defining characteristic of a fail-closed security boundary: the cost of unavailability is accepted to eliminate the cost of silent data exposure.

This places LSLConfigValidator in tension with availability requirements. Because the parent RedactionEngine pulls its rule set from a file that "can be changed without code deployment," the validator effectively becomes the only safeguard against operator error. A malformed YAML edit, an invalid regex, or a structurally incorrect rule entry will not produce a partial degradation — it will produce a complete persistence outage until the configuration is corrected. This is intentional: the alternative would be silent data leakage through misconfigured patterns, which the observations explicitly identify as the failure mode being defended against.

The validator's narrow scope — sitting between RedactionConfigLoader and PatternMatchRedactor — reflects the **single-responsibility principle** applied to a security boundary. It does not load configuration, it does not apply rules; it only judges whether a loaded configuration is fit to be applied.

## Implementation Details

The available observations do not surface concrete code symbols, class definitions, or method signatures for LSLConfigValidator (the code-structure report lists zero symbols and no key files). What can be stated with grounding is the validator's behavioral contract:

- **Input**: a parsed configuration object derived from `.specstory/config/redaction-config.yaml` (produced upstream by RedactionConfigLoader).
- **Output**: either an approval that allows the rules to be activated and consumed by PatternMatchRedactor, or a rejection that signals the engine to block all persistence.
- **Failure semantics**: fail-closed — rejection causes a system-wide halt of the persistence path rather than a fallback to permissive behavior.

The validator therefore must, at minimum, perform schema/structural verification of the YAML-derived configuration and likely some form of pattern integrity check (since "misconfigured patterns" are called out as the specific risk class it mitigates). The precise checks — regex compilability, presence of required rule fields, type constraints — are not enumerated in the observations and should not be invented here. Future inspection of the implementation should populate this section with concrete validation predicates.

## Integration Points

LSLConfigValidator's integration footprint is tightly bounded by its position in the RedactionEngine pipeline:

- **Upstream — RedactionConfigLoader**: provides the parsed YAML configuration. The loader is responsible for I/O and parsing; the validator receives an already-parsed structure and judges its semantic validity. This separation means the validator does not need to handle file-system errors, only structural/semantic ones.
- **Downstream — PatternMatchRedactor**: consumes the validated rule set to perform actual redaction. The validator's approval is a precondition for the redactor receiving any new rules; rejection prevents the redactor from ever seeing the changed configuration.
- **Sibling — ExternalizedRuleStore**: the conceptual peer that owns `.specstory/config/redaction-config.yaml` as the authoritative source of redaction rules. LSLConfigValidator is, in effect, the trust boundary between ExternalizedRuleStore's mutable externalized state and the engine's runtime state. Any edit made to the store is filtered through the validator.
- **Parent — RedactionEngine**: the containing L2 component. The engine delegates configuration trust decisions entirely to LSLConfigValidator and reacts to a rejection by halting persistence. This makes the engine's availability a direct function of the validator's verdicts.

Because redaction behavior is "fully externalized" to the YAML file (per the parent description), LSLConfigValidator is the **sole enforcement point** against silent data-leakage introduced by configuration drift. No other component is described as performing this guardrail role.

## Usage Guidelines

Developers and operators working with the RedactionEngine subsystem should treat LSLConfigValidator's behavior as a **non-negotiable security invariant** and follow these practices:

1. **Validate configuration changes out-of-band before deploying them.** Because rejection halts all persistence, edits to `.specstory/config/redaction-config.yaml` should be tested against the validator in a non-production context before being placed on a production host. Operators editing the YAML directly are one mistake away from a persistence outage.

2. **Do not attempt to bypass or weaken the validator's fail-closed semantics.** The "block all persistence" behavior is the intended safety property, not a bug. Adding a permissive fallback would re-introduce the silent-data-leakage failure mode the validator exists to prevent.

3. **Treat validator rejection as an actionable alert, not a transient error.** Because the validator is deterministic against a given configuration input, a rejection will persist until the configuration is repaired. Monitoring should surface validator rejections immediately and route them to whoever can correct the YAML.

4. **Preserve the narrow-chokepoint architecture.** New redaction features should route their rule-validation logic through LSLConfigValidator rather than introducing parallel validation paths. The single-enforcement-point property is part of what makes the system auditable; multiple validators with potentially divergent semantics would erode that guarantee.

5. **Coordinate with ExternalizedRuleStore conventions.** Since the YAML file is the sole authoritative store, any tooling that generates or mutates redaction rules should produce output that the validator will accept. Generators should ideally embed the same validation logic to catch errors before write.

---

### Summary of Requested Analytical Points

- **Architectural patterns identified**: validate-then-activate configuration gate; fail-closed security boundary; single-responsibility chokepoint between loader and applier.
- **Design decisions and trade-offs**: availability is deliberately sacrificed for data-leak prevention; externalization of rules (no code deploy needed) is paired with mandatory validation to compensate for the increased risk surface.
- **System structure insights**: a clean three-stage pipeline (RedactionConfigLoader → LSLConfigValidator → PatternMatchRedactor) within RedactionEngine, with ExternalizedRuleStore as the file-backed source of truth.
- **Scalability considerations**: validation is a per-configuration-change event, not a per-request event, so throughput is not a concern; latency of validation directly affects how <USER_ID_REDACTED> a rule change can take effect.
- **Maintainability assessment**: the narrow, well-defined role makes the component highly maintainable in principle, but the current observation set surfaces no code symbols or files — concrete maintainability evaluation requires implementation-level inspection that is not yet available.


## Hierarchy Context

### Parent
- [RedactionEngine](./RedactionEngine.md) -- RedactionEngine reads its rule set from .specstory/config/redaction-config.yaml, meaning redaction behavior is fully externalized and can be changed without code deployment, but an invalid config can block all persistence if LSLConfigValidator rejects it

### Siblings
- [ExternalizedRuleStore](./ExternalizedRuleStore.md) -- The parent L2 description explicitly names '.specstory/config/redaction-config.yaml' as the sole source of redaction rules, establishing a single file as the authoritative rule store for all pattern-match and keyword-based redaction.


---

*Generated from 4 observations*
