# LiveLoggingSystem

**Type:** Component

# LiveLoggingSystem — Technical Insight Document

## What It Is

LiveLoggingSystem is an L2 subsystem classification within the Coding knowledge graph's ontology, registered in `.data/ontologies/coding.lower.json` and loaded via `loadL2Classes(registry)` in `ontology-classification-agent.ts`. It extends the L1 carrier `Component`, meaning it is not a standalone graph type but a semantic refinement — nodes tagged LiveLoggingSystem are understood as "part of the live logging/session-capture subsystem" while remaining structurally Components. Concretely grounded implementation touchpoints include `scripts/validate-lsl-config.js` (configuration validation) and `session-facts.ts` (session fact extraction and anchoring). Its declared children — LSLConfigValidator, SessionFactIndex, ObservationPipeline, TranscriptAdapters, and TmuxSessionWrapper — represent the intended decomposition of this subsystem, though evidence quality varies sharply across them (detailed below).

![LiveLoggingSystem — Architecture](images/live-logging-system-architecture.png)

## Architecture and Design

The clearest architectural pattern evidenced is the **two-tier classification pipeline** that assigns nodes to LiveLoggingSystem in the first place: a deterministic keyword-based classifier `classifyL2()` in `l2-subsystem-classifier.js` runs first, cheaply matching text against known patterns (e.g., "session log", "transcript", "LSL"). Only when this heuristic declines does an LLM-based fallback in `OntologyClassificationAgent` engage. This is a deliberate cost/drift trade-off: cheap deterministic rules handle the common case, while the LLM path handles novel phrasing — hardened by `extractL2FromLLMResponse()`, which uses token-boundary regex matching against a closed vocabulary so hallucinated class names are rejected and classification degrades safely back to the parent Component rather than polluting the graph.

A second structural pattern is **dual-anchoring with graceful degradation**, seen in how `session-facts.ts` attaches extracted SubComponents to the graph: primarily via `metadata.parentId`, with a `contains`-edge traversal as fallback. Since roughly 22% of live SubComponents (104 of 468) lack a stamped parentId, this fallback is not an edge case but a load-bearing path relied upon by a substantial fraction of the corpus.

![LiveLoggingSystem — Relationship](images/live-logging-system-relationship.png)

## Implementation Details

Configuration validation is centralized in the `LSLConfigValidator` class (`scripts/validate-lsl-config.js`), which checks `.specstory/config/lsl-config.json` against a schema requiring `version`, `multiUser`, `fileManager`, `operationalLogger`, and `classification` sections. It enforces concrete bounds such as `fileManager.maxFileSize` between 1MB and 100MB, guarding against log-rotation thrashing or truncation. Multi-user disambiguation is handled by `validateUserEnvironment()`, which derives a 6-character hash via `crypto.createHash('sha256').update(user).digest('hex').substring(0,6)` from the `USER` environment variable — allowing shared log directories to separate sessions without embedding raw usernames in file paths.

Session identity for recording pipelines follows the `session-YYYYMMDD-HHMMSS-<HEX IDs>` convention, with storage under `~/.rapidscribe/meetings/<session-id>/`; this naming/path contract is directly exercised by smoke tests and is a hard compatibility constraint for anything touching session generation.

Notably, several declared children lack direct implementation evidence: no file references `SessionFactIndex` as a class or export (only the thematically related `session-facts.ts`); no adapter-registry or interface abstraction was found for `TranscriptAdapters` despite adjacent transcript reader/writer files (`enhanced-transcript-monitor.js`, `PiSessionReader.js`, `StreamingTranscriptReader.js`, `AdaptiveExchangeExtractor.js`, `PiSessionWriter.js`); and `TmuxSessionWrapper` has no grounding at all in the observation/write/consolidate/export files reviewed (`ObservationWriter.js`, `ObservationConsolidator.js`, `ObservationExporter.js`, `raw-fallback.js`). ObservationPipeline is the best-evidenced child, with Stage 5 scheduled consolidation described as fully implemented in production, modulo one open guard-coverage defect.

## Integration Points

LiveLoggingSystem's health is externally dependent on `health-coordinator.js`, which computes daemon/PID staleness from heartbeat file age plus PID liveness checks to report Healthy/Degraded status without false alarms — a dual-check design explicitly noted as preventing spurious flapping when heartbeat and PID liveness disagree.

Test infrastructure exercising this system's observation-writing paths runs through `obs-api`, which is effectively single-threaded; concurrent Jest workers in the typed-views test suite contending on this endpoint have produced timeout failures, establishing a known constraint that future test changes must serialize or limit worker concurrency against obs-api rather than assume safe parallelism.

Within the hierarchy, LiveLoggingSystem sits as a peer of LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, ConstraintSystem, and SemanticAnalysis under the Coding root, sharing the graph's Component/SubComponent/Detail carrier schema with all siblings. Its output (session facts, observations) feeds downstream into SemanticAnalysis-style consolidation and KnowledgeManagement's insight persistence, though those specific linkages are not directly evidenced here.

## Usage Guidelines

Developers extending classification must update the ontology JSON registry (`.data/ontologies/coding.lower.json`), not just add code, since `loadL2Classes` reads this at startup and gracefully degrades to an empty class list if the file is missing. When modifying `session-facts.ts`, treat `metadata.parentId` as preferred-but-not-guaranteed and preserve the `contains`-edge fallback to avoid orphaning a large share of live-logged facts. Changes to session ID generation or the `~/.rapidscribe/meetings/<session-id>/` storage structure risk breaking smoke tests that locate sessions by this convention. Test suites touching obs-api-backed features should account for its single-threaded bottleneck. Finally, given the sparse/contradictory evidence for SessionFactIndex, TranscriptAdapters, and TmuxSessionWrapper, any future documentation or code work on these children should verify actual implementation locations before assuming the names correspond to real, locatable artifacts.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents
- Typed-Views Test Suite — obs-api Contention Timeout documents a timeout failure in the typed-views test suite caused by concurrent Jest test workers contending on a shared, effectively single-threaded obs-api backend endpoint
- The 'Meeting Recording Pipeline — Session Smoke Test' record establishes that healthy start/verify/stop behavior for rapidscribe-meeting recording sessions (e.g. two-person feedback meetings with named external participants like David and Basti) depends on sessions being identified by a `session-YYYYMMDD-HHMMSS-<HEX IDs>` naming convention and stored under `~/.rapidscribe/meetings/<session-id>/`. This gives LiveLoggingSystem a concrete, testable contract for its recording subsystem: any change to session ID generation or storage path structure risks breaking the smoke test's ability to locate and validate an in-progress or completed session.
- The 'Opencode Daemon — Session Tracking and Temp File Lifecycle' record establishes that health-coordinator.js computes PID staleness from heartbeat file age and PID liveness checks to surface accurate 'Healthy'/'Degraded' status on the dashboard for coding sub-agents, explicitly designed to avoid false alarms. This is architecturally significant for LiveLoggingSystem because the live logging pipeline's own health depends on this heartbeat mechanism — if a logging daemon's heartbeat file goes stale but its PID is still alive (or vice versa), the health coordinator's dual-check logic (not just PID liveness alone) is what prevents spurious Degraded status flapping on the dashboard.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file; LLMAbstraction: [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copi; DockerizedServices: [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised ; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, me; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generat; ConstraintSystem: [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constra; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [LSLConfigValidator](./LSLConfigValidator.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents.
- [SessionFactIndex](./SessionFactIndex.md) -- [LLM] None of the retrieved code files reference a `SessionFactIndex` class, export, or file. The closest named artifact is `session-facts.ts`, cited only in the parent entity's own observations ('Session facts extracted from live transcripts... anchored onto the knowledge graph primarily via `metadata.parentId`, with a fallback resolution path through `contains` edges'), but that file was not part of this retrieval — the actual anchoring logic, its parentId-stamping code path, and its contains-edge fallback are not visible here to verify or ground further.
- [ObservationPipeline](./ObservationPipeline.md) -- [SESSION] Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap notes periodic re-synthesis of parent-node descriptions from accumulated child observations is fully implemented in production with one open guard-coverage defect.
- [TranscriptAdapters](./TranscriptAdapters.md) -- [LLM] No file in the supplied code evidence is named or scoped as 'TranscriptAdapters'. The closest candidates — enhanced-transcript-monitor.js, PiSessionReader.js, StreamingTranscriptReader.js, AdaptiveExchangeExtractor.js, PiSessionWriter.js — are transcript readers/writers referenced as imports inside enhanced-transcript-monitor.js, but none of them is shown, and no adapter-registry or adapter-interface abstraction is visible in the truncated excerpts provided.
- [TmuxSessionWrapper](./TmuxSessionWrapper.md) -- [LLM] None of the five supplied files (scripts/enhanced-transcript-monitor.js, src/live-logging/ObservationWriter.js, src/live-logging/ObservationConsolidator.js, src/live-logging/ObservationExporter.js, src/live-logging/raw-fallback.js) define, import, or reference anything named TmuxSessionWrapper, nor any tmux-specific process spawning, pane/window management, or terminal-multiplexer control logic. The retrieved set clusters around the Observation write/consolidate/export pipeline and the ETM (enhanced-transcript-monitor) prompt-capture loop — a thematically adjacent but distinct part of LiveLoggingSystem from whatever wraps a tmux session.

### Siblings
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as last resort — rather than demoting to lower tiers as primary
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised processes/health endpoints must be confirmed live before relying on downstream pipelines like wave-analysis
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, meaning the viewer's History sidebar (which filters strictly to entityType 'Insight') could never surface a Batch badge for that run's conclusions.
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generated diagram artifacts belong in version control versus being build outputs, enforcing consistent authoring and correct rendering across the docs pipeline.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying HookManagementSystem's violation data to a click-driven UX surface
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 9 observations*
