/**
 * knowledge-injection.js — per-prompt knowledge injection for OpenCode.
 *
 * Mirrors the Claude Code UserPromptSubmit hook (src/hooks/knowledge-injection-hook.js):
 * on each substantive user prompt it retrieves the ~1000-token KB block (Working
 * Memory + semantic Insights / Digests / Entities / Observations via /api/retrieve)
 * and prepends it to the outbound messages, so the model — and the rapid-llm-proxy
 * capture (KB_RE anchors on "## Working Memory\n**Project:**") — see the same block
 * Claude runs get. This is what makes the Performance-tab "Retrieved Knowledge" modal
 * populate for OpenCode runs (previously knowledge_text was always empty for them).
 *
 * OpenCode's `experimental.chat.messages.transform` fires on the CLONED messages
 * before every request, so the block is (re)inserted each request; retrieval is
 * cached per user-prompt so only the first request of an agentic turn pays the HTTP
 * cost. Fail-open: any error leaves the messages untouched — injection never blocks
 * or breaks a request.
 *
 * Self-contained (no repo imports) so it runs correctly once installed into
 * ~/.opencode/plugins/. Honors CODING_KNOWLEDGE_INJECTION=0/false/off (per-avenue
 * kill switch, matches the Claude hook).
 *
 * Installed by: coding/install.sh → install_knowledge_injection()
 * Removed by:   coding/uninstall.sh
 *
 * @see plugins/opencode/compaction-guard.js — sibling plugin, same API shape.
 */

import http from "node:http";

const MIN_WORDS = 4;
const MAX_QUERY_CHARS = 500;
const RETRIEVE_TIMEOUT_MS = 2500;
// Anchor the proxy's KB capture regex expects AND our idempotency marker.
const KB_SIGNATURE = "## Working Memory";
// The retrieval service is reachable at the same port the Claude hook uses
// (retrieval-client.js default 3033 → dashboard forward → obs-api).
const PORT = Number(process.env.CODING_RETRIEVAL_PORT || 3033);

function injectionEnabled() {
  const raw = process.env.CODING_KNOWLEDGE_INJECTION;
  if (raw == null) return true; // unset → default ON
  const v = String(raw).trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

// Minimal, fail-open POST /api/retrieve (inlined so the plugin has no repo deps).
function callRetrieval(query) {
  return new Promise((resolve) => {
    const payload = { query, budget: 1000, threshold: 0.7, context: { agent: "opencode" } };
    // Phase B: forward the run id when the launcher set it, so the obs-api persists
    // a structured per-item capture keyed by the same task_id the runs table shows.
    if (process.env.TASK_ID) payload.task_id = process.env.TASK_ID;
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/retrieve",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: RETRIEVE_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

// Concatenated text of a message's text parts (OpenCode message shape).
function userText(msg) {
  if (!msg || !Array.isArray(msg.parts)) return "";
  return msg.parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

export default {
  id: "knowledge-injection",
  server: async (_ctx) => {
    // Per-prompt retrieval cache — only the first request of a turn hits the network.
    let cachePrompt = null;
    let cacheBlock = null;

    return {
      "experimental.chat.messages.transform": async (_input, output) => {
        try {
          if (!injectionEnabled()) return;
          const msgs = output && output.messages;
          if (!Array.isArray(msgs) || msgs.length === 0) return;

          // Newest user message = the current prompt.
          let last = null;
          for (const m of msgs) if (m?.info?.role === "user") last = m;
          if (!last || !Array.isArray(last.parts)) return;

          const prompt = userText(last);
          if (!prompt || prompt.startsWith("/")) return; // slash-command / empty
          if (prompt.split(/\s+/).length < MIN_WORDS) return; // trivial prompt

          // Idempotent: this request's clone already carries the block.
          const already = last.parts.some(
            (p) => p?.type === "text" && typeof p.text === "string" && p.text.includes(KB_SIGNATURE),
          );
          if (already) return;

          // Retrieve once per distinct prompt; reuse across the turn's requests.
          if (prompt !== cachePrompt) {
            const res = await callRetrieval(prompt.slice(0, MAX_QUERY_CHARS));
            cachePrompt = prompt;
            cacheBlock = res && res.markdown && res.meta?.results_count > 0 ? res.markdown : null;
          }
          // Only inject a block that carries the WM anchor (so the proxy captures it).
          if (!cacheBlock || !cacheBlock.includes(KB_SIGNATURE)) return;

          // Prepend so the block precedes the user's own text.
          last.parts.unshift({ type: "text", text: cacheBlock });
        } catch {
          // Fail-open — never block a request on injection.
        }
      },
    };
  },
};
