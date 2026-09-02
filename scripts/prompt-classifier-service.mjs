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
 * So the proxy's `classifier.impl: service` extension point is used as intended:
 * it POSTs {text} here and reads {band} back. The proxy holds no rubric and no
 * model name; this service holds no routing.
 *
 * ── Agent-independent, deliberately ─────────────────────────────────────────
 * Nothing here knows about claude, opencode, copilot or pi. It is handed text
 * and returns a word. That is what lets one verdict serve every agent, and what
 * keeps a second agent from needing a second classifier.
 *
 * ── The judge follows the machine between networks ──────────────────────────
 * Until 2026-09-02 the backend was one URL from one env var, fixed at boot. On
 * that day, inside the corporate network, two `--pi` turns recorded
 * `classifier error: classifier HTTP 502` and ran on gh-copilot/claude-sonnet-5:
 * the judge dialled the laptop, which was not running, while the offload
 * DESTINATION for that network — the on-prem cluster — was up, enabled and
 * reachable throughout. The judge was the only part of the path that could not
 * follow the machine from one network to the other.
 *
 * config/prompt-classifier.yaml now declares backends the way llm-routing.yaml
 * declares offload targets: an ordered list, first enabled network match wins.
 * The live network comes from the proxy rather than being sensed again here —
 * one source of truth, so the two cannot disagree about where the machine is.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *   POST  /classify  {text}  -> {band, latencyMs, model, backend}
 *   GET   /health            -> {status, network, backends[], rubric, counts, …}
 *   PATCH /config    {backends?: [{id, enabled}], rubric?}  -> {ok, config}
 *
 * A backend failure is a 502 with a reason, NOT a guessed band. The proxy fails
 * open on anything that is not a usable answer, so silence is safe and a made-up
 * `small` is not: it would move a real turn onto a weaker model on no evidence.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parsePromptClassifierConfig, candidatesForNetwork, normalizeNetwork, describeBackends,
} from './lib/prompt-classifier-config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.env.CLASSIFIER_SERVICE_PORT || '12437', 10);
const CONFIG_PATH = process.env.CLASSIFIER_CONFIG || path.join(REPO, 'config', 'prompt-classifier.yaml');
const MAX_TEXT = parseInt(process.env.CLASSIFIER_MAX_TEXT || '4000', 10);

/**
 * Where the live network comes from. The proxy already re-evaluates this every
 * 30s against the coordinator and drops a pinned egress that stops answering
 * (proxy-bridge/egress-decision.mjs); sensing it again here would give us a
 * second answer that is worse and free to disagree.
 */
const PROXY_HEALTH_URL = process.env.CLASSIFIER_NETWORK_SOURCE
  || `${(process.env.LLM_CLI_PROXY_URL || 'http://127.0.0.1:12435').replace(/\/$/, '')}/health`;
const NETWORK_TTL_MS = parseInt(process.env.CLASSIFIER_NETWORK_TTL_MS || '60000', 10);

/**
 * How long a backend may sit idle before we ping it to keep its prefix cache
 * alive. 0 disables.
 *
 * Warming at boot is not enough, and that was measured rather than assumed.
 * llama.cpp drops the cached rubric prefix after a spell of inactivity, so the
 * first classification after a quiet stretch pays the full prefill again — past
 * the proxy's 2s budget, which fails open and keeps the caller's band. Observed
 * 2026-08-31: an idle gap of roughly ten minutes, then `what does HTTP 429
 * mean?` was NOT downgraded and the proxy recorded one classifier error; the
 * identical request seconds later resolved to haiku, and asking this service
 * directly returned `small` in 574ms.
 *
 * Nothing was broken in that sequence — fail-open did exactly its job — but the
 * downgrade was lost silently, and on a laptop that idles between turns that is
 * the common case rather than the rare one. Four minutes sits under the gap
 * where the loss was seen, and a ping costs three tokens on an unmetered local
 * model.
 */
const KEEPALIVE_MS = parseInt(process.env.CLASSIFIER_KEEPALIVE_MS || '240000', 10);

const BANDS = ['small', 'medium', 'high'];

const log = (...a) => process.stdout.write(`[prompt-classifier] ${a.join(' ')}\n`);

const counts = { asked: 0, answered: 0, failed: 0, byBand: { small: 0, medium: 0, high: 0 }, keepalives: 0 };

/**
 * Per-backend runtime facts, keyed by id and kept OUT of the config object.
 *
 * Reachability is not configuration and must never be rendered as if it were:
 * "switched off" and "declared but not answering" have opposite fixes, and the
 * dashboard can only say which is which if they arrive as separate fields. Same
 * split the proxy makes between its `providers` config and `runtime.availableImpls`.
 */
const runtime = new Map();  // id -> {reachable, lastLatencyMs, lastError, lastOkAt}

const runtimeOf = (id) => {
  if (!runtime.has(id)) runtime.set(id, { reachable: null, lastLatencyMs: null, lastError: null, lastOkAt: 0 });
  return runtime.get(id);
};

// ── config ──────────────────────────────────────────────────────────────────

let config = null;        // {backends, rubric}
let configMtimeMs = 0;
let configError = null;   // last load failure, surfaced on /health rather than thrown

/**
 * The pre-2026-09-02 shape: one endpoint from env. Kept as the fallback for when
 * the YAML is absent or unparseable, so a bad edit degrades to the behaviour we
 * had rather than to no judge at all.
 */
function envFallbackConfig() {
  return {
    backends: [{
      id: 'env',
      baseUrl: process.env.CLASSIFIER_BACKEND_URL
        || process.env.QWEN_LAPTOP_API_BASE_URL
        || 'http://127.0.0.1:8081/v1',
      model: process.env.CLASSIFIER_BACKEND_MODEL || 'qwen3.8-27b-local',
      // null, not 'CLASSIFIER_BACKEND_API_KEY': askBackend() already reads that
      // variable directly when a backend names no env var of its own, and
      // naming it here would turn "unset" from "no auth needed" into a throw.
      apiKeyEnv: null,
      requireNetwork: null,
      enabled: true,
      timeoutMs: parseInt(process.env.CLASSIFIER_BACKEND_TIMEOUT_MS || '15000', 10),
    }],
    rubric: [
      'You route requests to a model tier. Answer with EXACTLY one word: small, medium, or high.',
      'small  = trivial factual/lookup/formatting, one-step, no code reasoning, no tools needed.',
      'medium = ordinary single-file coding, explanation, or multi-step reasoning.',
      'high   = multi-file refactor, architecture, debugging across systems, or subtle correctness.',
    ].join('\n'),
    source: 'env',
  };
}

/**
 * Load the YAML if it changed. Hot-reload on mtime, the llm-routing.yaml
 * convention — editing policy should not require restarting a service that
 * every classified turn waits on.
 *
 * A parse failure KEEPS THE LAST GOOD CONFIG and records the error. Swapping in
 * a broken config, or dropping to no judge, would turn a typo into a silent
 * behaviour change across every agent; keeping the last good one and saying so
 * on /health is the same fail-toward-what-worked the rest of this path uses.
 *
 * @returns {{backends: Array, rubric: string, source: string}}
 */
function loadConfig({ force = false } = {}) {
  let st = null;
  try {
    st = fs.statSync(CONFIG_PATH);
  } catch {
    if (!config || config.source !== 'env') {
      config = envFallbackConfig();
      configMtimeMs = 0;
      log(`no ${CONFIG_PATH} — falling back to env (${config.backends[0].baseUrl})`);
    }
    return config;
  }
  if (!force && config && st.mtimeMs === configMtimeMs) return config;

  try {
    const { parse } = requireYaml();
    const next = parsePromptClassifierConfig(parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    const changed = !config || JSON.stringify(next) !== JSON.stringify({ backends: config.backends, rubric: config.rubric });
    config = { ...next, source: 'file' };
    configMtimeMs = st.mtimeMs;
    configError = null;
    if (changed) log(`config loaded — ${describeBackends(config.backends)}`);
    return config;
  } catch (e) {
    configError = String(e?.message || e);
    if (!config) {
      config = envFallbackConfig();
      configMtimeMs = 0;
      log(`config REFUSED (${configError}) — falling back to env`);
    } else {
      // Do not adopt the mtime: a fixed file must be picked up on the next tick
      // without needing another edit.
      log(`config REFUSED (${configError}) — keeping the last good one`);
    }
    return config;
  }
}

let _yaml = null;
function requireYaml() {
  if (!_yaml) throw new Error('yaml module not loaded yet');
  return _yaml;
}

// ── network ─────────────────────────────────────────────────────────────────

let cachedNetwork = 'public';
let networkCheckedAt = 0;

/**
 * The live network, from the proxy, cached.
 *
 * Fails open to 'public', which is the safe direction: it declines to dial a
 * LAN-only endpoint (and to attach a corporate bearer) from a network we could
 * not confirm, rather than assuming we are inside.
 *
 * @returns {Promise<'corporate'|'public'>}
 */
async function currentNetwork() {
  const now = Date.now();
  if (now - networkCheckedAt < NETWORK_TTL_MS) return cachedNetwork;
  networkCheckedAt = now;
  try {
    const r = await fetch(PROXY_HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const j = await r.json();
      const next = normalizeNetwork(j?.networkMode || j?.egress?.network);
      if (next !== cachedNetwork) log(`network is ${next} (was ${cachedNetwork})`);
      cachedNetwork = next;
    }
  } catch {
    // The proxy being unreachable says nothing about which network we are on,
    // so the previous answer stands until it can be confirmed again.
  }
  return cachedNetwork;
}

// ── asking ──────────────────────────────────────────────────────────────────

/**
 * Ask one backend for a verdict.
 *
 * `max_tokens: 3` is enough for the longest legal answer and caps the cost of a
 * model that decides to explain itself instead of answering. `enable_thinking:
 * false` is honoured by Qwen templates and ignored elsewhere — a reasoning
 * preamble here is pure latency, since only the first word is ever read.
 *
 * @param {object} backend
 * @param {string} rubric
 * @param {string} text
 * @returns {Promise<string>} raw content, not yet validated as a band
 */
async function askBackend(backend, rubric, text) {
  const key = backend.apiKeyEnv ? process.env[backend.apiKeyEnv] : process.env.CLASSIFIER_BACKEND_API_KEY;
  if (backend.apiKeyEnv && !key) {
    // Named an env var and it is not set. Distinguished from a network failure
    // because it is a setup mistake with a one-line fix, and reporting it as
    // "unreachable" would send someone to look at the wrong machine.
    throw new Error(`${backend.apiKeyEnv} not set`);
  }
  const r = await fetch(`${backend.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: backend.model,
      messages: [{ role: 'system', content: rubric }, { role: 'user', content: text }],
      max_tokens: 3,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(backend.timeoutMs),
  });
  if (!r.ok) throw new Error(`backend HTTP ${r.status}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || '';
}

/**
 * Ask whichever backend serves this network, retrying down the candidate list.
 *
 * The retry only walks past a backend that FAILED, never past one that is
 * switched off — candidatesForNetwork already excluded those. In the common
 * two-entry config there is exactly one candidate per network, so this is a
 * single call; the list matters when an unguarded catch-all is declared last.
 *
 * @returns {Promise<{raw: string, backend: object, latencyMs: number}>}
 */
async function askAny(text) {
  const cfg = loadConfig();
  const network = await currentNetwork();
  const candidates = candidatesForNetwork(cfg.backends, network);
  if (!candidates.length) {
    throw new Error(`no classifier backend for network=${network} (backends: ${describeBackends(cfg.backends)})`);
  }

  let lastError = null;
  for (const backend of candidates) {
    const rt = runtimeOf(backend.id);
    const t0 = Date.now();
    try {
      const raw = await askBackend(backend, cfg.rubric, text);
      rt.reachable = true;
      rt.lastLatencyMs = Date.now() - t0;
      rt.lastError = null;
      rt.lastOkAt = Date.now();
      return { raw, backend, latencyMs: rt.lastLatencyMs };
    } catch (e) {
      rt.reachable = false;
      rt.lastLatencyMs = Date.now() - t0;
      rt.lastError = String(e?.message || e);
      lastError = e;
    }
  }
  throw lastError || new Error('every backend failed');
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
 * Prime the selected backend's prompt cache.
 *
 * Without this the first real classification pays the full prefill and the
 * proxy — which allows 2s — abandons it and keeps the caller's band. That is
 * the fail-open path working, but the downgrade is lost, and the first turn
 * after a restart is exactly when someone is watching.
 *
 * Re-run when the SELECTION changes, not just at boot: moving between networks
 * swaps which box is being asked, and the new one is as cold as a fresh start.
 * Best-effort in every direction — never throws.
 */
let warmedBackendId = null;
async function warmUp(reason = 'boot') {
  const cfg = loadConfig();
  const network = await currentNetwork();
  const [backend] = candidatesForNetwork(cfg.backends, network);
  if (!backend) {
    warmedBackendId = null;
    log(`nothing to warm — no backend serves network=${network} (${describeBackends(cfg.backends)})`);
    return;
  }
  const t0 = Date.now();
  const rt = runtimeOf(backend.id);
  try {
    await askBackend(backend, cfg.rubric, 'ping');
    rt.reachable = true;
    rt.lastLatencyMs = Date.now() - t0;
    rt.lastError = null;
    rt.lastOkAt = Date.now();
    warmedBackendId = backend.id;
    log(`warmed ${backend.id} in ${Date.now() - t0}ms (${reason}) — ${backend.baseUrl} model ${backend.model}`);
  } catch (e) {
    rt.reachable = false;
    rt.lastError = String(e?.message || e);
    warmedBackendId = backend.id;
    log(`warm-up of ${backend.id} failed: ${rt.lastError} (verdicts will fail open until it answers)`);
  }
}

/**
 * Keep the selected backend's prefix cache alive across idle stretches, and
 * notice when the selection has moved under us.
 *
 * Skips the ping entirely when a real request has been served inside the
 * window — traffic warms it better than we can, and a timer that fired anyway
 * would just add queueing to a busy backend. `unref()` so this never holds the
 * process open on its own.
 */
function startKeepalive() {
  if (KEEPALIVE_MS <= 0) {
    log('keepalive disabled — the first request after an idle spell will pay the prefill');
    return;
  }
  const t = setInterval(async () => {
    loadConfig();
    const network = await currentNetwork();
    const [backend] = candidatesForNetwork(loadConfig().backends, network);
    if (!backend) return;
    // The network flipped, or the config changed which box answers. The new one
    // is cold regardless of how recently the old one was warm.
    if (backend.id !== warmedBackendId) {
      await warmUp('selection changed');
      return;
    }
    const rt = runtimeOf(backend.id);
    if (Date.now() - rt.lastOkAt < KEEPALIVE_MS) return;
    const t0 = Date.now();
    try {
      await askBackend(backend, loadConfig().rubric, 'ping');
      rt.reachable = true;
      rt.lastLatencyMs = Date.now() - t0;
      rt.lastError = null;
      rt.lastOkAt = Date.now();
      counts.keepalives += 1;
    } catch (e) {
      // The backend being down is already visible as failed classifications and
      // as reachable:false on /health. Logging it once per interval would fill
      // the log with a fact already reported.
      rt.reachable = false;
      rt.lastError = String(e?.message || e);
    }
  }, Math.max(30_000, Math.floor(KEEPALIVE_MS / 2)));
  t.unref();
  log(`keepalive every ${Math.round(KEEPALIVE_MS / 1000)}s of idle`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // The dashboard reaches this through the proxy, not directly, but a bare
    // curl from a browser tab is the first thing anyone tries when it misbehaves.
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
};

const readBody = async (req) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
};

/**
 * Write a PATCH back to the YAML, preserving its comments.
 *
 * Surgical `setIn` on the Document API rather than a whole-file rewrite, because
 * the prose under each backend IS the reason it is set the way it is — the
 * laptop's measured latency, the cluster's key, why the list is ordered. A
 * round-trip through parse+stringify would delete every one of those on the
 * first dashboard click.
 *
 * VALIDATE THE CANDIDATE BEFORE TOUCHING DISK, the contract the proxy's PATCH
 * /api/llm/routing follows: build the new text, re-parse it through the same
 * validator, and only then write. A rejected patch leaves the file byte-identical.
 */
function applyConfigPatch(patch) {
  const { parseDocument, parse } = requireYaml();
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`no ${CONFIG_PATH} to edit — this service is running on the env fallback`);
  }
  const doc = parseDocument(fs.readFileSync(CONFIG_PATH, 'utf8'));

  if (patch.rubric != null) {
    if (typeof patch.rubric !== 'string' || !patch.rubric.trim()) {
      throw new Error('rubric must be a non-empty string');
    }
    doc.setIn(['rubric'], patch.rubric.endsWith('\n') ? patch.rubric : `${patch.rubric}\n`);
  }

  if (Array.isArray(patch.backends)) {
    // Addressed BY ID, never by index. The dashboard renders the list in
    // declaration order, and an index-addressed write would silently target the
    // wrong backend the moment the file is reordered by hand between a read and
    // a save.
    const seq = doc.getIn(['backends']);
    const ids = (seq?.items || []).map(it => String(it?.get?.('id') ?? ''));
    for (const b of patch.backends) {
      if (!b?.id) continue;
      const i = ids.indexOf(String(b.id));
      if (i < 0) throw new Error(`no backend with id "${b.id}" in ${path.basename(CONFIG_PATH)}`);
      if (typeof b.enabled === 'boolean') doc.setIn(['backends', i, 'enabled'], b.enabled);
    }
  }

  const nextText = doc.toString();
  // The same validator the loader uses. If this throws, nothing is written.
  parsePromptClassifierConfig(parse(nextText));
  fs.writeFileSync(CONFIG_PATH, nextText, 'utf8');
  return loadConfig({ force: true });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    const cfg = loadConfig();
    const network = await currentNetwork();
    const selected = candidatesForNetwork(cfg.backends, network)[0]?.id ?? null;
    return send(res, 200, {
      status: 'ok',
      role: 'prompt-classifier',
      port: PORT,
      network,
      configPath: cfg.source === 'file' ? CONFIG_PATH : null,
      configSource: cfg.source,
      // Present only when the file on disk is currently unusable. Absent means
      // "no problem", not "not checked" — a null here would read the same as a
      // healthy load and hide exactly the state worth seeing.
      ...(configError ? { configError } : {}),
      // Config and runtime, side by side but never merged: `enabled` is what was
      // written down, `reachable` is what answered. Conflating them is how
      // "switched off" and "not answering" become the same red dot.
      backends: cfg.backends.map(b => {
        const rt = runtimeOf(b.id);
        return {
          id: b.id,
          model: b.model,
          baseUrl: b.baseUrl,
          requireNetwork: b.requireNetwork,
          enabled: b.enabled,
          selected: b.id === selected,
          reachable: rt.reachable,
          lastLatencyMs: rt.lastLatencyMs,
          lastError: rt.lastError,
          idleMs: rt.lastOkAt ? Date.now() - rt.lastOkAt : null,
        };
      }),
      // The actual prompt the judge is sent. On /health because "why did it say
      // that?" is unanswerable without it, and it is not a secret.
      rubric: cfg.rubric,
      keepaliveMs: KEEPALIVE_MS,
      bands: BANDS,
      counts,
    });
  }

  if (req.method === 'PATCH' && req.url === '/config') {
    try {
      const patch = JSON.parse(await readBody(req) || '{}');
      const next = applyConfigPatch(patch);
      log(`config saved — ${describeBackends(next.backends)}`);
      // The selected box may have changed; a cold one costs the next verdict.
      warmUp('config saved').catch(() => {});
      return send(res, 200, { ok: true, backends: next.backends, rubric: next.rubric });
    } catch (e) {
      const msg = String(e?.message || e);
      log(`config patch rejected (nothing written): ${msg}`);
      return send(res, 400, { error: msg, type: 'CLASSIFIER_CONFIG_INVALID' });
    }
  }

  if (req.method === 'POST' && req.url === '/classify') {
    let text = '';
    try {
      text = String(JSON.parse(await readBody(req))?.text || '');
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
      const { raw, backend, latencyMs } = await askAny(text);
      const band = parseBand(raw);
      if (!band) {
        counts.failed += 1;
        return send(res, 502, { error: 'backend returned no recognisable band', backend: backend.id });
      }
      counts.answered += 1;
      counts.byBand[band] += 1;
      return send(res, 200, { band, latencyMs, model: backend.model, backend: backend.id });
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

// yaml is loaded once, before the server binds, so every handler can assume it.
_yaml = await import('yaml');
loadConfig({ force: true });

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT} (POST /classify, GET /health, PATCH /config)`);
  log(`backends: ${describeBackends(loadConfig().backends)}`);
  warmUp('boot').then(startKeepalive);
});
