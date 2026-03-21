# CodeFormatter

**Type:** Detail

The code-formatter.py file contains the implementation of the CodeFormatter class, which is responsible for parsing the code and applying the formatting rules.

## What It Is  

The **CodeFormatter** lives in the file **`code-formatter.py`** and is the concrete implementation that enforces the coding conventions defined by its parent component **CodingConventions**.  At its core, the `CodeFormatter` class encapsulates the logic for parsing source files, inspecting them against a set of configurable rules, and rewriting the code so that indentation, naming styles, and other stylistic concerns are uniform across the repository.  Because the class is referenced by the sibling entities **NamingConventions** and **IndentationRules**, it is the single point where those specific rule‑sets are materialised and applied.  In short, `CodeFormatter` is the engine that turns abstract convention definitions into concrete, automatically‑applied formatting actions.

---

## Architecture and Design  

The observable design of **CodeFormatter** follows a **configuration‑driven architecture**.  The class does not hard‑code any particular rule; instead it reads a configuration object (or file) supplied by the developer and builds its rule‑set at runtime.  This approach gives the component high flexibility while keeping the core parsing and rewriting logic stable.  

From the hierarchy we see a classic **parent‑child relationship**: *CodingConventions* (parent) aggregates the formatting responsibilities, while *CodeFormatter* (child) implements them.  The sibling components **NamingConventions** and **IndentationRules** share the same parent and therefore likely expose their own configuration fragments that `CodeFormatter` consumes.  This indicates a **composition** pattern – the formatter composes the individual convention checkers into a single processing pipeline.  

Interaction is straightforward: a caller (e.g., a build script, IDE plugin, or CI step) creates a `CodeFormatter` instance, supplies a configuration, and invokes its public API (most likely a `format()` method).  Inside, the formatter parses the source, iterates over the configured rule objects (naming, indentation, etc.), and mutates the AST or raw text accordingly.  No evidence suggests distributed or event‑driven mechanisms; the design is monolithic and synchronous, appropriate for a code‑base‑wide formatting tool.

---

## Implementation Details  

The **`code-formatter.py`** file houses the `CodeFormatter` class.  Although the observations do not enumerate its methods, the described responsibilities imply at least three core responsibilities:

1. **Configuration Loading** – a method (e.g., `load_config()` or constructor injection) reads a developer‑provided configuration that defines which indentation width to use, which naming style (camelCase, PascalCase, etc.) is required, and any additional rule toggles.  

2. **Parsing** – a private routine (`_parse_source()` or similar) walks the source files, building an abstract syntax tree (AST) or token stream that can be inspected.  This step isolates the formatter from language‑specific syntax, making the rule‑checking logic independent of raw string handling.  

3. **Rule Application** – a processing loop (`apply_rules()` or `format()`) traverses the parsed representation and, for each configured rule, invokes the appropriate check‑and‑fix logic.  The sibling entities **NamingConventions** and **IndentationRules** are likely implemented as helper classes or functions that `CodeFormatter` calls, keeping the code modular and allowing each convention to evolve without touching the central formatter.  

Because the class is “configuration‑based,” the implementation probably stores the active rule set in an internal collection (e.g., a list of callables).  When `format()` runs, it iterates over this collection, applying each rule in turn.  This design makes it trivial to add new conventions: a developer adds a new rule class, registers it in the configuration, and the existing `CodeFormatter` automatically incorporates it.

---

## Integration Points  

`CodeFormatter` sits at the intersection of several system components:

* **Parent – CodingConventions**: The parent aggregates all convention‑related utilities.  It likely provides a façade or factory that creates a `CodeFormatter` with the appropriate configuration derived from the broader coding‑policy definition.  

* **Siblings – NamingConventions & IndentationRules**: These sibling modules supply concrete rule implementations that `CodeFormatter` invokes.  They may expose public interfaces such as `check_name()` or `check_indent()` that the formatter calls during its rule‑application phase.  

* **External Consumers**: Build pipelines, IDE extensions, or command‑line tools can import `CodeFormatter` from `code-formatter.py`.  The typical integration pattern is to instantiate the class, pass a configuration dictionary or file path, and call its `format()` method on a target directory or file list.  

* **Configuration Sources**: The formatter depends on a configuration artifact (JSON, YAML, or Python dict).  This artifact is the contract between developers and the formatter, dictating which conventions are active and any parameterisation (e.g., number of spaces per indent).  

No other dependencies are mentioned, so we assume the formatter is self‑contained aside from the configuration and the sibling rule modules.

---

## Usage Guidelines  

1. **Provide a Complete Configuration** – Before invoking the formatter, ensure that the configuration object includes entries for both naming and indentation rules (as expected by the sibling modules).  Missing entries will cause the formatter to fall back to defaults, which may not align with project standards.  

2. **Instantiate via the Parent Facade** – When possible, obtain a `CodeFormatter` instance through the `CodingConventions` API rather than constructing it directly.  This guarantees that the configuration is consistent with the rest of the convention suite.  

3. **Run in a Controlled Environment** – Because `CodeFormatter` parses and rewrites source files, run it on a clean working tree or inside a CI job that can abort on failures.  Always commit or stash changes before re‑formatting large codebases.  

4. **Extend via Configuration, Not Code Changes** – To add a new rule (e.g., a line‑length check), implement the rule as a separate module and reference it in the configuration.  The formatter’s design expects new conventions to be plug‑and‑play, preserving maintainability.  

5. **Validate After Formatting** – After a formatting pass, run the project’s test suite or linting tools to confirm that the formatter has not introduced syntax errors, especially if custom parsers are used.  

---

### 1. Architectural patterns identified  

* **Configuration‑Driven Architecture** – rules are supplied at runtime via a developer‑provided configuration.  
* **Composition** – the formatter composes multiple convention checkers (NamingConventions, IndentationRules) into a single processing pipeline.  

### 2. Design decisions and trade‑offs  

* **Flexibility vs. Simplicity** – By externalising rule definitions to configuration, the system gains high flexibility (different projects can tailor rules) at the cost of added runtime parsing of the configuration.  
* **Single‑Responsibility Separation** – Delegating naming and indentation checks to sibling modules keeps `CodeFormatter` focused on orchestration, improving readability and testability, but introduces a dependency on the stability of those sibling interfaces.  

### 3. System structure insights  

* **Hierarchical Organization** – `CodingConventions` is the parent container; `CodeFormatter` is the concrete child that implements the parent’s contract.  
* **Sibling Collaboration** – `NamingConventions` and `IndentationRules` are peer modules that supply domain‑specific logic consumed by the formatter, indicating a modular rule‑set architecture.  

### 4. Scalability considerations  

* Because rule application is performed in a single pass over the parsed representation, the formatter scales linearly with source‑code size.  
* Adding new rules does not affect the core parsing algorithm; scalability is therefore governed mainly by the efficiency of the underlying parser and the number of active rules.  

### 5. Maintainability assessment  

* The clear separation between configuration, parsing, and rule execution makes the component easy to maintain.  
* As long as sibling modules expose stable interfaces, new conventions can be introduced without modifying `CodeFormatter` itself, reducing churn.  
* The reliance on a configuration file means that documentation of the configuration schema is essential; otherwise, misconfigurations could lead to silent rule omissions.

## Hierarchy Context

### Parent
- [CodingConventions](./CodingConventions.md) -- The CodeFormatter class in code-formatter.py enforces consistent coding conventions, such as indentation and naming conventions.

### Siblings
- [NamingConventions](./NamingConventions.md) -- The CodeFormatter class in code-formatter.py checks for naming conventions, such as camelCase or PascalCase, and corrects them if necessary.
- [IndentationRules](./IndentationRules.md) -- The CodeFormatter class in code-formatter.py checks for indentation, ensuring that the code uses a consistent number of spaces for indentation.

---

*Generated from 3 observations*
