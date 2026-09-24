# LiveLoggingSystem

**Type:** Component

# LiveLoggingSystem — Technical Insight Document

## What It Is

LiveLoggingSystem is one of 7 major components under the Coding root, formally instantiated as one of 10 L2 ontology classes in `.data/ontologies/coding.lower.json`, extending the generic L1 'Component' carrier enumerated in `REFINABLE_L1_PARENTS` (`ontology-classification-agent.ts`). It is the subsystem responsible for capturing, persisting, and reconstructing live development session activity — spanning transcript monitoring, observation persistence, classification, and session-continuity recovery. It is composed of six child components: ObservationWriter, ObservationConsolidator, MentionsClassifier, EnhancedTranscriptMonitor, TokenUsageAdapters, and ClaudeJsonlTreeAdapter, each implementing a distinct stage of the logging pipeline.

![LiveLoggingSystem — Architecture](images/live-logging-system-architecture.png)

## Architecture and Design

The system follows a pipeline architecture where the Enhanced Transcript Monitor (ETM, `enhanced-transcript-monitor.js`) captures live session data and hands observations to ObservationWriter.js, which mediates all persistence between ETM and the database. ObservationWriter applies turn-aware semantic dedup and snapshot promotion to avoid redundant storage — a deliberate cost/quality trade-off mirrored downstream in ObservationConsolidator's dirty-parent-only scheduled re-consolidation strategy, which re-synthesizes only parents with new children rather than performing full re-synthesis.

A second architectural theme is two-phase, eventually-consistent classification: observations are initially tagged as generic Components and only later promoted to the named LiveLoggingSystem label via classifyL2 (`l2-subsystem-classifier.js`), an LLM-assisted classification pass distinct from ingestion. This is protected structurally by a hard-root guard in `OntologyClassificationAgent.classifySingleObservation()` (Phase 60 D-14), which short-circuits classification for 5 hierarchy-root entities (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa) to prevent LLM drift from corrupting the hierarchy that anchors LiveLoggingSystem's own L2 refinement.

TokenUsageAdapters embodies a Strategy/Adapter hybrid pattern via `STOP_ADAPTERS` (`lib/lsl/token/stop-adapter-registry.mjs`) — a keyed registry per agent (claude, copilot, opencode, pi) distinguishing `mode: 'transcript'` from `mode: 'stamp-only'`, encoding the hard invariant (D-04) that only agents bypassing rapid-llm-proxy get transcript rebuilds, avoiding double-counted tokens.

![LiveLoggingSystem — Relationship](images/live-logging-system-relationship.png)

## Implementation Details

Configuration integrity is enforced schema-first via `LSLConfigValidator` (`scripts/validate-lsl-config.js`), requiring top-level keys `version`, `multiUser`, `fileManager`, `operationalLogger`, and `classification`, with numeric bounds like `fileManager.maxFileSize` (1MB–100MB) and `operationalLogger.batchSize` (10–1000) — front-loading errors rather than allowing silent runtime coercion. `validateUserEnvironment()` derives a 6-character SHA-256 hash of `process.env.USER` for multi-user namespacing without exposing raw usernames, but hard-fails if `USER` is unset, creating a dependency on shell environment propagation fragile in containerized/CI contexts.

`session-facts.ts`'s `buildSessionFactIndex` anchors session-derived Insight nodes onto LiveLoggingSystem sub-nodes (EtmDaemon, HeartbeatWriter) primarily via `metadata.parentId`, falling back to graph 'contains' edges with explicit cycle-termination logic since the underlying graph doesn't guarantee acyclicity.

## Integration Points

The `/sl` (Session Logs) command reconstructs project context by loading recent Live Session Log transcripts, producing continuity summaries (time range, pending work, branch state, open bugs) — a human/agent-facing recovery layer distinct from ObservationWriter's persistence layer. As a sibling to KnowledgeManagement, LiveLoggingSystem's observations feed the same Insight-node ecosystem where Wave-analysis fixes ensure insights are properly stamped and queryable.

## Usage Guidelines

Do not trust "storing" log entries for [Raw] fallback observations (proxy-timeout classification failures) as proof of persistence — they repeatedly silently fail to persist. Validate `lsl-config.json` against LSLConfigValidator before deployment, and ensure `USER` is set in all execution environments. When extending TokenUsageAdapters, preserve the mode invariant to avoid double-counting proxy-routed tokens.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observation persistence between ETM and the database, applying turn-aware semantic dedup and snapshot promotion, but [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist
- The 'Cross-Agent /sl (Session Logs) Command / LSL Session Continuity Bootstrap' record establishes that /sl reconstructs project context by loading the most recent Live Session Log transcript files and producing a structured continuity summary covering time range, pending work, branch state, and open bugs
- Per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record, ObservationWriter.js mediates all observation persistence between ETM (Enhanced Transcript Monitor) and the database, applying turn-aware semantic dedup and snapshot promotion to avoid redundant storage. However, the record establishes a specific and repeatedly observed failure mode: [Raw] fallback observations — generated when a proxy call times out during classification — are logged as 'storing' in the pipeline's own logs, yet have been repeatedly observed to silently fail to actually persist to the database, meaning the logged success state cannot be trusted as evidence of durable storage for this observation class.
- The 'Session Continuity Protocol (/sl)' and 'Cross-Agent /sl (Session Logs) Command / LSL Session Continuity Bootstrap' records establish that this command reconstructs 'where was I' context by reading structured Live Session Log (LSL) transcript files across one or more projects, then synthesizing a continuity summary covering time range, projects touched, recent tasks, current state, branch state, open bugs, and likely next steps — functioning as the primary human/agent-facing recovery mechanism after any working-session gap or interruption, distinct from the underlying persistence layer that ObservationWriter manages.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observa; LLMAbstraction: [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which AP; DockerizedServices: [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History ; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rend; ConstraintSystem: [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the con; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [ObservationWriter](./ObservationWriter.md) -- [SESSION] ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent: [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist.
- [ObservationConsolidator](./ObservationConsolidator.md) -- [SESSION] Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap: implements a dirty-parent-only scheduled re-consolidation strategy that re-synthesizes only parents with new children, far cheaper than full re-synthesis while nearly matching quality.
- [MentionsClassifier](./MentionsClassifier.md) -- [CGR] MentionsClassifier.js (module) in MentionsClassifier.js
- [EnhancedTranscriptMonitor](./EnhancedTranscriptMonitor.md) -- [CGR] EnhancedTranscriptMonitor (class) in enhanced-transcript-monitor.js
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] `STOP_ADAPTERS` (lib/lsl/token/stop-adapter-registry.mjs) is the component's core data structure: a per-agent keyed registry where each entry declares `mode: 'transcript'` (claude, copilot, opencode) or `mode: 'stamp-only'` (pi), with only 'transcript' entries carrying a `build`/`locate` pair. This is a deliberate Strategy/Adapter hybrid — the keyed-map shape lets `captureForegroundTokens` treat all four agents uniformly while the mode flag encodes a hard invariant (D-04): only agents that bypass rapid-llm-proxy get a transcript rebuild, because building one for a proxy-routed agent would double-count tokens already present in `token_usage`.
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] lib/lsl/adapters/claude-jsonl-tree.mjs implements the Claude sub-agent transcript discovery path via `walkSubAgentJsonl()`, which recursively visits `~/.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl` and filters every candidate through `SUBAGENT_PATH_RE` at the candidate stage rather than after conversion. The regex captures three groups — encoded-cwd, parent session UUID, and agent hex id — that are re-extracted downstream by three separate single-purpose functions (`projectFromClaudeSubagentPath`, `parentSessionFromClaudeSubagentPath`, `agentIdFromClaudeSubagentPath`) instead of being threaded through as a parsed object, so every caller that needs row metadata re-runs the same regex against the same path.

### Siblings
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which API surface (Responses API vs /chat/completions), since some models are gated per-endpoint and mismatched combinations must be rejected rather than silently allowed
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and container state should be captured as a baseline to compare against post-restart state and catch regressions like stale naming or misconfigured mounts
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rendered .png files live in docs/images/, distinct from the MkDocs-served docs-content/images/ tree.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying ConstraintSystem violation state directly into the click-driven statusline UX
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 9 observations*
