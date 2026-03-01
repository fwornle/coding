# CorePattern
**Type:** Architecture
**Generated:** 2026-03-01T07:44:02.382Z

## What It Is  

*CorePattern* is the collective name given to a set of architectural conventions that underlie the **Core** component of the MCP (Memory‑Centric Platform).  The conventions live in the Core code‑base that is responsible for mediating between **AI agents** (e.g., Claude, Copilot) and the **knowledge‑management subsystems** (live MCP memory servers, visual knowledge bases, and the spec‑story logging format).  Although the source observations do not cite concrete file‑system locations, the patterns are realized in the modules that perform **agent detection**, **adapter registration**, **bidirectional state synchronisation**, **schema evolution**, and **stdio interception**.  Together they provide a unified, agent‑agnostic façade, a reliable two‑way knowledge sync channel, a progressive graph‑schema upgrade path, and a transparent logging layer that captures every interaction without requiring changes to the agents themselves.

---

## Architecture and Design  

The architecture is a **layered adapter‑centric design** built around four tightly coupled but independently replaceable subsystems:

1. **Agent‑Agnostic Adapter Layer** – a thin abstraction that discovers the active LLM agent at runtime and routes all higher‑level calls (memory read/write, logging, browser access) through a **standardised interface**.  The *agent detector* is the entry point; it consults a **registry** that maps each supported agent (Claude, Copilot, …) to a concrete adapter implementation.  This registry embodies the *Adapter* pattern and enables **polyglot agent environments**.

2. **Bi‑directional Knowledge Synchronisation Layer** – a pair of scripts (Python and shell) that export the live MCP memory server state to portable JSON/CSV files and import those artefacts into the **visual knowledge base (VKB)**.  The reverse flow pulls human‑curated insights from the VKB back into the live memory.  This creates a **dual‑source of truth** and follows a *synchroniser* style architecture rather than a single master.

3. **Semantic Entity Schema Evolution Layer** – a versioned knowledge‑graph schema that grows from a minimal artifact model to richer entities such as *insights*, *problems*, *solutions*, and *learnings*.  Migration scripts and validation tools enforce backward compatibility, reflecting a **Schema‑Versioning** approach.

4. **Stdio Interception Logging Layer** – an **auto‑logger** that spawns the agent process, wraps its standard input and output streams, timestamps each message, and persists the data in a **specstory‑compatible** format.  This layer implements a **Decorator**‑like interception without modifying the agent binaries.

The components interact in a **pipeline**: the detector selects an adapter → the adapter invokes memory or browser APIs → the stdio interceptor records the exchange → the synchronisation scripts periodically flush the in‑memory state to the VKB → the schema evolution tools ensure that the persisted data conforms to the latest entity definitions.  Because each layer communicates through **well‑defined interfaces** (e.g., `IMemoryAdapter`, `IBrowserAdapter`, `ISyncEngine`), the system can be extended with new agents, storage back‑ends, or schema versions without rippling changes throughout the code‑base.

---

## Implementation Details  

| Subsystem | Core Artefacts (as inferred) | Mechanics |
|-----------|-----------------------------|-----------|
| **Agent‑Agnostic Adapter** | *AgentDetector*, *AdapterRegistry*, concrete adapters such as `ClaudeAdapter`, `CopilotAdapter` | The detector runs early in the process bootstrap, probing environment variables, command‑line flags, or runtime capabilities to decide which agent is active.  It then queries `AdapterRegistry` – a map keyed by agent identifiers – to retrieve an object that implements a **standard interface** (`IMemory`, `ILogging`, `IBrowser`).  Each adapter translates the generic calls into the agent‑specific API (e.g., Claude’s HTTP endpoint vs. Copilot’s SDK). |
| **Bi‑directional Knowledge Sync** | `export_state.py`, `import_state.sh`, JSON/CSV schemas | The export script walks the live MCP memory server’s data structures, serialises them into JSON/CSV, and writes to a shared sync directory.  The import script reads the same files from the VKB, deserialises them, and pushes them back into the memory server via the adapter’s memory API.  A cron‑style scheduler triggers these scripts at configurable intervals, guaranteeing that both the programmatic and human‑readable representations stay consistent. |
| **Semantic Entity Schema Evolution** | `schema_v1.sql`, `schema_v2.sql`, `migrate_schema.py`, validation utilities | Initial schema (`v1`) defines only generic *artifact* nodes.  Subsequent migrations add tables/graph types for *insight*, *problem*, *solution*, and *learning* entities.  Migration scripts (`migrate_schema.py`) perform in‑place transformations while preserving existing data; validation tools run against a test copy to ensure that downstream queries continue to work.  Version numbers are stored alongside each entity to allow mixed‑version reads during transition periods. |
| **Stdio Interception Logging** | `auto_logger.py`, `specstory_formatter.py` | `auto_logger.py` spawns the agent as a subprocess, replaces its `stdin`/`stdout` file descriptors with pipe objects, and attaches a listener that timestamps each line.  The listener hands the raw line to `specstory_formatter.py`, which wraps it in the spec‑story JSON schema (including metadata such as session id, direction, and timestamps) before persisting to a rotating log directory.  The logger runs in a separate thread to avoid blocking the agent’s execution. |

All four subsystems are **configuration‑driven**: a central `core_config.yaml` lists enabled agents, sync intervals, schema versions, and log rotation policies.  The system boots by loading this file, instantiating the detector, and wiring the adapters, sync engine, and logger together.

---

## Integration Points  

1. **Live MCP Memory Server** – the primary data store that the adapters read from and write to.  The sync scripts query this server via its public REST or RPC API; any change to the server’s API would require updates only in the adapter implementations, not in the sync layer.

2. **Visual Knowledge Base (VKB)** – a UI‑oriented store (often a graph‑database or document store) that consumes the exported JSON/CSV files.  The import script pushes data into the VKB using its ingestion endpoint; the reverse flow reads human‑added insights from the VKB’s export API.

3. **Agent SDKs / CLIs** – Claude and Copilot expose distinct client libraries.  The adapters encapsulate these differences, exposing a **uniform contract** to the rest of CorePattern.  Adding a new agent only requires implementing the contract.

4. **Spec‑Story Consumer** – downstream tools that replay sessions (e.g., debugging dashboards, analytics pipelines) consume the spec‑story logs produced by the stdio interceptor.  Because the logs are emitted in a stable schema, consumer services can evolve independently.

5. **Configuration Management** – the `core_config.yaml` file is read by the bootstrap code and is also the source of truth for CI pipelines that provision environments (dev, test, prod).  Environment‑specific overrides are supported through standard YAML inheritance.

---

## Usage Guidelines  

*Detect early, adapt early.*  The **Agent Detector** must run before any memory or browser calls are made; developers should place the detector invocation at the top of the application entry point.  When introducing a new LLM, create a concrete adapter that satisfies the existing interface and register it in `AdapterRegistry`—no other component needs to be aware of the new agent.

*Synchronise deliberately.*  Schedule the **export/import scripts** at a cadence that matches the team’s knowledge‑refresh needs (e.g., every 15 minutes for fast‑moving projects, hourly for stable workloads).  Ensure that the sync directory is on a reliable, shared storage volume to avoid partial writes.

*Version schemas responsibly.*  When evolving the **Semantic Entity Schema**, bump the version identifier, run `migrate_schema.py` against a staging copy first, and retain backward‑compatible validation rules.  During a transition, both old and new schema versions may coexist; adapters should be tolerant of missing optional fields.

*Separate logs.*  The **Stdio Interception Logging** writes to its own log rotation tree; production logs that capture system health should not be mixed with session‑level spec‑story logs.  Configure retention policies according to compliance requirements (e.g., keep session logs for 30 days, rotate daily).

*Test in isolation.*  Because each layer communicates through interfaces, unit tests can mock the adapter, sync engine, or logger independently.  Integration tests should verify end‑to‑end flow: detector → adapter → memory → export → VKB → import → memory, asserting that data remains consistent across the round‑trip.

---

### Summary of Architectural Insights  

| Architectural Pattern | Where It Appears | Design Decision / Trade‑off |
|-----------------------|------------------|-----------------------------|
| **Adapter (Agent‑Agnostic)** | `AgentDetector`, `AdapterRegistry`, concrete adapters | Enables polyglot agent support; adds a thin indirection layer that slightly increases call latency but vastly improves extensibility. |
| **Bidirectional Synchroniser** | Export/Import scripts (`export_state.py`, `import_state.sh`) | Guarantees consistency between live memory and human‑readable VKB; introduces eventual‑consistency semantics and requires conflict‑resolution policies if concurrent edits occur. |
| **Schema‑Versioning / Evolution** | Migration scripts, versioned schema files | Allows progressive enrichment of the knowledge graph; must maintain backward compatibility and run migration safely on large datasets. |
| **Decorator‑style Stdio Interception** | `auto_logger.py`, `specstory_formatter.py` | Captures all agent I/O without code changes; incurs overhead of pipe buffering and log‑formatting, mitigated by asynchronous processing. |

**Design decisions** focus on **modularity** (each concern lives in its own module), **extensibility** (new agents or entity types can be added by implementing well‑defined interfaces), and **observability** (transparent logging and synchronisation provide auditability).  

**Scalability considerations** – the adapter layer scales horizontally because each agent instance runs its own adapter; the sync scripts can be parallelised across partitions of the memory graph; schema migrations can be performed incrementally using chunked batches.  

**Maintainability assessment** – the clear separation of concerns, explicit registry maps, and versioned schemas make the system **highly maintainable**.  The primary risk lies in the synchronization scripts: if they fall out of sync with the live server’s API, data drift can occur.  Regular integration testing and automated schema validation mitigate this risk.