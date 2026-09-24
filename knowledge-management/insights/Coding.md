# Coding

**Type:** Project

## What It Is

Coding is the root node of a personal/team development-infrastructure knowledge hierarchy, not a single codebase artifact itself. It has no direct implementation files of its own; instead it organizes seven L1 components — LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, ConstraintSystem, and SemanticAnalysis — each of which owns concrete files, classes, and behaviors. As a root, Coding's "implementation" is the aggregate of its children's implementations plus the conventions (e.g., documentation placement rules) that apply project-wide.

## Architecture and Design

The project is structured as a layered knowledge/infrastructure system rather than a runtime service architecture. Observations show no evidence of microservices or event-driven patterns at the root level; instead the architecture is a component-tree of concerns: logging/observation persistence (LiveLoggingSystem), model access abstraction (LLMAbstraction), containerized runtime services (DockerizedServices), a graph-based knowledge store (KnowledgeManagement), shared conventions (CodingPatterns), a constraint-tracking subsystem exposed via UI (ConstraintSystem), and an analysis pipeline that derives ontology data (SemanticAnalysis). Cross-cutting design decisions surface at this root level, such as the mandate (from CodingPatterns) that diagram sources and documentation artifacts live in fixed locations (docs/puml/, docs/images/) separate from MkDocs-served docs-content/images/, ensuring consistent tooling across all children.

## Implementation Details

Each child encapsulates its own mechanics: LiveLoggingSystem's ObservationWriter.js mediates observation persistence with semantic dedup and snapshot promotion; LLMAbstraction enforces endpoint-gated model access rules distinguishing Responses API vs /chat/completions; DockerizedServices requires baseline capture of supervisor/container state before restarts; KnowledgeManagement writes Insight graph entities stamped with source/subsystem metadata (e.g., 'wave-analysis') so UI filters (entityType='Insight') function correctly; ConstraintSystem integrates with a tmux statusline click-handler; SemanticAnalysis runs a pipeline that emits CodingLowerOntologySource references. The root itself contains no code symbols — it is purely a coordinating/documentation node.

## Integration Points

The children are interdependent through shared infrastructure: KnowledgeManagement's graph store appears to be the backing system that LiveLoggingSystem writes to and that SemanticAnalysis's pipeline emits ontology references into, while CodingPatterns' documentation rules apply across all components' docs. DockerizedServices likely hosts the runtime environment (containers) in which these other subsystems execute. ConstraintSystem's UI integration (tmux statusline) suggests a developer-facing surface layered atop the constraint data.

## Usage Guidelines

Developers should treat Coding as an organizational root: place new work under the correct child rather than at root level. Follow CodingPatterns' documentation rules strictly (.puml in docs/puml/, rendered .png in docs/images/). Be aware of known defects/gaps: LiveLoggingSystem's silent fallback failures, SemanticAnalysis's unresolved CodingLowerOntologySource emission bug, and the historical KnowledgeManagement gap where insight documents weren't persisted as graph nodes — always stamp new Insight entities appropriately. When modifying DockerizedServices, capture a baseline before restarts to catch regressions.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observation persistence between ETM and the database, applying turn-aware semantic dedup and snapshot promotion, but [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which API surface (Responses API vs /chat/completions), since some models are gated per-endpoint and mismatched combinations must be rejected rather than silently allowed
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and container state should be captured as a baseline to compare against post-restart state and catch regressions like stale naming or misconfigured mounts
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rendered .png files live in docs/images/, distinct from the MkDocs-served docs-content/images/ tree.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying ConstraintSystem violation state directly into the click-driven statusline UX
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 2 observations*
