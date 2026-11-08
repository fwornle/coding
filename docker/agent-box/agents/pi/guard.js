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
      tool_use_id: event.toolCallId,
      session_id: event.toolCallId,
      cwd: ctx?.cwd ?? process.cwd(),
    });
    if (!verdict.allow) return { block: true, reason: verdict.message };
    return undefined;
  });
  // Phase 2: judge what the call left on disk (pi fires this for failed calls
  // too). Undone files are appended to the result the model reads.
  pi.on('tool_result', async (event, ctx) => {
    const verdict = await checkCall('pi', {
      tool_name: event.toolName,
      tool_input: event.input,
      tool_use_id: event.toolCallId,
      session_id: event.toolCallId,
      cwd: ctx?.cwd ?? process.cwd(),
    }, 'post');
    if (verdict.allow) return undefined;
    return { content: [...(Array.isArray(event.content) ? event.content : []), { type: 'text', text: verdict.message }], isError: true };
  });
}
