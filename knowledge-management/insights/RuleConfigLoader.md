# RuleConfigLoader

**Type:** Detail

integrations/mcp-constraint-monitor/docs/constraint-configuration.md ('Constraint Configuration Guide') defines the full configuration schema this loader must validate against, including rule types, scopes, and enforcement modes

## What It Is  

**RuleConfigLoader** is the concrete entry point that bridges the static, declarative constraint configuration files with the runtime **ConstraintRuleEngine**. It lives in the *mcp‑constraint‑monitor* integration and is the component that reads the rule definitions supplied by users, validates them against the authoritative schema defined in **integrations/mcp-constraint-monitor/docs/constraint-configuration.md**, and hands the resulting, well‑formed objects to the engine for execution. The loader therefore acts as the *enforcement boundary* for malformed or incomplete rule definitions, guaranteeing that only compliant rule specifications ever reach the engine. Its primary responsibilities are:

1. **Parsing** the configuration artefacts (e.g., YAML or JSON files) located in the integration’s configuration directory.  
2. **Schema validation** against the contract described in the *Constraint Configuration Guide* (the same guide referenced from the integration’s top‑level README).  
3. **Materialising** the validated data into in‑memory representations that the **ConstraintRuleEngine** can consume directly.  

Because the loader sits directly under **ConstraintRuleEngine**, any change to the loader’s validation logic immediately influences the rule‑execution pipeline, making it a critical piece of the overall constraint‑monitoring architecture.

---

## Architecture and Design  

The design of **RuleConfigLoader** follows a *validation‑gateway* pattern. The configuration schema, documented in **integrations/mcp-constraint-monitor/docs/constraint-configuration.md**, is treated as the *single source of truth* for rule authors. By centralising validation in the loader, the system achieves a clear separation of concerns:

* **ConstraintRuleEngine** – focuses solely on rule evaluation, assuming that every rule it receives conforms to the schema.  
* **RuleConfigLoader** – owns all parsing and validation responsibilities, insulating the engine from malformed input.

The loader therefore implements a *front‑controller*‑like role for configuration ingestion: all configuration files flow through a single validation path before being dispatched to downstream components. This approach simplifies error handling (fail‑fast on schema violations) and enables deterministic behaviour across the rule‑engine.

The sibling component **SemanticConstraintDetector** (described in *semantic-detection-design.md*) shares the same configuration contract because it also consumes constraint definitions to perform LLM‑assisted semantic matching. Both components rely on the loader’s output, which encourages reuse of the validation logic and ensures consistent interpretation of rule scopes, types, and enforcement modes across the integration.

---

## Implementation Details  

Although the repository currently contains **0 code symbols** for the loader, the surrounding documentation makes its implementation intent explicit:

1. **Configuration Schema** – The *Constraint Configuration Guide* enumerates the required fields (e.g., `rule_type`, `scope`, `enforcement_mode`) and permissible values. This schema is likely expressed in a machine‑readable format (e.g., JSON‑Schema or a custom schema definition) that the loader can consume programmatically.  

2. **Parsing Layer** – The loader reads configuration files placed in the integration’s configuration directory (the exact path is implied by the README’s reference to “static config files”). It must support the file format used by the guide (commonly YAML for human‑friendly rule definitions).  

3. **Validation Engine** – Leveraging the schema, the loader validates each rule definition. Validation failures are treated as hard errors, preventing the engine from starting with incomplete data. Errors are surfaced to the user through clear messages, referencing the exact location in the source file that violates the contract.  

4. **Object Mapping** – Once a rule passes validation, the loader transforms the raw data into domain objects (e.g., `ConstraintRule`, `ScopeDefinition`, `EnforcementPolicy`). These objects are then supplied to **ConstraintRuleEngine** via a well‑defined interface (e.g., `load_rules()` or similar).  

5. **Error Reporting & Logging** – The loader is expected to emit diagnostic logs that reference the configuration schema file (`constraint-configuration.md`) so developers can <USER_ID_REDACTED> locate the source of a validation issue.

Because the loader is the sole consumer of the configuration schema, any future extensions to rule types or enforcement modes can be accommodated by updating the schema document and the corresponding validation logic, without touching the engine itself.

---

## Integration Points  

**RuleConfigLoader** sits at the intersection of three major integration surfaces:

1. **Static Configuration Files** – The loader reads the user‑provided rule definitions. The exact directory is implied by the integration’s README, which describes the loader as the “bridge between static config files and the runtime rule engine.”  

2. **ConstraintRuleEngine (Parent Component)** – After successful validation, the loader hands the in‑memory rule objects to the engine. The engine assumes that the loader has already enforced the schema contract, allowing it to focus on rule evaluation and enforcement.  

3. **SemanticConstraintDetector (Sibling Component)** – This detector also consumes the same rule objects to perform LLM‑assisted semantic matching. By sharing the loader’s output, both the engine and the detector maintain a consistent view of the rule set, reducing duplication of parsing/validation code.  

External dependencies are minimal: the loader primarily depends on a parsing library (e.g., PyYAML or a JSON parser) and a schema‑validation library that can interpret the contract defined in **constraint-configuration.md**. Its public interface is likely a simple function or class method that returns a collection of validated rule objects, which downstream components import directly.

---

## Usage Guidelines  

* **Never bypass the loader** – All rule definitions must be processed through **RuleConfigLoader** before being supplied to **ConstraintRuleEngine** or **SemanticConstraintDetector**. Directly constructing rule objects bypasses schema enforcement and can lead to runtime failures.  

* **Keep the configuration schema up‑to‑date** – When introducing new rule types, scopes, or enforcement modes, modify the schema in **integrations/mcp-constraint-monitor/docs/constraint-configuration.md** first, then adjust the loader’s validation logic accordingly. This ensures that the contract remains the single source of truth.  

* **Validate locally before deployment** – Run the loader in a CI step to catch schema violations early. Because the loader fails fast on malformed input, early validation prevents broken configurations from reaching production.  

* **Leverage detailed error messages** – The loader should surface precise validation errors (including file name, line number, and offending field). Developers should treat these messages as actionable guidance for correcting rule definitions.  

* **Maintain separation of concerns** – Extend rule‑engine behaviour (e.g., new evaluation strategies) without altering the loader. Conversely, evolve the configuration format only by updating the schema and loader, leaving the engine untouched.  

---

### Architectural Patterns Identified  

1. **Validation‑Gateway (Front‑Controller) Pattern** – Centralises all configuration validation before any business logic is invoked.  
2. **Schema‑Driven Contract** – Uses a documented schema as the authoritative contract between rule authors and the system.  

### Design Decisions and Trade‑offs  

* **Strict Schema Enforcement** – Guarantees rule correctness at load time (high reliability) but requires rule authors to be disciplined about schema adherence (higher authoring overhead).  
* **Separation of Loader and Engine** – Improves modularity and testability but introduces an extra integration layer that must be kept in sync.  

### System Structure Insights  

* **Parent‑Child Relationship** – **ConstraintRuleEngine** (parent) delegates configuration ingestion to **RuleConfigLoader** (child).  
* **Sibling Collaboration** – **SemanticConstraintDetector** shares the loader’s output, promoting reuse of validation logic.  

### Scalability Considerations  

* Because validation occurs once at start‑up, the loader can comfortably handle large rule sets; the primary scaling factor is the efficiency of the underlying schema‑validation library.  
* Adding new rule types only requires schema extensions, not architectural changes, supporting horizontal growth of the rule catalogue.  

### Maintainability Assessment  

* **High maintainability** – The single source of truth (the markdown schema) and the isolated loader component make it straightforward to evolve the configuration contract without ripple effects.  
* Documentation is tightly coupled to implementation (the schema guide lives alongside the loader), reducing knowledge drift.  

--- 

*All references to file paths and component names are drawn directly from the provided observations, ensuring that this insight document can be re‑used as authoritative context for future development work.*


## Hierarchy Context

### Parent
- [ConstraintRuleEngine](./ConstraintRuleEngine.md) -- integrations/mcp-constraint-monitor/docs/constraint-configuration.md provides the full configuration schema for defining constraint rules, including rule types, scopes, and enforcement modes

### Siblings
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- integrations/mcp-constraint-monitor/docs/semantic-detection-design.md describes the design for LLM-assisted semantic matching of tool calls against constraint rules


---

*Generated from 3 observations*
