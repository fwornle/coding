# Coding

**Type:** Project

## What It Is

"Coding" is the root node of a development infrastructure knowledge hierarchy — not a single implementation artifact but an organizing project that encompasses seven major L1 components: LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, ConstraintSystem, and SemanticAnalysis. There is no code directly implementing "Coding" itself; it exists as a conceptual/structural container aggregating the session records, subsystems, and conventions of the broader coding-tooling environment.

## Architecture and Design

The architecture is hierarchical: Coding sits at the top, with each child component owning a distinct concern — live process/session monitoring (LiveLoggingSystem), model routing (LLMAbstraction), container orchestration (DockerizedServices), graph-based knowledge capture (KnowledgeManagement), authoring conventions (CodingPatterns), user-facing constraint tooling (ConstraintSystem), and ontology/pipeline analysis (SemanticAnalysis). This is a domain-decomposition pattern rather than a runtime architecture — each child represents an independently evolving subsystem documented via its own session records, and Coding functions as the aggregation point tying these subsystems' knowledge together.

## Implementation Details

Because no code symbols or files are attributed directly to Coding, its "implementation" is really the sum of its children's documented behaviors: health-coordinator.js in LiveLoggingSystem computing PID staleness; a fallback tier ordering enforced somewhere in LLMAbstraction; a docker-compose rebuild/health-verification workflow in DockerizedServices; an insight-persistence gap in KnowledgeManagement (73 insight documents written without corresponding Insight graph nodes); a documentation convention requiring .puml sources under docs/puml/ in CodingPatterns; a statusline click-to-report feature in ConstraintSystem; and an unresolved CodingLowerOntologySource emission bug in SemanticAnalysis's pipeline.

## Integration Points

Coding's integration points are its seven parent-child relationships to LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, ConstraintSystem, and SemanticAnalysis. Cross-component dependencies are visible in the observations: DockerizedServices' health verification gates reliance by "downstream pipelines like wave-analysis," and KnowledgeManagement's insight-persistence defect affects the viewer's History sidebar — indicating these subsystems are consumed by shared tooling rather than operating in isolation.

## Usage Guidelines

Future work should attribute changes to the correct child component rather than to Coding directly, since Coding itself has no distinct code footprint. Documentation changes should follow CodingPatterns' rule that .puml sources live in docs/puml/. Known outstanding issues to be aware of include the KnowledgeManagement insight/graph-node persistence gap and the unresolved SemanticAnalysis CodingLowerOntologySource emission bug — both should be checked before trusting downstream reports or ontology output.

---

**Analytical notes:**
1. **Architectural patterns**: hierarchical domain decomposition; no microservice/event-driven claims are supported by evidence.
2. **Design decisions**: separation of concerns per subsystem; tradeoff is coordination overhead evidenced by the insight-persistence gap between KnowledgeManagement writes and graph nodes.
3. **Structure insights**: Coding is purely organizational — a knowledge-hierarchy root, not a runtime component.
4. **Scalability**: not addressed in observations.
5. **Maintainability**: documented defects (insight/graph mismatch, ontology emission bug) suggest maintainability gaps between subsystems' outputs and consuming tools.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as last resort — rather than demoting to lower tiers as primary
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised processes/health endpoints must be confirmed live before relying on downstream pipelines like wave-analysis
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, meaning the viewer's History sidebar (which filters strictly to entityType 'Insight') could never surface a Batch badge for that run's conclusions.
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generated diagram artifacts belong in version control versus being build outputs, enforcing consistent authoring and correct rendering across the docs pipeline.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying HookManagementSystem's violation data to a click-driven UX surface
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 2 observations*
