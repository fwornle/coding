/**
 * opencode guard plugin — loaded from /etc/opencode/opencode.json, opencode's
 * managed config: root-owned, highest precedence, and a project or user
 * `"plugin": []` does not remove it (verified in the box). It is listed last,
 * so it sees a call's arguments after every other plugin has run.
 *
 * Throwing from tool.execute.before blocks the call; the message (rule, and
 * the approval link when one was requested) is what the model sees.
 * tool.execute.after runs the result check (files undone are named in the
 * tool's output).
 */

import { checkCall } from '../guard-hook.mjs';

export const CodingGuard = async ({ directory }) => {
  /** callID → args: the after-call hook needs the call's file, and its input may not carry args. */
  const args = new Map();
  return {
    'tool.execute.before': async (input, output) => {
      const verdict = await checkCall('opencode', {
        tool_name: input.tool,
        tool_input: output.args,
        tool_use_id: input.callID,
        session_id: input.sessionID,
        cwd: directory,
      });
      if (!verdict.allow) throw new Error(verdict.message);
      if (input.callID) args.set(input.callID, output.args);
    },
    // Phase 2: judge what the call left on disk. Undone files are reported in
    // the tool's output, which is what the model reads next.
    'tool.execute.after': async (input, output) => {
      const callArgs = args.get(input.callID) ?? input.args ?? {};
      args.delete(input.callID);
      const verdict = await checkCall('opencode', {
        tool_name: input.tool,
        tool_input: callArgs,
        tool_use_id: input.callID,
        session_id: input.sessionID,
        cwd: directory,
      }, 'post');
      if (!verdict.allow && output) output.output = `${output.output ?? ''}\n\n${verdict.message}`;
    },
  };
};
