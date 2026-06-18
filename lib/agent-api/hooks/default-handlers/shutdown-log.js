/**
 * Default hook handler — session shutdown logging.
 *
 * Wired by config/hooks-config.json (event: "shutdown", id: "default-shutdown-log").
 * Observational hook: logs the session end and never denies. See startup-log.js
 * for the module-handler contract.
 */

import { createLogger } from '../../../logging/Logger.js';

const logger = createLogger('hook:shutdown');

export default async function shutdownLog(context = {}) {
  const { agentType = 'unknown', sessionId = 'unknown', timestamp = Date.now() } = context;
  logger.info('Session shutdown', { agentType, sessionId, timestamp });
  return { allow: true };
}
