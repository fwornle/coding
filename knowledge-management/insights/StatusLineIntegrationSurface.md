# StatusLineIntegrationSurface

**Type:** Detail

The existence of a separate doc (`integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) titled 'Claude Code Hook Data Format' alongside the status line doc suggests the dashboard ingests structured hook-format events and projects a summarized status outward — the status line being one such projection

## What It Is  

**StatusLineIntegrationSurface** is the formalised “status‑line” output channel of the **MCP Constraint Monitor** integration.  Its definition lives in the repository under  

```
integrations/mcp-constraint-monitor/docs/status-line-integration.md
```  

The presence of a dedicated markdown file (rather than an inline comment or a throw‑away script) tells us that the status line is a first‑class artifact, deliberately exposed to other components.  The surface is conceptually a *projection* of the structured constraint‑monitoring events (defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) onto a concise, human‑readable status line that can be consumed by any UI or logging sink.  

The surface sits **one level below** the `ConstraintDashboard` component (see `integrations/mcp-constraint-monitor/dashboard/README.md`) and is **shared** with the decoupled dashboard deployable (`DecoupledDeployableUnit`).  In other words, the status line is not owned by the dashboard alone; it is part of a common integration contract that both the monitor server and the dashboard respect.

---

## Architecture and Design  

The documentation layout and the naming conventions reveal a **modular, publish/subscribe‑style architecture**:

1. **Producer side – Claude Code Hook events** – The monitor server emits structured events that obey the *Claude Code Hook Data Format* (see the sibling doc).  These events are the canonical source of truth for constraint health, violation counts, and remediation suggestions.

2. **Integration surface – StatusLineIntegrationSurface** – This surface consumes the hook events, aggregates the relevant fields, and formats a succinct line (e.g., “✅ 12 checks passed, ⚠️ 3 warnings”).  Because the surface is described in a *shared* `docs/` folder, the contract is independent of any particular runtime (the monitor server, the dashboard, or any future consumer).

3. **Consumer side – ConstraintDashboard** – The dashboard, packaged as a **DecoupledDeployableUnit** under `integrations/mcp-constraint-monitor/dashboard/`, subscribes to the status‑line feed.  It can render the line in its UI, forward it to external monitoring tools, or expose it via an HTTP endpoint.  

The overall pattern resembles a **contract‑first integration**: the data format is defined first (`CLAUDE-CODE-HOOK-FORMAT.md`), the projection (status line) is defined next (`status-line-integration.md`), and the consuming services (dashboard) are built to read that projection.  This encourages loose coupling and independent deployment cycles.

> **Diagram – StatusLine Integration Architecture**  
> ![StatusLine Integration Architecture](assets/statusline-arch.png)  
> *The monitor server publishes Claude hook events → StatusLineIntegrationSurface aggregates & formats → ConstraintDashboard (DecoupledDeployableUnit) consumes.*

---

## Implementation Details  

The current repository snapshot contains **no concrete code symbols** for the surface, indicating that the surface is presently expressed as a *design contract* rather than a concrete class.  The implementation responsibilities can be inferred from the documentation:

* **Event Ingestion** – A component (likely part of the MCP server) reads JSON payloads that match the Claude hook schema.  It extracts fields such as `constraintId`, `status`, `severity`, and `message`.

* **Aggregation Logic** – The surface must collate these fields across the active monitoring window (e.g., last N seconds or the latest heartbeat).  Typical aggregation includes counting `PASS`, `WARN`, and `FAIL` statuses and possibly summarising the most critical messages.

* **Formatting** – The aggregated data is turned into a single‑line string.  The format is prescribed in `status-line-integration.md`; it may use emojis or short codes to convey health at a glance.  Because the surface is shared, the format is deliberately stable and versioned through the documentation.

* **Publication Mechanism** – While the exact mechanism is not listed, the location of the docs (outside `dashboard/`) suggests that the surface is exposed via a **publish/subscribe channel** (e.g., a message queue, a file‑based pipe, or a lightweight HTTP endpoint).  The dashboard’s README indicates that it runs as a separate deployable, so the surface must be reachable across process boundaries.

If a concrete implementation is added later, we would expect a small utility module (perhaps `status_line.py` or `status_line.go`) that implements the three steps above and registers itself with the monitor’s event bus.

---

## Integration Points  

| Entity | Relationship | Interface / Contract |
|--------|--------------|----------------------|
| **ConstraintDashboard** (parent) | Consumes the status line to display in its UI and to forward to external observability tools. | Reads the formatted line from the surface’s endpoint (e.g., HTTP `/status-line` or a message topic). |
| **Claude Code Hook** (sibling doc) | Provides the raw, structured events that feed the surface. | Emits JSON adhering to `CLAUDE-CODE-HOOK-FORMAT.md`. |
| **DecoupledDeployableUnit** (sibling) | Represents the dashboard as an independent deployment; it subscribes to the surface without being tightly coupled to the monitor server. | Uses the same surface contract; can be swapped out or scaled independently. |
| **MCP Constraint Monitor Server** (parent process) | Publishes hook events; may also host the surface’s endpoint. | Publishes to the event bus; optionally hosts the status‑line HTTP route. |

The surface therefore acts as a **boundary contract** between the monitor’s internal event generation and any external consumer that wishes to surface a concise health indicator.

---

## Usage Guidelines  

1. **Emit Valid Claude Hook Events** – All components that wish to influence the status line must produce events that conform exactly to the schema in `CLAUDE-CODE-HOOK-FORMAT.md`.  Missing fields or mismatched types will be ignored by the aggregation logic.

2. **Treat the Status Line as Read‑Only** – The surface is a *projection*; developers should not attempt to write directly to the status line.  Any desired change must be expressed by adjusting the underlying hook events.

3. **Version the Contract** – If the format of the status line needs to evolve, update `status-line-integration.md` and communicate the version bump to all consumers (e.g., dashboard, external alerting scripts).  Because the surface is documented, automated tests can verify that producers and consumers stay in sync.

4. **Deploy Independently** – Since the dashboard is a **DecoupledDeployableUnit**, it can be scaled horizontally without affecting the monitor server.  Ensure that the endpoint exposing the status line is reachable from the dashboard’s runtime environment (network policies, service discovery).

5. **Monitor Health of the Surface Itself** – Because the surface aggregates events, a failure to publish a status line may indicate upstream event loss.  Include health checks that verify the surface’s endpoint returns a non‑empty line.

---

### Architectural Patterns Identified  

* **Contract‑First Integration** – The Claude hook format and status‑line spec are defined before any code, establishing a clear contract.  
* **Publish/Subscribe (Event‑Driven)** – Hook events are published; the status line surface subscribes, aggregates, and republishes a derived artifact.  
* **Decoupled Deployable Unit** – The dashboard runs as an independent service, consuming the surface without being co‑located with the monitor server.  

### Design Decisions & Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| **Separate documentation folder** (`docs/` at integration root) | Makes the contract visible to all teams, encourages reuse across components. | No immediate code enforcement; relies on developer discipline. |
| **Single‑line projection** | Provides a lightweight, instantly readable health indicator for UI and CLI. | May hide detailed context; developers must still consult full hook events for debugging. |
| **Decoupled dashboard deployment** | Enables independent scaling and independent release cycles. | Requires a stable, network‑reachable surface; adds latency if the surface is remote. |

### System Structure Insights  

The **MCP Constraint Monitor** is organized as a parent component that houses both a **monitor server** (producing Claude hook events) and a **dashboard** (consuming the status line).  The `StatusLineIntegrationSurface` lives in the shared `docs/` layer, acting as a *contractual bridge* rather than a code module.  This layout emphasizes **separation of concerns**: event generation, aggregation, and presentation are each owned by distinct, loosely coupled units.

### Scalability Considerations  

* Because the surface aggregates events, its performance scales with the **rate of hook events**.  If the monitor emits a high volume, the aggregation logic must be efficient (e.g., incremental counters rather than full scans).  
* The decoupled dashboard can be horizontally scaled; each instance simply reads the same status‑line endpoint, which can be served behind a load balancer or replicated cache.  
* For very large deployments, the surface could be externalized to a lightweight service (e.g., a Go microservice) that holds the aggregated state in memory, avoiding contention on the monitor server.

### Maintainability Assessment  

* **High maintainability** – The contract is documented in plain markdown, making it easy to audit and evolve.  
* **Low code footprint** – With no concrete symbols in the repository, the surface imposes minimal technical debt; future implementations can be added without breaking existing consumers as long as the contract stays stable.  
* **Potential risk** – The lack of compile‑time enforcement means that mismatches between producers and consumers may surface only at runtime.  Introducing schema validation tests would mitigate this risk.

---

**In summary**, `StatusLineIntegrationSurface` is a deliberately shared, contract‑driven projection layer that transforms structured Claude hook events into a concise status line.  Its placement in the documentation hierarchy, its relationship to the decoupled `ConstraintDashboard`, and the surrounding design choices together illustrate a clean, modular integration strategy that balances readability, scalability, and independent deployment.


## Hierarchy Context

### Parent
- [ConstraintDashboard](./ConstraintDashboard.md) -- integrations/mcp-constraint-monitor/dashboard/README.md documents the dashboard as a separate deployable under the dashboard/ subdirectory, indicating it is architecturally decoupled from the MCP server process

### Siblings
- [DecoupledDeployableUnit](./DecoupledDeployableUnit.md) -- `integrations/mcp-constraint-monitor/dashboard/README.md` serves as the dedicated documentation entrypoint for the dashboard as its own deployable, signaling that it has a distinct lifecycle from the parent MCP Constraint Monitor server


---

*Generated from 3 observations*
