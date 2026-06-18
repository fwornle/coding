/**
 * Default hook handler — session startup logging.
 *
 * Wired by config/hooks-config.json (event: "startup", id: "default-startup-log").
 * The unified hook manager (hook-manager.js executeModule) imports this module
 * and invokes its default export with the event context, expecting an optional
 * { allow, message } result. This is an observational hook: it never denies.
 *
 * Context shape (hook-manager.js executeHooks): { event, agentType, sessionId,
 * timestamp, ...agentContext }.
 */

import { createLogger } from '../../../logging/Logger.js';

const logger = createLogger('hook:startup');

export default async function startupLog(context = {}) {
  const { agentType = 'unknown', sessionId = 'unknown', timestamp = Date.now() } = context;
  logger.info('Session startup', { agentType, sessionId, timestamp });
  return { allow: true };
}
