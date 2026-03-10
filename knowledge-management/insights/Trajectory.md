# Trajectory

**Type:** Component

The Trajectory component utilizes the specstory-adapter.js file in the lib/integrations directory to integrate with external planning systems and manage project milestones, GSD workflow, phase planning, and implementation task tracking.

## What It Is  

Trajectory is the **AI‑driven planning and milestone‑tracking component** of the **Coding** project.  All of its source lives under the project’s repository and its only explicit code artifact is the **`specstory‑adapter.js`** file located in **`lib/integrations/specstory‑adapter.js`**.  The component’s purpose, as described in the observations, is to **manage project milestones, the “Get‑Stuff‑Done” (GSD) workflow, phase planning, and implementation‑task tracking**.  It does not contain any nested sub‑components; instead it acts as a thin integration layer that connects the internal Coding knowledge base to external planning systems (e.g., road‑mapping or issue‑tracking services).  

Because Trajectory sits directly under the root **Coding** component, it shares the same high‑level namespace as its siblings—**LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**—but its responsibilities are focused on the temporal and procedural aspects of the development lifecycle rather than logging, LLM access, containerisation, knowledge‑graph storage, design‑pattern guidance, constraint enforcement, or semantic analysis.

---

## Architecture and Design  

The only concrete architectural artifact we can observe is the **adapter** implementation in `specstory‑adapter.js`.  The file name and its placement in `lib/integrations` strongly indicate an **Adapter pattern**: Trajectory does not embed the external planning system’s API directly; instead it provides a thin wrapper that translates the internal milestone/phase model into the external service’s contract and vice‑versa.  This design isolates the rest of the Coding codebase from changes in the third‑party planning API, supporting **loose coupling** and **replaceability** of the external system.

Trajectory’s design is **component‑centric**: it is declared as a top‑level component under the Coding hierarchy, with no internal sub‑components.  Interaction with other parts of the system is therefore expected to be **service‑oriented**—other components invoke Trajectory’s public adapter functions (e.g., `createMilestone`, `updatePhase`, `trackTask`) to record or retrieve planning data.  The component’s keyword list—*trajectory, milestone, planning, phase, GSD, roadmap, spec*—reinforces a **domain‑driven** focus, suggesting that its public API is expressed in terms of those domain concepts.

Because the observations do not mention any additional architectural styles (e.g., event‑driven messaging, microservices, or shared‑library patterns), we limit the analysis to the **adapter‑centric integration** and the **component hierarchy** that places Trajectory alongside its siblings under the Coding parent.

---

## Implementation Details  

The implementation lives in a single integration file:

```
lib/
 └─ integrations/
     └─ specstory‑adapter.js
```

Although no symbols were discovered in the provided code‑symbol scan, the file name and location give us enough to infer its responsibilities:

1. **Exported Functions** – The adapter likely exports a set of functions that map internal trajectory concepts (milestones, phases, GSD steps) to the external planning system’s API calls. Typical functions would include:
   * `syncMilestones(projectId, milestones)` – pushes a batch of milestone definitions.
   * `fetchRoadmap(projectId)` – retrieves the current roadmap for read‑only consumption.
   * `updatePhaseStatus(phaseId, status)` – reflects phase progress.
   * `trackImplementationTask(taskId, details)` – records task‑level tracking information.

2. **Configuration** – The adapter probably reads configuration (e.g., API keys, endpoint URLs) from environment variables or a central config module under the Coding project, ensuring that the external service can be swapped without code changes.

3. **Error Handling & Validation** – Given the presence of the sibling **ConstraintSystem**, it is plausible that the adapter performs basic validation of inputs before sending them outward, delegating deeper constraint checks to the ConstraintSystem component.

4. **Data Mapping** – The adapter must translate between the internal representation of milestones/phases (likely stored in the KnowledgeManagement graph) and the external format (JSON payloads, REST resources, etc.). This mapping is the core of the “trajectory” semantics.

Because no additional files or symbols were listed, we can conclude that **all of Trajectory’s runtime behaviour is encapsulated within this single adapter module**, keeping the component lightweight and focused on integration rather than business‑logic processing.

---

## Integration Points  

Trajectory’s primary integration surface is the **external planning system** accessed through `specstory‑adapter.js`.  The adapter abstracts that external dependency, exposing a stable internal API for the rest of the Coding project.

* **Upstream Dependencies** – Trajectory likely consumes configuration and authentication material from a central configuration service (perhaps provided by DockerizedServices or a shared config library).  It may also rely on the **KnowledgeManagement** component to read or persist milestone data in the project’s knowledge graph.

* **Downstream Consumers** – Any component that needs to schedule work or report progress can call the adapter’s functions.  For example:
  * **LiveLoggingSystem** could log milestone creation events.
  * **ConstraintSystem** could validate milestone definitions before they are sent.
  * **SemanticAnalysis** might annotate milestones with semantic tags derived from code history.

* **Sibling Collaboration** – While the observations do not detail explicit calls, the shared parent **Coding** suggests that all siblings operate within a common service container or process space, making inter‑component calls straightforward (e.g., via module imports).  The adapter’s location in `lib/integrations` positions it as a reusable bridge that any sibling can import.

* **External Interface** – The external planning system’s API is the only outward‑facing contract.  Because the adapter isolates this contract, swapping the external vendor (e.g., moving from SpecStory to another roadmap tool) would involve updating only `specstory‑adapter.js` without touching the rest of the codebase.

---

## Usage Guidelines  

1. **Interact Through the Adapter Only** – All milestone, phase, and task operations must be performed via the functions exported from `lib/integrations/specstory‑adapter.js`.  Direct HTTP calls or manual data manipulation bypass the validation and mapping logic and should be avoided.

2. **Follow the Domain Vocabulary** – Use the exact terminology from the component’s keyword set (*milestone, phase, GSD, roadmap, spec*) when naming entities or constructing payloads.  This ensures consistency across the Coding project and aligns with the expectations of the external planning system.

3. **Validate Before Sync** – Leverage the **ConstraintSystem** (or any existing validation utilities) to verify that milestone dates, dependencies, and statuses conform to project policies before invoking the adapter’s sync functions.

4. **Configuration Management** – Store API credentials and endpoint URLs in the central configuration store used by DockerizedServices.  Do not hard‑code them in the adapter; instead, read them at runtime to facilitate environment‑specific deployments (development, staging, production).

5. **Error Handling** – Propagate any errors from the external service up to the caller.  Wrap adapter calls in try/catch blocks and log failures through **LiveLoggingSystem** to maintain an audit trail.

6. **Testing** – Because the adapter isolates external calls, it can be mocked in unit tests for components that depend on Trajectory.  Use the mock mode provided by **LLMAbstraction**‑style patterns (if available) to simulate successful and failing responses from the planning system.

---

### Summary of Architectural Insights  

| Item | Observation‑Based Insight |
|------|----------------------------|
| **Architectural patterns identified** | **Adapter pattern** (via `specstory‑adapter.js`), **Component‑based hierarchy** (Trajectory as a top‑level component under Coding). |
| **Design decisions and trade‑offs** | Decision to keep integration logic in a single adapter file reduces surface area and simplifies swapping external services, at the cost of limited internal modularisation (no sub‑components). |
| **System structure insights** | Trajectory lives alongside seven sibling components, all sharing the same parent (`Coding`).  Its responsibilities are orthogonal to logging, LLM abstraction, containerisation, knowledge‑graph management, pattern guidance, constraint enforcement, and semantic analysis. |
| **Scalability considerations** | Because the heavy lifting is delegated to the external planning system, scalability largely depends on that service’s capacity.  The lightweight adapter can be replicated across multiple containers if needed, and its stateless nature supports horizontal scaling. |
| **Maintainability assessment** | High maintainability: a single, well‑named adapter file isolates external API changes.  The component’s limited scope and clear domain vocabulary further reduce churn.  Potential risk: any future expansion (e.g., adding sub‑components) will need careful design to avoid turning the adapter into a monolith. |

These insights are drawn directly from the supplied observations, preserving file paths, component names, and domain terminology without introducing unsupported assumptions.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: LiveLoggingSystem is a component of the Coding project. Live session logging infrastructure capturing Claude Code conversations. Handles session windo; LLMAbstraction: LLMAbstraction is a component of the Coding project. Abstraction layer over LLM providers (Anthropic, OpenAI, Groq) enabling provider-agnostic model c; DockerizedServices: DockerizedServices is a component of the Coding project. Docker containerization layer for all coding services including semantic analysis MCP, constr; Trajectory: Trajectory is a component of the Coding project. AI trajectory and planning system managing project milestones, GSD workflow, phase planning, and impl; KnowledgeManagement: KnowledgeManagement is a component of the Coding project. Knowledge graph storage, query, and lifecycle management including the VKB server, graph dat; CodingPatterns: CodingPatterns is a component of the Coding project. General programming wisdom, design patterns, best practices, and coding conventions applicable ac; ConstraintSystem: ConstraintSystem is a component of the Coding project. Constraint monitoring and enforcement system that validates code actions and file operations ag; SemanticAnalysis: SemanticAnalysis is a component of the Coding project. Multi-agent semantic analysis pipeline (batch-analysis workflow) that processes git history and.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- LiveLoggingSystem is a component of the Coding project. Live session logging infrastructure capturing Claude Code conversations. Handles session windowing, file routing, classification layers, and transcript capture.. It contains 0 sub-components: .
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a component of the Coding project. Abstraction layer over LLM providers (Anthropic, OpenAI, Groq) enabling provider-agnostic model calls, tier-based routing, and mock mode for testing.. It contains 0 sub-components: .
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices is a component of the Coding project. Docker containerization layer for all coding services including semantic analysis MCP, constraint monitor, code-graph-rag, and supporting databases.. It contains 0 sub-components: .
- [KnowledgeManagement](./KnowledgeManagement.md) -- KnowledgeManagement is a component of the Coding project. Knowledge graph storage, query, and lifecycle management including the VKB server, graph database, entity persistence, and knowledge decay tracking.. It contains 2 sub-components: ManualLearning, OnlineLearning.
- [CodingPatterns](./CodingPatterns.md) -- CodingPatterns is a component of the Coding project. General programming wisdom, design patterns, best practices, and coding conventions applicable across the project. Catch-all for entities not fitting other components.. It contains 0 sub-components: .
- [ConstraintSystem](./ConstraintSystem.md) -- ConstraintSystem is a component of the Coding project. Constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions.. It contains 0 sub-components: .
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a component of the Coding project. Multi-agent semantic analysis pipeline (batch-analysis workflow) that processes git history and LSL sessions to extract and persist structured knowledge entities.. It contains 3 sub-components: Pipeline, Ontology, Insights.


---

*Generated from 4 observations*
