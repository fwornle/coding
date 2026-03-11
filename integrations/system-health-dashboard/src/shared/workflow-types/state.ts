/**
 * WorkflowState discriminated union -- the core state machine type.
 *
 * 6 top-level states discriminated on 'status':
 *   idle, running, paused, completed, failed, cancelled
 *
 * The 'running' state has a subStatus discriminator for finer granularity:
 *   'executing-step' (actively running a step) vs 'between-steps' (awaiting next).
 *
 * All types derived via z.infer<> from Zod schemas.
 */

import { z } from 'zod';
import { RunConfigSchema, RunProgressSchema } from './config';

/** Why the workflow was paused */
export const PauseReasonSchema = z.enum(['user-requested', 'single-step-boundary']);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

// ---------------------------------------------------------------------------
// Individual state variant schemas
// ---------------------------------------------------------------------------

/** Idle: no workflow running, no data to carry */
export const IdleStateSchema = z.object({
  status: z.literal('idle'),
});
export type IdleState = z.infer<typeof IdleStateSchema>;

/**
 * Running: workflow is actively executing.
 * subStatus distinguishes whether we are mid-step or between steps.
 */
export const RunningStateSchema = z.object({
  status: z.literal('running'),
  /** Whether currently inside a step or between steps */
  subStatus: z.enum(['executing-step', 'between-steps']),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  progress: RunProgressSchema,
});
export type RunningState = z.infer<typeof RunningStateSchema>;

/**
 * Paused: workflow execution suspended, can be resumed.
 * Carries full position information for resumption.
 */
export const PausedStateSchema = z.object({
  status: z.literal('paused'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  progress: RunProgressSchema,
  /** Exact position where execution was paused */
  pausedAt: z.object({
    step: z.string(),
    substep: z.string().optional(),
  }),
  /** Why the workflow was paused */
  pauseReason: PauseReasonSchema,
  /** Whether the workflow can be resumed from this state */
  resumable: z.boolean(),
});
export type PausedState = z.infer<typeof PausedStateSchema>;

/**
 * Completed: workflow finished successfully.
 * Carries summary statistics but no mutable progress.
 */
export const CompletedStateSchema = z.object({
  status: z.literal('completed'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  /** Number of steps that completed successfully */
  completedSteps: z.number(),
  /** Total workflow duration in seconds */
  duration: z.number(),
  /** Optional summary data from the workflow run */
  summary: z.record(z.string(), z.unknown()).optional(),
});
export type CompletedState = z.infer<typeof CompletedStateSchema>;

/**
 * Failed: workflow stopped due to an error.
 * Carries error details and the progress state at time of failure.
 */
export const FailedStateSchema = z.object({
  status: z.literal('failed'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  /** Name of the step that failed */
  failedStep: z.string(),
  /** Error message */
  error: z.string(),
  /** Optional stack trace for debugging */
  stackTrace: z.string().optional(),
  /** Progress state at time of failure */
  progress: RunProgressSchema,
});
export type FailedState = z.infer<typeof FailedStateSchema>;

/**
 * Cancelled: workflow was explicitly cancelled by user or system.
 * Terminal state -- no outbound transitions.
 */
export const CancelledStateSchema = z.object({
  status: z.literal('cancelled'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  /** ISO 8601 timestamp of when cancellation occurred */
  cancelledAt: z.string(),
  /** Name of the last step that was running or completed */
  lastStep: z.string(),
});
export type CancelledState = z.infer<typeof CancelledStateSchema>;

// ---------------------------------------------------------------------------
// Discriminated union of all states
// ---------------------------------------------------------------------------

/**
 * WorkflowState: The complete state machine type.
 *
 * Discriminated on 'status' -- use state.status to narrow:
 *   if (state.status === 'running') { state.progress.currentStepName }
 *   if (state.status === 'failed') { state.error }
 */
export const WorkflowStateSchema = z.discriminatedUnion('status', [
  IdleStateSchema,
  RunningStateSchema,
  PausedStateSchema,
  CompletedStateSchema,
  FailedStateSchema,
  CancelledStateSchema,
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
