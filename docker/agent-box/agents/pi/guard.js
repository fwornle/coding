/**
 * pi guard extension — the box starts pi with `-e` pointing here. An explicit
 * `-e` extension always loads (even with --no-extensions), and the agent
 * cannot change the command line of the pi it runs in.
 *
 * Returning { block: true, reason } vetoes the call; the reason (rule, and the
 * approval link when one was requested) is what the model sees.
 */

import { checkCall } from '../guard-hook.mjs';

export default function codingGuard(pi) {
  pi.on('tool_call', async (event, ctx) => {
    const verdict = await checkCall('pi', {
      tool_name: event.toolName,
      tool_input: event.input,
      session_id: event.toolCallId,
      cwd: ctx?.cwd ?? process.cwd(),
    });
    if (!verdict.allow) return { block: true, reason: verdict.message };
    return undefined;
  });
}
