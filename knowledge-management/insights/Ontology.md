# Ontology

**Type:** SubComponent

Serves as The ontology classification system: upper/lower ontology definitions, entity type resolution, and validation. within the SemanticAnalysis component at hierarchy path Coding/SemanticAnalysis/Ontology

## What It Is

Ontology is a sub-component of SemanticAnalysis, located at the hierarchy path `Coding/SemanticAnalysis/Ontology`. It serves as the ontology classification system for the broader SemanticAnalysis pipeline, responsible for three tightly coupled concerns: upper/lower ontology definitions, entity type resolution, and validation. As an L2 SubComponent, it sits one level below SemanticAnalysis and operates alongside sibling components including Pipeline, Insights, OntologyRegistry, and GitStalenessDetector.

The component does not have indexed code symbols at this time, which suggests it may be in early definition, is abstracted through runtime configuration, or its implementation is primarily expressed through the OntologyClassificationAgent within the parent SemanticAnalysis system rather than through standalone files.

---

## Architecture and Design

The design of Ontology reflects a layered classification philosophy that distinguishes between **upper ontology** (universal, domain-agnostic categories) and **lower ontology** (domain-specific, project-contextualized types). This two-tier ontological structure is a deliberate architectural decision that allows the system to remain general enough to classify arbitrary codebases while still resolving concrete, project-specific entity types.

![Ontology — Relationship](images/ontology-relationship.png)

Within the SemanticAnalysis pipeline, the OntologyClassificationAgent is the primary consumer of Ontology's definitions. That agent is responsible for classifying observations against these upper/lower hierarchies, meaning Ontology acts as the **schema authority** — it defines what valid classifications look like, while the agent performs the matching. This separation of schema from classification logic is a sound design decision: it allows ontology definitions to evolve independently of the LLM-driven classification mechanics.

The sibling relationship with OntologyRegistry is architecturally significant. Where Ontology likely holds the **structural definitions and resolution logic**, OntologyRegistry likely handles **persistence and lookup** of classified entities. The two components together form a definition-and-registry pair — a common pattern in type systems and knowledge graphs where schema definition is kept separate from the runtime registry of instances.

Validation is explicitly listed as a core responsibility of Ontology. This positions it not merely as a passive schema, but as an **active enforcement layer** — ensuring that entities resolved by the pipeline conform to recognized types before they are persisted or surfaced through Insights.

---

## Implementation Details

No code symbols or key files are currently indexed for this component. Based on the observations and the parent context, the implementation likely manifests in one or more of the following forms:

- **Upper ontology definitions**: A structured representation (likely declarative — JSON, YAML, or Python dataclasses) of universal entity categories such as `Function`, `Class`, `Module`, `Dependency`, or `Concept`. These would be domain-agnostic and stable across projects.
- **Lower ontology definitions**: Project-contextualized or domain-specific subtypes that extend or specialize upper categories, resolved at classification time based on the target repository's language, framework, or coding conventions.
- **Entity type resolution logic**: A resolver that takes a raw observation or AST node and maps it to a canonical ontology type, likely consuming signals from the CodeGraphAgent (Tree-sitter/Memgraph AST data) and SemanticAnalysisAgent (LLM-derived cross-correlations).
- **Validation routines**: Rules that enforce type consistency, flag unresolvable entities, and potentially feed issue signals back through the BaseAgent's standard response envelope (confidence breakdown, issue detection, routing suggestions).

The absence of indexed symbols warrants attention — future indexing passes should surface the concrete classes and functions that implement these responsibilities.

---

## Integration Points

Ontology integrates with the SemanticAnalysis pipeline at several critical junctures. The most direct integration is with **OntologyClassificationAgent**, which consumes Ontology's type hierarchy to classify processed observations. Without Ontology's definitions, the agent has no schema to classify against.

The **OntologyRegistry** sibling depends on Ontology to know what types are valid before registering entity instances. This creates a directional dependency: Ontology must be initialized and stable before OntologyRegistry can operate correctly.

The **Pipeline** sibling, which coordinates the sequencing of agents within SemanticAnalysis, likely invokes ontology classification as a discrete stage — after raw data extraction (CodeGraphAgent, git/vibe processing) and before persistence or insight generation. This positions Ontology's resolution and validation logic as a **mid-pipeline gate**.

The **Insights** sibling consumes the output of the classification pipeline, meaning the <USER_ID_REDACTED> and completeness of Ontology's type definitions directly determines the richness and accuracy of generated insights. Poorly defined or missing lower-ontology types would produce underspecified or misclassified entities in the Insights layer.

The **GitStalenessDetector** sibling interacts with Ontology indirectly — stale entity detection (via file-reference and git-commit correlation, handled by ContentValidationAgent) needs to resolve entity types to understand what kinds of entities can become stale and how staleness should be interpreted per type.

---

## Usage Guidelines

Developers working with or extending Ontology should treat the upper ontology definitions as **stable contracts**. Changes to upper ontology types propagate through the entire classification pipeline, affecting OntologyClassificationAgent behavior, OntologyRegistry schemas, and Insights output simultaneously. Upper ontology changes should be treated with the same rigor as breaking API changes.

Lower ontology definitions are the appropriate extension point for project- or domain-specific classification needs. When onboarding a new repository type or language ecosystem, lower ontology entries should be added rather than modifying upper categories.

Validation logic within Ontology should be kept **stateless and deterministic**. Because it feeds into the BaseAgent response envelope (used across all agents in SemanticAnalysis), non-deterministic validation would introduce noise into confidence breakdowns and issue detection signals across the entire pipeline.

When the component gains indexed code symbols, developers should ensure that entity type resolution functions are independently testable against both upper and lower ontology layers. The two-tier structure implies two distinct resolution paths that should be exercised separately in tests to avoid conflation of universal and domain-specific classification failures.

Finally, the relationship between Ontology and OntologyRegistry should be treated as **schema-before-registry**: any new entity type must be defined and validated within Ontology before it can be registered or <USER_ID_REDACTED> through OntologyRegistry. Enforcing this ordering prevents orphaned registry entries that reference undefined types.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline within the mcp-server-semantic-analysis integration that processes git history, LSL (vibe) sessions, and AST-parsed code graphs to extract, classify, and persist structured knowledge entities. The system coordinates several specialized agents: CodeGraphAgent indexes repositories via Tree-sitter/Memgraph, SemanticAnalysisAgent performs LLM-driven cross-correlation of git/vibe/code data, OntologyClassificationAgent classifies observations against upper/lower ontology hierarchies, ContentValidationAgent detects stale entities via file-reference and git-commit correlation, and a BaseAgent abstract class provides the standard response envelope (confidence breakdown, issue detection, routing suggestions) used by all agents.

### Siblings
- [Pipeline](./Pipeline.md) -- Pipeline is a sub-component of SemanticAnalysis
- [Insights](./Insights.md) -- Insights is a sub-component of SemanticAnalysis
- [OntologyRegistry](./OntologyRegistry.md) -- OntologyRegistry is a sub-component of SemanticAnalysis
- [GitStalenessDetector](./GitStalenessDetector.md) -- GitStalenessDetector is a sub-component of SemanticAnalysis


---

*Generated from 3 observations*
