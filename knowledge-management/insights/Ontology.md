# Ontology

**Type:** SubComponent

Upper ontology definitions capture broad categorical distinctions (e.g., Module, Package, Concept) while lower ontology definitions encode domain-specific subtypes, with separate file paths managed by OntologyConfigManager

## What It Is

Ontology is a SubComponent within SemanticAnalysis that provides a two-tier type system for classifying knowledge entities produced by the pipeline. It exposes two distinct interfaces—OntologyClassifier and OntologyValidator—both backed by LegacyOntologyAdapter which wraps the km-core OntologyRegistry.

## Architecture and Design

The ontology employs a two-level taxonomy: an upper ontology defining broad categories (Module, Package, Concept) and a lower ontology encoding domain-specific subtypes. These are managed as separate files by the sibling OntologyConfigManager, which supports hot-reload without MCP server restart.

![Ontology — Architecture](images/ontology-architecture.png)

The key architectural decision is the separation of classification from validation as distinct interfaces. Classification combines AST-derived structural signals (DEFINES_METHOD, CONTAINS_MODULE relationships) with semantic signals from Insights agents to resolve the most specific lower-ontology class. Validation acts as a schema gate, enforcing that every entity carries a resolvable ontologyClass before persistence accepts it.

The introduction of LegacyOntologyAdapter resolved a documented tight-coupling issue (per CRITICAL-ARCHITECTURE-ISSUES.md), decoupling pipeline agents from km-core's concrete OntologyRegistry API.

![Ontology — Relationship](images/ontology-relationship.png)

## Implementation Details

Entity type resolution is a multi-signal process: structural signals from code graph construction (AST relationships) are combined with semantic signals from insight-generation agents. The classifier walks from upper to lower ontology, selecting the most specific matching subtype. The validator then confirms resolvability before the persistence step, rejecting entities with unknown or unresolvable classes.

OntologyConfigManager (a singleton) ensures all agents in the Pipeline DAG share a single authoritative view of taxonomy files and classification thresholds. Hot-reload capability means taxonomy updates propagate without service interruption.

## Integration Points

- **Upstream**: Receives structural signals from code graph/AST agents and semantic signals from Insights agents
- **Downstream**: Gates entity flow to persistence—nothing persists without valid ontologyClass
- **Sibling dependency**: OntologyConfigManager provides config paths and thresholds; LegacyOntologyAdapter provides the registry abstraction
- **Parent pipeline**: Operates within the SemanticAnalysis DAG defined in batch-analysis.yaml, with agents extending BaseAgent for standard response envelopes

## Usage Guidelines

- Always ensure new entity types are registered in the appropriate ontology tier (upper for broad categories, lower for domain subtypes) before pipeline agents emit them
- Leverage hot-reload via OntologyConfigManager for taxonomy updates rather than restarting the server
- Classification and validation are separate concerns—use OntologyClassifier for type assignment and OntologyValidator for gate checks
- When adding structural signals for classification, ensure corresponding relationship types are documented so the classifier can leverage them


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.

### Children
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- docs/architecture/agents.md describes OntologyClassifier and OntologyValidator as distinct interfaces, indicating a separation of classification and validation concerns within the Ontology sub-component.

### Siblings
- [Pipeline](./Pipeline.md) -- batch-analysis.yaml defines the pipeline as a DAG of steps with explicit depends_on edges, enabling topological execution order across coordinator, observation, KG, dedup, and persistence agents
- [Insights](./Insights.md) -- docs/architecture/agents.md identifies a dedicated insight-generation agent responsible for authoring structured knowledge reports from aggregated code and history signals
- [OntologyConfigManager](./OntologyConfigManager.md) -- Implemented as a singleton (per docs/configuration.md patterns) to ensure all pipeline agents share a single authoritative view of ontology paths and classification thresholds
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Resolves the architectural issue documented in CRITICAL-ARCHITECTURE-ISSUES.md where OntologyClassifier was tightly coupled to an internal registry; the adapter decouples pipeline agents from the km-core registry's concrete API
- [BaseAgent](./BaseAgent.md) -- BaseAgent<TInput, TOutput> is a generic abstract class (documented in docs/architecture/agents.md) parameterized on input and output types, enforcing type safety across the heterogeneous agent pipeline


---

*Generated from 6 observations*
