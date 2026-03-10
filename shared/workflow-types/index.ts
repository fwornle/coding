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
