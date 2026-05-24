# FiveStageAbstractContract

**Type:** Detail

Declared in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`, the five abstract methods partition agent behavior into typed semantic stages: data transformation (`process`), <USER_ID_REDACTED> scoring (`calculateConfidence`), fault detection (`detectIssues`), dispatch logic (`generateRouting`), and self-healing (`applyCorrections`).

# FiveStageAbstractContract — Technical Insight Document

## What It Is

The `FiveStageAbstractContract` is declared in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts` as a set of five abstract methods on the generic class `BaseAgent<TInput, TOutput>`. Together, these methods partition agent behavior into a fixed, typed sequence of semantic stages: `process()` (data transformation), `calculateConfidence()` (<USER_ID_REDACTED> scoring), `detectIssues()` (fault detection), `generateRouting()` (dispatch logic), and `applyCorrections()` (self-healing). This contract is the structural backbone of every concrete agent in the semantic-analysis MCP server.

As a `Detail` of its parent entity `AgentBase`, the contract defines *what* each subclass must implement, while its sibling `SealedExecutePipeline` defines *how* and *in what order* those implementations are invoked. The two are complementary: one specifies the obligations of subclasses, the other specifies the immutable control flow that consumes those obligations.

Because all five methods are declared as abstract with no default implementations, the TypeScript compiler enforces complete implementation by every concrete subclass. The contract is intentionally all-or-nothing — there is no optional method, no fallback behavior, and no partial implementation path.

## Architecture and Design

The contract operates as the abstract half of a **template-method pattern**, paired with `SealedExecutePipeline` as the sealed driver. `BaseAgent<TInput, TOutput>` exposes a sealed `execute()` method (described by the parent `AgentBase`) which unconditionally calls all five abstract methods in a fixed order. This separation places the orchestration concern in the base class while delegating semantically specific work to subclasses — a textbook inversion of control where the framework calls the agent, not the reverse.

The five stages are themselves chosen to express a deliberate processing philosophy: transformation followed by *<USER_ID_REDACTED> reflection* (`calculateConfidence`), *fault introspection* (`detectIssues`), *forward dispatch* (`generateRouting`), and *self-correction* (`applyCorrections`). This sequencing builds resilience into every agent by construction. An agent cannot simply transform data and exit; it must always reason about its own output <USER_ID_REDACTED>, surface defects, plan downstream routing, and attempt corrections. The contract therefore encodes architectural values — observability, self-assessment, and self-healing — directly into the type system.

The generic parameters `TInput` and `TOutput` on `BaseAgent<TInput, TOutput>` define the typed boundary that crosses the contract. `process()` is the primary transformation between these two types, while the remaining four stages operate on derived or intermediate results from `process()`. This makes `process()` the anchor stage; the other four are conceptually positioned around it.

The existence of `integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md` (titled "CRITICAL Architecture Issues - RESOLVED") in the same package indicates that the unconditional, all-or-nothing nature of this contract — combined with the sealed pipeline that always invokes every stage — was historically a friction point. The resolution preserved the strict five-stage shape rather than relaxing it, reinforcing that this contract is a load-bearing design decision.

## Implementation Details

The contract is implemented purely through TypeScript's abstract-method mechanism on `BaseAgent<TInput, TOutput>` in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. Each of the five methods — `process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, and `applyCorrections()` — is declared without a body, forcing subclasses to provide concrete implementations. There are no protected default helpers and no optional override hooks; the only contractually visible surface is these five methods.

The mechanics of invocation live in the sibling `SealedExecutePipeline`: the `execute()` method on `BaseAgent<TInput, TOutput>` is sealed (non-overridable) and calls all five abstract methods unconditionally. Concrete subclasses cannot reorder the stages, skip any of them, or short-circuit the flow. This means each abstract method has a guaranteed, fixed call site — implementers know exactly when and in what order their code will run.

The typing strategy is minimalist. By parameterizing only `TInput` and `TOutput`, the contract leaves room for the four supporting stages to use their own internal types (confidence scores, issue lists, routing decisions, correction records) without bloating the generic signature. This keeps the contract approachable while still type-safe at its primary input/output boundary.

Because no code symbols are catalogued under `FiveStageAbstractContract` itself (it is a contract-as-shape rather than a concrete class), its observable footprint is entirely the five method declarations on `BaseAgent<TInput, TOutput>`.

## Integration Points

The most direct integration is with `AgentBase`, the parent entity that contains this contract and exposes the sealed `execute()` driver that calls each of the five stages. From the agent author's perspective, satisfying `FiveStageAbstractContract` is the sole entry requirement for participating in the `BaseAgent<TInput, TOutput>` framework.

The sibling `SealedExecutePipeline` is the runtime counterpart: it consumes the contract's five methods in a fixed sequence and guarantees that none can be bypassed. Any concrete agent class in `integrations/mcp-server-semantic-analysis/src/agents/` inherits from `BaseAgent<TInput, TOutput>` and therefore couples to both the contract and the pipeline simultaneously — they are not independently usable.

Downstream consumers of agent output rely on the contract indirectly. Because every agent emits routing decisions through `generateRouting()` and surfaces issues through `detectIssues()`, the broader semantic-analysis system can compose agents into pipelines and reason about their reliability without needing to know each agent's internal logic. The contract is, in effect, the lingua franca by which agents expose themselves to the rest of the MCP server.

The `CRITICAL-ARCHITECTURE-ISSUES.md` document in the same package serves as historical context for integrators: it confirms that earlier tensions around unconditional stage invocation have been resolved, and that current code should treat the five-stage shape as stable.

## Usage Guidelines

When extending `BaseAgent<TInput, TOutput>`, implementers must provide all five methods — there is no partial path. Treat each stage as semantically required: `process()` for the core transformation, `calculateConfidence()` for honest self-assessment of output <USER_ID_REDACTED>, `detectIssues()` for surfacing problems, `generateRouting()` for indicating where the result should go next, and `applyCorrections()` for attempting self-healing on detected issues. Do not collapse stages by leaving one as a trivial no-op unless that is genuinely the correct semantics for the agent in question.

Do not attempt to override `execute()` or otherwise circumvent `SealedExecutePipeline`. The sealed pipeline is a deliberate architectural constraint, and the resolution noted in `CRITICAL-ARCHITECTURE-ISSUES.md` indicates that prior pressure to weaken this guarantee was rejected in favor of preserving uniform agent behavior. If a stage doesn't fit your agent's needs, the correct response is to rethink the agent's responsibilities, not to bypass the contract.

Keep the generic parameters `TInput` and `TOutput` meaningful and narrow. Because `process()` is the only stage that explicitly spans these types, accurate typing here improves readability for the four downstream stages that consume its output. Define richer internal types for confidence scores, issue records, and routing decisions inside the agent rather than leaking them through `TOutput`.

**Architectural patterns identified:** template-method (sealed driver + abstract steps), inversion of control, contract-as-type (compiler-enforced completeness via abstract methods).

**Design decisions and trade-offs:** The all-or-nothing five-stage shape trades implementation flexibility for uniform agent semantics, observability, and self-healing by construction. The sealed `execute()` removes the ability to customize control flow, which simplifies reasoning about agent behavior at the cost of forcing every agent into the same five-phase lifecycle.

**System structure insights:** The contract sits at the architectural seam between the `AgentBase` framework and concrete agents, with `SealedExecutePipeline` as its runtime executor. This three-part structure (contract, sealed pipeline, concrete agents) is the dominant organizing principle for `integrations/mcp-server-semantic-analysis/src/agents/`.

**Scalability considerations:** New agents scale linearly in development effort because the contract dictates a uniform implementation shape. The uniformity also enables higher-order composition — pipelines and orchestrators can treat any agent identically, since they all expose confidence, issues, routing, and corrections in the same way.

**Maintainability assessment:** Maintainability is high at the framework level because the contract is small, compiler-enforced, and stable (as confirmed by the resolved status of `CRITICAL-ARCHITECTURE-ISSUES.md`). The trade-off lands on subclass authors, who must implement all five stages even when one feels marginal — but this cost is the same cost that yields uniform observability and self-healing across the entire agent population.


## Hierarchy Context

### Parent
- [AgentBase](./AgentBase.md) -- BaseAgent<TInput, TOutput> in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts uses a template-method pattern where execute() is sealed and unconditionally calls all five abstract methods: process(), calculateConfidence(), detectIssues(), generateRouting(), and applyCorrections()

### Siblings
- [SealedExecutePipeline](./SealedExecutePipeline.md) -- In `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`, `execute()` is defined as sealed on `BaseAgent<TInput, TOutput>`, meaning no concrete subclass can override the top-level control flow or reorder, skip, or short-circuit any of the five stages.


---

*Generated from 4 observations*
