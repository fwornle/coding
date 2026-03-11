/**
 * Migration-aware schemas and step type definitions.
 *
 * WorkflowStateWithMigrationSchema wraps WorkflowStateSchema with z.preprocess()
 * to handle old format data:
 *   - Old 'starting' status -> 'running' with subStatus 'executing-step'
 *   - Old flat format (singleStepMode/mockLLM as top-level keys) -> structured config/progress
 *   - New format passes through unchanged
 *
 * StepStatus and StepDefinition are migrated from workflow-events.ts into shared types.
 */

import { z } from 'zod';
import { WorkflowStateSchema } from './state';

// ---------------------------------------------------------------------------
// Step types (migrated from workflow-events.ts)
// ---------------------------------------------------------------------------

/** Status of an individual workflow step */
export const StepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

/** Definition of a workflow step with optional wave and substeps */
export const StepDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  wave: z.number().optional(),
  substeps: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
      })
    )
    .optional(),
});
export type StepDefinition = z.infer<typeof StepDefinitionSchema>;

// ---------------------------------------------------------------------------
// Migration preprocess
// ---------------------------------------------------------------------------

/**
 * Detect whether data is in the old flat format.
 *
 * Old format indicators:
 * - status is 'starting' (removed in new schema)
 * - singleStepMode/mockLLM exist as top-level keys (should be nested in config)
 * - No 'config' or 'progress' top-level keys
 */
function isOldFormat(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj['status'] === 'starting' ||
    ('singleStepMode' in obj && !('config' in obj)) ||
    ('mockLLM' in obj && !('config' in obj))
  );
}

/**
 * Transform old flat progress format into the new structured WorkflowState.
 *
 * Old format had config fields (singleStepMode, mockLLM, etc.) mixed with
 * runtime state at the top level. New format separates them into config
 * (immutable) and progress (mutable) sub-objects.
 */
function migrateOldFormat(old: Record<string, unknown>): Record<string, unknown> {
  const status = old['status'] === 'starting' ? 'running' : (old['status'] as string);
  const now = new Date().toISOString();

  // Extract config fields from old top-level keys
  const config = {
    singleStepMode: old['singleStepMode'] ?? false,
    mockLLM: old['mockLLM'] ?? false,
    llmMode: old['llmMode'] ?? 'public',
    stepIntoSubsteps: old['stepIntoSubsteps'] ?? false,
    mockLLMDelay: old['mockLLMDelay'],
  };

  // Extract progress fields
  const progress = {
    currentStepIndex: typeof old['stepsCompleted'] === 'number' ? old['stepsCompleted'] : 0,
    currentStepName: (old['currentStep'] as string) ?? '',
    completedSteps: [],
    currentWave: old['currentWave'] as number | undefined,
    totalWaves: old['totalWaves'] as number | undefined,
    startTime: (old['startTime'] as string) ?? now,
    lastUpdate: (old['lastUpdate'] as string) ?? now,
    elapsedSeconds: typeof old['elapsedSeconds'] === 'number' ? old['elapsedSeconds'] : 0,
  };

  if (status === 'running') {
    return {
      status: 'running',
      subStatus: 'executing-step',
      workflowId: (old['workflowId'] as string) ?? 'migrated',
      workflowName: (old['workflowName'] as string) ?? 'unknown',
      config,
      progress,
    };
  }

  if (status === 'failed') {
    return {
      status: 'failed',
      workflowId: (old['workflowId'] as string) ?? 'migrated',
      workflowName: (old['workflowName'] as string) ?? 'unknown',
      config,
      failedStep: (old['currentStep'] as string) ?? 'unknown',
      error: (old['error'] as string) ?? (old['message'] as string) ?? 'Unknown error',
      progress,
    };
  }

  if (status === 'completed') {
    return {
      status: 'completed',
      workflowId: (old['workflowId'] as string) ?? 'migrated',
      workflowName: (old['workflowName'] as string) ?? 'unknown',
      config,
      completedSteps: typeof old['stepsCompleted'] === 'number' ? old['stepsCompleted'] : 0,
      duration: typeof old['elapsedSeconds'] === 'number' ? old['elapsedSeconds'] : 0,
    };
  }

  // For any other status, pass through with basic structure
  return { ...old, status };
}

/**
 * WorkflowStateWithMigrationSchema: Parses both old and new format data.
 *
 * Use this at system boundaries (reading progress file, receiving SSE events)
 * where data may be in the old flat format. The preprocess step transparently
 * migrates old format to new before Zod validation runs.
 *
 * For internal code that always produces new-format data, use WorkflowStateSchema
 * directly for better performance.
 */
export const WorkflowStateWithMigrationSchema = z.preprocess((val) => {
  if (isOldFormat(val)) {
    return migrateOldFormat(val as Record<string, unknown>);
  }
  return val;
}, WorkflowStateSchema);
