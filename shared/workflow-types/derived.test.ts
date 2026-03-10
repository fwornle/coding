/**
 * Tests for step status derivation functions.
 *
 * Verifies that step and substep statuses are derived purely from
 * state machine position -- no mutable status fields needed.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { deriveStepStatuses, deriveSubstepStatuses } from './derived';
import type { WorkflowState, StepDefinition } from './index';
import type { RunConfig } from './config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testConfig: RunConfig = {
  singleStepMode: false,
  mockLLM: false,
  llmMode: 'public',
  stepIntoSubsteps: false,
};

const threeSteps: StepDefinition[] = [
  { name: 'step-a', description: 'First step' },
  { name: 'step-b', description: 'Second step' },
  { name: 'step-c', description: 'Third step' },
];

const stepsWithSubsteps: StepDefinition[] = [
  { name: 'step-a', description: 'First step' },
  {
    name: 'step-b',
    description: 'Second step',
    substeps: [
      { id: 'sub-1', label: 'Substep 1' },
      { id: 'sub-2', label: 'Substep 2' },
      { id: 'sub-3', label: 'Substep 3' },
    ],
  },
  { name: 'step-c', description: 'Third step' },
];

const idleState: WorkflowState = { status: 'idle' };

const runningAtStep1: WorkflowState = {
  status: 'running',
  subStatus: 'executing-step',
  workflowId: 'wf-1',
  workflowName: 'test',
  config: testConfig,
  progress: {
    currentStepIndex: 1,
    currentStepName: 'step-b',
    completedSteps: ['step-a'],
    startTime: '2026-01-01T00:00:00Z',
    lastUpdate: '2026-01-01T00:01:00Z',
    elapsedSeconds: 60,
  },
};

const pausedAtStep1: WorkflowState = {
  status: 'paused',
  workflowId: 'wf-1',
  workflowName: 'test',
  config: testConfig,
  progress: {
    currentStepIndex: 1,
    currentStepName: 'step-b',
    completedSteps: ['step-a'],
    startTime: '2026-01-01T00:00:00Z',
    lastUpdate: '2026-01-01T00:01:00Z',
    elapsedSeconds: 60,
  },
  pausedAt: { step: 'step-b' },
  pauseReason: 'user-requested',
  resumable: true,
};

const completedState: WorkflowState = {
  status: 'completed',
  workflowId: 'wf-1',
  workflowName: 'test',
  config: testConfig,
  completedSteps: 3,
  duration: 180,
};

const failedAtStep1: WorkflowState = {
  status: 'failed',
  workflowId: 'wf-1',
  workflowName: 'test',
  config: testConfig,
  failedStep: 'step-b',
  error: 'Something broke',
  progress: {
    currentStepIndex: 1,
    currentStepName: 'step-b',
    completedSteps: ['step-a'],
    startTime: '2026-01-01T00:00:00Z',
    lastUpdate: '2026-01-01T00:01:00Z',
    elapsedSeconds: 60,
  },
};

// ---------------------------------------------------------------------------
// deriveStepStatuses
// ---------------------------------------------------------------------------

describe('deriveStepStatuses', () => {
  it('idle state returns all pending', () => {
    const result = deriveStepStatuses(idleState, threeSteps);
    assert.equal(result.get('step-a'), 'pending');
    assert.equal(result.get('step-b'), 'pending');
    assert.equal(result.get('step-c'), 'pending');
  });

  it('running at step 1 returns [completed, running, pending]', () => {
    const result = deriveStepStatuses(runningAtStep1, threeSteps);
    assert.equal(result.get('step-a'), 'completed');
    assert.equal(result.get('step-b'), 'running');
    assert.equal(result.get('step-c'), 'pending');
  });

  it('paused at step 1 returns [completed, running, pending]', () => {
    // Paused step uses 'running' status since StepStatus has no 'paused'
    const result = deriveStepStatuses(pausedAtStep1, threeSteps);
    assert.equal(result.get('step-a'), 'completed');
    assert.equal(result.get('step-b'), 'running');
    assert.equal(result.get('step-c'), 'pending');
  });

  it('completed state returns all completed', () => {
    const result = deriveStepStatuses(completedState, threeSteps);
    assert.equal(result.get('step-a'), 'completed');
    assert.equal(result.get('step-b'), 'completed');
    assert.equal(result.get('step-c'), 'completed');
  });

  it('failed at step 1 returns [completed, failed, pending]', () => {
    const result = deriveStepStatuses(failedAtStep1, threeSteps);
    assert.equal(result.get('step-a'), 'completed');
    assert.equal(result.get('step-b'), 'failed');
    assert.equal(result.get('step-c'), 'pending');
  });
});

// ---------------------------------------------------------------------------
// deriveSubstepStatuses
// ---------------------------------------------------------------------------

describe('deriveSubstepStatuses', () => {
  it('running at substep 1 of 3 returns [completed, running, pending]', () => {
    const runningWithSubstep: WorkflowState = {
      status: 'running',
      subStatus: 'executing-step',
      workflowId: 'wf-1',
      workflowName: 'test',
      config: testConfig,
      progress: {
        currentStepIndex: 1,
        currentStepName: 'step-b',
        currentSubstepIndex: 1,
        currentSubstepId: 'sub-2',
        completedSteps: ['step-a'],
        startTime: '2026-01-01T00:00:00Z',
        lastUpdate: '2026-01-01T00:01:00Z',
        elapsedSeconds: 60,
      },
    };

    const substeps = stepsWithSubsteps[1].substeps!;
    const result = deriveSubstepStatuses(runningWithSubstep, 'step-b', substeps);
    assert.equal(result.get('sub-1'), 'completed');
    assert.equal(result.get('sub-2'), 'running');
    assert.equal(result.get('sub-3'), 'pending');
  });

  it('pending step returns all substeps pending', () => {
    // step-c is pending in runningAtStep1
    const substeps = [
      { id: 'sub-x', label: 'X' },
      { id: 'sub-y', label: 'Y' },
    ];
    const result = deriveSubstepStatuses(runningAtStep1, 'step-c', substeps);
    assert.equal(result.get('sub-x'), 'pending');
    assert.equal(result.get('sub-y'), 'pending');
  });
});
