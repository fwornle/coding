/**
 * SSE event types for workflow state streaming.
 *
 * Discriminated union on 'event' field:
 *   - 'state-change': Emitted on every state machine transition
 *   - 'initial-state': Emitted when a client first connects
 *
 * Both carry the full WorkflowState snapshot. The event type tells you
 * WHY you received it; the state IS the complete snapshot.
 */

import { z } from 'zod';
import { WorkflowStateSchema } from './state';
import type { WorkflowTransitionEvent } from './transitions';

// ---------------------------------------------------------------------------
// SSE event schemas
// ---------------------------------------------------------------------------

/**
 * Emitted on every state machine transition.
 * Carries the full state plus the transition type that caused it.
 */
export const StateChangeEventSchema = z.object({
  event: z.literal('state-change'),
  state: WorkflowStateSchema,
  transition: z.string(),
  timestamp: z.string(),
});

/**
 * Emitted when a client first connects to /workflow-events.
 * Carries the current state snapshot.
 */
export const InitialStateEventSchema = z.object({
  event: z.literal('initial-state'),
  state: WorkflowStateSchema,
  timestamp: z.string(),
});

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/**
 * WorkflowSSEEvent: discriminated union on 'event' field.
 *
 * Clients switch on event.event to determine the message type:
 *   if (event.event === 'state-change') { event.transition }
 *   if (event.event === 'initial-state') { // reconnect sync }
 */
export const WorkflowSSEEventSchema = z.discriminatedUnion('event', [
  StateChangeEventSchema,
  InitialStateEventSchema,
]);

export type WorkflowSSEEvent = z.infer<typeof WorkflowSSEEventSchema>;
export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>;
export type InitialStateEvent = z.infer<typeof InitialStateEventSchema>;
