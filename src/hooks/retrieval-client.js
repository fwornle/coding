/**
 * Shared retrieval client -- HTTP client for the retrieval service.
 *
 * Fail-open pattern: ALWAYS resolves (never rejects).
 * Returns parsed JSON response or null on any error/timeout.
 * Zero npm dependencies -- uses only node:http.
 *
 * @module retrieval-client
 */

import http from 'node:http';

/**
 * Call the retrieval service with a query and optional context.
 *
 * @param {object} params
 * @param {string} params.query - The search query text
 * @param {number} [params.budget=1000] - Token budget
 * @param {number} [params.threshold=0.75] - Relevance threshold
 * @param {object|null} [params.context=null] - Optional context: { project, cwd, recent_files }
 * @param {string|null} [params.task_id=null] - Optional run/session id. When set, the
 *   retrieval server persists a structured per-item capture keyed by it (Phase B), so
 *   the dashboard can show the exact injected Insights/Digests/Entities/Observations
 *   as scored cards. Equals the runs-table task_id (experiment slug or session UUID).
 * @param {number} [params.timeout=4500] - HTTP timeout in ms. 4500 (was 2000) so the server-side
 *   LLM relevance judge (~2.5s, 3500ms cap) plus retrieval fit within a single retrieve; still <
 *   the hooks' 5000ms SAFETY_TIMEOUT. The judge itself fails open, so a slow proxy never stalls the
 *   hook (the request aborts and the hook injects nothing that turn).
 * @param {number} [params.port=3033] - Retrieval service port
 * @returns {Promise<object|null>} Parsed response or null (fail-open)
 */
export function callRetrieval({ query, budget = 1000, threshold = 0.75, context = null, task_id = null, timeout = 4500, port = 3033 }) {
  return new Promise((resolve) => {
    const payload = { query, budget, threshold };
    if (context != null) {
      payload.context = context;
    }
    if (task_id) {
      payload.task_id = task_id;
    }

    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/retrieve',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', (err) => {
      process.stderr.write(`[retrieval-client] Error: ${err.message}\n`);
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}
