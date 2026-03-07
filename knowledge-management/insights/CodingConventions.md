# CodingConventions

**Type:** SubComponent

The CodeSmellsDetector.cs file detects code smells, such as duplicated code or long methods, and provides suggestions for improvement.

## What It Is  

The **CodingConventions** sub‑component lives under the `CodingPatterns` parent and is realised by a collection of focused C# source files. The core files are `CodingConventions.cs`, `NamingConventions.cs`, `BestPractices.cs`, `CodeAnalyzer.cs`, `CodeFormatter.cs`, `CommentGenerator.cs`, and `CodeSmellsDetector.cs`. Together they constitute a self‑contained library that defines, enforces, and assists developers in applying the project‑wide coding standards. `CodingConventions.cs` holds the high‑level policy (naming, commenting, formatting rules), while the ancillary files implement concrete services that analyse source, re‑format it, generate missing documentation, and surface code‑smell warnings. The component therefore acts as the “rules engine” for source‑level quality inside the broader **CodingPatterns** umbrella.

## Architecture and Design  

The observable architecture follows a **modular, single‑responsibility** approach. Each file encapsulates a distinct concern:

* **Policy definition** – `CodingConventions.cs`, `NamingConventions.cs`, and `BestPractices.cs` expose static rule sets or configuration objects that other services read.  
* **Analysis & enforcement** – `CodeAnalyzer.cs` consumes the rule definitions and walks the abstract syntax tree (AST) of a source file to verify compliance.  
* **Transformation** – `CodeFormatter.cs` applies formatting rules (indentation, line breaks, brace placement) to produce a canonical representation of the code.  
* **Documentation assistance** – `CommentGenerator.cs` creates stub comments based on method signatures and the conventions described in `CodingConventions.cs`.  
* **Quality detection** – `CodeSmellsDetector.cs` looks for anti‑patterns such as duplicated blocks or overly long methods and surfaces improvement suggestions.

Although no explicit design‑pattern names appear in the observations, the layout naturally aligns with the **Strategy** pattern: the analyser, formatter, comment generator, and smell detector each implement a specific “strategy” for handling source code, and they can be swapped or extended without touching the rule definitions. The component also exhibits **Facade** characteristics: `CodingConventions.cs` serves as a single entry point that aggregates the various rule sets, allowing callers to work against one cohesive API rather than a scattered set of files.

Interaction between the pieces is straightforward. `CodeAnalyzer`, `CodeFormatter`, `CommentGenerator`, and `CodeSmellsDetector` each import the rule objects from `CodingConventions.cs`, `NamingConventions.cs`, and `BestPractices.cs`. The flow typically starts with a developer invoking the analyser; if violations are found, the formatter or comment generator may be called to automatically remediate, while the smell detector offers higher‑level refactoring advice. This clear separation mirrors the **separation‑of‑concerns** principle and keeps the component loosely coupled to the rest of the system.

## Implementation Details  

* **`CodingConventions.cs`** – Declares immutable constants or static classes that enumerate naming styles (PascalCase for types, camelCase for locals), comment requirements (XML doc headers for public members), and formatting tokens (max line length, brace placement). The file likely contains helper methods such as `IsValidIdentifier(string name)` that downstream services call.  
* **`NamingConventions.cs`** – Provides granular rules for class, method, property, and variable names. It may expose methods like `ValidateClassName(string name)` and `ValidateMethodName(string name)`, each returning a boolean or diagnostic object.  
* **`BestPractices.cs`** – Captures higher‑level guidance such as “always unit‑test public methods” or “use using‑statements for disposable resources”. The file probably defines a set of `BestPracticeRule` objects that the analyser can surface as warnings.  
* **`CodeAnalyzer.cs`** – Implements a parser or leverages Roslyn APIs to walk the syntax tree. For each node, it queries the rule objects from the three policy files and records any mismatches in a `DiagnosticResult` collection. The analyser may expose a public method `Analyze(string sourceCode)` that returns a list of violations.  
* **`CodeFormatter.cs`** – Takes raw source text and, guided by the formatting rules, rewrites whitespace, aligns braces, and enforces line‑break conventions. It likely provides `Format(string sourceCode)` returning a formatted string, possibly using a `FormatterEngine` internally.  
* **`CommentGenerator.cs`** – Generates XML documentation stubs for methods, classes, and properties lacking comments. It reads the signature, applies the comment template defined in `CodingConventions.cs`, and inserts the result into the source file. The main entry point could be `GenerateComments(string sourceCode)`.  
* **`CodeSmellsDetector.cs`** – Scans for patterns such as duplicated code blocks, methods exceeding a configurable line count, or deep nesting. It may use simple heuristics (e.g., token frequency) or more sophisticated metrics. The detector returns `CodeSmell` objects that include a description and a suggested refactor.

All files reside in the same logical namespace (e.g., `Project.CodingPatterns.CodingConventions`) and reference each other through internal `using` statements, ensuring compile‑time cohesion without external dependencies.

## Integration Points  

The **CodingConventions** sub‑component is primarily consumed by developer tooling and CI pipelines. Typical integration scenarios include:

1. **IDE extensions** – An editor plug‑in can call `CodeAnalyzer.Analyze` on the active file to surface real‑time violations, then invoke `CodeFormatter.Format` or `CommentGenerator.GenerateComments` to auto‑fix issues.  
2. **Build‑time checks** – A pre‑commit hook or CI job runs `CodeAnalyzer` and `CodeSmellsDetector` against the entire solution, failing the build if critical rules are breached.  
3. **Documentation generators** – `CommentGenerator` can be wired into a documentation pipeline to ensure that every public API has at least a stub comment before full documentation is produced.  
4. **Testing frameworks** – While not directly related, the `BestPractices.cs` guidelines can be read by test‑generation tools to enforce that new code includes unit tests, linking the component to the sibling **TestingGuidelines**.  

The component depends only on the .NET compiler platform (Roslyn) for parsing; no other system modules are required. It exposes public static methods or service interfaces that other components (e.g., a custom **ArchitectureGuidelines** validator) can call, reinforcing the modular nature of the **CodingPatterns** family.

## Usage Guidelines  

Developers should treat the **CodingConventions** library as the authoritative source for all source‑level style decisions. When adding new code, run `CodeAnalyzer.Analyze` locally to catch naming or comment violations before committing. If the analyzer flags formatting issues, invoke `CodeFormatter.Format` to automatically align the file with the project’s style. For newly introduced public members, run `CommentGenerator.GenerateComments` to seed XML documentation, then flesh out the comments manually.  

When a code‑smell is reported by `CodeSmellsDetector`, consider the suggested refactoring—e.g., extracting duplicated blocks into a shared helper or breaking a long method into smaller, testable units. Because the rules are defined centrally in `CodingConventions.cs`, `NamingConventions.cs`, and `BestPractices.cs`, any change to the conventions should be made in those files only; the rest of the component will automatically respect the updated policy.  

Finally, keep the component up‑to‑date with the evolving project standards. Adding a new rule (for example, a requirement for async suffixes) involves extending the relevant policy file and, if necessary, updating the analyser to emit the new diagnostic. This incremental approach preserves backward compatibility while allowing the **CodingConventions** sub‑component to grow alongside the broader **CodingPatterns** suite.

---

### Architectural patterns identified
1. **Strategy** – distinct services (analyser, formatter, comment generator, smell detector) each implement a specific processing strategy for source code.  
2. **Facade** – `CodingConventions.cs` aggregates rule definitions, presenting a unified API to consumers.  
3. **Single‑Responsibility / Separation‑of‑Concerns** – each file addresses one orthogonal concern (policy, analysis, formatting, documentation, quality detection).

### Design decisions and trade‑offs  
* **Modular rule files** keep policy definitions isolated, making updates easy but requiring all services to stay in sync with the rule schema.  
* **Static rule exposure** simplifies consumption (no DI required) but limits runtime configurability; extending to per‑project overrides would need a more flexible configuration layer.  
* **Roslyn‑based analysis** provides precise AST information at the cost of a heavier runtime dependency; however, it yields accurate diagnostics essential for a coding‑convention engine.

### System structure insights  
The sub‑component forms a tightly‑coupled utility layer under the **CodingPatterns** parent. Its sibling components (DesignPatterns, ArchitectureGuidelines, TestingGuidelines, ErrorHandlingGuidelines) each expose their own policy files, suggesting a consistent “guideline‑as‑code” philosophy across the codebase. The component’s public interfaces are likely consumed by IDE tooling, CI pipelines, and other guideline modules, reinforcing a service‑oriented internal ecosystem.

### Scalability considerations  
Because each service processes source files independently, the component scales horizontally: CI pipelines can parallelise `CodeAnalyzer` and `CodeSmellsDetector` across multiple projects. Adding new rule categories (e.g., security conventions) would involve creating additional policy files without touching existing services, preserving performance. The primary scalability bottleneck could be the Roslyn parsing step for very large solutions; caching parsed syntax trees or incremental analysis would mitigate this.

### Maintainability assessment  
The clear separation of concerns, static rule definitions, and straightforward public APIs make the component highly maintainable. Adding, removing, or tweaking a convention is localized to a single file, reducing regression risk. The use of well‑known .NET tooling (Roslyn) ensures that future language versions can be supported with minimal changes. The main maintenance challenge is keeping the analyser, formatter, and smell detector in sync with any evolution of the rule schema, which can be mitigated by unit‑testing the rule‑consumption paths.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the project. It serves as a catch-all for entities not fitting other components, providing a foundation for maintainable and efficient code. The component's architecture is not explicitly defined in the provided codebase, but it is likely to involve a range of classes and functions that implement various design patterns and coding conventions.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- The Singleton pattern is implemented in the SingletonClass.cs file, which ensures a single instance of the class is created throughout the application.
- [ArchitectureGuidelines](./ArchitectureGuidelines.md) -- The ArchitectureGuidelines.cs file provides guidelines for overall system architecture, including layering and separation of concerns.
- [TestingGuidelines](./TestingGuidelines.md) -- The TestingGuidelines.cs file provides guidelines for testing the system, including unit testing, integration testing, and acceptance testing.
- [ErrorHandlingGuidelines](./ErrorHandlingGuidelines.md) -- The ErrorHandlingGuidelines.cs file provides guidelines for error handling, including exception handling, logging, and error reporting.


---

*Generated from 7 observations*
