# HealthCoordinator

**Type:** SubComponent

# HealthCoordinator — Technical Insight Document

## What It Is

HealthCoordinator is concretely implemented in `scripts/health-coordinator.js` as a standalone daemon process, not a class hierarchy or agent in the SemanticAnalysis sense. It is worth noting up front that while HealthCoordinator is nested under the SemanticAnalysis parent in this system's hierarchy, the observations make clear it is an operationally distinct subsystem — a health-monitoring daemon — sitting alongside sibling entities like OntologyClassificationAgent and SemanticAnalysisAgent that belong to an entirely different concern (ontology/taxonomy derivation). The daemon maintains a single in-memory `currentState` object as its source of truth and exposes it over HTTP via `GET /health`, `GET /health/state`, `POST /signals`, and `POST /health/refresh`. State is refreshed on a 5-second tick that iterates a check registry loaded from `config/health-verification-rules.json`, consolidating what were previously four legacy host daemons into one process.

## Architecture and Design

The core pattern is a single-owner Source-of-Truth (SoT) HTTP gateway, explicitly mirrored elsewhere in the system by `observations-api-server.mjs`. HealthCoordinator binds to `0.0.0.0` rather than localhost specifically to satisfy Docker host-gateway networking, indicating the daemon must be reachable from sibling containers rather than just the host process.

![HealthCoordinator — Architecture](images/health-coordinator-architecture.png)

The scheduler is tick-based (`TICK_MS`) with per-check error isolation: each probed subsystem — container, services, lsl, databases, knowledge_pipeline, graph_integrity, sub_agent_capture, classifier — is independently checked and independently allowed to fail without corrupting the others' status. This directly reflects SPEC R6, which mandates that a throwing check must tag its slice `unknown` rather than fabricate `healthy`. Notably, not all checks share the same cadence: `graph_integrity` runs on a slower interval than the 5s tick because it must read the entire knowledge graph (~2k entities, ~28k relations), so the design deliberately mixes fast and slow probes within one `currentState` schema, differentiated by computation cost.

A defense-in-depth guard is embedded directly in the module via `FORBIDDEN_RULE_NAMES` (`bind_mount_freshness`, `supervisord_status`), which must be skipped even if stale configuration still references them — a hedge against config/environment drift across deploy phases rather than an assumption of clean cutover.

## Implementation Details

The child entity InjectionFlagSystem is implemented directly in this file via the module-level `injectionFlags` Map and the `shouldInject(kind)` function, which unifies two fault-injection paths: an in-memory flag set through `POST /test/inject` (loopback-gated) and the legacy `HEALTH_COORDINATOR_INJECT_THROW` environment variable. Any check site can call `shouldInject()` without caring which mechanism triggered the fault.

LslSessionStalenessTracking is implemented as a two-stage decay rather than a single timeout: `HEARTBEAT_STALENESS_MS = 15_000` marks a session "stopped" after 15 seconds without a heartbeat, and `EVICT_AFTER_STOPPED_MS = 5 * 60 * 1000` removes it from `currentState.lsl` only after 5 minutes in that stopped state (tagged D-10). This prevents dashboards from flapping a session straight to "gone" on a single missed beat.

ActiveTimeStallClock and EtmExpectationTracking work together to avoid false-positive stall/health warnings. The stall clock (`_obsActiveStallMs`, `_obsStallAnchor`, `_obsStallPolledAt`) accumulates elapsed time only while `currentState.user_active === true`, advancing by actual `sinceLastPoll` duration rather than assuming a fixed tick interval — explicitly compensating for delayed or slow ticks. This guards against a known historical regression where a wall-clock "stalled" verdict false-alarmed nightly. EtmExpectationTracking derives `ETM_MISSING_MS` as a multiple of `ETM_SPAWN_INTERVAL_MS`, records expectations only after an activity gate, and prunes sweep-scoped state — preventing both false stall warnings from idle wall-clock time and false-healthy readings from crash-looping ETMs missing session-key tracking.

Uniquely, `tests/integration/health-coordinator-etm-expected.test.mjs` validates these invariants via source-contract testing: it regex-matches the flattened source text of the coordinator rather than importing and executing it, pinning exact literal tokens (e.g., `_obsActiveStallMs += sinceLastPoll`). This means a semantically equivalent rewrite could fail CI even without a behavioral regression.

## Integration Points

![HealthCoordinator — Relationship](images/health-coordinator-relationship.png)

HealthCoordinator's HTTP surface is its primary integration point, and its currentState schema aggregates status from multiple subsystems (container, services, lsl, databases, knowledge_pipeline, graph_integrity, sub_agent_capture, classifier), implying dependencies on each of those probed domains. Its child components — InjectionFlagSystem, LslSessionStalenessTracking, EtmExpectationTracking, and ActiveTimeStallClock — are not separate modules but logical subsystems implemented within the same `health-coordinator.js` file, all reachable through the shared `currentState` object and tick scheduler. The architectural pattern of a single-owner SoT HTTP gateway is shared with `observations-api-server.mjs`, suggesting a system-wide convention for exposing consolidated state.

## Usage Guidelines

Any new health check registered in `config/health-verification-rules.json` must respect the `FORBIDDEN_RULE_NAMES` guard and must default to `unknown`, never `healthy`, on failure per SPEC R6. Developers adding checks with meaningfully different computation costs should follow the graph_integrity precedent of a separate slower interval rather than forcing everything onto the 5s tick. Because the ETM and stall-clock tests match literal source tokens rather than behavior, any refactor of `_obsActiveStallMs`, `_etmExpected`, or related variables must be coordinated with `tests/integration/health-coordinator-etm-expected.test.mjs` to avoid spurious CI failures — rewrites should preserve exact token forms, or the test itself must be updated in tandem. Fault injection should always go through `shouldInject()` rather than checking the legacy env var or Map directly, to preserve the unified interface.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per Pipeline CodingLowerOntologySource Emission Bug, the SemanticAnalysis pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced — an unrelated open defect in the ontology/semantic-analysis subsystem referenced in the parent context, not something present in the HealthCoordinator files themselves.
- Per Taxonomy Stability Validation via Disjoint Sample Re-derivation, SemanticAnalysisAgent-produced intent taxonomies were validated for reproducibility by re-deriving them independently from disjoint data samples and measuring agreement, establishing the taxonomy as a fixed 'spine' precondition — again describing the ontology/taxonomy subsystem in the parent context rather than HealthCoordinator's own code.

## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced

### Children
- [InjectionFlagSystem](./InjectionFlagSystem.md) -- [LLM] scripts/health-coordinator.js implements the InjectionFlagSystem directly: the module-level `injectionFlags` Map plus `shouldInject(kind)` function unify two fault-injection mechanisms — an in-memory flag set via POST /test/inject (loopback-gated) and the legacy `HEALTH_COORDINATOR_INJECT_THROW` env var — so any check site can query a single function regardless of which mechanism triggered it.
- [LslSessionStalenessTracking](./LslSessionStalenessTracking.md) -- [LLM] scripts/health-coordinator.js implements the actual staleness/eviction thresholds for LSL sessions: `HEARTBEAT_STALENESS_MS = 15_000` marks a session 'stopped' after 15s without a heartbeat, and `EVICT_AFTER_STOPPED_MS = 5 * 60 * 1000` drops it from `currentState.lsl` after 5 minutes in that state (both tagged D-10 in the header comment). This is a two-stage decay rather than a single timeout: a session first degrades to a visible-but-stopped status so consumers can still show 'last seen N ago', and only later disappears entirely, which keeps the dashboard/statusline from flapping a session straight to 'gone' on a single missed beat.
- [EtmExpectationTracking](./EtmExpectationTracking.md) -- [SESSION] Health Coordinator — ETM Reaper Logic notes this prevents false-positive stall/health warnings from raw wall-clock idle time and prevents crash-looping ETMs from showing falsely healthy due to missing session-key tracking.
- [ActiveTimeStallClock](./ActiveTimeStallClock.md) -- [LLM] The test file tests/integration/health-coordinator-etm-expected.test.mjs regex-matches flattened source of scripts/health-coordinator.js for the exact stall-clock update lines (`_obsActiveStallMs += sinceLastPoll`, `_obsStallAnchor` reset, `_obsStallPolledAt` diffing) rather than executing the coordinator, meaning the 'ActiveTimeStallClock' logic is pinned as literal source strings — a regression in these exact tokens (even a semantically equivalent rewrite) would fail CI even though behavior is unchanged.

### Siblings
- [Ontology](./Ontology.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced, indicating a gap between the lower-ontology source contract and actual emission behavior.
- [Pipeline](./Pipeline.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in its output despite documentation stating this source type should never be produced, indicating a mismatch between the pipeline's source-tagging logic and its own contract.
- [Insights](./Insights.md) -- [SESSION] Intent Spine Derivation Pipeline describes deriving an 'intent spine' by clustering insights into Intent entities via aggregate edges, consolidating five prior ad-hoc scripts into one producer script.
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation establishes that intent-derived taxonomies produced by SemanticAnalysisAgent were validated for stability by re-deriving the taxonomy independently from disjoint data samples and measuring agreement between the two derivations, rather than by inspecting a single run's output. This methodology exists because the taxonomy serves as a fixed 'spine' for downstream KB stages — instability would propagate structural drift into every consumer that depends on the taxonomy being held fixed, so reproducibility across disjoint samples was treated as a precondition for freezing the spine rather than an optional sanity check. This bears on OntologyClassificationAgent because its L1/L2 output is exactly the kind of categorical assignment such a spine depends on staying stable run-to-run.
- [SemanticAnalysisAgent](./SemanticAnalysisAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation validates that an intent-derived taxonomy produced from SemanticAnalysisAgent-adjacent processing is stable and reproducible by re-deriving it independently from disjoint data samples.
- [BaseAgentFramework](./BaseAgentFramework.md) -- [LLM] None of the five files retrieved for this request — scripts/health-coordinator.js, scripts/repair-writer-ontology-class.mjs, src/ontology/index.ts, tests/integration/health-coordinator-etm-expected.test.mjs, and config/agents/copilot.sh — define, import, or reference a class named BaseAgent, BaseAgentFramework, or any of the five lifecycle methods (process(), calculateConfidence(), detectIssues(), generateRouting(), applyCorrections(), buildMetadata()) that the parent context attributes to base-agent.ts. The <code_graph> block supplied for this request is also empty, so there is no structural (call-graph) evidence tying these files to the framework either. This is a retrieval mismatch, not a finding about the framework's design.
- [L2RefinementClassifier](./L2RefinementClassifier.md) -- [LLM] None of the supplied code files (scripts/health-coordinator.js, scripts/repair-writer-ontology-class.mjs, src/ontology/index.ts, tests/integration/health-coordinator-etm-expected.test.mjs, config/agents/copilot.sh) implement or reference loadL2Classes(), buildL2RefinementPrompt(), or extractL2FromLLMResponse() — the three functions the parent context attributes to L2RefinementClassifier's implementation in ontology-classification-agent.ts. That file is absent from the supplied evidence.
- [AgentLauncherConfigs](./AgentLauncherConfigs.md) -- [LLM] The supplied code files (health-coordinator.js, repair-writer-ontology-class.mjs, src/ontology/index.ts, health-coordinator-etm-expected.test.mjs, config/agents/copilot.sh) contain no reference to an 'AgentLauncherConfigs' class, module, or file. config/agents/copilot.sh is an agent definition sourced by launch-agent-common.sh, which is thematically adjacent to an 'agent launcher' concept but is not itself a config aggregation component named AgentLauncherConfigs.
- [NoUnboundedFsScanGuard](./NoUnboundedFsScanGuard.md) -- [LLM] None of the supplied code files implement or reference anything resembling a filesystem-scan bound or guard. `scripts/health-coordinator.js` owns health-state polling and Docker/service/LSL checks; `scripts/repair-writer-ontology-class.mjs` repairs `ontologyClass` vs `entityType` mismatches over HTTP against obs-api; `src/ontology/index.ts` wires `LegacyOntologyAdapter`/`OntologyValidator`/`OntologyClassifier`; the test file asserts ETM-expectation lifecycle invariants; `config/agents/copilot.sh` configures the CoPilot agent launch. None of these touch directory traversal, `fs.readdir`/`fs.walk` recursion, or any depth/size/count ceiling that a name like 'NoUnboundedFsScanGuard' would imply.


---

*Generated from 10 observations*
