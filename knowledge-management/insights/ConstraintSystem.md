# ConstraintSystem

**Type:** Component

# ConstraintSystem — Technical Insight Document

## What It Is

ConstraintSystem is a hook-driven enforcement and observability layer implemented across `lib/agent-api/hooks/hook-config.js`, `lib/agent-api/hooks/hook-manager.js`, and `scripts/violation-capture-service.js`, with a downstream data-consumption presence in `scripts/health-prompt-hook.js`. Its core responsibility is threefold: load and merge hook configuration (HookConfigLoader), dispatch hook handlers in priority order across the agent lifecycle (UnifiedHookManager), and persist/sanitize violation records produced when handlers reject or flag tool calls (ViolationCaptureService). The system's outputs — session-violations.jsonl and violation-history.json — form the data contract consumed by two independently deployed dashboards, and are surfaced in real time via a tmux statusline click-through affordance.

![ConstraintSystem — Architecture](images/constraint-system-architecture.png)

## Architecture and Design

The architecture centers on a registry/dispatch pattern: UnifiedHookManager pre-seeds a `Map<event, HookHandler[]>` from every value in the HookEvent enum (startup, pre-tool, post-tool, etc.) so all valid event keys exist before any handler registers, eliminating null-check branches at dispatch time. Handlers are appended via `registerHandler()` and the array is re-sorted by numeric priority (default 100), meaning execution order is fully priority-determined rather than registration-order-determined — with equal-priority handlers falling back to insertion order, a subtlety that can produce non-deterministic-feeling behavior if registration happens across async boundaries.

Configuration follows a two-tier override model in HookConfigLoader: `CONFIG_PATHS.user` (~/.coding-tools/hooks.json) for global preferences and `CONFIG_PATHS.project` (.coding/hooks.json) for repo-specific overrides, merged via `mergeConfigs()`. Critically, project-level handler definitions for a given event completely supersede user-level ones rather than composing additively — a deliberate design privileging reproducible per-project/CI behavior over persistent user customization.

Persistence in ViolationCaptureService follows a dual-artifact pattern: an append-only, unbounded JSONL log for full audit history and a capped, rolled-up JSON aggregate (1000 entries via slicing) for efficient dashboard consumption. This is a classic bounded-cache-plus-unbounded-log tradeoff.

## Implementation Details

`HookConfigLoader.validateConfig()` treats malformed entries (missing `handler.type`/`handler.path`, non-array `hooks.<event>`) as warnings, not hard errors — a fail-soft posture that keeps agent sessions running in degraded mode but risks silently disabling enforcement for an entire event type if a hooks.json typo goes unnoticed in startup logs.

`ViolationCaptureService.sanitizeParams()` redacts tool-call parameters whose keys substring-match a fixed denylist (`password`, `token`, `key`, `secret`, `auth`) before persistence. This naive key-name matching over-redacts (e.g., `keyword`, `authorName`) while potentially missing secrets under unlisted key names — a security boundary worth auditing rather than trusting as exhaustive.

`updateViolationHistory()` bounds the rollup file via array slicing, meaning long-running projects lose fine-grained history beyond the 1000-entry window in violation-history.json; only the JSONL log retains unbounded history, so any audit or full-history feature must read the JSONL rather than the rollup.

## Integration Points

![ConstraintSystem — Relationship](images/constraint-system-relationship.png)

ConstraintSystem sits as one of seven major components under the Coding root, alongside siblings LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, and SemanticAnalysis. Its children — HookConfigLoader, UnifiedHookManager, ViolationCaptureService, HealthPromptHook, and KnowledgeInjectionHook — implement its config loading, dispatch, and persistence responsibilities respectively; note that KnowledgeInjectionHook's evidentiary trail actually points to `health-prompt-hook.js`'s UserPromptSubmit/SPEC R8 envelope injection mechanism rather than a distinct implementation, indicating the two hooks are conceptually related but separately named.

Violation data aggregated via `health-prompt-hook.js` feeds two architecturally distinct dashboards — a Next.js-based constraint-monitor dashboard and a Vite-based system-health-dashboard — meaning any schema change to violation-history.json or session-violations.jsonl must preserve compatibility with both consumers. The tmux statusline's "constraints" field is wired to open/focus the constraint-monitor dashboard tab, creating a hard dependency from the terminal UX layer down through to the addressable dashboard tab/routing structure.

## Usage Guidelines

Developers editing `.coding/hooks.json` should understand that project-level handler definitions replace, not merge with, user-level ones per event — additive composition is not assumed. When registering handlers dynamically, be mindful that priority (not registration order) governs execution, and equal priorities fall back to insertion order, which can surprise across async registration paths. Treat `validateConfig()` warnings seriously since malformed config silently disables enforcement rather than failing loudly. Any consumer needing full violation history must read session-violations.jsonl, not the capped rollup. Finally, treat the denylist-based sanitization as a baseline, not a complete secret scanner, and any change to dashboard tab routing or violation data schema must account for both dashboard consumers and the statusline click-through dependency.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying HookManagementSystem's violation data to a click-driven UX surface
- HealthDashboard — Performance/System-Health/Token-Cost Dashboards record distinguishes the Next.js-based constraint-monitor dashboard from the Vite-based system-health-dashboard, both consuming violation/health data aggregated by health-prompt-hook.js
- The HealthDashboard — Performance/System-Health/Token-Cost Dashboards record establishes that constraint violation data surfaced by ConstraintSystem is consumed by two architecturally distinct dashboard stacks: a Next.js-based constraint-monitor dashboard and a separate Vite-based system-health-dashboard, both fed by a shared aggregator, health-prompt-hook.js. This means any schema change to violation-history.json or session-violations.jsonl produced by ViolationCaptureService has to stay compatible with both dashboard frontends' consumption logic, not just one, since they are separately built/deployed applications reading the same underlying data contract.
- The Statusline Click-Report Feature record establishes that the tmux statusline's 'constraints' field is wired to open or focus the constraint-monitor dashboard tab on click, creating a direct UX path from live-session enforcement (hook handlers rejecting/flagging tool calls) to the persisted violation data ConstraintSystem writes. This click-through path is a documented product decision to make constraint violations discoverable in real time from within the terminal workflow, rather than requiring users to separately navigate to or already have open the dashboard — meaning any change to the constraint-monitor dashboard's tab/routing structure has a hard dependency from the tmux status line integration and must preserve the addressable tab target.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file; LLMAbstraction: [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copi; DockerizedServices: [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised ; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, me; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generat; ConstraintSystem: [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constra; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [ViolationCaptureService](./ViolationCaptureService.md) -- [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying this service's persisted violation history to a click-driven UX surface
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption record notes a related coverage-metric bug in obs-api counting 'observations' and 'digests' entity types in a ratio denominator that should exclude them, showing this hook's upstream data source has known accuracy gaps
- [KnowledgeInjectionHook](./KnowledgeInjectionHook.md) -- [LLM] None of the supplied code files implement or reference a component named 'KnowledgeInjectionHook'. scripts/health-prompt-hook.js implements a UserPromptSubmit hook that injects *health* status text into Claude's context via the SPEC R8 envelope (`{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`), which is structurally the kind of thing a knowledge-injection hook would also do (inject a context string ahead of a prompt), but it is a distinct, named component (health, not knowledge) with its own test file (tests/integration/health-prompt-hook-stall.test.mjs). The other two files, integrations/system-health-dashboard/src/components/workflow/hooks.ts and integrations/system-health-dashboard/src/hooks/usePolledFetch.ts, are React hooks for dashboard data-fetching (useWorkflowDefinitions, useRecentCalls, usePolledFetch) and have no relationship to knowledge injection at all — they surfaced only because the retrieval matched the generic term 'hooks'.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as last resort — rather than demoting to lower tiers as primary
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised processes/health endpoints must be confirmed live before relying on downstream pipelines like wave-analysis
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, meaning the viewer's History sidebar (which filters strictly to entityType 'Insight') could never surface a Batch badge for that run's conclusions.
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generated diagram artifacts belong in version control versus being build outputs, enforcing consistent authoring and correct rendering across the docs pipeline.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 9 observations*
