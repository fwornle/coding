/**
 * opencode guard plugin — loaded from /etc/opencode/opencode.json, opencode's
 * managed config: root-owned, highest precedence, and a project or user
 * `"plugin": []` does not remove it (verified in the box). It is listed last,
 * so it sees a call's arguments after every other plugin has run.
 *
 * Throwing from tool.execute.before blocks the call; the message (rule, and
 * the approval link when one was requested) is what the model sees.
 */

import { checkCall } from '../guard-hook.mjs';

export const CodingGuard = async ({ directory }) => ({
  'tool.execute.before': async (input, output) => {
    const verdict = await checkCall('opencode', {
      tool_name: input.tool,
      tool_input: output.args,
      session_id: input.sessionID,
      cwd: directory,
    });
    if (!verdict.allow) throw new Error(verdict.message);
  },
});
