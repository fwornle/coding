# ConstraintDashboard

**Type:** SubComponent

integrations/mcp-constraint-monitor/dashboard/README.md documents the dashboard as a separate deployable under the dashboard/ subdirectory, indicating it is architecturally decoupled from the MCP server process

# ConstraintDashboard — Technical Insight Document

## What It Is

ConstraintDashboard is a SubComponent of the ConstraintSystem, implemented under `integrations/mcp-constraint-monitor/dashboard/` with its own dedicated `README.md` documenting it as a separate deployable. As documented in `integrations/mcp-constraint-monitor/dashboard/README.md`, the dashboard is architecturally decoupled from the MCP server process — it lives in a subdirectory of the constraint monitor integration but has a distinct lifecycle and deployment surface from its sibling, the McpConstraintMonitor server.

Functionally, the dashboard is a **read-only consumer** of constraint violation data. It sources data exclusively from the violation history JSON store that is written by McpConstraintMonitor, meaning it has no direct involvement in the Claude Code hook pipeline itself. Its responsibility is purely observational: presenting severity breakdowns, session statistics, and historical trends derived from the violation record produced upstream.

![ConstraintDashboard — Architecture](images/constraint-dashboard-architecture.png)

Within the broader ConstraintSystem hierarchy, the dashboard sits alongside McpConstraintMonitor (which receives hook payloads from the UnifiedHookManager dispatch chain) and SemanticConstraintDetector (the semantic detection layer). It contains two conceptual child surfaces — DecoupledDeployableUnit and StatusLineIntegrationSurface — that reflect its dual nature as both a standalone deployable artifact and a contributor to the status line output channel documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`.

## Architecture and Design

The dashboard follows a **decoupled consumer-producer pattern** with a file-based integration boundary. The McpConstraintMonitor produces the violation history JSON store as part of its hook payload processing; the ConstraintDashboard consumes that same store without any direct IPC, shared process state, or runtime coupling. This file-based seam is the single integration contract between the two components, and it is what enables the dashboard to be a DecoupledDeployableUnit with its own README and lifecycle.

This design reflects a deliberate **separation of concerns** between the hot path (hook payload reception and constraint evaluation, handled by McpConstraintMonitor and SemanticConstraintDetector) and the cold path (historical observation and reporting, handled by ConstraintDashboard). Because the dashboard never participates in the UnifiedHookManager dispatch chain — unlike its sibling McpConstraintMonitor which is wired into that chain as a downstream endpoint — it cannot introduce latency or failure modes into Claude Code's hook execution.

The presence of a StatusLineIntegrationSurface as a child concept indicates the dashboard's data also surfaces through the explicitly designed status line output channel described in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`. This is treated as a first-class output surface rather than an incidental feature, suggesting the dashboard's data model is shaped to accommodate compact status-line representations in addition to full dashboard views.

## Implementation Details

The dashboard's display surface includes at least two well-defined views derived from the violation history schema. The **severity breakdown** display implies that records in the violation history JSON store carry a `severity` field, which is populated upstream by either the pattern-based detection layer in McpConstraintMonitor or the SemanticConstraintDetector. The dashboard reads these severity values and aggregates them to produce its breakdown visualization.

The **session statistics** view groups violations by a session identifier present in the Claude Code hook payloads, whose format is documented in `docs/CLAUDE-CODE-HOOK-FORMAT.md`. This implies the violation history records retain the session identifier from the original hook payload as it flows through McpConstraintMonitor's persistence path. The dashboard then performs grouping and aggregation on this field to present per-session activity.

![ConstraintDashboard — Relationship](images/constraint-dashboard-relationship.png)

Because no code symbols were enumerated for the dashboard module itself, the precise internal structure (rendering framework, server, asset pipeline) is not captured in the source observations. What is grounded is the contract: input is the violation history JSON store; output is a deployable web/UI surface that visualizes severity and session dimensions of that data.

## Integration Points

The dashboard's primary integration point is the **violation history JSON store** written by McpConstraintMonitor. This file-based interface is the entire data dependency surface — the dashboard does not call into the MCP server's runtime, does not subscribe to hook events, and does not participate in the dispatch chain orchestrated by the UnifiedHookManager (`lib/agent-api/hooks/hook-manager.js`) that the parent ConstraintSystem coordinates.

Upstream, the data flowing into that JSON store originates from Claude Code hook payloads received by McpConstraintMonitor, processed by either the pattern-based engine or the SemanticConstraintDetector (whose design is documented in `docs/semantic-detection-design.md` and operations in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`). The severity classifications and session identifiers the dashboard relies on are produced at those upstream layers, making the dashboard transitively dependent on the schema stability of those producers.

The StatusLineIntegrationSurface child concept indicates a second integration point: the status line channel described in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`. This is a distinct output surface from the dashboard's primary UI and represents a separate contract for emitting condensed constraint-state information.

## Usage Guidelines

Developers working with the ConstraintDashboard should treat it as an **observational tool only**. It must never be modified to write back into the violation history store or to inject behavior into the hook dispatch chain — doing so would violate the read-only consumer contract that justifies its decoupled deployment as a DecoupledDeployableUnit. If new enforcement behavior is needed, it belongs in McpConstraintMonitor or SemanticConstraintDetector, not in the dashboard.

Because the dashboard is deployed independently (per its own `integrations/mcp-constraint-monitor/dashboard/README.md`), its lifecycle does not need to match the MCP server's. Operators can restart, redeploy, or scale the dashboard without affecting hook processing. Conversely, the dashboard will gracefully reflect whatever state is present in the violation history store at read time — there is no handshake or coordination required at startup.

When extending the dashboard's views, developers must respect the upstream schema: the `severity` field and session identifier are the established dimensions, and any new aggregations should be derivable from fields already persisted by McpConstraintMonitor. Adding a new view that requires additional fields means first updating the upstream producer's persistence logic, then teaching the dashboard to consume those new fields — not the other way around.

Finally, contributors should be aware that the dashboard is one of two output surfaces for constraint data; the other is the status line. Changes that affect the violation history schema should be evaluated against both consumers to avoid breaking the StatusLineIntegrationSurface, which depends on the same underlying data.

---

### Summary of Key Insights

1. **Architectural patterns identified**: Decoupled consumer-producer with a file-based integration boundary (violation history JSON store); separation of hot path (hook processing) from cold path (observation); independent deployable unit pattern.

2. **Design decisions and trade-offs**: Choosing file-based decoupling over in-process integration trades real-time freshness for isolation — the dashboard cannot affect hook latency or failure modes, but it sees data only after it has been persisted. The dual output surfaces (dashboard UI and status line) accept some schema-coupling cost in exchange for richer observability.

3. **System structure insights**: ConstraintDashboard is a leaf observational component within ConstraintSystem; it depends on McpConstraintMonitor for data but not for runtime; SemanticConstraintDetector's classifications flow transitively into its views via the shared violation store.

4. **Scalability considerations**: Independent deployment allows the dashboard to scale horizontally without affecting the MCP server. The JSON store is a single-file integration point that may become a bottleneck for very high violation volumes; the design assumes constraint violations are a relatively low-frequency signal.

5. **Maintainability assessment**: High maintainability due to clean separation — dashboard changes cannot regress hook processing. The main maintainability risk is schema drift in the violation history store, which requires coordinated changes across McpConstraintMonitor (producer), ConstraintDashboard (consumer), and the StatusLineIntegrationSurface (secondary consumer).


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] **Dual-Layer Hook Configuration with Priority-Based Dispatch**: The UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) implements a two-tier configuration system that merges user-global settings from `~/.coding-tools/hooks.json` with project-local settings from `.coding/hooks.json`, where project-level entries take precedence on conflicts. After merging, handlers are sorted by a numeric `priority` field before event dispatch, meaning a project can override a user's global constraint handler entirely or simply outrank it in execution order. This design allows teams to enforce project-specific constraints (e.g., blocking writes to certain directories) without requiring developers to modify their personal tool configurations. New developers should be aware that a seemingly missing constraint enforcement may be masked by a higher-priority project-level handler silently overriding a user-level one.

### Children
- [DecoupledDeployableUnit](./DecoupledDeployableUnit.md) -- `integrations/mcp-constraint-monitor/dashboard/README.md` serves as the dedicated documentation entrypoint for the dashboard as its own deployable, signaling that it has a distinct lifecycle from the parent MCP Constraint Monitor server
- [StatusLineIntegrationSurface](./StatusLineIntegrationSurface.md) -- `integrations/mcp-constraint-monitor/docs/status-line-integration.md` is a dedicated document titled 'Status Line Integration,' indicating this is a first-class, explicitly designed output channel of the constraint monitoring system rather than an ad-hoc addition

### Siblings
- [McpConstraintMonitor](./McpConstraintMonitor.md) -- integrations/mcp-constraint-monitor/README.md documents the server's role as a hook payload receiver, meaning it is wired into the UnifiedHookManager dispatch chain as a downstream endpoint rather than running inline with Claude Code
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md provides operational documentation while docs/semantic-detection-design.md contains the design rationale, indicating the module went through a distinct design phase separate from the pattern-based engine


---

*Generated from 4 observations*
