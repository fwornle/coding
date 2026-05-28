# ConstraintMonitorDashboard

**Type:** SubComponent

ConstraintMonitorDashboard consumes .mcp-sync/violation-history.json (a capped 1000-entry JSON array) rather than the raw JSONL append-log, isolating the UI from unbounded stream parsing as described in the ViolationCaptureService dual-store design

# ConstraintMonitorDashboard — Technical Reference

## What It Is

ConstraintMonitorDashboard is a self-contained SubComponent residing at `integrations/mcp-constraint-monitor/dashboard/`, documented via `dashboard/README.md`. It is the visualization and reporting surface of the broader ConstraintSystem, responsible for presenting violation history to developers without coupling itself to the live data production pipeline. Its integration contract is documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`, indicating it has at least one outbound display channel beyond simple file reads.

## Architecture and Design

![ConstraintMonitorDashboard — Architecture](images/constraint-monitor-dashboard-architecture.png)

The dashboard's defining architectural decision is its data source: it reads exclusively from `.mcp-sync/violation-history.json`, the capped 1000-entry JSON array maintained by ViolationCaptureService, rather than from `.mcp-sync/session-violations.jsonl`, the raw JSONL append-log. This is not an incidental choice — it is an explicit boundary encoded in ViolationCaptureService's dual-store design. The JSONL log is sized for tail-following and real-time streaming; the JSON array is sized for dashboard reads. By consuming only the latter, the dashboard avoids the unbounded stream-parsing problem that would arise if violation volume grew large across a long session.

![ConstraintMonitorDashboard — Relationship](images/constraint-monitor-dashboard-relationship.png)

This design enforces a clean producer/consumer decoupling. The hook handlers and SemanticConstraintDetector that feed ViolationCaptureService operate entirely on the write path. High violation rates cause write contention in ViolationCaptureService — specifically, the full-rewrite cost of evicting the oldest entry and re-serializing the capped array — but this contention is confined to the producer side. The dashboard's reads are structurally isolated: it sees a stable, bounded JSON file with no dependency on the write cadence of its siblings.

The tradeoff is explicit recency loss. Once the cap is active, the oldest violations are evicted. The dashboard therefore presents a trailing window of at most 1000 entries, not a complete session record. Developers requiring full session history must consult the JSONL log directly. This is a deliberate design point, not a limitation to be patched — the architecture accepts bounded recency in exchange for predictable, O(1)-bounded read performance.

## Implementation Details

No code symbols were resolved for this component, so implementation mechanics must be inferred from the observations and the file-system layout. The dashboard is self-contained within its subdirectory, with `dashboard/README.md` serving as the authoritative integration surface document. The status-line integration documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md` implies the dashboard has an outbound rendering contract — likely a formatted summary line suitable for embedding in a terminal status bar or editor status area — meaning it is not purely a passive file reader but also a formatted output producer.

The consumption of `.mcp-sync/violation-history.json` is straightforward in mechanical terms: the file is a standard JSON array, parseable in a single read without streaming logic. The 1000-entry cap means the parse cost is bounded regardless of session length, which is the point of the dual-store architecture. The dashboard never needs to implement line-by-line JSONL parsing, seek offsets, or handle partial writes — all of that complexity is absorbed by ViolationCaptureService.

## Integration Points

The dashboard sits at the consumer end of the ConstraintSystem data flow. ViolationCaptureService is its sole data dependency, supplying `.mcp-sync/violation-history.json`. SemanticConstraintDetector feeds ViolationCaptureService upstream, but the dashboard has no direct relationship with detection logic — it sees only the already-captured, already-capped output.

The outbound integration point documented in `status-line-integration.md` represents the dashboard's display contract with external consumers (editors, terminal environments, or other tooling). This makes the dashboard a translation layer: it reads structured violation history and emits formatted status output, decoupled from both the detection logic above it and the rendering target below it.

The parent ConstraintSystem contains this component alongside ViolationCaptureService and SemanticConstraintDetector, but the dashboard deliberately does not share code paths with either sibling — the architectural goal is that it remains readable and operable even when siblings are under load.

## Usage Guidelines

Developers working with or extending ConstraintMonitorDashboard should treat `.mcp-sync/violation-history.json` as the only sanctioned data source. Reading from `.mcp-sync/session-violations.jsonl` directly would bypass the cap and re-introduce the unbounded parsing problem the dual-store design exists to prevent.

The 1000-entry cap is a system-level constant set by ViolationCaptureService, not by the dashboard. If the window size needs adjustment, that change belongs in `scripts/violation-capture-service.js`, not in dashboard code. Dashboard logic should treat the array length as variable up to the cap, not hardcode assumptions about entry count.

The status-line integration contract documented in `integrations/mcp-constraint-monitor/docs/status-line-integration.md` should be consulted before adding new outbound display formats. The dashboard's value is its stable, bounded read performance and clean output contract — extensions that introduce unbounded processing or tight coupling to the production pipeline would undermine both.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem employs a dual-store persistence strategy in ViolationCaptureService (scripts/violation-capture-service.js) that separates concerns between live streaming and historical querying. Violations are written to two distinct files: a JSONL append-log at .mcp-sync/session-violations.jsonl where each line is a JSON-serialized violation event suitable for tail-following and real-time consumption, and a capped JSON array at .mcp-sync/violation-history.json that never exceeds 1000 entries and is intended for dashboard reads. This design means producers (the hook handlers) never block on dashboard consumers, and the dashboard never needs to parse an unbounded stream. The tradeoff is that the history file requires a full rewrite on each append once the cap is active, since the oldest entry must be evicted and the array re-serialized, which can become a write hotspot under high violation rates.

### Siblings
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- SemanticConstraintDetector is documented across two dedicated files—integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md and docs/semantic-detection-design.md—indicating the detection strategy is complex enough to warrant both a user-facing guide and an internal design document
- [ViolationCaptureService](./ViolationCaptureService.md) -- scripts/violation-capture-service.js implements a dual-store write strategy: each violation is appended as a single JSON line to .mcp-sync/session-violations.jsonl and also inserted into .mcp-sync/violation-history.json


---

*Generated from 5 observations*
