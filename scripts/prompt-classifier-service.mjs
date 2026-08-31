#!/usr/bin/env node
/**
 * prompt-classifier-service — how hard is this request?
 *
 * A standalone HTTP service that answers ONE question: given the text of a
 * request, which model tier should serve it — small, medium or high.
 *
 * ── Why this is a service and not code inside the proxy ─────────────────────
 * rapid-llm-proxy can ask a local model directly (`classifier.impl: local-llm`),
 * and that works. It also puts three decisions inside the router that are not
 * the router's: which model judges, what the rubric says, and what "small"
 * means for this installation. Those are OUR policy, they change on our
 * schedule, and changing them should not mean editing — or restarting — the
 * component every LLM call in the house goes through.
 *
 * So the proxy's `impl: http` extension point is used as intended: it POSTs
 * {text} here and reads {band} back. The proxy holds no rubric and no model
 * name; this service holds no routing.
 *
 * ── Agent-independent, deliberately ─────────────────────────────────────────
 * Nothing here knows about claude, opencode, copilot or pi. It is handed text
 * and returns a word. That is what lets one verdict serve every agent, and what
 * keeps a second agent from needing a second classifier.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *   POST /classify  {text}  -> {band, latencyMs, model}   (the proxy's contract)
 *   GET  /health            -> {status, backend, model, warm, counts}
 *
 * A backend failure is a 502 with a reason, NOT a guessed band. The proxy fails
 * open on anything that is not a usable answer, so silence is safe and a made-up
 * `small` is not: it would move a real turn onto a weaker model on no evidence.
 *
 * Backend is any OpenAI-compatible /chat/completions endpoint — llama.cpp on
 * this laptop by default. Swapping it is an env var, not a code change.
 */

import http from 'node:http';

const PORT = parseInt(process.env.CLASSIFIER_SERVICE_PORT || '12437', 10);
const BACKEND_URL = process.env.CLASSIFIER_BACKEND_URL
  || process.env.QWEN_LAPTOP_API_BASE_URL
  || 'http://127.0.0.1:8081/v1';
const BACKEND_MODEL = process.env.CLASSIFIER_BACKEND_MODEL || 'qwen3.8-27b-local';
const BACKEND_KEY = process.env.CLASSIFIER_BACKEND_API_KEY || '';
/**
 * Our own budget, deliberately looser than the proxy's.
 *
 * The proxy aborts at its `timeout_ms` (2s) and keeps the caller's band — that
 * is the fail-open path and it is correct. This service should not ALSO give up
 * at 2s, because a request the proxy has already abandoned still warms the
 * backend's KV cache by running to completion, which is what makes the next
 * verdict fast. Giving up early would throw that away.
 */
const BACKEND_TIMEOUT_MS = parseInt(process.env.CLASSIFIER_BACKEND_TIMEOUT_MS || '15000', 10);
const MAX_TEXT = parseInt(process.env.CLASSIFIER_MAX_TEXT || '4000', 10);

const BANDS = ['small', 'medium', 'high'];

/**
 * The rubric. This service owns it — that is the point of the split.
 *
 * Calibration is the whole feature, not a detail. Measured 2026-08-30 against
 * llama.cpp: with a bare "how hard is this?" prompt, "how many r's in
 * strawberry" came back `medium` — the exact request that motivated the work.
 * With the three definition lines below it comes back `small`. Same model, same
 * temperature; only this text changed.
 *
 * ONE constant, never interpolated per request: llama.cpp KV-caches the prefix,
 * so a stable prefix costs a full prefill once (~4.8s measured) and ~600ms
 * every time after. A rubric that varied per request would pay the prefill on
 * every call and blow the proxy's timeout every time.
 */
const RUBRIC = [
  'You route requests to a model tier. Answer with EXACTLY one word: small, medium, or high.',
  'small  = trivial factual/lookup/formatting, one-step, no code reasoning, no tools needed.',
  'medium = ordinary single-file coding, explanation, or multi-step reasoning.',
  'high   = multi-file refactor, architecture, debugging across systems, or subtle correctness.',
].join('\n');

const log = (...a) => process.stdout.write(`[prompt-classifier] ${a.join(' ')}\n`);

const counts = { asked: 0, answered: 0, failed: 0, byBand: { small: 0, medium: 0, high: 0 } };
let warm = false;

/**
 * Ask the backend for a verdict.
 *
 * `max_tokens: 3` is enough for the longest legal answer and caps the cost of a
 * model that decides to explain itself instead of answering. `enable_thinking:
 * false` is honoured by Qwen templates and ignored elsewhere — a reasoning
 * preamble here is pure latency, since only the first word is ever read.
 *
 * @param {string} text
 * @returns {Promise<string>} raw content, not yet validated as a band
 */
async function askBackend(text) {
  const r = await fetch(`${BACKEND_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(BACKEND_KEY ? { Authorization: `Bearer ${BACKEND_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: BACKEND_MODEL,
      messages: [{ role: 'system', content: RUBRIC }, { role: 'user', content: text }],
      max_tokens: 3,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`backend HTTP ${r.status}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || '';
}

/**
 * The band in a raw answer, or '' if there is not one.
 *
 * Substring, not equality: a model that answers "small." or "Small" has told us
 * what we asked for, and rejecting it would fail open for a formatting reason.
 * Longest-first so "high" is never found inside a word we would rather read
 * whole. Anything with no band at all returns '' and the caller 502s.
 */
function parseBand(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return '';
  for (const b of ['medium', 'small', 'high']) {
    if (t.includes(b)) return b;
  }
  return '';
}

/**
 * Prime the backend's prompt cache once at boot.
 *
 * Without this the first real classification pays the full prefill and the
 * proxy — which allows 2s — abandons it and keeps the caller's band. That is
 * the fail-open path working, but the downgrade is lost, and the first turn
 * after a restart is exactly when someone is watching. Best-effort in every
 * direction: never throws, logs once either way.
 */
async function warmUp() {
  const t0 = Date.now();
  try {
    await askBackend('ping');
    warm = true;
    log(`warmed in ${Date.now() - t0}ms — backend ${BACKEND_URL} model ${BACKEND_MODEL}`);
  } catch (e) {
    log(`warm-up failed: ${e?.message || e} (first real call will pay the prefill)`);
  }
}

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, {
      status: 'ok',
      role: 'prompt-classifier',
      port: PORT,
      backend: BACKEND_URL,
      model: BACKEND_MODEL,
      warm,
      bands: BANDS,
      counts,
    });
  }

  if (req.method === 'POST' && req.url === '/classify') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let text = '';
    try {
      text = String(JSON.parse(raw)?.text || '');
    } catch {
      return send(res, 400, { error: 'body must be JSON {text}' });
    }
    if (!text.trim()) return send(res, 400, { error: 'text is empty' });

    // Cap here as well as at the caller. The proxy already refuses a large
    // request before asking, but this service is reachable by anything and a
    // 200KB prompt would cost a prefill nobody budgeted for.
    text = text.slice(0, MAX_TEXT);

    counts.asked += 1;
    const t0 = Date.now();
    try {
      const band = parseBand(await askBackend(text));
      if (!band) {
        counts.failed += 1;
        return send(res, 502, { error: 'backend returned no recognisable band' });
      }
      warm = true;
      counts.answered += 1;
      counts.byBand[band] += 1;
      return send(res, 200, { band, latencyMs: Date.now() - t0, model: BACKEND_MODEL });
    } catch (e) {
      counts.failed += 1;
      // A reason, never a band. The proxy treats any non-answer as "keep the
      // declared band"; inventing `small` here would move a real turn onto a
      // weaker model on the strength of a network error.
      return send(res, 502, { error: String(e?.message || e), latencyMs: Date.now() - t0 });
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT} (POST /classify, GET /health)`);
  warmUp();
});
