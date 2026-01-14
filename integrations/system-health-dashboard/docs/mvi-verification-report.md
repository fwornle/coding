# MVI Architecture Verification Report

## Overview

This report documents the refactored state management architecture for the UKB Workflow Modal following MVI (Model-View-Intent) principles with Redux as the single source of truth.

## State Flow Architecture

### 1. Redux Store (Single Source of Truth)

**File:** `src/store/slices/ukbSlice.ts`

| State Field | Purpose | Updated By |
|-------------|---------|------------|
| `singleStepMode` | User's preference for single-step debugging | `setSingleStepMode` action (explicit user toggle) |
| `singleStepModeExplicit` | Tracks if user explicitly set the mode | `setSingleStepMode` action |
| `stepPaused` | Server-reported pause state | `syncStepPauseFromServer` action |
| `pausedAtStep` | Step name where workflow is paused | `syncStepPauseFromServer` action |
| `selectedSubStep` | Currently selected sub-step for sidebar | `setSelectedSubStep` action |

### 2. State Update Flow

**User Action Flow:**
1. User toggles checkbox or clicks button
2. Redux action dispatched (`setSingleStepMode`)
3. Redux reducer updates store
4. Components re-render via selectors
5. API call to server (`/api/ukb/single-step-mode`)
6. Server updates progress file
7. Coordinator reads on next step
8. Coordinator pauses or continues

### 3. Server Polling Flow (Does NOT override user choice)

**Poll cycle (every 2s):**
1. Server poll returns process data with `singleStepMode` and `stepPaused`
2. useEffect in `ukb-workflow-modal.tsx` runs
3. IF `singleStepModeExplicit` is false: dispatch `syncSingleStepFromServer`
4. ALWAYS sync `stepPaused` and `pausedAtStep` via `syncStepPauseFromServer`

**CRITICAL:** The `singleStepModeExplicit` flag prevents server polling from overwriting user's explicit choice.

## Step Sequence Verification

### YAML Configuration (complete-analysis.yaml)

The workflow defines steps with dependencies forming a DAG:

| Phase | Steps | Dependencies |
|-------|-------|--------------|
| 1 (Parallel) | `analyze_git_history`, `analyze_vibe_history`, `index_codebase`, `link_documentation` | None (parallel entry) |
| 1.5 | `synthesize_code_insights` | `index_codebase` |
| 2 | `semantic_analysis` | Phase 1 steps |
| 2.5 | `web_search` | `semantic_analysis` |
| 3 | `generate_insights` | `semantic_analysis`, `web_search`, `synthesize_code_insights` |
| 3.5 | `generate_observations` | `generate_insights` |
| 4 (Parallel) | `classify_with_ontology`, `transform_code_entities` | `generate_observations`, `synthesize_code_insights` |
| 5 | `quality_assurance` | Phase 4 steps |
| 6a | `persist_results` | `quality_assurance` |
| 6b | `deduplicate_insights` | `persist_results` |
| 6c | `validate_content` | `deduplicate_insights` |

### Coordinator Execution (coordinator.ts)

The `executeWorkflow` method implements DAG-based parallel execution:

- Main loop runs while completed + skipped < total steps
- `getReadySteps()` finds steps with satisfied dependencies
- Steps started up to `maxConcurrent` limit (default: 3)
- `Promise.race()` waits for any step to complete
- Progress file updated after each step completion
- Memory cleanup removes unneeded step results

### Progress File Updates

The `writeProgressFile` method:
1. Preserves single-step state from existing file
2. Builds detailed step info (status, outputs, timing, LLM metrics)
3. Re-reads file right before writing to minimize race conditions
4. Writes updated progress

## Visualization State Mapping

### Graph Node States

| Status | Visual Style | Condition |
|--------|-------------|-----------|
| `pending` | Gray background, gray border | Step not yet started |
| `running` | Blue background, blue border, pulsing | Step currently executing |
| `completed` | Green background, green border | Step finished successfully |
| `failed` | Red background, red border | Step failed with error |
| `skipped` | Light gray, dashed border | Step skipped (condition false) |

### State Source Hierarchy

1. **Primary:** Step info from `process.steps[]` (includes status from coordinator)
2. **Fallback:** Inferred from `completedSteps` count (for backward compatibility)
3. **Current Step:** Determined by `process.currentStep` field

### Sub-Step Visualization

| Component | State Source |
|-----------|-------------|
| Sub-step arc expansion | Local state in graph (auto-expand on running) |
| Selected sub-step | Redux `selectedSubStep` via props |
| Sidebar display | Redux `selectedSubStep` mapped to SubStep object |

## Single-Step Mode Behavior

### Enabling Single-Step Mode

1. User checks the "Single-step mode" checkbox
2. `handleToggleSingleStepMode(true)` dispatches `setSingleStepMode({ enabled: true, explicit: true })`
3. API POST to `/api/ukb/single-step-mode` with `{ enabled: true }`
4. Server writes `singleStepMode: true` to progress file
5. Coordinator reads this on next step completion and pauses

### Advancing to Next Step

1. User clicks "Next Step" button
2. `handleStepAdvance()` dispatches `syncStepPauseFromServer({ paused: false, pausedAt: null })`
3. API POST to `/api/ukb/step-advance`
4. Server clears `stepPaused` in progress file
5. Coordinator's poll loop sees `stepPaused: false` and continues

### Disabling Single-Step Mode

1. User unchecks the checkbox
2. `handleToggleSingleStepMode(false)` dispatches `setSingleStepMode({ enabled: false, explicit: true })`
3. Also dispatches `syncStepPauseFromServer({ paused: false, pausedAt: null })`
4. API POST to `/api/ukb/single-step-mode` with `{ enabled: false }`
5. Coordinator sees `singleStepMode: false` and resumes normal execution

## Verification Checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Single source of truth for single-step mode | PASS | Redux store with `singleStepMode`, `singleStepModeExplicit` |
| Only checkbox/button can change single-step state | PASS | `setSingleStepMode` dispatched only from handlers |
| Server polling doesn't override user choice | PASS | `singleStepModeExplicit` flag prevents override |
| Step sequence follows YAML dependencies | PASS | Coordinator's DAG execution respects `dependencies` array |
| Graph visualization syncs with coordinator state | PASS | `process.steps[]` from progress file drives node status |
| Sub-step selection uses Redux | PASS | `selectSelectedSubStep` selector, `setSelectedSubStep` action |
| Build succeeds with no TypeScript errors | PASS | `npm run build` completed successfully |

## Files Modified

| File | Changes |
|------|---------|
| `src/store/slices/ukbSlice.ts` | Added single-step mode state, reducers, and selectors |
| `src/components/ukb-workflow-modal.tsx` | Replaced local state with Redux selectors and dispatch |
| `src/components/workflow/multi-agent-graph.tsx` | Typo fix (`observation_generator` to `observation_generation`) |

## Conclusion

The state management has been successfully refactored to follow MVI architecture with Redux as the single source of truth. The single-step mode now:

1. Can only be changed by explicit user action (checkbox toggle or step button)
2. Is protected from server polling overwrite via `singleStepModeExplicit` flag
3. Properly syncs with the coordinator via the progress file
4. Displays correctly in the visualization graph

---
*Report generated: 2026-01-14*
