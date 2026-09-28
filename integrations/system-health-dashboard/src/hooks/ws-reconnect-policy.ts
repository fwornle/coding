/**
 * When the workflow WebSocket closes, should we reconnect — and how long do we
 * wait?
 *
 * This was four lines inside `ws.onclose` and it was wrong in a way nothing
 * could catch:
 *
 *     if (autoReconnect && event.code !== 1000 && attempts < max) { ... }
 *
 * Close code 1000 means "clean", and a clean close is what a SERVER sends when
 * it shuts down. So every dashboard restart permanently killed live updates in
 * every open tab. The UKB modal renders its controls — Step, Cancel, the LLM
 * chips — from state that socket feeds, so they simply stopped appearing, and a
 * workflow paused at a breakpoint became indistinguishable from a hung one.
 * That cost an hour of hunting a bug in a workflow that was working correctly.
 *
 * The fix is to key the decision on WHO closed the socket, which the code never
 * tells you, rather than on the code. Kept pure and separate so the rule can be
 * tested without a browser, a React tree, or a live server.
 */

export interface ReconnectInput {
  /** True when our own `disconnect()` initiated the close (unmount, modal close). */
  intentional: boolean
  /** The hook's autoReconnect option. */
  autoReconnect: boolean
  /** Attempts already made since the last successful open. */
  attempts: number
  /** Ceiling on attempts. */
  maxAttempts: number
  /** Base delay in ms; the returned delay scales with the attempt number. */
  baseDelayMs: number
}

export type ReconnectDecision =
  /** Do nothing — we closed it, or reconnecting is disabled. */
  | { action: 'stop'; reason: 'intentional' | 'disabled' }
  /** Try again after `delayMs`; `attempt` is this attempt's 1-based number. */
  | { action: 'retry'; attempt: number; delayMs: number }
  /** Out of attempts. The UI must SAY so — silence is what caused the incident. */
  | { action: 'give-up' }

/** Ceiling on the backoff, so a long outage still retries about every 15s. */
export const MAX_RECONNECT_DELAY_MS = 15_000

export function decideReconnect(input: ReconnectInput): ReconnectDecision {
  if (input.intentional) return { action: 'stop', reason: 'intentional' }
  if (!input.autoReconnect) return { action: 'stop', reason: 'disabled' }
  if (input.attempts >= input.maxAttempts) return { action: 'give-up' }

  const attempt = input.attempts + 1
  return {
    action: 'retry',
    attempt,
    delayMs: Math.min(input.baseDelayMs * attempt, MAX_RECONNECT_DELAY_MS),
  }
}
