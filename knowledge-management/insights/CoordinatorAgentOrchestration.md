# CoordinatorAgentOrchestration

**Type:** Detail

The parent component context explicitly names GitHistoryAgent, VibeHistoryAgent, and CodeGraphAgent as distinct specialized agents all residing in integrations/mcp-server-semantic-analysis/src/agents/, indicating a deliberate decomposition where each agent owns a single analysis domain (git history, vibe/intent history, and code graph respectively).

# CoordinatorAgentOrchestration

## What It Is

CoordinatorAgentOrchestration is the central sequencing mechanism within the `Pipeline` component of the semantic analysis MCP server, implemented across the agent modules in `integrations/mcp-server-semantic-analysis/src/agents/`. It is the orchestration layer responsible for invoking specialized analysis agents — specifically `GitHistoryAgent`, `VibeHistoryAgent`, and `CodeGraphAgent` — in a deliberate order and managing the handoff of intermediate context between them.

The orchestration pattern is formally documented as a first-class architectural concern in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` ("Agent Architecture"), which establishes the coordinator-plus-specialists structure as a deliberate design rather than an incidental implementation choice. This signals that the decomposition of analysis responsibilities across multiple agents — each owning a single analytical domain — is considered a primary architectural decision worth dedicated reference documentation.

As a `Detail`-type component nested within the broader `Pipeline`, CoordinatorAgentOrchestration sits alongside sibling concerns such as `TieredModelSelectionPolicy`. Where the sibling policy governs *which* model handles a given step, the coordinator governs *which agent runs when* and *how their outputs flow forward*.

## Architecture and Design

The architectural pattern at play is a **coordinator/specialist decomposition** (sometimes called the orchestrator pattern), where a central coordinator owns sequencing logic while specialized agents each own a single analysis domain. The three named specialists make this division explicit:

- `GitHistoryAgent` — owns analysis of git history
- `VibeHistoryAgent` — owns analysis of vibe/intent history
- `CodeGraphAgent` — owns analysis of the code graph

All three reside together in `integrations/mcp-server-semantic-analysis/src/agents/`, reinforcing that they are peers operating under a common coordination contract. The `et cetera` qualifier in the parent context implies the set is extensible, suggesting the coordinator is designed to accommodate additional specialists without structural rework.

The presence of `integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md` ("CRITICAL Architecture Issues - RESOLVED") indicates that the coordinator's sequencing logic was itself subject to a significant breaking revision. The most natural reading is that the ordering or coupling between specialist agents was previously incorrect — for example, an agent may have been invoked before its upstream dependency produced required context — and that the resolved design now reflects a corrected dependency-aware sequencing strategy. This history is important for designers: the current coordinator shape is the *result* of resolving a non-trivial ordering problem, and changes to the sequence should be made with awareness that such ordering carries known sharp edges.

The handoff mechanics between specialists are addressed in `integrations/mcp-server-semantic-analysis/docs/architecture/integration.md` ("Integration Patterns"), which is the canonical reference for how intermediate analysis results are shared across pipeline stages. This separation — sequencing in `agents.md`, integration/handoff in `integration.md` — reflects a clean conceptual split between "what runs in what order" and "what data crosses the boundary."

## Implementation Details

Concrete code symbols for the coordinator are not surfaced in the available observations (no specific class or function names beyond the agent names themselves), so implementation specifics must be derived from the documented structure. What can be stated with confidence:

1. **Agent location**: every specialist agent lives in `integrations/mcp-server-semantic-analysis/src/agents/`, which is therefore the canonical directory where the coordinator either resides or imports from.
2. **Agent boundaries are domain-aligned**: `GitHistoryAgent` does not encroach on code-graph concerns, and vice versa. The coordinator is the only component that holds the cross-domain view.
3. **Sequencing is explicit and revisable**: the existence of a dedicated, formerly-critical architecture document about sequencing implies that the order is encoded in the coordinator (not implicit in agent self-invocation), making it a single point where the pipeline shape can be reasoned about and changed.

Within the parent `Pipeline`, the coordinator collaborates with the sibling `TieredModelSelectionPolicy`. The natural division of labor is: the coordinator decides *what step runs next*, and `TieredModelSelectionPolicy` decides *which model tier services that step*. These are orthogonal concerns and likely composed at the point where the coordinator dispatches work to an individual agent.

## Integration Points

The principal integration surfaces, as evidenced by the observations, are:

- **Downward to specialists**: the coordinator invokes `GitHistoryAgent`, `VibeHistoryAgent`, and `CodeGraphAgent` (and additional agents in `integrations/mcp-server-semantic-analysis/src/agents/`). The interface contract for these invocations is the implicit shared concern documented in `docs/architecture/integration.md`.
- **Upward to the Pipeline**: the coordinator is the embodiment of the Pipeline's execution semantics — the `Pipeline` parent component delegates ordering and handoff entirely to this orchestration layer.
- **Sideways to TieredModelSelectionPolicy**: as a sibling concern, the model-selection policy is consulted (directly or indirectly) when the coordinator dispatches work, so that each agent runs on the appropriate model tier. The formal proposal for that policy lives in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`.
- **Documentation surfaces**: two architecture documents are authoritative — `docs/architecture/agents.md` for the agent structure, and `docs/architecture/integration.md` for the integration/handoff patterns. The historical context lives in `CRITICAL-ARCHITECTURE-ISSUES.md`.

The fact that intermediate results must "flow between pipeline stages" (as implied by `integration.md`'s scope) means the coordinator carries an implicit context-accumulation responsibility: outputs from earlier agents become inputs available to later agents. This is the most likely site of the previously-resolved critical issue.

## Usage Guidelines

When working with or extending CoordinatorAgentOrchestration, observe the following conventions grounded in the documented design:

1. **Keep specialist agents single-domain.** The decomposition into `GitHistoryAgent`, `VibeHistoryAgent`, and `CodeGraphAgent` is deliberate. A new analytical concern should become a new agent in `integrations/mcp-server-semantic-analysis/src/agents/`, registered with the coordinator, rather than being grafted onto an existing specialist.

2. **Treat agent ordering as load-bearing.** The resolution recorded in `CRITICAL-ARCHITECTURE-ISSUES.md` demonstrates that sequencing errors have produced critical-severity problems before. Changes to ordering should be accompanied by review against `docs/architecture/agents.md` and the handoff contracts in `docs/architecture/integration.md`.

3. **Route data handoffs through documented integration patterns.** Cross-agent data flow belongs to the patterns captured in `docs/architecture/integration.md`. Specialists should not reach into each other directly; the coordinator (and the shared integration contract) is the seam.

4. **Coordinate model-tier choices with the sibling policy.** Do not hard-code model selection inside an agent or inside the coordinator's dispatch. Defer to `TieredModelSelectionPolicy` (see `docs/TIERED-MODEL-PROPOSAL.md`) so that tiering decisions remain centralized.

5. **Update `docs/architecture/agents.md` when changing the orchestration shape.** Because this document is the canonical first-class reference for the pattern, any new agent, dropped agent, or ordering change should be reflected there to keep the architecture document trustworthy as a reference manual.

---

### Architectural Patterns Identified
- **Coordinator / Specialist (Orchestrator) pattern** — central sequencer dispatching to single-responsibility agents.
- **Pipeline composition** — staged execution with context flowing forward between stages.
- **Separation of orchestration from policy** — sequencing (coordinator) is distinct from model selection (`TieredModelSelectionPolicy`).

### Design Decisions and Trade-offs
- **Decomposition by analysis domain** (git, vibe, code graph) maximizes cohesion per agent at the cost of requiring a coordinator to maintain cross-domain views.
- **Explicit, centralized sequencing** makes ordering reasoned-about in one place — proven valuable given the historical critical issue — but concentrates risk: a coordinator bug affects the whole pipeline.
- **Documented integration patterns** (in `integration.md`) impose a contract-cost on adding agents but pay back in safer handoffs.

### System Structure Insights
- `Pipeline` → CoordinatorAgentOrchestration → `{ GitHistoryAgent, VibeHistoryAgent, CodeGraphAgent, … }` is the operative shape.
- Authoritative knowledge is split across `docs/architecture/agents.md`, `docs/architecture/integration.md`, `docs/TIERED-MODEL-PROPOSAL.md`, and the historical `CRITICAL-ARCHITECTURE-ISSUES.md`.

### Scalability Considerations
- The agent set is extensible by adding new modules under `integrations/mcp-server-semantic-analysis/src/agents/` and registering them with the coordinator.
- Sequential coordination implies that pipeline latency is the sum of agent latencies; any parallelization opportunities would need to be modeled explicitly in the coordinator and reflected in `agents.md`.
- The sibling `TieredModelSelectionPolicy` is the natural lever for cost/throughput scaling on a per-agent basis.

### Maintainability Assessment
Maintainability is **structurally strong**: clear domain boundaries between specialists, dedicated architecture documentation, and a documented integration-patterns surface all reduce the cost of change. The principal maintenance hazard is the coordinator's sequencing logic itself — historically a source of critical issues — which warrants careful review whenever agents are added, removed, or reordered. The presence of `CRITICAL-ARCHITECTURE-ISSUES.md` as a resolved-but-preserved record is itself a maintainability asset, as it documents the failure mode for future contributors.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- The pipeline is orchestrated by a coordinator agent that sequences specialized agents (GitHistoryAgent, VibeHistoryAgent, CodeGraphAgent, etc.) defined in integrations/mcp-server-semantic-analysis/src/agents/

### Siblings
- [TieredModelSelectionPolicy](./TieredModelSelectionPolicy.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md ('Tiered Model Selection Proposal') is a dedicated design proposal for this policy, indicating the model-selection strategy is a non-trivial architectural concern that warranted formal documentation separate from the general configuration reference.


---

*Generated from 4 observations*
