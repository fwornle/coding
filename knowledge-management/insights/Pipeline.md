# Pipeline

**Type:** SubComponent

BaseAgent<TInput,TOutput> in src/agents/base-agent.ts enforces a six-step template-method execute() sequence (process, calculateConfidence, detectIssues, generateRouting, applyCorrections, buildMetadata) that all pipeline agents must follow without short-circuiting

## What It Is

The Pipeline is a SubComponent of SemanticAnalysis that defines the ordered execution structure through which semantic processing work flows. Rather than being a single file or class itself, the Pipeline is the conceptual and structural arrangement of named agents—`CodeGraphAgent`, `SemanticAnalysisAgent`, `OntologyClassificationAgent`, and `ContentValidationAgent`—each wired into a coordinator's dispatch order. The foundational contract for every stage in this pipeline is defined in `src/agents/base-agent.ts`, which houses `BaseAgent<TInput,TOutput>`. All pipeline agents inherit from this base class, making it the single most important file for understanding how the pipeline operates at runtime.

The Pipeline's child component, TemplatMethodExecuteSequence, captures the structural heart of how each stage executes. Its sibling components—Ontology, Insights, OntologyRegistry, and KmCoreAdapter—represent the downstream consumers and supporting infrastructure that the pipeline feeds into or relies upon.

---

## Architecture and Design

![Pipeline — Architecture](images/pipeline-architecture.png)

The Pipeline is organized around a **coordinator-dispatch model** inherited from its parent, SemanticAnalysis. The coordinator holds knowledge of agent ordering and is responsible for routing `AgentResponse` envelopes between stages, but it is deliberately kept ignorant of each agent's internal domain logic. This separation means the coordinator can handle routing generically: it inspects the uniform `AgentResponse` envelope returned by every agent and decides what to invoke next without needing to understand whether it just received a code graph result or an ontology classification.

Within each agent, the architectural pattern is the **template method**, implemented through TemplatMethodExecuteSequence. The six-step sequence—`process`, `calculateConfidence`, `detectIssues`, `generateRouting`, `applyCorrections`, `buildMetadata`—is enforced by `BaseAgent<TInput,TOutput>` in `src/agents/base-agent.ts`. The base class controls invocation order absolutely; subclasses provide stage-specific behavior by implementing abstract or overridable methods, but they cannot reorder or skip steps. This is a deliberate rigidity: consistency of output shape and metadata completeness is valued over execution efficiency for simple cases.

![Pipeline — Relationship](images/pipeline-relationship.png)

A notable architectural decision is that **deduplication is a discrete pipeline stage** rather than a responsibility distributed across agents. Duplicate detection runs after observation generation but before persistence, which means the pipeline has a clean separation between "what did we observe?" and "is this observation novel?" This avoids contaminating agent logic with cross-cutting storage concerns and allows the deduplication stage to be reasoned about, tested, and replaced independently.

The interaction with the graph layer is similarly isolated. KG operators in the pipeline communicate with the graph through a configurable batch-sizing mechanism (`MEMGRAPH_BATCH_SIZE`), keeping batch tuning as an operational concern distinct from agent logic. The canonical write path to storage runs through `storage/km-core-adapter.ts` (see KmCoreAdapter), which centralizes entity writes that were previously fragmented.

---

## Implementation Details

Every agent in the pipeline is a concrete subclass of `BaseAgent<TInput,TOutput>` from `src/agents/base-agent.ts`. The generic type parameters make the contract explicit: each agent declares its expected input and output types, and the coordinator can type-safely pass envelopes between stages. The template method's six steps as defined in TemplatMethodExecuteSequence break down as follows:

1. **`process()`** — The only step where domain-specific logic lives. For `OntologyClassificationAgent`, this is where entity type resolution occurs (see Ontology). For `CodeGraphAgent`, this is where graph construction happens.
2. **`calculateConfidence()`** — Produces a confidence score attached to the result. This runs unconditionally, even for agents whose output is deterministic and trivially certain.
3. **`detectIssues()`** — Scans the processed output for anomalies or validation failures.
4. **`generateRouting()`** — Produces routing hints that the coordinator uses to decide what stage handles the envelope next.
5. **`applyCorrections()`** — Allows the agent to self-correct its output before handing it off.
6. **`buildMetadata()`** — Constructs the metadata block attached to the `AgentResponse` envelope.

The result of every agent execution is a uniform `AgentResponse` envelope. This uniformity is what makes the coordinator's generic routing viable. The Insights sibling component, for example, consumes `AgentResponse` envelopes that carry `entityType` and `ontologyClass` fields populated by `OntologyClassificationAgent`—it does not need to know how those fields were produced, only that they will be present in the envelope.

The inability to short-circuit the sequence is enforced at the base class level. An agent that attempts to bypass steps would need to throw an exception, making silent short-circuits structurally impossible. This is a conscious tradeoff documented in the parent SemanticAnalysis description.

---

## Integration Points

The Pipeline sits inside SemanticAnalysis and delegates persistence concerns outward to KmCoreAdapter (`storage/km-core-adapter.ts`), which is the canonical endpoint for all entity write operations. Graph-layer interactions are mediated by KG operators configured via `MEMGRAPH_BATCH_SIZE`, decoupling throughput tuning from pipeline logic.

The Ontology sibling provides the classification results that flow forward to Insights generation. This means the pipeline stages are sequentially dependent: `OntologyClassificationAgent` must complete and populate the `AgentResponse` envelope before Insights can consume it. The OntologyRegistry sibling, through `LegacyOntologyAdapter`'s strangler-facade pattern, supplies ontology data to classification without requiring pipeline agents to know whether they are talking to a legacy or modern registry implementation.

The deduplication stage integrates between observation generation and the KmCoreAdapter write path, acting as a gate that prevents redundant data from reaching persistence. Its position in the pipeline is fixed by design—it must see the full observation before any write occurs.

---

## Usage Guidelines

**Adding a new pipeline agent** requires only implementing the domain-specific `process()` method in a subclass of `BaseAgent<TInput,TOutput>`. The remaining five steps in TemplatMethodExecuteSequence will execute automatically. Developers should not attempt to skip or reorder steps; doing so requires throwing an exception and will break the coordinator's assumptions about envelope completeness. If an agent's logic is truly trivial, the overhead of confidence scoring and metadata construction is a known and accepted cost of pipeline membership.

**Routing logic** should be expressed through `generateRouting()` output in the `AgentResponse` envelope rather than by reaching into the coordinator directly. The coordinator is designed to remain domain-agnostic; embedding routing knowledge inside an agent's envelope output maintains that separation.

**Batch sizing for graph operations** (`MEMGRAPH_BATCH_SIZE`) should be treated as an operational configuration concern, not something individual agents need to manage. Adjusting this value affects KG operator throughput without requiring any agent code changes.

When consuming `AgentResponse` envelopes downstream (as Insights does), consumers should rely on the presence of the full metadata block as a guarantee, since `buildMetadata()` cannot be skipped. This makes the envelope a reliable, complete contract rather than a partially populated struct that might be missing fields depending on which agent produced it.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis pipeline is structured around a coordinator pattern where specialized agents each extend BaseAgent<TInput,TOutput> defined in src/agents/base-agent.ts. This base class implements a strict template-method execute() that sequences six steps in order: process(), calculateConfidence(), detectIssues(), generateRouting(), applyCorrections(), and buildMetadata(). Every agent—CodeGraphAgent, SemanticAnalysisAgent, OntologyClassificationAgent, ContentValidationAgent—inherits this contract and returns a uniform AgentResponse envelope. This design means a new developer adding an agent only needs to implement the domain-specific process() logic; confidence scoring, issue detection, and metadata construction are guaranteed to run in a consistent order regardless of which agent is invoked. The tradeoff is that the template method imposes overhead steps even when an agent's output is trivially simple, and agents cannot short-circuit the sequence without throwing exceptions.

### Children
- [TemplatMethodExecuteSequence](./TemplatMethodExecuteSequence.md) -- The six steps—process, calculateConfidence, detectIssues, generateRouting, applyCorrections, buildMetadata—are defined as abstract or overridable methods in BaseAgent<TInput,TOutput> (src/agents/base-agent.ts), forcing subclasses to provide stage-specific logic while the base class controls invocation order.

### Siblings
- [Ontology](./Ontology.md) -- OntologyClassificationAgent extends BaseAgent and implements domain-specific process() logic for entity type resolution while relying on the base class for confidence scoring and metadata construction
- [Insights](./Insights.md) -- Insight generation runs after ontology classification, consuming AgentResponse envelopes with populated entityType and ontologyClass fields produced by OntologyClassificationAgent
- [OntologyRegistry](./OntologyRegistry.md) -- LegacyOntologyAdapter implements the strangler-facade pattern, exposing the old ontology-loading interface while delegating internally to km-core OntologyRegistry
- [KmCoreAdapter](./KmCoreAdapter.md) -- storage/km-core-adapter.ts is the canonical file for this component, centralizing all entity write paths that were previously split across GraphDatabaseAdapter and PersistenceAgent


---

*Generated from 6 observations*
