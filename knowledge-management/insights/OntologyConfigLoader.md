# OntologyConfigLoader

**Type:** Detail

The architecture docs in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md describe agent patterns where agents consume shared services rather than performing direct I/O, consistent with this loader acting as a single read point for ontology config.

# OntologyConfigLoader: Technical Insight Document

## What It Is

`OntologyConfigLoader` is a configuration loading component that resides within the ontology subsystem of the SemanticAnalysis MCP server, located in `src/ontology/`. It operates as a child component of `OntologyEngine` and is closely associated with `OntologyConfigManager`, which is the broader manager responsible for loading and managing ontology configuration in the same directory. The loader's primary responsibility is to centralize ontology definition loading, abstracting file system access away from individual agents that consume ontology data.

Functionally, it acts as a single read point for ontology configuration files, ensuring that agents in the SemanticAnalysis MCP server do not need to perform direct I/O operations to obtain ontology schema definitions. This positions it as a foundational infrastructure piece for the semantic analysis capabilities of the system.

## Architecture and Design

The architectural approach reflected by `OntologyConfigLoader` follows a clear **separation of concerns** pattern, where I/O responsibilities are extracted from agent logic and consolidated into a shared service. This aligns with the agent patterns documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, which describe agents as consumers of shared services rather than direct file system clients. The loader thus serves as one of these shared services upon which agents depend.

By being contained within `OntologyEngine`, the loader participates in a **hierarchical composition pattern**: the engine encapsulates the overall ontology behavior while delegating the specific concern of configuration loading to this dedicated child. Its sibling-level relationship with `OntologyConfigManager` (also in `src/ontology/`) indicates a layered design — the loader handles the mechanics of reading configurations, while the manager orchestrates lifecycle and availability of ontology definitions to consumers.

This design realizes the **dependency inversion** principle in practice: agents depend on the abstraction provided by the loader rather than on concrete file system paths or formats. The result is a decoupling of ontology schema definitions from agent logic, which is one of the explicit design goals of this architecture.

## Implementation Details

Because the source observations indicate no specific code symbols are currently catalogued for `OntologyConfigLoader`, the implementation details described here are derived from its role within `src/ontology/` and its relationship to `OntologyConfigManager`. The loader is expected to expose configuration access methods that the manager invokes when populating ontology state. Its mechanics center on reading ontology definition files from a known location, parsing them into in-memory representations, and returning these to upstream consumers.

The collaboration with `OntologyConfigManager` suggests a clear division: the loader focuses narrowly on retrieval — locating the configuration source, performing file system reads, and producing structured output — while the manager applies higher-level semantics such as caching, validation, and exposure to agents. This split keeps the loader's surface area small and its behavior predictable.

Within the broader `OntologyEngine`, the loader operates as an internal collaborator, not as a public-facing API. Agents do not invoke it directly; they reach ontology information through the engine and its manager layer. This containment makes the loader's implementation an internal detail that can evolve without disturbing the rest of the SemanticAnalysis MCP server.

## Integration Points

The most prominent integration point for `OntologyConfigLoader` is its parent component `OntologyEngine`, which contains it and integrates its output into the engine's overall ontology management workflow. The closely related `OntologyConfigManager` in `src/ontology/` is the immediate consumer of the loader's outputs, using them to make ontology definitions available to agents without requiring direct file I/O in each agent.

Downstream, the loader indirectly serves the agents described in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`. These agents are designed to consume shared services rather than perform direct file system access, so the loader is part of the infrastructure that makes the agent pattern viable. The integration is unidirectional: agents read ontology data through the engine/manager stack, and the loader feeds that stack from disk.

Externally, the loader depends on the file system layout of the SemanticAnalysis MCP server, particularly wherever ontology configuration files are stored. Any reorganization of those configuration paths is a concern localized to this loader rather than spread across agent code.

## Usage Guidelines

Developers working within the SemanticAnalysis MCP server should treat `OntologyConfigLoader` as the canonical entry point for ontology configuration reads. **Do not bypass it by performing direct file system access from agents or other components** — doing so violates the design intent articulated in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` and reintroduces the coupling this architecture is designed to eliminate.

When ontology schema definitions need to be updated, the changes should be made at the configuration source. The loader's decoupling allows such updates to propagate without modifications to agent implementations. This is a key maintainability property: ontology evolution and agent evolution proceed independently.

Extensions to loading behavior — such as supporting new configuration formats, additional sources, or richer validation — should be implemented within `OntologyConfigLoader` (or coordinated with `OntologyConfigManager`) rather than scattered across consumers. Centralization is the architectural value the loader provides; preserving it is a guideline as much as a design choice.

---

## Architectural Assessment Summary

**1. Architectural patterns identified:**
- Separation of concerns (I/O isolation from agent logic)
- Shared service / facade for configuration access
- Hierarchical composition (loader contained within `OntologyEngine`)
- Dependency inversion (agents depend on abstractions, not file paths)

**2. Design decisions and trade-offs:**
- Decision to centralize ontology loading in `src/ontology/` trades a small indirection cost for substantial decoupling benefits.
- Splitting responsibilities between `OntologyConfigLoader` and `OntologyConfigManager` adds a layer but yields cleaner, more testable units.
- Containment within `OntologyEngine` keeps the loader an internal detail, sacrificing direct external reuse for stronger encapsulation.

**3. System structure insights:**
- The `src/ontology/` directory functions as a cohesive subsystem with clear internal layering: loader → manager → engine → agent consumers.
- Agents in the SemanticAnalysis MCP server depend on this subsystem through well-defined service interfaces rather than ad hoc file access.

**4. Scalability considerations:**
- Centralized loading creates a natural seat for caching, lazy loading, or parallel fetch optimizations should ontology size grow.
- Because all agents flow through this loader (via the manager), it becomes a strategic point for cross-cutting concerns like access metrics or hot-reload capabilities.

**5. Maintainability assessment:**
- High maintainability: ontology updates do not require touching agent code, and file system changes are localized to one component.
- Clear hierarchy (`OntologyEngine` → `OntologyConfigLoader` / `OntologyConfigManager`) makes the responsibility boundaries easy to reason about.
- The absence of catalogued code symbols suggests the component is small or still consolidating; documentation of its public surface would further improve maintainability.


## Hierarchy Context

### Parent
- [OntologyEngine](./OntologyEngine.md) -- OntologyConfigManager in src/ontology/ is responsible for loading and managing ontology configuration, making ontology definitions available to agents without requiring direct file I/O in each agent


---

*Generated from 3 observations*
