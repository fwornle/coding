# TemplatMethodExecuteSequence

**Type:** Detail

The six steps—process, calculateConfidence, detectIssues, generateRouting, applyCorrections, buildMetadata—are defined as abstract or overridable methods in BaseAgent<TInput,TOutput> (src/agents/base-agent.ts), forcing subclasses to provide stage-specific logic while the base class controls invocation order.

# TemplatMethodExecuteSequence: Technical Insight Document

## What It Is

`TemplatMethodExecuteSequence` is the enforced execution contract implemented in `src/agents/base-agent.ts` via the `BaseAgent<TInput, TOutput>` abstract class. It defines a fixed six-step sequence that every agent in the Pipeline must execute in order: **process → calculateConfidence → detectIssues → generateRouting → applyCorrections → buildMetadata**. This sequence is not optional or negotiable — the base class controls invocation order, and subclasses fulfill each step by implementing abstract or overridable methods. No agent in the pipeline may short-circuit this sequence.

## Architecture and Design

**Pattern: Template Method**

The design is a textbook application of the Gang of Four Template Method pattern. `BaseAgent<TInput, TOutput>` defines the algorithm skeleton in its `execute()` method, delegating each step to overridable hooks. Subclasses provide stage-specific logic without ever altering the sequence itself. This is a deliberate inversion of control: the base class *owns the sequence*, subclasses *own the behavior*.

The six steps are not arbitrary. They encode a specific epistemic ordering: you must *assess* before you *correct*. `calculateConfidence` and `detectIssues` are positioned before `applyCorrections` by design, ensuring that any corrective action taken in a given execution pass is always grounded in a confidence score and issue list computed from the *same input data*. This eliminates a class of bugs where corrections might be applied based on assessments from a prior execution cycle — stale assessments are structurally impossible within a single pass.

`generateRouting` sits in the fourth position, after assessment but before final correction and metadata assembly. This placement means routing decisions are informed by confidence and issues, but are produced before the agent finalizes its output — giving the `CoordinatorAgent` early signal about where the output should flow, without requiring a second pass.

**Design Decision: Data-Driven Routing Over Hard-Coded Transitions**

A notable architectural choice is that `generateRouting` produces `AgentResponse` routing hints rather than encoding downstream targets as static configuration. The `CoordinatorAgent` consumes these hints to determine which agent receives the output. This means stage transitions are a runtime *data decision*, not a compile-time *topology decision*. The pipeline can branch, retry, or escalate based on what an agent actually observed about its input, rather than following a fixed graph of edges.

## Implementation Details

Each of the six steps maps to an abstract or overridable method in `BaseAgent<TInput, TOutput>`:

- **`process`**: Core transformation logic. This is the primary computation step where the agent acts on `TInput` to produce intermediate results.
- **`calculateConfidence`**: Produces a confidence score for the output of `process`. This score is available to all subsequent steps in the same execution pass.
- **`detectIssues`**: Inspects the processed output and confidence score to produce a structured issue list. Both this result and the confidence score feed into correction logic.
- **`generateRouting`**: Emits `AgentResponse` routing hints that the `CoordinatorAgent` uses to select the next downstream agent. Because this step has access to confidence and issues, routing can be adaptive — a low-confidence result might route to a review agent rather than proceeding downstream.
- **`applyCorrections`**: Applies fixes or adjustments informed by the confidence score and issue list computed earlier in the same pass. The structural guarantee that corrections are never based on stale assessments is enforced here by sequence position.
- **`buildMetadata`**: Assembles final metadata for the `AgentResponse`, likely capturing provenance, scores, and issue summaries for downstream consumers and observability.

The `execute()` method in `BaseAgent` calls these six methods in strict order. Subclasses cannot reorder them — only override their implementations.

## Integration Points

`TemplatMethodExecuteSequence` is the core behavioral contract of the **Pipeline**. Every agent that participates in the pipeline inherits from `BaseAgent<TInput, TOutput>` and is therefore bound to this sequence. The Pipeline itself is the containing structure that coordinates multiple such agents.

The primary external integration point is the **`CoordinatorAgent`**, which consumes the `AgentResponse` routing hints produced by `generateRouting`. This creates a two-party contract: agents produce routing signals, and the coordinator acts on them. The <USER_ID_REDACTED> of pipeline routing is therefore a function of how well individual agents implement `generateRouting` — particularly their use of confidence scores and detected issues to produce meaningful routing decisions.

Within a single agent execution, `calculateConfidence` and `detectIssues` act as internal integration points: their outputs are not just returned to the caller but are expected to be consumed by `applyCorrections` within the same pass. The base class sequence enforces this dependency implicitly through ordering.

## Usage Guidelines

**Do not short-circuit the sequence.** The parent component Pipeline explicitly documents that all agents must follow the six-step sequence without short-circuiting. Subclasses that return early from `process` or produce empty stubs for `calculateConfidence` or `detectIssues` will produce corrections and routing decisions that are semantically invalid, even if they compile and run without error.

**Treat `calculateConfidence` and `detectIssues` as inputs to `applyCorrections`, not independent outputs.** The architectural guarantee of same-pass assessment only holds if subclass implementations actually compute meaningful values in these steps. Returning a hardcoded confidence of `1.0` or an empty issue list defeats the ordering guarantee and will produce corrections that are indistinguishable from uncorrected output.

**Use `generateRouting` to encode real agent judgments about output <USER_ID_REDACTED>.** Because the `CoordinatorAgent` relies on routing hints for data-driven sequencing, agents that return generic or static routing responses collapse the pipeline's adaptive branching capability into a fixed topology — undermining the primary architectural advantage of this design.

**Scalability and Maintainability:** The Template Method structure scales well for adding new agent types: each new subclass gets the full sequence enforcement for free. The cost is rigidity — if a future agent type has a legitimate reason to skip a step (e.g., a passthrough agent that cannot meaningfully compute confidence), it must still implement all six methods, likely as no-ops. This is a known trade-off of the pattern. The data-driven routing through `CoordinatorAgent` provides the primary scalability lever for pipeline topology, allowing new routing logic to be introduced by changing agent implementations rather than pipeline wiring.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- BaseAgent<TInput,TOutput> in src/agents/base-agent.ts enforces a six-step template-method execute() sequence (process, calculateConfidence, detectIssues, generateRouting, applyCorrections, buildMetadata) that all pipeline agents must follow without short-circuiting


---

*Generated from 3 observations*
