# Phase 19: Migration & Cleanup - Research

**Researched:** 2026-03-11
**Domain:** Legacy state management removal, parallel validation, code cleanup
**Confidence:** HIGH

## Summary

Phase 19 is a migration and deletion phase, not a feature-building phase. The new typed state machine (Phases 15-18) is fully operational -- this phase validates it runs equivalently to the old `writeProgressFile` path, then surgically removes all legacy code. The codebase currently has dual state management paths: the old coordinator `writeProgressFile()` (55+ call sites in a 5531-line file) writing untyped JSON, and the new state machine singleton writing typed `WorkflowState`. The dashboard already consumes the new path via SSE/WebSocket but maintains backward-compat sync to legacy Redux fields.

The work is mechanical and well-scoped: wire up parallel output during validation, run 3 scenarios, then delete legacy code in staged commits. The main risk is not technical complexity but thoroughness -- missing a legacy reference that causes a runtime error after deletion.

**Primary recommendation:** Use snapshot file comparison (old writes to `-legacy.json`, new writes to main file), validate with 3 runs, then delete in 4 staged commits following the exact order from CONTEXT.md decisions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Snapshot comparison: old writeProgressFile writes to `workflow-progress-legacy.json`, new state machine subscriber writes to `workflow-progress.json` -- compared post-run
- Dashboard consumes the new path (state machine/SSE events) during parallel operation -- Phase 18 work is exercised immediately
- 3 successful workflow runs with no divergence required before cutover (covering debug mode, production, and cancel scenarios)
- On divergence detected: log to comparison file AND show a warning banner on the dashboard so it's visible immediately (non-blocking)
- Migration window only -- Zod preprocess transforms for old format are active during parallel validation, then removed after cutover
- After cutover, if a stale old-format progress file is found: delete it and start with idle state (no backup, no error)
- Legacy comparison file (`workflow-progress-legacy.json`) kept until manually deleted by user -- no auto-cleanup
- Rollback strategy: git revert to pre-migration commit. No runtime toggle or environment variable -- the 3-run validation window is the safety net
- Staged removal in ordered commits:
  1. Coordinator: remove all ~30 writeProgressFile calls and the method itself
  2. Dashboard: remove 6+ LEGACY-tagged fields in ukbSlice, backward-compat sync in setWorkflowState, all dead selectors/actions/reducers/props
  3. Constants: delete @deprecated hardcoded step/substep fallback mappings (lines 367, 444) -- YAML is sole source, no fallback
  4. Zod schemas: remove old-format preprocess()/transform() migration code
- Delete ALL dead code -- unused selectors, actions, reducers, and component props that only existed for legacy fields
- YAML-only for step/substep definitions -- if YAML isn't loaded, graph doesn't render (no hardcoded fallback)
- Add schemaVersion: 2 field to progress file format after migration complete

### Claude's Discretion
- Exact comparison script implementation for snapshot diffing
- Dashboard warning banner styling and placement
- Order of writeProgressFile call site removal within coordinator
- How to verify each staged removal doesn't break the build

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MIG-01 | Parallel path -- old updateProgress and new state machine run side-by-side | Redirect writeProgressFile output to `-legacy.json`; state machine subscriber continues writing main file. Post-run diff comparison script. |
| MIG-02 | Backward-compatible progress file reader | Already implemented: `WorkflowStateWithMigrationSchema` in `shared/workflow-types/schemas.ts` with `z.preprocess()` that detects old format and transforms. Remove after cutover. |
| MIG-03 | All old inference/fallback code removed after validation | 4-commit staged deletion: coordinator writeProgressFile (~55 call sites), ukbSlice legacy fields/sync (~10 locations), constants deprecated mappings (2 blocks), Zod migration preprocess (1 file). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | strict | Type checking after deletion ensures no dangling references | Compiler catches removed type/field usage |
| Zod | existing | Runtime validation at boundaries | Already used for WorkflowState schemas |
| Node.js test runner | built-in | Existing test infrastructure for state machine | Tests already exist in `workflow-state-machine.test.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| diff (npm) | latest | JSON snapshot comparison | Comparing legacy vs new progress files post-run |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| npm `diff` | Manual JSON comparison | `diff` provides structured output; manual is fine for simple key-value comparison since progress files are flat-ish JSON |

**Note:** No new dependencies are strictly required. The comparison script can use `JSON.parse` + deep equality checking with Node.js built-ins. The `diff` package is optional but provides cleaner divergence reports.

## Architecture Patterns

### Pattern 1: Parallel Output Redirection
**What:** Change `writeProgressFile` to write to a different file path (`workflow-progress-legacy.json`) instead of the main progress file. The state machine subscriber continues writing to the main file unchanged.
**When to use:** During the validation window (3 runs).
**Example:**
```typescript
// In coordinator.ts writeProgressFile method:
// Change:
//   const progressPath = `${this.repositoryPath}/.data/workflow-progress.json`;
// To:
//   const progressPath = `${this.repositoryPath}/.data/workflow-progress-legacy.json`;
```

### Pattern 2: Post-Run Snapshot Comparison
**What:** After each workflow run completes, compare the two progress files and log divergences.
**When to use:** After each of the 3 validation runs.
**Example:**
```typescript
// comparison utility
function compareProgressSnapshots(legacyPath: string, newPath: string): Divergence[] {
  const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  const current = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  // Compare semantically equivalent fields:
  // legacy.status vs current.status
  // legacy.currentStep vs current.progress.currentStepName
  // legacy.stepsCompleted vs current.progress.currentStepIndex
  // etc.
  const divergences: Divergence[] = [];
  // ... field-by-field comparison with format mapping
  return divergences;
}
```

### Pattern 3: Staged Commit Deletion
**What:** Remove legacy code in ordered commits, each compilable and testable independently.
**When to use:** After 3 successful validation runs.
**Why this order matters:**
1. Coordinator first -- removes the source of legacy writes. Dashboard still works because it already consumes new path.
2. Dashboard second -- removes consumers of legacy fields. Components already read from `workflowState`.
3. Constants third -- removes deprecated fallback mappings. YAML is already the primary source.
4. Schemas last -- removes migration preprocess. Only safe after all writers/readers of old format are gone.

### Anti-Patterns to Avoid
- **Big-bang deletion:** Do NOT delete all legacy code in one commit. If something breaks, a single commit deletion makes bisecting impossible.
- **Runtime feature flag:** Do NOT add environment variables to toggle between old and new paths. Git revert is the rollback strategy -- simpler and more reliable.
- **Partial field removal:** Do NOT remove some legacy fields from UKBState while leaving others. Remove all LEGACY-tagged fields in one commit to avoid type inconsistencies.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON comparison | Custom deep-diff library | Simple field mapping + equality checks | Progress files have known structure; a 30-line comparison function is sufficient |
| Format detection | Heuristic-based old format detection | Already exists: `isOldFormat()` in `schemas.ts` | Proven logic, remove after cutover |

## Common Pitfalls

### Pitfall 1: Missing writeProgressFile Call Sites
**What goes wrong:** Removing the method but missing a call site causes a compile error. Or worse, a call site exists in a code path that only triggers under rare conditions (error handling, cancellation).
**Why it happens:** 55+ call sites spread across 5531 lines, many in nested try/catch blocks.
**How to avoid:** Use TypeScript compiler -- delete the method FIRST, then fix all compile errors. The compiler will catch every reference.
**Warning signs:** Any `writeProgressFile` grep hit after deletion.

### Pitfall 2: Legacy Field References in Components
**What goes wrong:** A component still reads `state.execution.status` or `state.singleStepMode` after those fields are removed from the Redux state type.
**Why it happens:** Components may use untyped selectors or `any` casts that bypass TypeScript.
**How to avoid:** After removing fields from `UKBState`, run `tsc --noEmit` on the dashboard. Search for string literals matching removed field names.
**Warning signs:** Runtime `undefined` access that doesn't crash but renders wrong values.

### Pitfall 3: Abort/Cancel Signal Path in writeProgressFile
**What goes wrong:** The old `writeProgressFile` method contains abort signal checking logic (lines 160-176) that reads `.data/workflow-abort.json`. If this is the only place abort signals are checked, removing it breaks cancellation.
**Why it happens:** Abort signal handling was historically tied to progress file writes.
**How to avoid:** Verify that the state machine's cancel transition (Phase 16, BE-04) handles abort signals independently. The 6 cooperative cancel check points were added in Phase 16 -- confirm they don't depend on `writeProgressFile`.
**Warning signs:** Cancel button stops working after coordinator cleanup.

### Pitfall 4: Preserved Debug State in writeProgressFile
**What goes wrong:** The old `writeProgressFile` preserves `singleStepMode`, `mockLLM`, and other debug state from the existing progress file (lines 180-227). If the new state machine subscriber doesn't handle this equivalently, debug/single-step mode breaks.
**Why it happens:** The sticky debug state is a known issue (documented in MEMORY.md).
**How to avoid:** Verify that `RunConfig` in the new state machine properly receives and persists these settings via the `start` transition event, not by reading them from the progress file. Phase 15 decision SM-03 made RunConfig immutable after workflow start -- this is the correct behavior.
**Warning signs:** `singleStepMode` or `mockLLM` not taking effect after migration.

### Pitfall 5: schemaVersion Field Ordering
**What goes wrong:** Adding `schemaVersion: 2` to the progress file format but the Zod schema doesn't include it, causing validation failures.
**Why it happens:** Adding a field to the written output without updating the schema.
**How to avoid:** Add `schemaVersion` to `WorkflowStateSchema` (or as a passthrough field) BEFORE writing it. Use `.passthrough()` on the schema or add the field explicitly.

### Pitfall 6: Docker Rebuild Forgotten
**What goes wrong:** Backend changes to coordinator.ts don't take effect because `npm run build` + Docker rebuild was skipped.
**Why it happens:** Recurring issue documented in CLAUDE.md and MEMORY.md.
**How to avoid:** Every coordinator change requires: `cd integrations/mcp-server-semantic-analysis && npm run build && cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services`.

## Code Examples

### Coordinator writeProgressFile Redirection
```typescript
// coordinator.ts - change the output path for parallel validation
private writeProgressFile(/* ... existing params ... */): void {
  try {
    // PARALLEL VALIDATION: Write to legacy file, not main progress file
    const progressPath = `${this.repositoryPath}/.data/workflow-progress-legacy.json`;
    // ... rest of method unchanged ...
```

### Post-Run Comparison Script
```typescript
// comparison-util.ts (new file, temporary - removed after cutover)
import { readFileSync, existsSync } from 'fs';

interface Divergence {
  field: string;
  legacy: unknown;
  current: unknown;
}

// Field mapping: legacy flat format -> new structured format
const FIELD_MAP: Array<[string, string, (v: unknown) => unknown]> = [
  ['status', 'status', (v) => v === 'starting' ? 'running' : v],
  ['currentStep', 'progress.currentStepName', (v) => v],
  ['workflowName', 'workflowName', (v) => v],
  // ... additional field mappings
];

export function compareSnapshots(legacyPath: string, newPath: string): Divergence[] {
  if (!existsSync(legacyPath) || !existsSync(newPath)) return [];
  const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
  const current = JSON.parse(readFileSync(newPath, 'utf8'));

  const divergences: Divergence[] = [];
  for (const [legacyKey, newKey, transform] of FIELD_MAP) {
    const legacyVal = transform(getNestedValue(legacy, legacyKey));
    const newVal = getNestedValue(current, newKey);
    if (JSON.stringify(legacyVal) !== JSON.stringify(newVal)) {
      divergences.push({ field: legacyKey, legacy: legacyVal, current: newVal });
    }
  }
  return divergences;
}
```

### Dashboard Warning Banner
```typescript
// Simple divergence banner component (temporary)
function DivergenceBanner({ divergences }: { divergences: string[] }) {
  if (divergences.length === 0) return null;
  return (
    <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: '8px 16px' }}>
      <strong>Migration Warning:</strong> {divergences.length} state divergence(s) detected.
      Check .data/comparison-log.json for details.
    </div>
  );
}
```

### Staged Deletion - ukbSlice Legacy Field Removal
```typescript
// BEFORE: UKBState with legacy fields
interface UKBState {
  workflowState: WorkflowState | null;
  lastTransition: string | null;
  execution: WorkflowExecutionState;      // REMOVE
  preferences: WorkflowPreferencesState;   // KEEP (not legacy)
  singleStepMode: boolean;                 // REMOVE
  singleStepModeExplicit: boolean;         // REMOVE
  stepPaused: boolean;                     // REMOVE
  pausedAtStep: string | null;             // REMOVE
  mockLLM: boolean;                        // REMOVE
  mockLLMExplicit: boolean;                // REMOVE
  mockLLMDelay: number;                    // REMOVE
  // ... other fields stay
}

// AFTER: Clean UKBState
interface UKBState {
  workflowState: WorkflowState | null;
  lastTransition: string | null;
  preferences: WorkflowPreferencesState;
  // ... other non-legacy fields
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `writeProgressFile()` ad-hoc JSON | State machine `dispatch()` + subscriber | Phase 16 (v3.0) | Single source of truth for state |
| Polling progress file for dashboard | SSE events over WebSocket | Phase 17 (v3.0) | Real-time, typed updates |
| Inference/fallback in dashboard | Direct consumption of `WorkflowState` | Phase 18 (v3.0) | No guessing, pure consumer |

**Being removed in this phase:**
- `writeProgressFile()` method and all 55+ call sites in coordinator.ts
- `execution`, `singleStepMode`, `mockLLM`, `stepPaused`, `pausedAtStep`, `mockLLMExplicit`, `singleStepModeExplicit`, `mockLLMDelay` fields from ukbSlice
- Backward-compat sync block in `setWorkflowState` action (lines 898-946)
- `STEP_TO_AGENT` hardcoded mapping (constants.ts line 374)
- `STEP_TO_SUBSTEP` hardcoded mapping (constants.ts line 451)
- `WorkflowStateWithMigrationSchema` preprocess in `schemas.ts`
- `isOldFormat()` and `migrateOldFormat()` functions in `schemas.ts`

## Open Questions

1. **Abort signal handling after writeProgressFile removal**
   - What we know: Coordinator checks `.data/workflow-abort.json` inside `writeProgressFile` (lines 160-176). Phase 16 added 6 cooperative cancel check points.
   - What's unclear: Do the cancel check points also read the abort file, or do they rely on the state machine's cancel transition?
   - Recommendation: Verify cancel works in the 3 validation runs (one run must test cancel). If abort file checking is only in writeProgressFile, extract it to a standalone check before deletion.

2. **Which components still read legacy Redux fields?**
   - What we know: Only `ukbSlice.ts` shows up in grep for `execution.status` and `state.singleStepMode`. Phase 18 migrated components to use `workflowState`.
   - What's unclear: Whether any component uses untyped access patterns that grep wouldn't catch.
   - Recommendation: TypeScript compiler will catch typed references. Do a manual search for string literals like `'execution'`, `'singleStepMode'` in component files.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | None (direct execution) |
| Quick run command | `cd integrations/mcp-server-semantic-analysis && npx tsx --test src/workflow-state-machine.test.ts` |
| Full suite command | `cd integrations/mcp-server-semantic-analysis && npx tsx --test src/*.test.ts` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MIG-01 | Legacy and new paths produce equivalent output | integration (manual) | 3 workflow runs with comparison script | N/A - manual validation runs |
| MIG-02 | Progress file reader handles both formats | unit | `npx tsx --test src/workflow-state-machine.test.ts` | Partial (schema tests needed) |
| MIG-03 | Build compiles after each staged deletion | build | `cd integrations/mcp-server-semantic-analysis && npm run build && cd ../system-health-dashboard && npm run build` | N/A - build verification |

### Sampling Rate
- **Per task commit:** `npm run build` in affected submodule (compile check)
- **Per wave merge:** Full build of both backend and dashboard submodules
- **Phase gate:** 3 successful validation runs + clean builds after all deletions

### Wave 0 Gaps
- [ ] Comparison utility script -- covers MIG-01 (post-run divergence detection)
- [ ] Schema migration test -- verify `WorkflowStateWithMigrationSchema` handles old format (covers MIG-02, proves it works before removal)

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `coordinator.ts` (5531 lines, 55+ writeProgressFile calls)
- Direct code inspection of `ukbSlice.ts` (LEGACY-tagged fields at lines 514, 520, 597, 601, 607)
- Direct code inspection of `schemas.ts` (WorkflowStateWithMigrationSchema with preprocess)
- Direct code inspection of `constants.ts` (@deprecated mappings at lines 367, 444)
- Direct code inspection of `workflow-state-machine.ts` (singleton pattern, subscriber model)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions (user-locked choices for migration strategy)
- STATE.md accumulated decisions from Phases 15-18

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries needed, existing infrastructure sufficient
- Architecture: HIGH - migration pattern is well-defined in CONTEXT.md decisions, code locations verified
- Pitfalls: HIGH - all identified through direct code inspection of affected files

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable -- this is internal migration, not dependent on external libraries)
