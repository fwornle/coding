# ConstraintDashboard

**Type:** SubComponent

integrations/mcp-constraint-monitor/docs/status-line-integration.md describes a complementary status-line view alongside the dashboard, suggesting the dashboard handles detailed historical display while the status line handles ambient real-time counts

# ConstraintDashboard — Technical Insight Document

## What It Is

The ConstraintDashboard is a SubComponent of the broader ConstraintSystem, implemented within the dedicated sub-directory `integrations/mcp-constraint-monitor/dashboard/`. The presence of a standalone `README.md` at that path is itself an architectural signal: the dashboard has been deliberately separated from the core constraint engine, giving it its own documentation boundary, its own concerns, and implicitly its own interface contract. Within the ConstraintSystem hierarchy, it sits as a peer to HookConfigurationLayer, ConstraintRuleEngine, and ViolationPersistenceStore — all siblings that handle upstream concerns — while itself owning one child component, StatusLineWidget, which extends its display surface into ambient, real-time contexts.

The dashboard's primary role is violation review: it is the principal surface through which users inspect what the ConstraintSystem has detected and recorded. It does not participate in detection or enforcement; it is a consumer, not a producer, of constraint state. Its concern begins where the ViolationPersistenceStore's concern ends.

## Architecture and Design

![ConstraintDashboard — Architecture](images/constraint-dashboard-architecture.png)

The most consequential architectural decision visible in the observations is the dashboard's **pull-over-push** relationship with violation data. The `integrations/mcp-constraint-monitor/README.md` positions the dashboard as consuming the persistence store's query interface rather than receiving push events directly from the ConstraintRuleEngine. This is a deliberate separation of concerns: the rule engine fires during hook lifecycle points (pre-tool, post-tool, and others managed by HookConfigurationLayer), captures violations, and hands them to ViolationPersistenceStore. The dashboard is entirely decoupled from that real-time execution path. It <USER_ID_REDACTED> durable state on demand, which means its correctness does not depend on being alive or connected at the moment a violation occurs.

This pull-based design carries a clear trade-off. It improves resilience — the dashboard can be opened, closed, or reloaded without risk of missing events — but it means the dashboard's view of the world is only as current as its last query against the persistence store. For ambient, always-visible freshness, the architecture delegates to StatusLineWidget rather than requiring the full dashboard to poll aggressively. This division of responsibility between detailed historical display (dashboard) and real-time counts (status line) is explicitly documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`, and it represents a conscious UX and performance trade-off: keep the heavy surface lazy, keep the lightweight surface live.

![ConstraintDashboard — Relationship](images/constraint-dashboard-relationship.png)

The architectural separation of the dashboard sub-directory from the core engine also suggests a boundary that could support independent deployment or replacement of the display layer without touching rule evaluation logic. Whether or not that has been exercised, the structure encodes the option.

## Implementation Details

The dashboard's internal structure bifurcates into two display modes with distinct lifecycle characteristics. The primary dashboard view handles detailed, historical violation data — likely rendering violation records with context such as tool name, file paths, session identifiers, and rule metadata that the ConstraintRuleEngine and HookConfigurationLayer would have populated at capture time. The `CLAUDE-CODE-HOOK-FORMAT.md` document (owned by the HookConfigurationLayer sibling) defines the JSON schema emitted at each hook lifecycle point, including tool name, file paths, and session context. Since violations are derived from that schema and persisted by ViolationPersistenceStore, the dashboard's query results can be expected to carry those same fields as displayable attributes.

The StatusLineWidget child component, documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`, implements the ambient display layer. Its role is count-level awareness rather than record-level inspection — surfacing how many violations exist without requiring the user to open the full dashboard. The fact that it is a *child* of ConstraintDashboard rather than a sibling suggests it shares infrastructure with the dashboard (likely the same query interface to ViolationPersistenceStore) while presenting a stripped-down projection of that data.

The semantic layer described in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` belongs to the ConstraintRuleEngine sibling, not the dashboard. This is an important boundary: the dashboard displays what was detected, but the meaning-aware matching that determined *whether* something was a violation is not the dashboard's responsibility. The dashboard trusts the persistence store's records as already-classified violations.

## Integration Points

The dashboard's primary dependency is the ViolationPersistenceStore. All violation data flows through that store before the dashboard can access it, making the store's query interface the critical contract the dashboard depends on. Changes to how violations are serialized or indexed in the persistence store are upstream breaking changes for the dashboard.

The relationship with HookConfigurationLayer is indirect but structurally important. HookConfigurationLayer parses the Claude Code hook payloads (schema documented in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) and makes tool names, file paths, and session context available to the rule evaluation pipeline. That metadata ultimately ends up in violation records. The dashboard's ability to display rich, contextual violation information depends on the completeness of what HookConfigurationLayer extracted and what ViolationPersistenceStore retained.

The ConstraintRuleEngine sibling is deliberately not a direct integration point for the dashboard. The pull-based architecture ensures the dashboard never calls into the rule engine at runtime — it only reads persisted outcomes. This keeps the display layer isolated from the performance-sensitive hook execution path that the rule engine operates within.

The StatusLineWidget child integrates outward into whatever shell or editor surface hosts the constraint monitor, providing a projection of dashboard data into contexts where the full dashboard is not visible.

## Usage Guidelines

Developers working with or extending the ConstraintDashboard should respect the architectural boundary that makes it a **read-only consumer** of the ViolationPersistenceStore. Any temptation to add real-time push connections directly from the ConstraintRuleEngine to the dashboard would undermine the resilience and decoupling that the current pull-based design provides. If lower-latency display is needed, the correct extension point is StatusLineWidget, which is already designed for that purpose.

Because the dashboard is architecturally separated into its own sub-directory with its own README, changes to dashboard display logic should not require touching sibling components. Developers should treat `integrations/mcp-constraint-monitor/dashboard/` as an encapsulated unit with a defined input (the persistence store's query results) and defined outputs (rendered violation information to the user and ambient counts via StatusLineWidget).

When interpreting violation records displayed in the dashboard, the semantic classification performed by ConstraintRuleEngine's meaning-aware detection layer (documented in `semantic-constraint-detection.md`) has already been applied before records reach the store. The dashboard should not re-evaluate or re-interpret rule semantics — it should treat stored violations as authoritative, classified facts. Any disagreement with classification belongs in the rule engine configuration, not in dashboard display logic.

Finally, the two-surface model — full dashboard for historical review, StatusLineWidget for ambient awareness — should be maintained as a design discipline. Features that belong to "always-visible, low-cost counts" should live in StatusLineWidget; features that belong to "detailed, on-demand inspection" should live in the dashboard proper. Blurring this boundary risks either overloading the status line with complexity or forcing the full dashboard into a polling-heavy, always-on posture it was not designed for.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a monitoring and enforcement layer that validates code actions and file operations against configured rules during Claude Code sessions. It operates through a hook-based architecture where constraint checks are triggered at key lifecycle points (pre-tool, post-tool, etc.) and violations are captured, persisted, and surfaced to dashboards. The system integrates with Claude Code's native hook mechanism via configuration files at user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json), with project config overriding user config.

### Children
- [StatusLineWidget](./StatusLineWidget.md) -- integrations/mcp-constraint-monitor/docs/status-line-integration.md ('Status Line Integration') documents the status-line integration pattern, indicating this is a distinct, documented feature of the dashboard sub-component.

### Siblings
- [HookConfigurationLayer](./HookConfigurationLayer.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md documents the exact JSON schema Claude Code emits at each hook lifecycle point, which the configuration layer must parse to extract tool name, file paths, and session context
- [ConstraintRuleEngine](./ConstraintRuleEngine.md) -- integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md describes a semantic layer for detecting constraint violations that uses meaning-aware matching rather than literal rule comparison
- [ViolationPersistenceStore](./ViolationPersistenceStore.md) -- integrations/mcp-constraint-monitor/README.md describes violations being persisted and surfaced to dashboards, implying a durable store separate from in-memory hook execution state


---

*Generated from 3 observations*
