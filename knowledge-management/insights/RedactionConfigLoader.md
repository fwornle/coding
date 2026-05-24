# RedactionConfigLoader

**Type:** Detail

The parent analysis references an LSLConfigValidator redactionConfig schema, indicating that RedactionConfigLoader feeds its parsed output through a validation step before any redaction is applied — preventing malformed rules from silently corrupting the pipeline.

# RedactionConfigLoader — Technical Insight Document

## What It Is

RedactionConfigLoader is a configuration loading sub-component that resides within the `RedactionLayer` of the pipeline. Its canonical responsibility is to read and parse the redaction rule definitions stored at `.specstory/config/redaction-config.yaml`, which the L2 sub-component description explicitly designates as the single source of truth for redaction policy. The loader executes at pipeline startup, transforming the YAML document on disk into an in-memory representation of rules that downstream redaction logic can consume.

Architecturally, the loader sits at the boundary between persisted configuration and runtime behavior. It does not itself perform redaction — that responsibility belongs to its parent `RedactionLayer` and the converter/adapter logic the layer orchestrates. Instead, RedactionConfigLoader is the single entry point through which externalized privacy policy enters the running system, making it a foundational piece of the redaction subsystem's bootstrap sequence.

## Architecture and Design

The design follows a deliberate **separation of concerns** pattern: by externalizing the rules into `.specstory/config/redaction-config.yaml` rather than embedding them in code, the architecture decouples *what is sensitive* (a policy concern owned by operators) from *how redaction is performed* (an engineering concern owned by the adapter and converter components inside `RedactionLayer`). This split allows policy changes to ship independently of software releases, which is a significant operational advantage when sensitivity rules evolve faster than the codebase.

A second key architectural decision is the **load-then-validate** pipeline. RedactionConfigLoader does not hand its parsed output directly to consumers; the parent analysis indicates that the loader's output is fed through `LSLConfigValidator`'s `redactionConfig` schema before any redaction rule becomes active. This introduces a clear two-stage boundary — parsing (structural) and validation (semantic) — that prevents malformed or incomplete rule definitions from silently corrupting the redaction pipeline. The loader's contract is therefore narrow and well-defined: turn YAML bytes into a structured object; defer correctness judgments to the validator.

This composition reflects a **configuration-as-data** philosophy. The YAML file is treated as authoritative input, the loader as a pure transformer, and the validator as a gatekeeper. None of these components needs to know about the downstream redaction mechanics, which keeps the bootstrap pipeline linear and inspectable.

## Implementation Details

Although no code symbols were surfaced in the provided observations, the implementation contract can be inferred from the architectural role. RedactionConfigLoader targets the fixed path `.specstory/config/redaction-config.yaml`, which means the loader either hard-codes this canonical location or resolves it through a well-known configuration anchor relative to the project root. Because the path is treated as canonical in the L2 description, the loader is not expected to search multiple locations or support per-environment overrides at this level — environmental variation is presumably handled by editing the YAML itself.

The loader's processing pipeline is straightforward: open the YAML file, parse it into a structured object (typically a nested map representing redaction rules), and return that object so that `LSLConfigValidator` can apply the `redactionConfig` schema check. Because parsing happens at pipeline startup, any I/O error, YAML syntax error, or missing-file condition surfaces before redaction work begins, ensuring the system fails fast rather than degrading mid-stream.

The absence of embedded rule data in code means that the loader's correctness is largely judged by two questions: did it find the file, and did it produce a structure that `LSLConfigValidator` accepts? This narrow contract keeps the loader simple and testable — it can be exercised against fixture YAML files without engaging the full redaction stack.

## Integration Points

RedactionConfigLoader has three principal integration relationships. First, it is **contained by** `RedactionLayer`, its parent component, which is responsible for orchestrating redaction across the adapter and converter logic. The loader effectively bootstraps the layer by providing the rule set that subsequent redaction passes will apply.

Second, it integrates **downstream** with `LSLConfigValidator`, specifically with that validator's `redactionConfig` schema. This handoff is the system's guarantee that malformed rules never reach the redaction execution path. The loader produces; the validator approves; only then does the policy become active.

Third, it integrates **upstream** with the filesystem at `.specstory/config/redaction-config.yaml`. This file is the operator-facing surface — the place where policy authors write and modify redaction patterns. The loader therefore implicitly defines a contract with operators: the file's structure, naming, and location must remain consistent with what the loader expects to read.

## Usage Guidelines

Developers and operators working with RedactionConfigLoader should observe several conventions. First, **treat `.specstory/config/redaction-config.yaml` as the single canonical location** for redaction rules. Do not introduce alternate files or scatter rule definitions across the codebase — doing so undermines the explicit design goal of separating privacy policy from code. When patterns need to change, edit this YAML file; the loader and surrounding `RedactionLayer` are intentionally agnostic to rule content.

Second, **respect the load-then-validate boundary**. Consumers should never bypass `LSLConfigValidator` to read the loader's raw output directly. The validator's `redactionConfig` schema is the contract that downstream redaction logic relies on; circumventing it reintroduces the risk of malformed rules silently corrupting the pipeline.

Third, **understand the startup-time semantics**. Because the loader runs at pipeline startup, configuration changes do not take effect until the pipeline restarts. Operators should plan rule updates accordingly, and developers extending the loader should preserve this fail-fast behavior — surfacing I/O or parse errors early is preferable to lazy loading that could fail mid-pipeline.

Finally, when extending or modifying the redaction subsystem, **keep changes scoped to the appropriate layer**. New rule *types* may require schema updates in `LSLConfigValidator` and execution support in the adapter/converter logic under `RedactionLayer`, but the loader itself should remain a thin YAML-to-object transformer. Adding business logic to the loader would erode the clean separation that makes this design maintainable.

---

### Summary of Architectural Properties

- **Pattern identified:** Externalized configuration with load-then-validate handoff, anchored at a single canonical YAML path.
- **Key trade-off:** Startup-time loading sacrifices live-reload flexibility in exchange for predictable, fail-fast initialization and a simpler loader contract.
- **Structural insight:** The loader is intentionally minimal — its value comes from being the *only* path through which policy enters the system, not from doing complex work itself.
- **Scalability consideration:** Because rules are loaded once at startup, the loader has negligible runtime overhead; scaling concerns shift to the rule-application logic in `RedactionLayer` rather than the loader.
- **Maintainability assessment:** High. The narrow contract (YAML path in, structured object out), the explicit downstream validator boundary, and the externalization of policy from code together make this component easy to reason about, easy to test in isolation, and resilient to changes in either the policy domain or the redaction execution domain.


## Hierarchy Context

### Parent
- [RedactionLayer](./RedactionLayer.md) -- Redaction rules are declared in .specstory/config/redaction-config.yaml, externalizing privacy policy from code so operators can update patterns without modifying the adapter or converter logic.


---

*Generated from 3 observations*
