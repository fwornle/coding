/**
 * Workflow state machine transitions.
 *
 * Defines typed transition events and a transition() function that enforces
 * the valid state transition graph at both compile-time (TransitionMap) and
 * runtime (exhaustive switch + InvalidTransitionError).
 *
 * Transition graph:
 *   idle ──start──> running
 *   running ──pause──> paused
 *   running ──fail──> failed
 *   running ──complete──> completed
 *   running ──cancel──> cancelled
 *   running ──step-complete──> running (self-loop)
 *   running ──substep-update──> running (self-loop, progress update)
 *   paused ──resume──> running
 *   paused ──cancel──> cancelled
 *   failed ──reset──> idle
 *   completed ──(none)──> terminal
 *   cancelled ──(none)──> terminal
 */

import { z } from 'zod';
import { RunConfigSchema } from './config';
import { PauseReasonSchema } from './state';
import type {
  WorkflowState,
  RunningState,
  PausedState,
  CompletedState,
  FailedState,
  CancelledState,
  IdleState,
} from './state';

// ---------------------------------------------------------------------------
// InvalidTransitionError
// ---------------------------------------------------------------------------

/**
 * Thrown when an invalid state transition is attempted.
 *
 * Carries the source state and event type for diagnostic messages.
 */
export class InvalidTransitionError extends Error {
  public readonly fromStatus: string;
  public readonly eventType: string;

  constructor(fromStatus: string, eventType: string) {
    super(`Invalid transition: cannot apply '${eventType}' in '${fromStatus}' state`);
    this.name = 'InvalidTransitionError';
    this.fromStatus = fromStatus;
    this.eventType = eventType;
  }
}

// ---------------------------------------------------------------------------
// Transition event schemas
// ---------------------------------------------------------------------------

const StartEventSchema = z.object({
  type: z.literal('start'),
  config: RunConfigSchema,
  workflowName: z.string(),
  firstStep: z.string(),
});

const StepCompleteEventSchema = z.object({
  type: z.literal('step-complete'),
  stepName: z.string(),
  nextStep: z.string(),
  duration: z.number(),
});

const PauseEventSchema = z.object({
  type: z.literal('pause'),
  reason: PauseReasonSchema,
});

const ResumeEventSchema = z.object({
  type: z.literal('resume'),
});

const FailEventSchema = z.object({
  type: z.literal('fail'),
  error: z.string(),
  step: z.string(),
  stackTrace: z.string().optional(),
});

const CancelEventSchema = z.object({
  type: z.literal('cancel'),
  reason: z.string().optional(),
});

const CompleteEventSchema = z.object({
  type: z.literal('complete'),
  summary: z.record(z.string(), z.unknown()).optional(),
});

const ResetEventSchema = z.object({
  type: z.literal('reset'),
});

const SubstepUpdateEventSchema = z.object({
  type: z.literal('substep-update'),
  substepId: z.string(),
  wave: z.number().optional(),
  totalWaves: z.number().optional(),
});

/** All possible workflow transition events as a discriminated union on 'type' */
export const WorkflowTransitionEventSchema = z.discriminatedUnion('type', [
  StartEventSchema,
  StepCompleteEventSchema,
  PauseEventSchema,
  ResumeEventSchema,
  FailEventSchema,
  CancelEventSchema,
  CompleteEventSchema,
  ResetEventSchema,
  SubstepUpdateEventSchema,
]);

export type WorkflowTransitionEvent = z.infer<typeof WorkflowTransitionEventSchema>;

// ---------------------------------------------------------------------------
// Compile-time transition map
// ---------------------------------------------------------------------------

/**
 * Maps each state status to its valid event types.
 * Terminal states (completed, cancelled) map to never -- no outbound transitions.
 */
export type TransitionMap = {
  idle: Extract<WorkflowTransitionEvent, { type: 'start' }>;
  running: Extract<WorkflowTransitionEvent, { type: 'pause' | 'fail' | 'cancel' | 'complete' | 'step-complete' | 'substep-update' }>;
  paused: Extract<WorkflowTransitionEvent, { type: 'resume' | 'cancel' }>;
  failed: Extract<WorkflowTransitionEvent, { type: 'reset' }>;
  completed: never;
  cancelled: never;
};

// ---------------------------------------------------------------------------
// transition() function
// ---------------------------------------------------------------------------

/**
 * Apply a transition event to the current workflow state.
 *
 * Uses exhaustive switch on state.status for compile-time coverage.
 * Throws InvalidTransitionError for events not valid in the current state.
 *
 * @param state  Current workflow state
 * @param event  Transition event to apply
 * @returns      New workflow state (never mutates the input)
 */
export function transition(state: WorkflowState, event: WorkflowTransitionEvent): WorkflowState {
  switch (state.status) {
    case 'idle':
      return handleIdle(state, event);
    case 'running':
      return handleRunning(state, event);
    case 'paused':
      return handlePaused(state, event);
    case 'failed':
      return handleFailed(state, event);
    case 'completed':
      throw new InvalidTransitionError('completed', event.type);
    case 'cancelled':
      throw new InvalidTransitionError('cancelled', event.type);
    default: {
      // Exhaustiveness check
      const _exhaustive: never = state;
      throw new InvalidTransitionError((_exhaustive as WorkflowState).status, event.type);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-state handlers
// ---------------------------------------------------------------------------

function handleIdle(_state: IdleState, event: WorkflowTransitionEvent): WorkflowState {
  if (event.type !== 'start') {
    throw new InvalidTransitionError('idle', event.type);
  }

  const now = new Date().toISOString();
  const frozenConfig = Object.freeze({ ...event.config });

  const result: RunningState = {
    status: 'running',
    subStatus: 'executing-step',
    workflowId: `wf-${Date.now()}`,
    workflowName: event.workflowName,
    config: frozenConfig,
    progress: {
      currentStepIndex: 0,
      currentStepName: event.firstStep,
      completedSteps: [],
      startTime: now,
      lastUpdate: now,
      elapsedSeconds: 0,
    },
  };
  return result;
}

function handleRunning(state: RunningState, event: WorkflowTransitionEvent): WorkflowState {
  const now = new Date().toISOString();

  switch (event.type) {
    case 'step-complete': {
      const newCompleted = [...state.progress.completedSteps, event.stepName];
      const result: RunningState = {
        ...state,
        subStatus: 'executing-step',
        progress: {
          ...state.progress,
          currentStepIndex: state.progress.currentStepIndex + 1,
          currentStepName: event.nextStep,
          completedSteps: newCompleted,
          lastUpdate: now,
          elapsedSeconds: state.progress.elapsedSeconds + event.duration,
        },
      };
      return result;
    }

    case 'pause': {
      const result: PausedState = {
        status: 'paused',
        workflowId: state.workflowId,
        workflowName: state.workflowName,
        config: state.config,
        progress: { ...state.progress, lastUpdate: now },
        pausedAt: {
          step: state.progress.currentStepName,
          substep: state.progress.currentSubstepId,
        },
        pauseReason: event.reason,
        resumable: true,
      };
      return result;
    }

    case 'fail': {
      const result: FailedState = {
        status: 'failed',
        workflowId: state.workflowId,
        workflowName: state.workflowName,
        config: state.config,
        failedStep: event.step,
        error: event.error,
        stackTrace: event.stackTrace,
        progress: { ...state.progress, lastUpdate: now },
      };
      return result;
    }

    case 'cancel': {
      const result: CancelledState = {
        status: 'cancelled',
        workflowId: state.workflowId,
        workflowName: state.workflowName,
        config: state.config,
        cancelledAt: now,
        lastStep: state.progress.currentStepName,
      };
      return result;
    }

    case 'complete': {
      const elapsed = Math.round(
        (new Date(now).getTime() - new Date(state.progress.startTime).getTime()) / 1000
      );
      const result: CompletedState = {
        status: 'completed',
        workflowId: state.workflowId,
        workflowName: state.workflowName,
        config: state.config,
        completedSteps: state.progress.completedSteps.length,
        duration: elapsed,
        summary: event.summary,
      };
      return result;
    }

    case 'substep-update': {
      const result: RunningState = {
        ...state,
        progress: {
          ...state.progress,
          currentSubstepId: event.substepId,
          ...(event.wave !== undefined && { currentWave: event.wave }),
          ...(event.totalWaves !== undefined && { totalWaves: event.totalWaves }),
          lastUpdate: now,
        },
      };
      return result;
    }

    default:
      throw new InvalidTransitionError('running', event.type);
  }
}

function handlePaused(state: PausedState, event: WorkflowTransitionEvent): WorkflowState {
  const now = new Date().toISOString();

  switch (event.type) {
    case 'resume': {
      const result: RunningState = {
        status: 'running',
        subStatus: 'executing-step',
        workflowId: state.workflowId,
        workflowName: state.workflowName,
        config: state.config,
        progress: { ...state.progress, lastUpdate: now },
      };
      return result;
    }

    case 'cancel': {
      const result: CancelledState = {
        status: 'cancelled',
        workflowId: state.workflowId,
        workflowName: state.workflowName,
        config: state.config,
        cancelledAt: now,
        lastStep: state.pausedAt.step,
      };
      return result;
    }

    default:
      throw new InvalidTransitionError('paused', event.type);
  }
}

function handleFailed(state: FailedState, event: WorkflowTransitionEvent): WorkflowState {
  if (event.type !== 'reset') {
    throw new InvalidTransitionError('failed', event.type);
  }

  const result: IdleState = { status: 'idle' };
  return result;
}
