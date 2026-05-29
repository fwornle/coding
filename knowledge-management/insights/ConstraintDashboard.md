# ConstraintDashboard

**Type:** SubComponent

docs/constraints/constraint-monitoring-system.md describes the dashboard as reading from a JSON history file maintained by ViolationCaptureService, meaning the dashboard is read-only with no direct write path to violation state

# ConstraintDashboard — Technical Insight Document

## What It Is

The ConstraintDashboard is a read-only visualization subcomponent within the ConstraintSystem, responsible for surfacing violation data accumulated during Claude Code sessions. It is documented across `docs/constraints/README.md` and `docs/constraints/constraint-monitoring-system.md`, with its integration boundary defined by the `.mcp-sync` directory — a shared filesystem location that serves as the handoff point between the live session runtime and the dashboard UI layer.

Rather than participating in the active enforcement pipeline alongside its siblings HookInterceptionLayer and ViolationCaptureService, the ConstraintDashboard sits entirely downstream of that pipeline. It has no write path to violation state and does not receive push notifications from the session. Instead, it operates as a passive consumer of structured files: a JSONL log of individual violation events and a JSON history file maintained by ViolationCaptureService. This positions the dashboard as a pure visualization layer — its role is to parse, interpret, and display what the rest of the ConstraintSystem has already captured and persisted.

Per `docs/architecture/system-overview.md`, the constraint monitoring system is part of the broader Coding infrastructure, meaning the ConstraintDashboard is accessible in the same operational context as other system dashboards, making it a peer UI concern within the wider tooling ecosystem.

---

## Architecture and Design

The defining architectural decision in the ConstraintDashboard is **file-based decoupling**, encapsulated by its child component FileBasedViolationDecoupling. Rather than coupling the dashboard to any live in-process state or event stream, the design interposes the `.mcp-sync` directory as a stable, filesystem-level integration boundary. This is not an incidental implementation detail — `docs/constraints/constraint-monitoring-system.md` explicitly frames `.mcp-sync` as *the* integration boundary between the dashboard and the rest of the ConstraintSystem.

![ConstraintDashboard — Architecture](images/constraint-dashboard-architecture.png)

This design reflects a deliberate separation-of-concerns trade-off: the dashboard cannot corrupt or interfere with violation state because it has no write access to it. The live session (driven by HookInterceptionLayer's pre-tool and post-tool hook events) produces violations; ViolationCaptureService persists those violations to `.mcp-sync`; the dashboard reads from `.mcp-sync`. The data flow is strictly unidirectional, and the dashboard is isolated from any failure modes in the capture pipeline. If the dashboard crashes or lags, no violations are lost, because the source of truth lives in files written by ViolationCaptureService independently.

The pull-based, file-polling model (reading JSONL logs and a JSON history file) rather than a push/event-driven model means the dashboard trades real-time immediacy for architectural simplicity and resilience. This is consistent with an offline-readable, audit-oriented dashboard rather than a live alerting system.

![ConstraintDashboard — Relationship](images/constraint-dashboard-relationship.png)

---

## Implementation Details

The ConstraintDashboard parses two structured file formats originating from ViolationCaptureService: a JSONL (JSON Lines) log, where each line represents a discrete violation event, and a JSON history file that likely represents an aggregated or indexed view of those violations. The distinction between these two formats suggests the dashboard may support different views — a chronological event stream from the JSONL log, and a summary or filtered view from the JSON history file.

The FileBasedViolationDecoupling child component represents the abstraction responsible for mediating access to the `.mcp-sync` directory. Its existence as a named component implies it is more than a simple file read — it likely encapsulates the file path resolution, format parsing, and possibly polling or refresh logic that insulates the rest of the dashboard from direct filesystem concerns.

No code symbols were located in the current analysis sweep, meaning the concrete class names, function signatures, and module paths that implement the parsing and rendering logic are not yet available. The architectural shape is clear from documentation, but the implementation mechanics at the code level remain to be mapped.

---

## Integration Points

The ConstraintDashboard's sole integration point with the rest of the ConstraintSystem is the `.mcp-sync` directory, written to by ViolationCaptureService. There is no direct API, function call, or in-memory interface between the dashboard and either ViolationCaptureService or HookInterceptionLayer. This means the dashboard's correctness is entirely dependent on the schema stability of the JSONL and JSON files that ViolationCaptureService produces — any change to those file formats constitutes a breaking change for the dashboard.

Within the parent ConstraintSystem, the dashboard is downstream of the entire enforcement pipeline. HookInterceptionLayer captures agent actions and feeds them to ViolationCaptureService, which writes to `.mcp-sync`; only after that write does any data become visible to the dashboard. This pipeline sequencing means the dashboard reflects a slightly lagged view of session activity, bounded by how frequently it reads from the filesystem.

Per `docs/architecture/system-overview.md`, the dashboard integrates into the broader Coding infrastructure as a peer to other system dashboards, suggesting it shares a display or navigation context with other monitoring UIs, though the specifics of that broader integration surface are outside the ConstraintSystem's own documentation scope.

---

## Usage Guidelines

Developers working with or extending the ConstraintDashboard should treat the `.mcp-sync` directory as the canonical, immutable interface contract. The dashboard must never write to `.mcp-sync` or any path within it — that write responsibility belongs exclusively to ViolationCaptureService. Any attempt to introduce a write path from the dashboard would violate the architectural isolation that FileBasedViolationDecoupling is designed to enforce.

When modifying the file formats written by ViolationCaptureService — whether the JSONL log schema or the JSON history file structure — the ConstraintDashboard's parsing logic must be updated in lockstep. Because there is no runtime schema negotiation between the two components (only filesystem files at a shared path), schema drift will produce silent parsing failures rather than explicit errors unless the dashboard implements robust format validation.

The pull-based design means there is no built-in notification when new violations are written. Any dashboard refresh or live-update behavior must be implemented as explicit polling against the `.mcp-sync` files, with appropriate rate-limiting to avoid filesystem overhead during active sessions. Developers adding features to the dashboard should preserve the read-only, pull-based contract — introducing push channels or callbacks from the capture pipeline would undermine the decoupling that is the dashboard's primary architectural characteristic.

---

## Summary of Design Decisions and Trade-offs

| Decision | Rationale | Trade-off |
|---|---|---|
| File-based decoupling via `.mcp-sync` | Isolates dashboard from live session failures | Dashboard reflects lagged, not real-time, state |
| Read-only dashboard | Prevents corruption of violation state | No interactive remediation from the UI |
| Pull-based file polling | Architectural simplicity, no event bus needed | Requires explicit refresh logic; no push latency guarantee |
| Dual-format consumption (JSONL + JSON) | Supports both event-stream and summary views | Schema coupling between ViolationCaptureService and dashboard |
| Filesystem as integration boundary | Decouples deployment and process lifecycles | Breaking changes are silent without schema versioning |


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based interception architecture where pre-tool and post-tool hook events capture agent actions, evaluate them against constraint rules, and record violations for persistence and dashboard display. The system bridges live session activity with persistent storage via the ViolationCaptureService, which writes violations to JSONL logs and maintains a JSON history file in the .mcp-sync directory for dashboard consumption.

### Children
- [FileBasedViolationDecoupling](./FileBasedViolationDecoupling.md) -- docs/constraints/README.md explicitly documents .mcp-sync as the intermediary directory where violation history files are written, establishing a file-based boundary between the live session and the dashboard UI

### Siblings
- [ViolationCaptureService](./ViolationCaptureService.md) -- docs/constraints/constraint-monitoring-system.md identifies ViolationCaptureService as the bridge between live session activity and persistent storage, writing to both a JSONL log and a JSON history file
- [HookInterceptionLayer](./HookInterceptionLayer.md) -- docs/constraints/constraint-monitoring-system.md describes a hook-based interception architecture with distinct pre-tool and post-tool hook events, establishing a two-phase capture model around each tool invocation


---

*Generated from 5 observations*
