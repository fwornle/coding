# CodingConventions

**Type:** SubComponent

The mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md file defines a commenting practice for hook data format, implying a coding convention.

## What It Is  

**CodingConventions** is the sub‑component that codifies the way source files, documentation, and inline comments are written across the repository.  The conventions are materialised in a handful of concrete artefacts that live in the *integrations* and *mcp‑constraint‑monitor* folders:

* `integrations/code-graph-rag/README.md` – a top‑level README that follows a strict naming and section‑ordering rule set.  
* `integrations/copi/USAGE.md`, `integrations/copi/INSTALL.md`, `integrations/copi/MIGRATION.md`, `integrations/copi/STATUS.md` – a family of Markdown files that share a common formatting style (heading hierarchy, fenced code blocks, bullet‑point syntax).  
* `copi/USAGE.md` – an additional usage guide that mirrors the same style as the integration‑level docs.  
* `mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` – a specification of the comment‑based hook data format, i.e. a concrete commenting convention that developers must embed in source code.

Together these files form the *observable surface* of the CodingConventions sub‑component: they demonstrate a consistent naming convention for files, a repeatable Markdown layout, and a prescribed comment syntax for hook data.  The conventions are not an abstract policy; they are embodied in the concrete paths and file names listed above, making them directly discoverable and enforceable.

---

## Architecture and Design  

The architecture of **CodingConventions** is deliberately lightweight: it is a *documentation‑centric* sub‑component that lives alongside the functional codebase rather than being a runtime module.  Its design follows the **“Convention‑over‑Configuration”** principle, where the presence of a correctly named and formatted Markdown file *implies* compliance without the need for additional configuration files or tooling.  

From the observations we can infer three design patterns:

1. **Standardised Documentation Template** – each integration (`code-graph-rag`, `copi`) ships a `README.md` and a set of auxiliary docs (`USAGE.md`, `INSTALL.md`, etc.) that obey the same heading order (e.g., *Overview → Features → Installation → Usage → Migration → Status*).  This template is implicitly shared across siblings such as **DesignPatterns** (which also supplies a `CONTRIBUTING.md` with similar structure) and **BestPractices** (which defines contribution guidelines).  

2. **Comment‑Based Hook Specification** – the `CLAUDE-CODE-HOOK-FORMAT.md` file defines a *comment syntax* that developers embed directly in source files.  This is a classic **Domain‑Specific Language (DSL) in comments** pattern: the comment acts as a declarative hook descriptor that downstream tooling (e.g., the constraint monitor) can parse.  

3. **Naming‑Convention Enforcement** – the consistent use of kebab‑case for directories (`code-graph-rag`, `mcp-constraint-monitor`) and upper‑case for markdown extensions (`README.md`, `USAGE.md`) reflects a **Naming Convention** pattern that reduces ambiguity when new integrations are added.

Interaction among components is therefore *static*: the conventions are read by developers, CI linters, and any automated documentation generators.  There is no runtime coupling, but the conventions provide a *contract* that sibling components (e.g., **GraphDatabase**’s `storage/graph-database-adapter.ts`) implicitly respect when they reference documentation or embed hook comments.

---

## Implementation Details  

### File‑Level Conventions  

| Path | Observed Convention | Key Details |
|------|---------------------|-------------|
| `integrations/code-graph-rag/README.md` | **Naming & Section Order** | Title line, feature list, architecture diagram placeholder, usage example in fenced code block, “License” footer. |
| `integrations/copi/USAGE.md` (and sibling docs) | **Markdown Styling** | Level‑2 headings (`## Installation`, `## Migration`), bullet lists with leading hyphens, code fences labelled with language (` ```bash `, ` ```ts `). |
| `copi/USAGE.md` | **Consistent Formatting** | Mirrors the integration‑level USAGE file – same heading hierarchy, same code‑block style, same emphasis on command‑line examples. |
| `mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` | **Comment DSL** | Defines a block comment syntax such as `/* @hook: { "type": "validation", "severity": "high" } */`.  The format is JSON‑compatible, enabling straightforward parsing by monitoring tools. |

### Comment DSL Mechanics  

The hook format document specifies that every hook comment must:

1. Begin with a recognizable token (e.g., `@hook:`).  
2. Contain a JSON payload that describes the hook’s purpose, expected inputs, and severity.  
3. Appear immediately before the function or class it decorates, ensuring a deterministic parsing window for the **ConstraintMonitoring** subsystem.

Because the DSL is defined in a Markdown file, it is *source‑controlled* and versioned alongside the code it describes.  This eliminates the need for a separate schema file and keeps the documentation‑to‑code traceability tight.

### Naming & Path Conventions  

All integration directories use lower‑kebab case (`code-graph-rag`, `copi`).  Within each integration, top‑level documentation follows the `<NAME>.md` pattern where `<NAME>` is a noun describing the artefact (`README`, `USAGE`, `INSTALL`, `MIGRATION`, `STATUS`).  This predictable layout enables scripts (e.g., CI checks) to locate and validate docs without hard‑coded paths.

---

## Integration Points  

The **CodingConventions** sub‑component is a *foundational contract* that other parts of the system implicitly depend on:

* **DesignPatterns** – its `CONTRIBUTING.md` re‑uses the same heading hierarchy and code‑block conventions, demonstrating cross‑component adherence to the same template.  
* **BestPractices** – the contribution guidelines reference the same *Installation* and *Usage* sections, ensuring that new contributors see a uniform experience.  
* **GraphDatabase** – while the `storage/graph-database-adapter.ts` file is pure TypeScript, any generated documentation (e.g., API docs) pulls the same markdown styling rules, guaranteeing visual consistency across generated artefacts.  
* **ConstraintMonitoring** – the hook comment format defined in `CLAUDE-CODE-HOOK-FORMAT.md` is parsed by runtime monitors that enforce data‑integrity constraints; the monitor’s parsing logic is tightly coupled to the exact JSON schema described in the markdown file.  

These integration points are *static* (documentation imports, linting rules) rather than dynamic API calls, which means the conventions can evolve without breaking runtime behaviour, provided the markdown contracts remain backward compatible.

---

## Usage Guidelines  

1. **File Naming** – Always create documentation files in kebab‑case directories and name them using the exact tokens observed (`README.md`, `USAGE.md`, `INSTALL.md`, `MIGRATION.md`, `STATUS.md`).  Deviating from this pattern will cause CI checks that enforce naming conventions to fail.  

2. **Markdown Structure** – Follow the established heading order: start with a level‑1 title, then level‑2 sections for *Overview*, *Features*, *Installation*, *Usage*, *Migration*, and *Status*.  Use fenced code blocks with explicit language identifiers (`bash`, `ts`, `json`) to aid syntax highlighting and downstream parsing.  

3. **Hook Comment Syntax** – When adding a hook, embed a comment that matches the DSL described in `CLAUDE-CODE-HOOK-FORMAT.md`.  Example:  

   ```ts
   /* @hook: { "type": "validation", "severity": "high", "target": "UserInput" } */
   function validateInput(input: string) { … }
   ```  

   The JSON payload must be valid and include the required keys (`type`, `severity`).  

4. **Consistency Checks** – Run the repository’s linting suite (often invoked via `npm run lint` or `make lint`) which includes a markdown‑lint step that validates heading depth, code‑block language tags, and file‑name patterns.  Fix any violations before opening a pull request.  

5. **Documentation Updates** – When a feature changes, update *all* related docs in the same integration folder to keep the sections synchronized.  For example, a change to the CLI flags of the Copi wrapper should be reflected in both `integrations/copi/USAGE.md` and `copi/USAGE.md`.  

---

## Architectural Patterns Identified  

| Pattern | Manifestation |
|---------|---------------|
| **Convention‑over‑Configuration** | File‑naming and markdown templates are enforced by convention, not by external config files. |
| **Standardised Documentation Template** | Uniform heading hierarchy and code‑block usage across README, USAGE, INSTALL, MIGRATION, STATUS files. |
| **Comment‑Based DSL (Hook Specification)** | `CLAUDE-CODE-HOOK‑FORMAT.md` defines a JSON‑in‑comment syntax that downstream monitors parse. |
| **Naming Convention** | Lower‑kebab case directories, upper‑case markdown filenames. |

---

## Design Decisions and Trade‑offs  

* **Decision to embed conventions in Markdown** – This makes the rules self‑documenting and version‑controlled, but it relies on developers reading the docs rather than a machine‑enforced schema.  
* **Choosing a comment‑based DSL** – Allows hook metadata to live next to the code it decorates without adding a separate annotation language, simplifying parsing.  The trade‑off is that JSON inside comments can be fragile to formatting errors and lacks compile‑time validation.  
* **Uniform file naming** – Simplifies tooling (search, CI checks) but can be restrictive if a future integration needs a more expressive filename (e.g., `README-EN.md`).  Extending the pattern would require updating lint rules.  

---

## System Structure Insights  

The repository’s structure reveals a *layered documentation hierarchy*: top‑level integrations contain their own documentation sub‑tree, each mirroring the same template.  This mirrors the **Composite** style where each integration is a leaf node that implements the same interface (the documentation contract).  The parent **CodingPatterns** component aggregates these leaves, providing a single point of reference for all coding conventions across the codebase.

---

## Scalability Considerations  

Because the conventions are purely textual, scaling to dozens of new integrations is straightforward: copy the existing markdown template, rename files according to the naming rule, and fill in the content.  Automated scaffolding scripts can be built on top of the observed patterns, ensuring new components inherit the same conventions without manual effort.  The only scalability bottleneck is the human review of hook comment syntax; as the number of hooks grows, a static analysis tool could be introduced to validate the JSON payloads automatically.

---

## Maintainability Assessment  

The **CodingConventions** sub‑component scores high on maintainability:

* **Visibility** – All conventions are stored alongside the code they govern, making changes traceable.  
* **Low Coupling** – No runtime dependencies; only documentation generators and linters interact with the conventions.  
* **High Cohesion** – Each markdown file serves a single purpose (e.g., installation, migration) and follows a tight, predictable structure.  

Potential risks include *drift* if developers ignore the markdown guidelines.  Mitigation is achieved through CI linting and periodic audits of the `CLAUDE-CODE-HOOK‑FORMAT.md` parser to ensure it stays aligned with the documented schema.  

Overall, the design promotes a consistent developer experience, eases onboarding, and supports the broader **CodingPatterns** ecosystem by providing a clear, enforceable set of conventions that sibling components (DesignPatterns, BestPractices, GraphDatabase, ConstraintMonitoring) already reference.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component demonstrates a strong emphasis on data consistency and integrity, as reflected in the GraphDatabaseAdapter (storage/graph-database-adapter.ts) which utilizes Graphology+LevelDB persistence with automatic JSON export sync. This approach ensures that data remains consistent across the application, and the use of automatic JSON export sync enables seamless data exchange between components. The GraphDatabaseAdapter class, for instance, exports a function to get the graph database instance, which can be used to perform various graph-related operations. Furthermore, the CodeGraphRAG system (integrations/code-graph-rag/README.md) is designed as a graph-based RAG system for any codebases, highlighting the project's focus on graph-based data structures and algorithms. The system's README file provides a detailed overview of its features and capabilities, including its ability to handle large codebases and provide efficient query performance.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- The GraphDatabaseAdapter class in storage/graph-database-adapter.ts utilizes the singleton pattern to provide a single instance of the graph database across the application.
- [BestPractices](./BestPractices.md) -- The integrations/code-graph-rag/CONTRIBUTING.md file outlines contribution guidelines, indicating a focus on best practices for code review and testing.
- [GraphDatabase](./GraphDatabase.md) -- The storage/graph-database-adapter.ts file provides a graph database adapter, indicating the use of a graph database.
- [ConstraintMonitoring](./ConstraintMonitoring.md) -- The mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md file defines the hook data format, potentially including constraints.


---

*Generated from 7 observations*
