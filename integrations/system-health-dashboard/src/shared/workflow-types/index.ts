/**
 * Shared workflow type definitions.
 *
 * Single import point for all workflow state machine types and schemas.
 * Import from this module in both backend and dashboard consumers.
 */

// Config and progress schemas (immutable config vs mutable progress)
export {
  RunConfigSchema,
  RunProgressSchema,
  type RunConfig,
  type RunProgress,
} from './config';

// State machine discriminated union
export {
  PauseReasonSchema,
  IdleStateSchema,
  RunningStateSchema,
  PausedStateSchema,
  CompletedStateSchema,
  FailedStateSchema,
  CancelledStateSchema,
  WorkflowStateSchema,
  type PauseReason,
  type IdleState,
  type RunningState,
  type PausedState,
  type CompletedState,
  type FailedState,
  type CancelledState,
  type WorkflowState,
} from './state';

// Migration schemas and step types
export {
  StepStatusSchema,
  StepDefinitionSchema,
  WorkflowStateWithMigrationSchema,
  type StepStatus,
  type StepDefinition,
} from './schemas';

// Typed state transitions
export {
  WorkflowTransitionEventSchema,
  InvalidTransitionError,
  transition,
  type WorkflowTransitionEvent,
  type TransitionMap,
} from './transitions';

// Step status derivation (pure functions)
export { deriveStepStatuses, deriveSubstepStatuses } from './derived';

// SSE event types (discriminated union on 'event' field)
export {
  StateChangeEventSchema,
  InitialStateEventSchema,
  WorkflowSSEEventSchema,
  type WorkflowSSEEvent,
  type StateChangeEvent,
  type InitialStateEvent,
} from './events';
