# WorkflowDefinitionsMemoization

**Type:** Detail

## What It Is

WorkflowDefinitionsMemoization refers to the `useMemo` block wrapping the return value of `useWorkflowDefinitions`, implemented at `integrations/system-health-dashboard/src/components/workflow/hooks.ts:53-90` (hook defined starting line 23). It is the specific mechanism by which the parent hook `DashboardWorkflowHooks`'s `useWorkflowDefinitions` achieves referentially stable output — a single memoized computation whose dependency array (`[initialized, agents, orchestrator, edges, stepToAgent, stepToSubStep, agentSubSteps, isLoading, error]`) covers all nine Redux-derived inputs feeding the hook.

## Architecture and Design

The core pattern is a memoized selector-merge: nine `useAppSelector` calls (hooks.ts:26-34) pull raw slice state from `workflowConfigSlice`, and the memo combines this with static fallback constants (`WORKFLOW_AGENTS`, `STEP_TO_AGENT`, etc., from `./constants`). Two distinct merge strategies coexist deliberately, not inconsistently: `agents`, `orchestrator`, and `edges` use a ternary "API wins outright" replacement, while `stepToAgent`, `stepToSubStep`, and `agentSubSteps` use constants-first object spreads so partial API payloads can never drop a mapping (hooks.ts:79-81). Without the memo, these three spread-derived fields would produce a new object reference on every render regardless of whether inputs changed.

A second, equally important design decision embedded in the same memo is Rules-of-Hooks compliance: an earlier version returned early for the `!initialized` case before calling `useMemo`, causing a variable hook count across renders. The fix, documented at hooks.ts:47-52, folds the uninitialized-fallback branch inside the memo callback (lines 55-65), making correctness and performance improvements the same restructuring rather than separate fixes.

## Implementation Details

The memoization depends entirely on selector reference stability from `workflowConfigSlice` (`selectAgents`, `selectOrchestrator`, `selectEdges`, `selectStepMappings`, `selectStepToSubStep`, `selectAgentSubSteps`, `selectWorkflowConfigLoading`, `selectWorkflowConfigError`, `selectWorkflowConfigInitialized`). These are plain property accessors, not derived/computed values, so they return stable references when underlying state is unchanged — a precondition the memo silently relies on. If any selector were rewritten to use inline `.filter()`/`.map()`, it would become unstable per call, and the `useMemo` would recompute every render with no visible symptom in `hooks.ts` itself — a coupling risk worth flagging for future selector changes.

## Integration Points

`useWorkflowDefinitions` shares a file with, but is architecturally unrelated to, `useRecentCalls` (the "Phase 52 D-04" module-singleton poller using file-scope mutable state `_recentCalls`/`_subscribers`/`_intervalId`). The two should not be conflated: one is component-scoped `useMemo`, the other is a cross-component subscribe/notify singleton. Within `DashboardWorkflowHooks`, the sibling `WorkflowEdgeDispatchEffect` label most plausibly maps to the inline `useEffect` at hooks.ts:36-40, which dispatches `setWorkflowEdges({ workflowName })` when `workflowName` and `initialized` are set — a separate concern from the memoized return-value computation, feeding the `edges` selector that the memo later consumes.

Compared to `usePolledFetch.ts`, which exposes a caller-controlled `enabled` flag to suspend polling and protect in-flight edits, `useWorkflowDefinitions` has no such opt-out: its recomputation is driven purely by upstream Redux state, consistent with its role as a pure derivation hook rather than a network-polling hook.

## Usage Guidelines

Developers modifying `workflowConfigSlice` selectors must preserve their reference-stability guarantee (plain accessors, no inline derivation) or the memo's performance benefit silently disappears. When touching the uninitialized-fallback logic, keep it inside the `useMemo` callback rather than reintroducing an early return, to avoid a Rules-of-Hooks violation. Maintain the asymmetric merge strategy intentionally: whole-list fields (agents/orchestrator/edges) should replace outright on non-empty API data, while mapping fields (stepToAgent/stepToSubStep/agentSubSteps) must keep constants-first spreads so partial API responses never silently drop a required mapping. Finally, don't assume this hook's memoization technique generalizes to `useRecentCalls` in the same file — they solve different problems with different mechanisms and should be reasoned about independently.


## Hierarchy Context

### Parent
- [DashboardWorkflowHooks](./DashboardWorkflowHooks.md) -- [LLM] useWorkflowDefinitions in integrations/system-health-dashboard/src/components/workflow/hooks.ts is the actual implementation of a 'dashboard workflow hook': it reads nine Redux selectors (selectAgents, selectOrchestrator, selectEdges, selectStepMappings, selectStepToSubStep, selectAgentSubSteps, selectWorkflowConfigLoading, selectWorkflowConfigError, selectWorkflowConfigInitialized) from workflowConfigSlice and merges them with static fallback constants (WORKFLOW_AGENTS, ORCHESTRATOR_NODE, MULTI_AGENT_EDGES, STEP_TO_AGENT, STEP_TO_SUBSTEP, AGENT_SUBSTEPS). The merge order is deliberate: API data takes precedence for agents/orchestrator/edges (`agents?.length > 0 ? agents : WORKFLOW_AGENTS`) but constants are spread FIRST for the three mapping objects (`{ ...STEP_TO_AGENT, ...(stepToAgent || {}) }`), so a partial API response can never leave a step unmapped — the code comment calls out 'operator_* → kg_operators' as the critical mapping constants must never lose.

### Siblings
- [WorkflowEdgeDispatchEffect](./WorkflowEdgeDispatchEffect.md) -- [LLM] No file in the supplied evidence defines, exports, or references a component named `WorkflowEdgeDispatchEffect`. The only candidate that plausibly matches this label is the anonymous `useEffect` inside `useWorkflowDefinitions` in integrations/system-health-dashboard/src/components/workflow/hooks.ts:36-40 — `useEffect(() => { if (workflowName && initialized) { dispatch(setWorkflowEdges({ workflowName })) } }, [workflowName, initialized, dispatch])` — which is structurally an 'edge dispatch effect' (it dispatches a Redux action that sets workflow edges), but it is an unnamed inline effect inside a larger hook, not a standalone entity with this name. Nothing in the code establishes that identifier as a real symbol.


---

*Generated from 9 observations*
