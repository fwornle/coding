/**
 * Tests for workflow state transitions.
 *
 * Verifies all valid transitions produce correct state and
 * all invalid transitions throw InvalidTransitionError.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  transition,
  InvalidTransitionError,
  type WorkflowTransitionEvent,
} from './transitions';
import type { WorkflowState, RunConfig } from './index';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const testConfig: RunConfig = {
  singleStepMode: false,
  mockLLM: false,
  llmMode: 'public',
  stepIntoSubsteps: false,
};

const idleState: WorkflowState = { status: 'idle' };

function makeRunningState(overrides?: Partial<WorkflowState & { status: 'running' }>): WorkflowState {
  return {
    status: 'running',
    subStatus: 'executing-step',
    workflowId: 'test-wf-1',
    workflowName: 'test-workflow',
    config: testConfig,
    progress: {
      currentStepIndex: 1,
      currentStepName: 'step-b',
      completedSteps: ['step-a'],
      startTime: '2026-01-01T00:00:00Z',
      lastUpdate: '2026-01-01T00:01:00Z',
      elapsedSeconds: 60,
    },
    ...overrides,
  } as WorkflowState;
}

function makePausedState(): WorkflowState {
  return {
    status: 'paused',
    workflowId: 'test-wf-1',
    workflowName: 'test-workflow',
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
}

function makeFailedState(): WorkflowState {
  return {
    status: 'failed',
    workflowId: 'test-wf-1',
    workflowName: 'test-workflow',
    config: testConfig,
    failedStep: 'step-b',
    error: 'Something went wrong',
    progress: {
      currentStepIndex: 1,
      currentStepName: 'step-b',
      completedSteps: ['step-a'],
      startTime: '2026-01-01T00:00:00Z',
      lastUpdate: '2026-01-01T00:01:00Z',
      elapsedSeconds: 60,
    },
  };
}

function makeCompletedState(): WorkflowState {
  return {
    status: 'completed',
    workflowId: 'test-wf-1',
    workflowName: 'test-workflow',
    config: testConfig,
    completedSteps: 3,
    duration: 120,
  };
}

function makeCancelledState(): WorkflowState {
  return {
    status: 'cancelled',
    workflowId: 'test-wf-1',
    workflowName: 'test-workflow',
    config: testConfig,
    cancelledAt: '2026-01-01T00:02:00Z',
    lastStep: 'step-b',
  };
}

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

describe('transition() valid transitions', () => {
  it('idle + start -> running with frozen config and initial progress', () => {
    const event: WorkflowTransitionEvent = {
      type: 'start',
      config: { ...testConfig },
      workflowName: 'my-workflow',
      firstStep: 'step-a',
    };
    const result = transition(idleState, event);
    assert.equal(result.status, 'running');
    if (result.status === 'running') {
      assert.equal(result.workflowName, 'my-workflow');
      assert.equal(result.progress.currentStepName, 'step-a');
      assert.equal(result.progress.currentStepIndex, 0);
      assert.deepStrictEqual(result.progress.completedSteps, []);
      // Config should be frozen
      assert.ok(Object.isFrozen(result.config));
    }
  });

  it('running + pause -> paused with pausedAt from progress', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = { type: 'pause', reason: 'user-requested' };
    const result = transition(running, event);
    assert.equal(result.status, 'paused');
    if (result.status === 'paused') {
      assert.equal(result.pausedAt.step, 'step-b');
      assert.equal(result.pauseReason, 'user-requested');
      assert.equal(result.resumable, true);
    }
  });

  it('running + fail -> failed with error details', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = {
      type: 'fail',
      error: 'Boom',
      step: 'step-b',
      stackTrace: 'Error: Boom\n  at ...',
    };
    const result = transition(running, event);
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') {
      assert.equal(result.error, 'Boom');
      assert.equal(result.failedStep, 'step-b');
      assert.equal(result.stackTrace, 'Error: Boom\n  at ...');
    }
  });

  it('running + complete -> completed with duration and step count', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = { type: 'complete', summary: { total: 5 } };
    const result = transition(running, event);
    assert.equal(result.status, 'completed');
    if (result.status === 'completed') {
      assert.equal(result.completedSteps, 1); // step-a in completedSteps
      assert.equal(typeof result.duration, 'number');
      assert.deepStrictEqual(result.summary, { total: 5 });
    }
  });

  it('running + cancel -> cancelled', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = { type: 'cancel', reason: 'User cancelled' };
    const result = transition(running, event);
    assert.equal(result.status, 'cancelled');
    if (result.status === 'cancelled') {
      assert.equal(result.lastStep, 'step-b');
      assert.equal(typeof result.cancelledAt, 'string');
    }
  });

  it('running + step-complete -> running with updated progress', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = {
      type: 'step-complete',
      stepName: 'step-b',
      nextStep: 'step-c',
      duration: 30,
    };
    const result = transition(running, event);
    assert.equal(result.status, 'running');
    if (result.status === 'running') {
      assert.equal(result.progress.currentStepIndex, 2);
      assert.equal(result.progress.currentStepName, 'step-c');
      assert.ok(result.progress.completedSteps.includes('step-b'));
      assert.ok(result.progress.completedSteps.includes('step-a'));
    }
  });

  it('paused + resume -> running preserving config and progress', () => {
    const paused = makePausedState();
    const event: WorkflowTransitionEvent = { type: 'resume' };
    const result = transition(paused, event);
    assert.equal(result.status, 'running');
    if (result.status === 'running') {
      assert.deepStrictEqual(result.config, testConfig);
      assert.equal(result.progress.currentStepName, 'step-b');
    }
  });

  it('paused + cancel -> cancelled', () => {
    const paused = makePausedState();
    const event: WorkflowTransitionEvent = { type: 'cancel' };
    const result = transition(paused, event);
    assert.equal(result.status, 'cancelled');
  });

  it('failed + reset -> idle', () => {
    const failed = makeFailedState();
    const event: WorkflowTransitionEvent = { type: 'reset' };
    const result = transition(failed, event);
    assert.equal(result.status, 'idle');
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions
// ---------------------------------------------------------------------------

describe('transition() invalid transitions', () => {
  it('idle + pause throws InvalidTransitionError', () => {
    assert.throws(
      () => transition(idleState, { type: 'pause', reason: 'user-requested' } as WorkflowTransitionEvent),
      (err: unknown) => {
        assert.ok(err instanceof InvalidTransitionError);
        assert.equal(err.fromStatus, 'idle');
        assert.equal(err.eventType, 'pause');
        return true;
      }
    );
  });

  it('idle + fail throws InvalidTransitionError', () => {
    assert.throws(
      () => transition(idleState, { type: 'fail', error: 'x', step: 'y' } as WorkflowTransitionEvent),
      (err: unknown) => {
        assert.ok(err instanceof InvalidTransitionError);
        return true;
      }
    );
  });

  it('completed + any throws InvalidTransitionError', () => {
    const completed = makeCompletedState();
    assert.throws(
      () => transition(completed, { type: 'start', config: testConfig, workflowName: 'w', firstStep: 's' }),
      (err: unknown) => err instanceof InvalidTransitionError
    );
    assert.throws(
      () => transition(completed, { type: 'reset' } as WorkflowTransitionEvent),
      (err: unknown) => err instanceof InvalidTransitionError
    );
  });

  it('cancelled + any throws InvalidTransitionError', () => {
    const cancelled = makeCancelledState();
    assert.throws(
      () => transition(cancelled, { type: 'start', config: testConfig, workflowName: 'w', firstStep: 's' }),
      (err: unknown) => err instanceof InvalidTransitionError
    );
    assert.throws(
      () => transition(cancelled, { type: 'reset' } as WorkflowTransitionEvent),
      (err: unknown) => err instanceof InvalidTransitionError
    );
  });
});

// ---------------------------------------------------------------------------
// substep-update event tests
// ---------------------------------------------------------------------------

describe('transition() substep-update event', () => {
  it('dispatch substep-update on running state returns state with status === running', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = {
      type: 'substep-update',
      substepId: 'wave1_analyze',
    };
    const result = transition(running, event);
    assert.equal(result.status, 'running');
  });

  it('dispatch substep-update sets progress.currentSubstepId to supplied substepId', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = {
      type: 'substep-update',
      substepId: 'wave2_classify',
    };
    const result = transition(running, event);
    assert.equal(result.status, 'running');
    if (result.status === 'running') {
      assert.equal(result.progress.currentSubstepId, 'wave2_classify');
    }
  });

  it('dispatch substep-update with wave/totalWaves sets progress.currentWave and totalWaves', () => {
    const running = makeRunningState();
    const event: WorkflowTransitionEvent = {
      type: 'substep-update',
      substepId: 'wave2_analyze',
      wave: 2,
      totalWaves: 4,
    };
    const result = transition(running, event);
    assert.equal(result.status, 'running');
    if (result.status === 'running') {
      assert.equal(result.progress.currentWave, 2);
      assert.equal(result.progress.totalWaves, 4);
    }
  });

  it('dispatch substep-update updates progress.lastUpdate timestamp', () => {
    const running = makeRunningState();
    const beforeUpdate = running.status === 'running' ? running.progress.lastUpdate : '';
    const event: WorkflowTransitionEvent = {
      type: 'substep-update',
      substepId: 'wave1_persist',
    };
    const result = transition(running, event);
    assert.equal(result.status, 'running');
    if (result.status === 'running') {
      assert.notEqual(result.progress.lastUpdate, beforeUpdate);
    }
  });

  it('dispatch substep-update on idle state throws InvalidTransitionError', () => {
    assert.throws(
      () => transition(idleState, { type: 'substep-update', substepId: 'x' } as WorkflowTransitionEvent),
      (err: unknown) => {
        assert.ok(err instanceof InvalidTransitionError);
        assert.equal(err.fromStatus, 'idle');
        assert.equal(err.eventType, 'substep-update');
        return true;
      }
    );
  });

  it('dispatch substep-update on completed state throws InvalidTransitionError', () => {
    const completed = makeCompletedState();
    assert.throws(
      () => transition(completed, { type: 'substep-update', substepId: 'x' } as WorkflowTransitionEvent),
      (err: unknown) => {
        assert.ok(err instanceof InvalidTransitionError);
        return true;
      }
    );
  });
});
