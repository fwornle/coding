/**
 * Pure functions to derive step and substep statuses from state machine position.
 *
 * Instead of storing mutable status fields on each step, these functions
 * compute the status on demand from the current WorkflowState. This ensures
 * step statuses are always consistent with the state machine position.
 */

import type { WorkflowState } from './state';
import type { StepDefinition, StepStatus } from './schemas';

/**
 * Derive the status of each step from the current workflow state.
 *
 * Pure function -- no side effects, no mutation of inputs.
 *
 * @param state            Current workflow state
 * @param stepDefinitions  Ordered list of step definitions
 * @returns                Map from step name to derived StepStatus
 */
export function deriveStepStatuses(
  state: WorkflowState,
  stepDefinitions: readonly StepDefinition[]
): Map<string, StepStatus> {
  const result = new Map<string, StepStatus>();

  switch (state.status) {
    case 'idle': {
      for (const step of stepDefinitions) {
        result.set(step.name, 'pending');
      }
      break;
    }

    case 'running': {
      const completed = new Set(state.progress.completedSteps);
      for (const step of stepDefinitions) {
        if (completed.has(step.name)) {
          result.set(step.name, 'completed');
        } else if (step.name === state.progress.currentStepName) {
          result.set(step.name, 'running');
        } else {
          result.set(step.name, 'pending');
        }
      }
      break;
    }

    case 'paused': {
      // StepStatus enum has no 'paused' -- the parent state carries pause semantics.
      // The paused step shows as 'running' in step-level status.
      const completed = new Set(state.progress.completedSteps);
      for (const step of stepDefinitions) {
        if (completed.has(step.name)) {
          result.set(step.name, 'completed');
        } else if (step.name === state.pausedAt.step) {
          result.set(step.name, 'running');
        } else {
          result.set(step.name, 'pending');
        }
      }
      break;
    }

    case 'completed': {
      for (const step of stepDefinitions) {
        result.set(step.name, 'completed');
      }
      break;
    }

    case 'failed': {
      const completed = new Set(state.progress.completedSteps);
      for (const step of stepDefinitions) {
        if (completed.has(step.name)) {
          result.set(step.name, 'completed');
        } else if (step.name === state.failedStep) {
          result.set(step.name, 'failed');
        } else {
          result.set(step.name, 'pending');
        }
      }
      break;
    }

    case 'cancelled': {
      // CancelledState doesn't carry progress -- mark steps up to lastStep as completed,
      // rest as pending. This is a best-effort derivation since cancelled state loses
      // the full completed steps list.
      let reachedLast = false;
      for (const step of stepDefinitions) {
        if (reachedLast) {
          result.set(step.name, 'pending');
        } else {
          result.set(step.name, 'completed');
          if (step.name === state.lastStep) {
            reachedLast = true;
          }
        }
      }
      break;
    }
  }

  return result;
}

/**
 * Derive substep statuses for a specific step from the current workflow state.
 *
 * If the step is not the current step, all substeps inherit the step's status.
 * If the step is current and the state tracks substep position, substeps are
 * split into completed/running/pending based on the substep index.
 *
 * @param state     Current workflow state
 * @param stepName  Name of the step whose substeps to derive
 * @param substeps  Ordered list of substep definitions
 * @returns         Map from substep id to derived StepStatus
 */
export function deriveSubstepStatuses(
  state: WorkflowState,
  stepName: string,
  substeps: readonly { id: string; label: string }[],
  /** Optional mapping from backend substep IDs (e.g. 'sem_llm_analysis') to UI substep IDs (e.g. 'extract') */
  backendToUiSubstepMap?: Record<string, string>
): Map<string, StepStatus> {
  const result = new Map<string, StepStatus>();

  // First determine the parent step's status
  const isCurrentStep =
    (state.status === 'running' && state.progress.currentStepName === stepName) ||
    (state.status === 'paused' && state.pausedAt.step === stepName);

  if (!isCurrentStep) {
    // Step is not active -- all substeps inherit a uniform status
    let inheritedStatus: StepStatus = 'pending';

    if (state.status === 'completed') {
      inheritedStatus = 'completed';
    } else if (state.status === 'failed' && state.failedStep === stepName) {
      inheritedStatus = 'failed';
    } else if (
      (state.status === 'running' || state.status === 'paused' || state.status === 'failed' || state.status === 'cancelled') &&
      'progress' in state
    ) {
      const completed = new Set(state.progress.completedSteps);
      if (completed.has(stepName)) {
        inheritedStatus = 'completed';
      }
    }

    for (const sub of substeps) {
      result.set(sub.id, inheritedStatus);
    }
    return result;
  }

  // Step is current -- check for substep-level tracking
  // Resolve currentSubstepIndex: prefer explicit index, fall back to deriving from currentSubstepId
  let resolvedIdx: number | undefined;
  if (state.status === 'running' || state.status === 'paused') {
    const progress = state.progress;
    if (progress.currentSubstepIndex !== undefined && progress.currentSubstepIndex !== null) {
      resolvedIdx = progress.currentSubstepIndex;
    } else if (progress.currentSubstepId) {
      // Map backend substep ID to UI substep ID, then find its index
      const backendId = progress.currentSubstepId;
      const uiSubstepId = backendToUiSubstepMap?.[backendId] ?? backendId;
      const idx = substeps.findIndex(s => s.id === uiSubstepId);
      if (idx >= 0) {
        resolvedIdx = idx;
      }
    }
  }

  if (resolvedIdx !== undefined) {
    for (let i = 0; i < substeps.length; i++) {
      if (i < resolvedIdx) {
        result.set(substeps[i].id, 'completed');
      } else if (i === resolvedIdx) {
        result.set(substeps[i].id, 'running');
      } else {
        result.set(substeps[i].id, 'pending');
      }
    }
  } else {
    // No substep tracking -- all substeps follow parent step status
    const parentStatus: StepStatus = state.status === 'running' ? 'running' : 'running'; // paused shows as running
    for (const sub of substeps) {
      result.set(sub.id, parentStatus);
    }
  }

  return result;
}
