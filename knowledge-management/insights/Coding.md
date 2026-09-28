# Coding

**Type:** Project

## What It Is

"Coding" is the root node of the entire development infrastructure knowledge hierarchy for this project. It is not itself an implementation with specific files or classes; rather, it is an organizing entity that encompasses seven major L1 components: LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, ConstraintSystem, and SemanticAnalysis. All concrete implementation detail (specific paths, classes, functions) lives within these children, not at the root level.

## Architecture and Design

The architecture is a hierarchical decomposition of a coding-support system into distinct functional domains: capturing and classifying session activity (LiveLoggingSystem), routing LLM requests across provider tiers (LLMAbstraction), managing containerized service health (DockerizedServices), persisting derived knowledge (KnowledgeManagement), enforcing documentation/code conventions (CodingPatterns), monitoring runtime constraints (ConstraintSystem), and performing semantic/ontological analysis of content (SemanticAnalysis). Each child component appears to own its own implementation surface (e.g., ontology-classification-agent.ts for LiveLoggingSystem, lib/service-probe.js for DockerizedServices) while the root ties them together as siblings under a shared project identity.

Cross-cutting concerns are visible even at this root level: SemanticAnalysis's pipeline emits a "CodingLowerOntologySource" reference, suggesting the root "Coding" concept itself has a formal position within an ontology that lower-level components reference — an explicit modeling of the parent/child relationship in the data itself, not just in project structure.

## Implementation Details

No code symbols or files belong directly to the root; all mechanics are delegated to children. Notable child-level mechanics referenced include: the ontology-classification-agent.ts classification layer and its dedicated hierarchy-root test suite (ontology-classification-agent.hierarchy-roots.test.ts) in LiveLoggingSystem, distinguishing root-node classification correctness from general classification accuracy; the tiered fallback routing logic in LLMAbstraction (max-subscription → work/GH Copilot → Groq Llama-70B); the polling-based health-check probe in DockerizedServices' lib/service-probe.js, which uses consecutive-failure-in-window logic rather than fixed timeouts; and the documentation conventions in CodingPatterns requiring .puml sources under docs/puml/.

## Integration Points

The root's primary integration role is structural: it defines parent-child relationships to all seven components, letting them share a common project context and vault. A concrete cross-component issue surfaces in KnowledgeManagement's Wave Insight Persistence record — insight documents were written without corresponding Insight graph nodes, meaning the History sidebar's strict entityType filtering rendered 73 documents invisible to graph queries. This highlights a real integration risk between the documentation/insight-generation process and the graph-based knowledge store that underlies "Coding" as a whole. Similarly, SemanticAnalysis's unresolved "CodingLowerOntologySource Emission Bug" is a direct integration defect between the semantic pipeline and the root ontology concept.

## Usage Guidelines

Given that "Coding" is a pure organizational/root entity, guidelines center on maintaining hierarchy integrity: new work should be attributed to the correct child component rather than the root, insight documents must be persisted as proper graph nodes (entityType 'Insight') to remain queryable, and diagram/documentation conventions from CodingPatterns (.puml files in docs/puml/) should be followed project-wide. The unresolved ontology-source emission bug in SemanticAnalysis should be treated as a known defect affecting root-level ontology references until fixed.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The classification layer for LiveLoggingSystem is implemented in ontology-classification-agent.ts, which categorizes captured session content as it flows through the logging pipeline. Its hierarchy-root validation logic is tested separately in ontology-classification-agent.hierarchy-roots.test.ts, indicating that root-node classification (i.e., correctly assigning top-level ontology categories rather than leaf nodes) is treated as a distinct correctness concern from general classification accuracy — likely because incorrect root assignment cascades into misfiled session data across the entire per-person or per-project vault structure.
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as a last resort — rather than demoting to lower-tier providers as primary
- [DockerizedServices](./DockerizedServices.md) -- [LLM] lib/service-probe.js implements the health-check polling logic that determines readiness of dockerized services (semantic analysis MCP, constraint monitor) before dependent processes proceed. Rather than a single fixed timeout, the probe pattern issues periodic requests against known health endpoints and treats consecutive failures within a window as the signal for 'not ready' versus 'transiently slow', which matters in a Docker context where container startup order and cold-start times (loading models, connecting to databases) are highly variable across restarts.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 wrote 73 insight documents but zero Insight graph nodes, because the History sidebar filters strictly to entityType 'Insight' — documents alone are invisible to graph queries
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/ and generated diagram artifacts have defined placement rules, enforcing a convention for the docs pipeline to render correctly.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] Statusline Click-Report Feature establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, integrating HookManagementSystem-driven violation data with the dashboard UI
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced, indicating a gap between the L2 refinement design and current emission behavior


---

*Generated from 2 observations*
