# StatusLineWidget

**Type:** Detail

integrations/mcp-constraint-monitor/docs/status-line-integration.md ('Status Line Integration') documents the status-line integration pattern, indicating this is a distinct, documented feature of the dashboard sub-component.

# StatusLineWidget — Technical Insight Document

## What It Is

`StatusLineWidget` is a lightweight display component residing within the `ConstraintDashboard`, located under `integrations/mcp-constraint-monitor/dashboard/`. It serves as the primary consumer of violation count data produced by the MCP Constraint Monitor engine (documented in `integrations/mcp-constraint-monitor/README.md`), presenting that data in a compact, status-line format. Its integration pattern is explicitly documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`, signaling that it is treated as a first-class, intentionally designed feature rather than an incidental UI detail.

The widget exists at the boundary between the constraint engine's output and the user-facing dashboard layer. Its role is narrow and deliberate: consume violation counts, render a status line. This narrow scope is what makes it "lightweight" relative to the full `ConstraintDashboard` it is contained within.

## Architecture and Design

The most significant architectural decision evident from the observations is **separation of concerns between the constraint engine and its display layer**. The `integrations/mcp-constraint-monitor/dashboard/` sub-directory has its own `README.md`, which signals an intentional architectural boundary — the dashboard (and by extension `StatusLineWidget`) is decoupled from the core constraint engine. This means the widget does not participate in constraint evaluation logic; it only consumes results.

`StatusLineWidget` is a **self-contained display component** within `ConstraintDashboard`. This containment relationship means `ConstraintDashboard` acts as the orchestrating parent, presumably responsible for acquiring constraint data and passing it down, while `StatusLineWidget` is responsible solely for rendering. This is a classic parent-owns-data, child-renders pattern, which keeps the widget stateless or minimally stateful and easy to reason about.

The existence of a dedicated integration document (`status-line-integration.md`) suggests that connecting `StatusLineWidget` to data sources follows a defined, repeatable pattern — not ad hoc wiring. This is a meaningful design decision: it implies the widget's integration contract (what data it needs, in what shape) is stable enough to document formally, reducing ambiguity for implementers.

The trade-off of this design is that `StatusLineWidget` is intentionally limited in capability. By being a "lightweight consumer," it sacrifices richness for simplicity and composability. Developers who need more than a status line summary must look to the broader `ConstraintDashboard` rather than extending this widget.

## Implementation Details

No code symbols were resolved for `StatusLineWidget` in the current analysis, meaning specific class definitions, function signatures, or rendering logic cannot be confirmed from source. What *can* be inferred from the documented architecture is the following:

The widget's primary data input is **violation counts**, which are described in `integrations/mcp-constraint-monitor/README.md` as a primary output of the constraint monitor. This strongly implies the widget receives a numeric or structured count value — likely total violations, possibly broken down by severity or constraint type — and renders it inline in a status-line format (a single-line or compact multi-field display, common in editor-style or dashboard UIs).

Given its description as "self-contained," the widget likely encapsulates its own formatting and rendering logic without relying on shared rendering utilities from the constraint engine layer. The separation documented in `dashboard/README.md` reinforces this: the widget's implementation does not reach back into `integrations/mcp-constraint-monitor/` core internals.

## Integration Points

`StatusLineWidget` integrates directly with its parent, `ConstraintDashboard`, which is its primary — and likely only — integration surface. `ConstraintDashboard` is responsible for sourcing violation count data from the constraint engine and supplying it to the widget.

The formal integration pattern is captured in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`. Developers connecting or extending this widget should treat that document as the authoritative interface specification. The pattern is documented separately from both the core engine and the dashboard README, suggesting it describes a reusable or re-applicable approach — possibly relevant if `StatusLineWidget` were ever embedded in other dashboard contexts.

There are no sibling components identified in the current observations, though it is reasonable to expect that `ConstraintDashboard` contains other display components that consume the same constraint engine output in more detailed ways.

## Usage Guidelines

Developers working with `StatusLineWidget` should respect the architectural boundary established by the `dashboard/` sub-directory structure. Logic belonging to constraint evaluation or data aggregation should not be introduced into this widget; it should remain a pure consumer of already-computed violation counts provided by `ConstraintDashboard`.

The integration pattern documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md` should be followed when wiring the widget to data sources. Deviating from this documented pattern risks breaking the clean separation between the display layer and the constraint engine.

Because the widget is intentionally lightweight, feature requests that go beyond summarizing violation counts — such as drill-down interaction, filtering, or constraint-level detail — belong in `ConstraintDashboard` or a more capable sibling component, not in `StatusLineWidget` itself. Keeping this widget's scope narrow is what preserves its maintainability and composability.

---

## Architectural Patterns, Design Decisions, and Assessments

**Architectural patterns identified:** Parent-owns-data / child-renders display pattern; explicit layer separation between engine and UI via directory and README boundaries; documented integration contracts.

**Design decisions and trade-offs:** Choosing lightweight consumption over richness keeps the widget simple and stable, at the cost of capability. Documenting the integration pattern formally trades flexibility for consistency.

**System structure insights:** The widget sits at the outermost display layer of a three-layer structure: constraint engine → `ConstraintDashboard` → `StatusLineWidget`. Each layer has increasing display specificity and decreasing domain logic.

**Scalability considerations:** As a read-only, count-consuming display widget, `StatusLineWidget` scales trivially with the data — it renders a summary regardless of how many constraints exist. Scalability pressure would manifest in the upstream engine and dashboard layers, not here.

**Maintainability assessment:** High, by design. Narrow scope, documented integration pattern, and architectural isolation from the constraint engine mean changes to the core system are unlikely to require modifications to this widget. The primary maintenance risk is drift from the integration document if the violation count data shape changes upstream without updating `status-line-integration.md`.


## Hierarchy Context

### Parent
- [ConstraintDashboard](./ConstraintDashboard.md) -- integrations/mcp-constraint-monitor/dashboard/README.md is a dedicated sub-directory README, indicating the dashboard is architecturally separated from the core constraint engine


---

*Generated from 3 observations*
