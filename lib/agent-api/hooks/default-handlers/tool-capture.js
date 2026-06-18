/**
 * Default hook handler — tool interaction capture (monitoring).
 *
 * Wired by config/hooks-config.json (event: "pre-tool", id: "tool-interaction-capture").
 * Records each tool invocation for monitoring/observability. This is an
 * observational pre-tool hook: it ALWAYS returns { allow: true } and never
 * blocks a tool call — enforcement is the constraint-monitor's job, not this
 * default logger's. See startup-log.js for the module-handler contract.
 *
 * Pre-tool context typically carries a `tool` descriptor in addition to the
 * base { event, agentType, sessionId, timestamp } fields.
 */

import { createLogger } from '../../../logging/Logger.js';

const logger = createLogger('hook:tool-capture');

export default async function toolCapture(context = {}) {
  const { agentType = 'unknown', sessionId = 'unknown', tool } = context;
  logger.debug('Tool interaction', {
    agentType,
    sessionId,
    tool: tool?.name ?? context.toolName ?? 'unknown',
  });
  return { allow: true };
}
