# ConstraintSystem

**Type:** Component

## What It Is

ConstraintSystem is a distributed component whose implementation spans hook-dispatch infrastructure (`lib/agent-api/hooks/hook-config.js`, `hook-manager.js`), a violation persistence layer (`scripts/violation-capture-service.js`), and a Next.js-based reporting surface (the constraint-monitor dashboard), tied together with a click-driven affordance in the tmux statusline. It is not a single class or file but an assembly of cooperating pieces registered under Coding as a sibling of LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, and SemanticAnalysis. Its children — ContentValidationAgent, HealthPromptHook, UnifiedHookManagementSystem, KnowledgeInjectionHook, and DashboardWorkflowHooks — indicate that "constraint enforcement" here is realized through hook wiring and dashboard reporting rather than a monolithic validator.

![ConstraintSystem — Architecture](images/constraint-system-architecture.png)

## Architecture and Design

The core pattern is a two-tier, override-based configuration merge: `HookConfigLoader` in `hook-config.js` establishes user-level defaults (`~/.coding-tools/hooks.json`) that project-level `.coding/hooks.json` values override field-by-field via `UnifiedHookManager.loadConfig()`. This lets individual projects tighten enforcement (e.g., `stopOnError=true`) without global changes or manual file synchronization — at the cost of requiring developers to inspect both files to know the effective runtime behavior.

Handler execution is organized around `registerHandler()`'s id-based deduplication plus priority-based re-sorting: registrations replace existing same-id entries and trigger a full re-sort, guaranteeing the handlers array is always execution-ordered with no duplicates. This invariant simplifies every dispatch path (startup, shutdown, pre-tool, post-tool, pre-prompt, post-prompt, error) to plain iteration.

Persistence follows a split-concern design in `ViolationCaptureService`: an append-only JSONL session log preserves the raw event stream, while a separate, size-capped `violation-history.json` (hard limit of 1000 entries via slicing) drives aggregate dashboard statistics. This trades complete historical accuracy in the aggregate view for bounded file growth, with full history still recoverable from JSONL if needed.

## Implementation Details

`sanitizeParams()` in `violation-capture-service.js` redacts fields matching sensitive substrings (password, token, key, secret, auth) *before* any write to disk — a capture-time rather than render-time security boundary, meaning redaction cannot be bypassed by reading raw JSONL directly. `updateViolationHistory()` enforces the 1000-entry cap through array slicing, silently dropping old aggregate entries.

`HookConfigLoader.validateConfig()` takes a permissive stance: malformed entries (missing type/path) log warnings rather than throwing, letting the system degrade gracefully by skipping bad entries while risking silent, long-lived configuration typos.

On the reporting side, the constraint-monitor dashboard is a Next.js application, architecturally distinct from the Vite-based system-health-dashboard, both reachable via the shared `health-prompt-hook.js` status aggregator (implemented as HealthPromptHook). This split-framework structure means Next.js-specific tooling requirements (e.g., ESLint flat-config) apply only to this dashboard's pipeline.

## Integration Points

![ConstraintSystem — Relationship](images/constraint-system-relationship.png)

The tmux statusline exposes a clickable 'constraints' field that opens or focuses the constraint-monitor dashboard tab, directly surfacing ConstraintSystem violation state in the operator's terminal UX. This click-handling logic lives in UnifiedHookManagementSystem's tmux/statusline wiring rather than the dashboard itself, meaning that module is part of ConstraintSystem's effective surface area despite living separately. HealthPromptHook's `health-prompt-hook.js` acts as the shared status aggregator connecting both the constraint-monitor and system-health dashboards. Notably, KnowledgeInjectionHook is a child in name only per current evidence — the actual `health-prompt-hook.js` code injects health summaries (`deriveSummary()`, `outputHealthContext()`), not knowledge-base content, and the knowledge-injection logic described elsewhere points back to `hook-config.js`/`hook-manager.js`, which weren't found referencing that entity directly. ContentValidationAgent's coverage-metric quirk (denominator inclusion of 'observations'/'digests') is a related but distinct concern under this same parent grouping.

## Usage Guidelines

Developers modifying hook behavior must check both user-level and project-level config files, since neither is independently authoritative. Because `validateConfig()` only warns on malformed entries, configuration changes should be verified against logs rather than assumed correct from absence of errors. When extending violation storage, remember the JSONL log is the durable source of truth while `violation-history.json` is a bounded, lossy aggregate — don't rely on it for complete historical queries. Any new sensitive-data fields should be added to `sanitizeParams()`'s substring list, since sanitization is enforced only at capture time. Finally, cross-dashboard work must account for the Next.js vs Vite split between the constraint-monitor and system-health-dashboard, and changes to statusline click-behavior should be treated as within ConstraintSystem's scope even though implemented in UnifiedHookManagementSystem.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying ConstraintSystem violation state directly into the click-driven statusline UX
- The HealthDashboard architecture record establishes that the Next.js-based constraint-monitor dashboard is one of the dashboards reachable via the health-prompt-hook.js status aggregator, distinct from the Vite-based system-health-dashboard
- The Statusline Click-Report Feature record establishes that ConstraintSystem violation state is surfaced not just through the constraint-monitor dashboard's own UI but through a click-driven affordance in the tmux statusline: clicking the 'constraints' field opens or focuses that dashboard tab directly. This ties the hook/violation-capture backend (hook-manager.js, violation-capture-service.js) to a specific frontend entry point outside the dashboard itself, meaning changes to the statusline click-handling code are part of the effective surface area of the constraint system even though they live in a separate module (HookManagementSystem).
- The HealthDashboard architecture record establishes that the constraint-monitor dashboard consuming ViolationCaptureService's output is built on Next.js, distinct from the Vite-based system-health-dashboard used for other operational metrics, and both are reachable through the shared health-prompt-hook.js status aggregator. This means the ConstraintSystem's reporting UI has a different build/deploy pipeline and framework-specific tooling (e.g., ESLint flat-config requirements noted for Next.js apps) than sibling dashboards, which a developer must account for when making cross-dashboard changes or shared-component extraction.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observa; LLMAbstraction: [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which AP; DockerizedServices: [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History ; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rend; ConstraintSystem: [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the con; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [ContentValidationAgent](./ContentValidationAgent.md) -- [SESSION] The obs-api Service Lifecycle and Dev Workflow Resumption record establishes that a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage.
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] The HealthDashboard record establishes that health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.
- [UnifiedHookManagementSystem](./UnifiedHookManagementSystem.md) -- [SESSION] The tmux Statusline Copy-Mode / Mouse Configuration record and Tmux Pane Badge — ETM Entry Selection Logic record are both filed under HookManagementSystem, indicating this component's scope extends beyond agent tool hooks into tmux pane/statusline click-hook wiring.
- [KnowledgeInjectionHook](./KnowledgeInjectionHook.md) -- [LLM] None of the supplied code files implement, import, or reference a `KnowledgeInjectionHook` entity. `scripts/health-prompt-hook.js` is a `UserPromptSubmit` hook whose entire job is fetching `/health/state` from the host health-coordinator and reducing it to a one-line status string (`deriveSummary()`, `outputHealthContext()`) — it injects a health summary, not knowledge-base content, into the prompt context. The parent context's own description of knowledge injection lives in `lib/agent-api/hooks/hook-config.js` and `hook-manager.js` (per the parent's [LLM] observations), and neither file appears anywhere in the Code Files provided here.
- [DashboardWorkflowHooks](./DashboardWorkflowHooks.md) -- [LLM] useWorkflowDefinitions in integrations/system-health-dashboard/src/components/workflow/hooks.ts is the actual implementation of a 'dashboard workflow hook': it reads nine Redux selectors (selectAgents, selectOrchestrator, selectEdges, selectStepMappings, selectStepToSubStep, selectAgentSubSteps, selectWorkflowConfigLoading, selectWorkflowConfigError, selectWorkflowConfigInitialized) from workflowConfigSlice and merges them with static fallback constants (WORKFLOW_AGENTS, ORCHESTRATOR_NODE, MULTI_AGENT_EDGES, STEP_TO_AGENT, STEP_TO_SUBSTEP, AGENT_SUBSTEPS). The merge order is deliberate: API data takes precedence for agents/orchestrator/edges (`agents?.length > 0 ? agents : WORKFLOW_AGENTS`) but constants are spread FIRST for the three mapping objects (`{ ...STEP_TO_AGENT, ...(stepToAgent || {}) }`), so a partial API response can never leave a step unmapped — the code comment calls out 'operator_* → kg_operators' as the critical mapping constants must never lose.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observation persistence between ETM and the database, applying turn-aware semantic dedup and snapshot promotion, but [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which API surface (Responses API vs /chat/completions), since some models are gated per-endpoint and mismatched combinations must be rejected rather than silently allowed
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and container state should be captured as a baseline to compare against post-restart state and catch regressions like stale naming or misconfigured mounts
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rendered .png files live in docs/images/, distinct from the MkDocs-served docs-content/images/ tree.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 9 observations*
