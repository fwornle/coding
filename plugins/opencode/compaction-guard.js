/**
 * compaction-guard.js - Prevents "Bad Request" errors during compaction
 *
 * Root cause: When an OpenCode session grows too large, the compaction
 * request itself can exceed the Copilot API proxy's limits. This happens
 * because OpenCode sends the ENTIRE message history (structuredClone) to
 * the model to generate a summary, without truncating oversized parts.
 *
 * The hook "experimental.chat.messages.transform" fires on the cloned
 * messages BEFORE they're sent. We mutate the messages array in-place
 * to trim oversized content, preventing the 400 "Bad Request".
 *
 * This runs on ALL LLM requests (not just compaction), so we keep
 * recent messages intact and only truncate older ones aggressively.
 *
 * Installed by: coding/install.sh → install_compaction_guard()
 * Removed by:   coding/uninstall.sh
 *
 * @see https://github.com/anomalyco/opencode — OpenCode plugin system
 */

export default {
  id: "compaction-guard",
  server: async (_ctx) => {
    // Limits - tuned to stay well under typical API proxy limits
    const MAX_PART_CHARS = 8000;        // max chars per individual part (tool output, text, etc.)
    const MAX_USER_TEXT_CHARS = 12000;   // max chars for user message text
    const PROTECTED_RECENT = 10;        // keep last N messages fully intact
    const PROTECTED_START = 2;          // keep first N messages fully intact (system context)
    const TRUNCATION_MARKER = "\n\n... [truncated by compaction-guard to prevent API overload]";

    function truncate(str, limit) {
      if (!str || typeof str !== "string" || str.length <= limit) return str;
      return str.slice(0, limit) + TRUNCATION_MARKER;
    }

    function trimParts(parts, isUserMsg) {
      if (!Array.isArray(parts)) return;
      for (const part of parts) {
        // Tool outputs (often huge - file contents, grep results, etc.)
        if (part.type === "tool" && part.output) {
          part.output = truncate(part.output, MAX_PART_CHARS);
        }
        // Text parts
        if (part.type === "text" && part.text) {
          const limit = isUserMsg ? MAX_USER_TEXT_CHARS : MAX_PART_CHARS;
          part.text = truncate(part.text, limit);
        }
        // Step/content parts that may contain nested text
        if (part.type === "step" && part.content) {
          part.content = truncate(part.content, MAX_PART_CHARS);
        }
      }
    }

    return {
      "experimental.chat.messages.transform": async (_input, output) => {
        const msgs = output.messages;
        if (!msgs || msgs.length === 0) return;

        const startBound = Math.min(PROTECTED_START, msgs.length);
        const endBound = Math.max(startBound, msgs.length - PROTECTED_RECENT);

        // Truncate middle messages (older context)
        for (let i = startBound; i < endBound; i++) {
          const msg = msgs[i];
          if (!msg || !msg.parts) continue;
          trimParts(msg.parts, msg.info?.role === "user");
        }

        // Also scan ALL messages for truly enormous parts (>50k)
        // Even recent messages with a 500k paste should be trimmed
        const ABSOLUTE_MAX = 50000;
        for (const msg of msgs) {
          if (!msg || !msg.parts) continue;
          for (const part of msg.parts) {
            if (part.type === "tool" && part.output && part.output.length > ABSOLUTE_MAX) {
              part.output = part.output.slice(0, MAX_PART_CHARS) + TRUNCATION_MARKER;
            }
            if (part.type === "text" && part.text && part.text.length > ABSOLUTE_MAX) {
              part.text = part.text.slice(0, MAX_USER_TEXT_CHARS) + TRUNCATION_MARKER;
            }
          }
        }
      },

      "experimental.session.compacting": async (_input, output) => {
        output.context.push(
          "IMPORTANT: The conversation was very long. Focus the summary on: " +
          "(1) current task and goal, (2) key files modified, (3) what to do next. " +
          "Do NOT reproduce large tool outputs or file contents."
        );
      },
    };
  },
};
