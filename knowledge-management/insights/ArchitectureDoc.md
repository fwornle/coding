# ArchitectureDoc

**Type:** Detail

integrations/mcp-server-semantic-analysis/docs/architecture/ contains three focused documents: agents.md ('Agent Architecture'), tools.md ('Tool Extensions'), and integration.md ('Integration Patterns'), separating concerns across agent design, tool extension points, and integration behavior.

# ArchitectureDoc — Technical Insight Document

## What It Is

`ArchitectureDoc` represents the structured architecture documentation layer within the `integrations/mcp-server-semantic-analysis` integration. It is physically implemented as a dedicated subdirectory at `integrations/mcp-server-semantic-analysis/docs/architecture/`, containing four files that together form a self-contained architectural reference:

- `README.md` — a navigational index titled *"Architecture Documentation - MCP Server Semantic Analysis"*
- `agents.md` — focused on *Agent Architecture*
- `tools.md` — focused on *Tool Extensions*
- `integration.md` — focused on *Integration Patterns*
- `CRITICAL-ARCHITECTURE-ISSUES.md` (at the integration root) — a living record of resolved design issues, titled *"CRITICAL Architecture Issues - RESOLVED"*

This documentation set is scoped entirely to the `mcp-server-semantic-analysis` integration and sits within the broader `MCPServerPattern` parent component, which governs how integrations present their tool interfaces through top-level `README.md` entry points.

---

## Architecture and Design

The most prominent architectural decision visible here is **concern separation through document decomposition**. Rather than consolidating all architecture knowledge into a single monolithic document, the design partitions the knowledge space into three orthogonal axes: agent design (`agents.md`), tool extension points (`tools.md`), and integration behavior (`integration.md`). This mirrors, at the documentation level, the same separation-of-concerns principle commonly applied to code architecture — each document has a single, well-scoped responsibility.

The presence of `README.md` as an explicit index document is a deliberate **orientation layer**. Its role is not to contain architecture content itself but to orient developers before they descend into individual files. This pattern acknowledges that documentation directories, like code modules, benefit from a clear entry point that reduces cognitive load and establishes the reading contract upfront.

A particularly notable design decision is the treatment of `CRITICAL-ARCHITECTURE-ISSUES.md` as a **living architectural record** rather than a disposable ticket or changelog entry. By marking issues as "RESOLVED" within the document and retaining it in the repository, the team embeds decision provenance directly into the codebase. This transforms what could have been ephemeral issue-tracker content into durable, co-located architectural memory — a practice that directly supports future contributors who need to understand *why* the architecture looks the way it does, not just *what* it looks like.

The overall structure reflects a **documentation-as-architecture** philosophy: the shape of the documentation mirrors the shape of the system, making the docs themselves a navigable model of the integration's structure.

---

## Implementation Details

The three core documents carve up the architectural surface area of `mcp-server-semantic-analysis` along functional boundaries. `agents.md` addresses the agent tier — likely covering agent lifecycle, responsibilities, and behavioral contracts. `tools.md` addresses the extension surface — the points at which new tooling can be introduced or existing tools modified, which is especially significant in an MCP (Model Context Protocol) context where tool definitions are first-class citizens. `integration.md` addresses the behavioral contracts between this integration and its external consumers or dependencies — the observable patterns at the integration boundary.

The `README.md` index acts as a **discoverability mechanism**. In a subdirectory that could otherwise require developers to open each file speculatively, the index pre-communicates the contents and purpose of each document, reducing the time-to-orientation for any developer approaching this integration for the first time.

The `CRITICAL-ARCHITECTURE-ISSUES.md` file warrants particular attention. Its title signals that it was created during a period of active architectural stress — issues significant enough to be flagged as "critical." The "RESOLVED" status embedded in the title indicates the document has been updated in place rather than deleted, preserving the resolution rationale alongside the original problem statement. This is a meaningful implementation choice: the document is not a bug report, but a **decision audit trail** that captures the delta between an unstable prior state and the current stable architecture.

---

## Integration Points

`ArchitectureDoc` exists within `MCPServerPattern`, which establishes the convention that each integration maintains a top-level `README.md` as its primary tool description entry point. The `ArchitectureDoc` subdirectory at `docs/architecture/` is a layer *below* that top-level entry point — it is reachable from `integrations/mcp-server-semantic-analysis/README.md` but serves a different audience: developers working *on* the integration, rather than consumers working *with* it.

The sibling entity `IntegrationOnboarding`, instantiated in `integrations/code-graph-rag/CONTRIBUTING.md`, demonstrates a parallel pattern: contribution-specific guidance scoped to a single integration, separate from any project-wide documentation. `ArchitectureDoc` and `IntegrationOnboarding` together represent the two primary documentation concerns for any integration — *how it is designed* and *how to contribute to it*. That `mcp-server-semantic-analysis` has formalized the architecture side while `code-graph-rag` has formalized the contribution side suggests these documentation types are independently emergent based on each integration's maturity and complexity.

The `CRITICAL-ARCHITECTURE-ISSUES.md` file implicitly integrates with whatever issue-tracking or decision-making process the team uses — it represents the handoff point between that process and the codebase, serving as a permanent anchor for decisions that originated outside the repository.

---

## Usage Guidelines

Developers approaching `mcp-server-semantic-analysis` for architectural understanding should begin at `integrations/mcp-server-semantic-analysis/docs/architecture/README.md` and use it as the canonical navigation starting point. Skipping the index and opening individual documents directly risks missing the intended reading sequence and the contextual framing the index provides.

The three-document structure (`agents.md`, `tools.md`, `integration.md`) should be treated as **bounded scopes** — changes to agent behavior belong in `agents.md`, changes to tool extension points belong in `tools.md`, and changes to integration-level contracts belong in `integration.md`. Allowing concerns to bleed across documents would erode the separation-of-concerns design and degrade the documentation's navigability over time.

`CRITICAL-ARCHITECTURE-ISSUES.md` should be preserved and extended, not deleted when issues are resolved. The "RESOLVED" annotation pattern is the correct convention: update in place, mark as resolved, retain the document. This ensures that future contributors encountering a puzzling design decision can find the context for why a prior approach was rejected. Deleting resolved-issues documents removes architectural memory that cannot easily be reconstructed.

When adding new documentation to this subdirectory, the `README.md` index should be updated simultaneously to register the new document. The index is only valuable if it remains complete — an index that silently omits files is worse than no index, because it creates a false sense of comprehensive orientation.

---

## Architectural Patterns Identified

| Pattern | Evidence |
|---|---|
| **Concern Separation via Document Decomposition** | Three focused files (`agents.md`, `tools.md`, `integration.md`) each owning a single architectural axis |
| **Explicit Orientation Layer** | `README.md` as a pure index document at the subdirectory root |
| **Living Architecture Record** | `CRITICAL-ARCHITECTURE-ISSUES.md` retained and annotated post-resolution rather than deleted |
| **Documentation Mirroring System Structure** | Doc hierarchy reflects the integration's functional decomposition |

**Key Trade-off:** The three-document decomposition improves navigability and scoped editability but introduces a risk of cross-cutting concerns (e.g., an agent behavior that is also an integration pattern) falling ambiguously between documents. The index `README.md` partially mitigates this by providing a <COMPANY_NAME_REDACTED>-level view, but the team should establish a clear triage convention for cross-cutting topics.

**Scalability Consideration:** The current structure scales well for a single integration of moderate complexity. If `mcp-server-semantic-analysis` grows significantly, `agents.md` or `tools.md` may need to be further decomposed into subdirectories following the same pattern — the `README.md`-as-index convention is composable and can be applied recursively.

**Maintainability Assessment:** High. The separation of concerns, explicit indexing, and living-record approach for critical issues all contribute to a documentation architecture that is straightforward to update incrementally, easy to navigate, and resistant to the "documentation rot" that affects monolithic docs. The primary maintenance risk is index drift — the `README.md` becoming stale relative to the actual files present — which should be addressed through code review conventions.


## Hierarchy Context

### Parent
- [MCPServerPattern](./MCPServerPattern.md) -- Each integration maintains a top-level README.md describing the tool interface: integrations/mcp-constraint-monitor/README.md ('MCP Constraint Monitor'), integrations/mcp-server-semantic-analysis/README.md ('MCP Server - Semantic Analysis'), and integrations/code-graph-rag/README.md each serve as the primary tool description entry point.

### Siblings
- [IntegrationOnboarding](./IntegrationOnboarding.md) -- integrations/code-graph-rag/CONTRIBUTING.md ('Contributing to Code Graph RAG') provides contribution-specific guidance scoped to the code-graph-rag integration, separate from any top-level project CONTRIBUTING.md.


---

*Generated from 3 observations*
