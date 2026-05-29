# ViolationCaptureService

**Type:** SubComponent

The dual-format output (JSONL for streaming append, JSON for dashboard snapshot) documented in docs/constraints/constraint-monitoring-system.md suggests ViolationCaptureService maintains two write paths with different update strategies

# ViolationCaptureService — Technical Insight Document

## What It Is

ViolationCaptureService is a persistence-focused subcomponent of the ConstraintSystem, responsible for durably recording constraint violations that have already been evaluated upstream. Its designated output target is the `.mcp-sync` directory, as established in `docs/constraints/README.md`, which serves as the filesystem handoff point between the live session runtime and the ConstraintDashboard UI layer. The system's behavioral contract and output formats are specified in `docs/constraints/constraint-monitoring-system.md`.

Critically, ViolationCaptureService does not perform rule evaluation. It operates as a downstream consumer of evaluated violation events, receiving structured violation records that have already been produced by the HookInterceptionLayer's pre-tool and post-tool hook phases. Its sole responsibility is receiving those records and writing them faithfully to persistent storage in the correct formats and at the correct locations.

Within the broader ConstraintSystem, ViolationCaptureService occupies the persistence tier — sitting between the live interception machinery (HookInterceptionLayer) and the user-facing display layer (ConstraintDashboard). It is, in the precise language of `docs/constraints/constraint-monitoring-system.md`, "the bridge between live session activity and persistent storage."

![ViolationCaptureService — Relationship](images/violation-capture-service-relationship.png)

## Architecture and Design

The most architecturally significant decision in ViolationCaptureService is its **dual-format write strategy**. The service maintains two distinct output paths targeting the `.mcp-sync` directory:

1. **A JSONL (JSON Lines) log** — an append-oriented stream where each violation record is written as a discrete newline-delimited JSON object. This format is optimized for sequential writes and supports streaming consumption without requiring the entire file to be parsed or rewritten on each new entry.

2. **A JSON history file** — a snapshot-oriented document representing the accumulated violation history in a form suitable for dashboard consumption. Unlike the JSONL log, this file likely requires a read-modify-write cycle or full replacement on each update, reflecting its role as a complete state snapshot rather than an event stream.

![ViolationCaptureService — Architecture](images/violation-capture-service-architecture.png)

This dual-format design encodes a deliberate trade-off: the JSONL path prioritizes write efficiency and durability (no data is lost if a write fails mid-session, since prior entries are already flushed), while the JSON snapshot path prioritizes read simplicity for the ConstraintDashboard, which can load a single structured file rather than parsing an unbounded log stream. The two formats serve different consumers with different access patterns, and ViolationCaptureService bears the cost of maintaining both in sync.

The filesystem-based handoff to `.mcp-sync` is itself an architectural pattern worth noting. By writing to a shared directory rather than communicating with the ConstraintDashboard through a direct API or in-memory channel, ViolationCaptureService and ConstraintDashboard are **decoupled by the filesystem**. The dashboard can be started, stopped, or refreshed independently of the session runtime without any coordination protocol — it simply reads from `.mcp-sync` whenever it needs current state.

## Implementation Details

No code symbols or source files were located during analysis, meaning the implementation details below are inferred entirely from the documentation observations in `docs/constraints/constraint-monitoring-system.md` and `docs/constraints/README.md`.

ViolationCaptureService receives violation records that originate from the HookInterceptionLayer's two-phase hook model. The HookInterceptionLayer wraps each tool invocation with a pre-tool hook (before execution) and a post-tool hook (after execution), evaluating constraint rules at both boundaries. Violations identified during either phase are passed downstream to ViolationCaptureService as already-evaluated records — the service does not re-evaluate rules or inspect raw tool inputs independently.

The write mechanics for the two output paths differ structurally. The JSONL log supports **append-only writes**: each incoming violation is serialized as a JSON object and written as a new line at the end of the file. This is an O(1) write operation regardless of how many prior violations exist. The JSON history file, by contrast, represents a **full-state snapshot** and must reflect all violations including the newly arrived one — this suggests either an in-memory accumulation strategy (where ViolationCaptureService holds the full violation list in memory and rewrites the JSON file on each update) or a read-append-write cycle (where the existing file is read, the new record is appended to the parsed structure, and the file is rewritten). The former is more efficient but risks data loss if the session crashes before a flush; the latter is more durable but incurs I/O overhead proportional to violation history size.

Given that violations can originate from code actions, file operations, and tool interactions (as scoped in `docs/constraints/README.md`), ViolationCaptureService must handle a heterogeneous set of violation record structures, or the ConstraintSystem enforces a normalized violation schema upstream before records reach ViolationCaptureService.

## Integration Points

ViolationCaptureService integrates at two boundaries within the ConstraintSystem:

**Upstream — HookInterceptionLayer**: ViolationCaptureService receives evaluated violations from the HookInterceptionLayer. The hook layer's pre-tool and post-tool events are the origination points; by the time a violation reaches ViolationCaptureService, rule evaluation is complete. This clean separation means ViolationCaptureService has no dependency on constraint rule definitions or tool inspection logic — it is a pure persistence consumer.

**Downstream — ConstraintDashboard**: The ConstraintDashboard reads from `.mcp-sync` to display violation history. ViolationCaptureService's JSON history file is the primary artifact the dashboard consumes. The filesystem boundary between them means the integration contract is entirely file-format-based: changes to how ViolationCaptureService structures its JSON output are breaking changes for the ConstraintDashboard, even though the two components never communicate directly.

**Filesystem — `.mcp-sync` directory**: This directory, designated in `docs/constraints/README.md`, is the concrete integration surface. Both output files (the JSONL log and the JSON snapshot) land here. Any tooling, monitoring, or external process that needs access to violation data can target this directory as a stable read location.

## Usage Guidelines

**Do not route rule evaluation through ViolationCaptureService.** Its contract is to receive pre-evaluated violations. Introducing evaluation logic here would violate the separation of concerns between the HookInterceptionLayer (which owns rule assessment) and ViolationCaptureService (which owns persistence). New constraint rules belong in the interception layer, not here.

**Treat the `.mcp-sync` directory as the canonical violation record.** Because ViolationCaptureService writes both formats there, `.mcp-sync` is the single source of truth for violation history. Developers should not maintain secondary caches or in-memory copies outside of ViolationCaptureService's own write buffer (if one exists) — doing so risks divergence between what the dashboard shows and what was actually recorded.

**Understand the write-path asymmetry when extending output formats.** The JSONL log and JSON snapshot have fundamentally different update strategies. If a third output format is ever added (e.g., a database write, a metrics emission), its update strategy should be explicitly designed to match its consumer's access pattern, following the same reasoning that differentiated the existing two paths.

**Schema changes to violation records are a cross-component breaking change.** Because the integration between ViolationCaptureService and ConstraintDashboard is purely file-format-based, any modification to the JSON structure of violation records requires coordinated updates to both the serialization logic in ViolationCaptureService and the parsing logic in ConstraintDashboard. There is no runtime negotiation or versioning layer to absorb schema drift.

---

### Architectural Patterns Identified

| Pattern | Evidence |
|---|---|
| **Dual-format persistence** | JSONL for append streaming, JSON for snapshot reads — two write paths serving different consumers |
| **Filesystem-based decoupling** | `.mcp-sync` as handoff boundary between runtime and dashboard, eliminating direct component coupling |
| **Pipeline stage separation** | ViolationCaptureService explicitly does not evaluate — it only persists, enforcing single responsibility |
| **Append-optimized logging** | JSONL format chosen specifically for its sequential write characteristics |

### Key Design Trade-offs

- **JSONL durability vs. JSON readability**: The JSONL log is more resilient to mid-session failure; the JSON snapshot is simpler for dashboard consumers. Both are maintained at the cost of write overhead.
- **Filesystem decoupling vs. consistency guarantees**: The file-based handoff eliminates coupling but introduces a window where the JSONL and JSON files may be transiently inconsistent if a write to one succeeds and the other fails.
- **Downstream passivity vs. evaluation capability**: Keeping rule evaluation out of ViolationCaptureService simplifies it but means it has no ability to filter, deduplicate, or enrich violations — that responsibility must be handled upstream or the dashboard must tolerate raw, unprocessed records.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based interception architecture where pre-tool and post-tool hook events capture agent actions, evaluate them against constraint rules, and record violations for persistence and dashboard display. The system bridges live session activity with persistent storage via the ViolationCaptureService, which writes violations to JSONL logs and maintains a JSON history file in the .mcp-sync directory for dashboard consumption.

### Siblings
- [ConstraintDashboard](./ConstraintDashboard.md) -- docs/constraints/README.md documents the ConstraintDashboard as a consumer of violation history files written to .mcp-sync, establishing a file-based decoupling between the live session and the UI layer
- [HookInterceptionLayer](./HookInterceptionLayer.md) -- docs/constraints/constraint-monitoring-system.md describes a hook-based interception architecture with distinct pre-tool and post-tool hook events, establishing a two-phase capture model around each tool invocation


---

*Generated from 5 observations*
