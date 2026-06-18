/**
 * Default hook handler — error logging to the monitoring system.
 *
 * Wired by config/hooks-config.json (event: "error", id: "error-logger").
 * Records errors surfaced through the hook system. Observational: never denies.
 * See startup-log.js for the module-handler contract.
 *
 * Error context typically carries an `error` field (Error instance or string)
 * alongside the base { event, agentType, sessionId, timestamp } fields.
 */

import { createLogger } from '../../../logging/Logger.js';

const logger = createLogger('hook:error');

export default async function errorLog(context = {}) {
  const { agentType = 'unknown', sessionId = 'unknown', error } = context;
  const message = error?.message ?? (typeof error === 'string' ? error : 'unknown error');
  logger.error('Hook-reported error', { agentType, sessionId, error: message });
  return { allow: true };
}
