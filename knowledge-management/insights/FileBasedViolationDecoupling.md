# FileBasedViolationDecoupling

**Type:** Detail

docs/constraints/README.md explicitly documents .mcp-sync as the intermediary directory where violation history files are written, establishing a file-based boundary between the live session and the dashboard UI

# FileBasedViolationDecoupling

## What It Is

FileBasedViolationDecoupling is a design detail within the `ConstraintDashboard` that describes the mechanism by which violation data produced during live sessions is made available to the dashboard UI without direct coupling between the two. As documented in `docs/constraints/README.md` and `docs/constraints/constraint-monitoring-system.md`, the `.mcp-sync` directory serves as the intermediary boundary: the constraint monitoring system writes violation history files to `.mcp-sync`, and the `ConstraintDashboard` reads from that same directory via polling rather than subscribing to live session events directly.

## Architecture and Design

The core architectural pattern here is a **file-based producer-consumer handoff**. The constraint monitoring system acts as the producer, persisting violation records as files under `.mcp-sync`. The `ConstraintDashboard` acts as the consumer, periodically polling that directory through its file-based data loader module. This establishes a clear boundary: neither side needs to know about the other's runtime state, lifecycle, or internal event model.

This design trades immediacy for decoupling. A direct event subscription would give the dashboard lower-latency updates, but would tightly couple the dashboard's lifecycle to the live session. By routing through `.mcp-sync`, the two components can start, stop, and fail independently. The dashboard can be restarted without losing violation history, and the session can run without concern for whether the dashboard is active.

The choice of a directory-based boundary rather than a database or message queue keeps the integration lightweight and inspectable — violation files in `.mcp-sync` are directly readable artifacts, which aids debugging and auditing.

## Implementation Details

The `ConstraintDashboard` contains a file-based data loader module responsible for reading violation history from `.mcp-sync`. Rather than reacting to push notifications, this loader polls the directory, detecting new or updated violation files and surfacing them to the dashboard's display layer. The polling model means the dashboard's view of violations is eventually consistent with the session state, with latency bounded by the polling interval.

The constraint monitoring system described in `docs/constraints/constraint-monitoring-system.md` is the authoritative producer of these files. It observes constraint violations during live sessions and writes structured violation history into `.mcp-sync`, establishing the file format and naming conventions that the dashboard's loader must align with.

No code symbols were available for analysis, so the precise file format, polling interval, and loader class structure are not confirmed from observations. The `.mcp-sync` directory name and the file-based handoff pattern are the confirmed implementation anchors.

## Integration Points

FileBasedViolationDecoupling sits at the seam between two subsystems: the constraint monitoring system (producer) and the `ConstraintDashboard` (consumer). The `.mcp-sync` directory is the sole integration surface — it is the contract between them. Changes to file naming, structure, or location in `.mcp-sync` would require coordinated updates on both sides.

The `ConstraintDashboard` as the parent component owns the consumer side of this pattern. Any sibling components within `ConstraintDashboard` that need violation data would logically access it through the same file-based loader rather than re-implementing their own polling, making the loader a shared internal dependency.

## Usage Guidelines

Developers working with the `ConstraintDashboard` or the constraint monitoring system should treat `.mcp-sync` as the stable interface contract. Violation files should be written atomically by the producer to avoid partial reads by the polling loader. The dashboard's loader should be tolerant of missing or malformed files, since the session may not have produced any violations or may be mid-write.

The polling approach means developers should not expect real-time reflection of violations in the dashboard — there is an inherent lag. For debugging, the `.mcp-sync` directory can be inspected directly to confirm whether the monitoring system is producing output independently of the dashboard's rendering.

Any extension of the violation data model (new fields, new file types) should be treated as a schema change affecting both the constraint monitoring system and the `ConstraintDashboard`'s loader, and should be documented in `docs/constraints/README.md` and `docs/constraints/constraint-monitoring-system.md` to keep the integration contract explicit.

---

**Architectural Patterns:** File-based producer-consumer decoupling; polling-based eventual consistency; directory-as-interface contract.

**Key Trade-offs:** Decoupling and resilience over low latency; inspectability over efficiency; simplicity over real-time push.

**Scalability Note:** The polling model and file-per-violation approach may require attention if violation volume grows large — directory scanning and file I/O costs increase with file count. Batching or archiving strategies for `.mcp-sync` contents would be the natural mitigation.

**Maintainability:** The pattern is straightforward and the integration surface (`.mcp-sync`) is narrow, which aids maintainability. The main risk is implicit schema coupling between producer and consumer with no enforced contract beyond file conventions documented in markdown.


## Hierarchy Context

### Parent
- [ConstraintDashboard](./ConstraintDashboard.md) -- docs/constraints/README.md documents the ConstraintDashboard as a consumer of violation history files written to .mcp-sync, establishing a file-based decoupling between the live session and the UI layer


---

*Generated from 3 observations*
