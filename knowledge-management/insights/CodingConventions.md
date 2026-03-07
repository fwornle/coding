# CodingConventions

**Type:** SubComponent

The CodeAnalyzer class in code-analyzer.py checks for adherence to coding standards, such as cyclomatic complexity and code duplication.

## What It Is  

The **CodingConventions** sub‑component lives in the `coding-conventions/` package and is materialised by a handful of concrete Python modules:  

* `code-formatter.py` – defines the **CodeFormatter** class that enforces indentation and naming conventions.  
* `code-analyzer.py` – defines the **CodeAnalyzer** class that checks cyclomatic complexity and code duplication.  
* `coding-conventions.py` – hosts the **CodingConventions** module that aggregates the standards used throughout the project.  
* `code-inspector.py` – defines the **CodeInspector** class that walks the abstract syntax tree (AST) using the **Visitor** pattern to enforce the conventions.  
* `code-generator.py` – defines the **CodeGenerator** class that follows the **Template Method** pattern to emit code that already complies with the conventions.  
* `coding-standards.py` – defines the **CodingStandards** class, a concrete repository of the rule definitions.  
* `code-reviewer.py` – defines the **CodeReviewer** class that subscribes to change events via the **Observer** pattern to provide feedback on convention violations.  

Together these files constitute a self‑contained module that specifies, validates, formats, and even auto‑generates code according to a unified set of rules. The component sits under the **CodingPatterns** parent, sharing the broader architectural philosophy of reusable, pattern‑driven utilities that also appear in sibling components such as **DesignPatterns** (Singleton‑based `OntologyLoader`) and **GraphDatabaseManagement** (Repository‑based `GraphDatabaseAdapter`). Its immediate children – **CodeFormatter**, **NamingConventions**, and **IndentationRules** – are logical sub‑domains implemented inside `code-formatter.py`.

---

## Architecture and Design  

The architecture of **CodingConventions** is deliberately layered and pattern‑centric. At the top level, `coding-conventions.py` and `coding-standards.py` expose the **domain model** of what a “coding standard” looks like (e.g., allowed indentation width, naming case rules). This model is consumed by three orthogonal services:

1. **Formatting Service** – `CodeFormatter` (in `code-formatter.py`) applies the rules to raw source files, handling both indentation and naming.  
2. **Static Analysis Service** – `CodeAnalyzer` (in `code-analyzer.py`) evaluates structural metrics such as cyclomatic complexity and duplicate fragments.  
3. **Inspection / Generation Service** – `CodeInspector` (Visitor) traverses the AST to locate violations, while `CodeGenerator` (Template Method) builds new code artefacts that are already compliant.

The **Visitor pattern** in `CodeInspector` decouples the traversal logic from the concrete actions taken on each node (e.g., “check naming”, “verify indentation”). This makes it trivial to add new inspection rules without touching the traversal engine.  

The **Template Method pattern** in `CodeGenerator` defines a skeleton algorithm (`generate_code()`) that calls abstract hook methods (`emit_header()`, `emit_body()`, `emit_footer()`) implemented by subclasses. Each subclass can specialise the generated artefact (e.g., a class stub, a configuration file) while the base class guarantees that the output respects the formatting conventions defined by **CodeFormatter**.  

Finally, the **Observer pattern** in `CodeReviewer` (found in `code-reviewer.py`) registers listeners for code‑change events (e.g., after a developer runs `git commit`). When a change occurs, the reviewer receives a notification, runs the relevant checks, and produces feedback. This event‑driven approach keeps the review process loosely coupled to the rest of the pipeline and enables asynchronous or batch processing.

Because the component is a child of **CodingPatterns**, it inherits the same emphasis on reusable patterns that appear in siblings: the **DesignPatterns** sibling uses a Singleton (`OntologyLoader`), the **NaturalLanguageProcessing** sibling employs a Pipeline, and the **MachineLearningIntegration** sibling relies on a Factory. This consistent pattern language across the parent component simplifies onboarding and cross‑team collaboration.

---

## Implementation Details  

### Core Rule Definitions  
* `coding-conventions.py` and `coding-standards.py` expose classes (`CodingConventions`, `CodingStandards`) that encapsulate rule data structures – typically dictionaries or data classes mapping rule names to parameters (e.g., `indent_size: 4`, `naming_style: "camelCase"`).  

### Formatting Engine (`code-formatter.py`)  
* **CodeFormatter** reads the rule objects from `CodingStandards` and provides two public methods: `format_indentation(source: str) -> str` and `format_naming(source: str) -> str`.  
* Internally it leverages regular expressions for naming conversion and a simple line‑by‑line scanner for indentation, emitting a corrected source string.  
* The class also serves as the concrete implementation for the **NamingConventions** and **IndentationRules** child entities, exposing them as properties (`self.naming_rules`, `self.indentation_rules`) for external callers.

### Static Analysis (`code-analyzer.py`)  
* **CodeAnalyzer** parses a file into an AST (using Python’s `ast` module) and walks it to compute cyclomatic complexity (using a classic edge‑node counting algorithm) and detect duplicated code blocks (via hash‑based fingerprinting).  
* Results are packaged into a `AnalysisReport` object that lists violations with line numbers, enabling downstream tooling (e.g., CI pipelines) to fail builds when thresholds are exceeded.

### Inspection (`code-inspector.py`) – Visitor  
* **CodeInspector** implements the classic Visitor interface: `visit_Module`, `visit_FunctionDef`, `visit_ClassDef`, etc. Each visit method delegates to the appropriate rule check in **CodeFormatter** or **CodeAnalyzer**.  
* Because the visitor is stateless, multiple inspectors can run in parallel on different files, supporting the work‑stealing concurrency model mentioned in the parent’s description.

### Generation (`code-generator.py`) – Template Method  
* **CodeGenerator** defines `generate_code(self, model: Any) -> str` as the template method. The algorithm:  
  1. `self.emit_header(model)` – writes file‑level comments and imports.  
  2. `self.emit_body(model)` – produces the main code block (sub‑class responsibility).  
  3. `self.emit_footer(model)` – finalises the file.  
* Sub‑classes such as `ClassStubGenerator` or `ConfigFileGenerator` override the hook methods while re‑using the formatting utilities from **CodeFormatter** to guarantee compliance.

### Review (`code-reviewer.py`) – Observer  
* **CodeReviewer** registers itself with a central `EventBus` (provided elsewhere in the system). It listens for `CodeChanged` events, invokes `CodeInspector` and `CodeAnalyzer`, and aggregates the findings into a `ReviewReport`.  
* The observer can be configured with different severity thresholds, allowing teams to treat certain convention breaches as warnings rather than errors.

---

## Integration Points  

* **Parent – CodingPatterns**: The component consumes shared utilities (e.g., the global `EventBus` used by `CodeReviewer`) defined at the **CodingPatterns** level. It also adheres to the same pattern‑first philosophy, making it interchangeable with other pattern‑driven siblings.  

* **Siblings**:  
  * **DesignPatterns** – The Singleton `OntologyLoader` may supply ontology‑based naming dictionaries that **CodeFormatter** can reference for domain‑specific naming conventions.  
  * **GraphDatabaseManagement** – The `GraphDatabaseAdapter` could store historical analysis metrics (complexity scores) generated by **CodeAnalyzer** for trend analysis.  
  * **NaturalLanguageProcessing** – The `NaturalLanguageProcessor` pipeline might be used to generate documentation strings that **CodeGenerator** inserts, ensuring that generated code is both syntactically and semantically aligned with project glossaries.  

* **Children** – The logical children **NamingConventions** and **IndentationRules** are not separate classes but are exposed as configuration objects inside **CodeFormatter**. External tools (e.g., IDE plugins) can query these objects to display live linting hints.  

* **External Interfaces** – The component offers a clean API surface: `format(source)`, `analyze(source)`, `inspect(ast)`, `generate(model)`, and `review(event)`. These functions can be invoked from CI scripts, IDE extensions, or the internal code‑review workflow.  

* **Data Flow** – A typical flow is: source file → `CodeInspector` (Visitor) → violation list → `CodeReviewer` (Observer) → feedback → optional auto‑fix via `CodeFormatter` → re‑run `CodeAnalyzer` for verification.

---

## Usage Guidelines  

1. **Enforce Early** – Run `CodeFormatter.format(source)` as part of the pre‑commit hook to guarantee that every commit respects indentation and naming conventions before any analysis occurs.  

2. **Static Analysis as Gate** – Integrate `CodeAnalyzer.analyze(source)` into the CI pipeline; treat cyclomatic complexity thresholds and duplication percentages as quality gates.  

3. **Visitor‑Based Inspection** – When extending the rule set, create a new `visit_*` method in `CodeInspector` rather than modifying existing ones. This respects the open‑closed principle and keeps the traversal engine stable.  

4. **Template Method Extension** – To generate a new artefact type, subclass `CodeGenerator` and implement `emit_header`, `emit_body`, and `emit_footer`. Do not alter the base `generate_code` algorithm; rely on the inherited formatting step to keep output consistent.  

5. **Observer Configuration** – Register `CodeReviewer` with the `EventBus` only once per process. Configure severity levels via a YAML file that the reviewer reads at startup, ensuring that teams can evolve the strictness of convention enforcement without code changes.  

6. **Cross‑Component Coordination** – If a sibling component provides additional naming dictionaries (e.g., from `OntologyLoader`), inject them into `CodeFormatter` via its constructor. This avoids hard‑coding domain vocabularies and keeps the formatter reusable across domains.  

---

### Architectural patterns identified  

* **Visitor** – `CodeInspector` traverses AST nodes to apply convention checks.  
* **Template Method** – `CodeGenerator` defines a fixed generation skeleton with overridable hooks.  
* **Observer** – `CodeReviewer` subscribes to code‑change events and reacts with feedback.  

### Design decisions and trade‑offs  

* **Pattern‑driven modularity** – Choosing Visitor, Template Method, and Observer isolates concerns (traversal, generation, notification) and eases extension, at the cost of added indirection and a modest learning curve for new contributors.  
* **Centralised rule repository** – Storing all conventions in `CodingStandards` ensures a single source of truth, but it can become a bottleneck if the rule set grows dramatically; caching strategies may be needed.  
* **Stateless visitors** – Enables parallel inspection, improving scalability, but requires that any state (e.g., accumulated violations) be passed explicitly, increasing method signatures.  

### System structure insights  

* The component follows a **layered** structure: *Rule Definition* → *Formatting/Analysis Services* → *Inspection/Generation* → *Review/Feedback*.  
* Child entities (**NamingConventions**, **IndentationRules**) are not separate modules but logical partitions within `CodeFormatter`, reflecting a **composition** rather than inheritance approach.  
* The hierarchy mirrors the parent‑child‑sibling relationships defined in the broader **CodingPatterns** ecosystem, promoting a uniform mental model across the codebase.  

### Scalability considerations  

* **Parallel Inspection** – Because `CodeInspector` is stateless, multiple files can be inspected concurrently, leveraging the work‑stealing concurrency mentioned in the parent component.  
* **Extensible Generation** – New `CodeGenerator` subclasses can be added without impacting existing generators, allowing the system to scale to new artefact types (e.g., API stubs, test scaffolds).  
* **Rule Cache** – To support large codebases, caching the parsed `CodingStandards` object and reusing compiled regexes in `CodeFormatter` reduces per‑file overhead.  

### Maintainability assessment  

The heavy reliance on well‑known design patterns yields high **maintainability**:

* **Separation of concerns** makes each class small and focused, simplifying unit testing.  
* **Open‑closed extensions** (Visitor and Template Method) allow new conventions or generation formats to be added with minimal risk of regression.  
* **Central rule source** (`CodingStandards`) reduces duplication, though it must be guarded against becoming monolithic; modularising rule groups (e.g., separate files for naming vs. indentation) could further improve readability.  

Overall, the **CodingConventions** sub‑component exemplifies a pattern‑centric, extensible design that aligns with the architectural ethos of its parent **CodingPatterns** and integrates cleanly with sibling modules across the project.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- Key patterns in this component include the use of graph database adapters, work-stealing concurrency, and lazy initialization of large language models. The project also employs a custom OntologyLoader class to load the ontology and a custom EntityAuthoringService class to handle manual entity creation and editing. These patterns and principles contribute to the overall quality and maintainability of the codebase.

### Children
- [CodeFormatter](./CodeFormatter.md) -- The CodeFormatter class in code-formatter.py defines the formatting rules, including indentation and naming conventions, which are applied to the codebase.
- [NamingConventions](./NamingConventions.md) -- The CodeFormatter class in code-formatter.py checks for naming conventions, such as camelCase or PascalCase, and corrects them if necessary.
- [IndentationRules](./IndentationRules.md) -- The CodeFormatter class in code-formatter.py checks for indentation, ensuring that the code uses a consistent number of spaces for indentation.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- The OntologyLoader class in ontology-loader.py utilizes the Singleton pattern to ensure only one instance is created.
- [GraphDatabaseManagement](./GraphDatabaseManagement.md) -- The GraphDatabaseAdapter class in graph-database-adapter.py uses the Repository pattern to abstract the graph database interactions.
- [NaturalLanguageProcessing](./NaturalLanguageProcessing.md) -- The NaturalLanguageProcessor class in natural-language-processor.py uses the Pipeline pattern to process natural language text.
- [MachineLearningIntegration](./MachineLearningIntegration.md) -- The MachineLearningModel class in machine-learning-model.py uses the Factory pattern to create instances of different machine learning models.
- [OntologyManagement](./OntologyManagement.md) -- The OntologyLoader class in ontology-loader.py uses the Singleton pattern to ensure only one instance is created.
- [EntityManagement](./EntityManagement.md) -- The EntityAuthoringService class in entity-authoring-service.py employs the Factory pattern to handle manual entity creation and editing.


---

*Generated from 7 observations*
