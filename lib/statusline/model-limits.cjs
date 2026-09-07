'use strict';
/**
 * Real context-window sizes, read from the catalogue the agents themselves use.
 *
 * WHY THIS EXISTS
 * ---------------
 * context-gauge.cjs used to size every window from a five-line regex table, and
 * the second line of that table said "anything matching /^claude-/ is 200K".
 * That was true for the Claude 3/4 era and is false now: models.dev reports
 * github-copilot/claude-opus-5 and github-copilot/claude-sonnet-5 at 1,000,000.
 *
 * The consequence was not a rounding error, it was a wrong colour. A measured
 * 188,240-token opencode session rendered 94% in bold red — the "you are about
 * to be compacted" state — when the honest figure was 19%, solid green. It also
 * made the gauge blind to the thing it exists to show: switching sonnet-5 →
 * opus-5 could not move the needle, because the table mapped both to the same
 * fabricated 200K.
 *
 * WHY READ models.dev RATHER THAN HARDCODE
 * ----------------------------------------
 * A hardcoded number is a fact with no owner: it is right on the day it is
 * typed and silently wrong from the next model release onward — which is
 * precisely how the 200K line rotted. opencode already downloads and caches the
 * whole models.dev catalogue for its own compaction maths, so the number that
 * decides when the AGENT compacts is sitting on disk. Reading THAT means the
 * gauge and the agent can never disagree, and a new model needs no edit here.
 *
 * COST, AND WHY THERE IS A DERIVED CACHE
 * --------------------------------------
 * ~/.cache/opencode/models.json is 4.5MB / 213 providers and takes 33ms to
 * parse. The status line runs every 5s in every pane, in a FRESH process each
 * tick, so an in-process memo buys nothing across ticks and 33ms would be a
 * third of the whole render budget. So the catalogue is boiled down ONCE into a
 * flat `"<provider>/<model>": <context>` map (plus a by-model index), written
 * beside the other status-line caches, and invalidated on the source's
 * mtime+size. Steady-state cost is a sub-millisecond read of a small file.
 *
 * Every path fails soft: no catalogue, unparseable JSON, an unwritable cache
 * directory — all return null and the caller falls back to its regex table. A
 * status line must never be the thing that breaks.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * opencode's models.dev cache. This is opencode's file, read-only to us.
 * OPENCODE_MODELS_JSON exists for tests and for a non-default XDG cache home.
 */
function catalogueSourcePath() {
  return (
    process.env.OPENCODE_MODELS_JSON ||
    path.join(os.homedir(), '.cache', 'opencode', 'models.json')
  );
}

/**
 * Where the boiled-down map lives: beside combined-status-line-cache*.txt and
 * combined-status-line-projects.json, which is where every other derived
 * status-line artefact already lives. Falls back to the OS temp dir when there
 * is no CODING_REPO — an unwrapped agent still gets correct windows, it just
 * re-derives them per tick.
 */
function catalogueCachePath() {
  const repo = process.env.CODING_REPO;
  const dir = repo ? path.join(repo, '.logs') : os.tmpdir();
  return path.join(dir, 'model-context-limits.json');
}

/**
 * Providers consulted, in order, when a model id is not found under the
 * provider that served it.
 *
 * This is the custom-provider case, and it is the common one here: a user's
 * `rapid-proxy` provider is declared in their own opencode.json and appears in
 * no public catalogue, yet the model ids it exposes (claude-sonnet-5,
 * claude-haiku-4.5) are the real upstream ids — the proxy rewrites the model by
 * band and forwards to gh-copilot or claude-code-max. So the id IS resolvable,
 * just not under that provider name.
 *
 * The order is "who actually serves these ids for us", not alphabetical.
 */
const FALLBACK_PROVIDERS = ['github-copilot', 'anthropic', 'openai', 'google'];

/** A positive integer context size, or null. Guards NaN, 0 and negatives. */
function positiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Boil the catalogue down to what the gauge needs.
 *
 * Two indexes: `byPair` for the exact provider/model hit, and `byModel` for the
 * custom-provider fallback above. byModel records ONE value per id, chosen by
 * FALLBACK_PROVIDERS order and falling back to the modal value across every
 * provider that offers it — the modal rather than the max or the first, because
 * when catalogues disagree the value most providers agree on is the one most
 * likely to be the model's actual window rather than one provider's cap.
 */
function deriveLimits(catalogue) {
  const byPair = {};
  /** @type {Record<string, Record<number, number>>} model id → context → count */
  const votes = {};
  /** @type {Record<string, Record<string, number>>} model id → provider → context */
  const byProvider = {};

  for (const [providerId, provider] of Object.entries(catalogue || {})) {
    const models = provider && provider.models;
    if (!models || typeof models !== 'object') continue;
    for (const [modelId, model] of Object.entries(models)) {
      const ctx = positiveInt(model && model.limit && model.limit.context);
      if (!ctx) continue;
      byPair[`${providerId}/${modelId}`] = ctx;
      (votes[modelId] ||= {})[ctx] = (votes[modelId][ctx] || 0) + 1;
      (byProvider[modelId] ||= {})[providerId] = ctx;
    }
  }

  const byModel = {};
  for (const modelId of Object.keys(votes)) {
    let chosen = null;
    for (const p of FALLBACK_PROVIDERS) {
      const ctx = byProvider[modelId] && byProvider[modelId][p];
      if (ctx) { chosen = ctx; break; }
    }
    if (!chosen) {
      let best = 0;
      for (const [ctx, count] of Object.entries(votes[modelId])) {
        // Ties broken toward the larger window: a tie means the catalogue has no
        // majority view, and over-reporting occupancy (the smaller window) would
        // paint a red gauge on evidence that does not support it.
        if (count > best || (count === best && Number(ctx) > chosen)) {
          best = count;
          chosen = Number(ctx);
        }
      }
    }
    if (chosen) byModel[modelId] = chosen;
  }

  return { byPair, byModel };
}

/** Read + parse a JSON file, or null. Never throws. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The user's own opencode config, which OUTRANKS the public catalogue.
 *
 * A provider block there can declare `models.<id>.limit.context`, and when it
 * does that number is not an opinion about the model — it is the number
 * opencode itself compacts against for that provider. The catalogue cannot know
 * it: the case that matters is a self-hosted endpoint (`qwen-laptop` served by
 * a laptop llama.cpp at 32K) whose model id also exists publicly at 262K. Taking
 * the catalogue's 262K there would under-report occupancy by 8x, and the gauge
 * would sit green while the agent compacted.
 *
 * Cheap enough to read per tick (single-digit KB), so it is not folded into the
 * derived cache — that cache is invalidated on the catalogue's mtime, and a
 * config edit would not move it.
 */
function userConfigPath() {
  return (
    process.env.OPENCODE_CONFIG ||
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json')
  );
}

let _userMemo;
function userConfigContextWindow(model, provider) {
  if (!provider) return null;
  if (_userMemo === undefined) _userMemo = readJson(userConfigPath());
  const ctx =
    _userMemo &&
    _userMemo.provider &&
    _userMemo.provider[provider] &&
    _userMemo.provider[provider].models &&
    _userMemo.provider[provider].models[model] &&
    _userMemo.provider[provider].models[model].limit &&
    _userMemo.provider[provider].models[model].limit.context;
  return positiveInt(ctx);
}

/**
 * The derived map, rebuilt only when the catalogue underneath it changed.
 *
 * Identity is (mtimeMs, size) rather than a hash: hashing 4.5MB costs more than
 * the parse the cache exists to avoid, and opencode replaces this file wholesale
 * on refresh, so a same-mtime-same-size file is the same file.
 */
let _memo = null;
function limits() {
  if (_memo !== null) return _memo;
  _memo = false; // negative-cache for this process; every path below fails soft

  const src = catalogueSourcePath();
  let stat;
  try {
    stat = fs.statSync(src);
  } catch {
    return _memo; // no catalogue on this machine — caller keeps its regex table
  }
  const identity = { mtimeMs: Math.floor(stat.mtimeMs), size: stat.size };

  const cacheFile = catalogueCachePath();
  const cached = readJson(cacheFile);
  if (
    cached &&
    cached.src &&
    cached.src.mtimeMs === identity.mtimeMs &&
    cached.src.size === identity.size &&
    cached.byPair
  ) {
    _memo = cached;
    return _memo;
  }

  const catalogue = readJson(src);
  if (!catalogue) return _memo;
  const derived = deriveLimits(catalogue);
  const payload = { src: identity, ...derived };
  _memo = payload;

  // Best-effort, via temp+rename so a reader on the 5s tick can never observe a
  // half-written map. A failure here costs 33ms per tick, not correctness.
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, cacheFile);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
  }
  return _memo;
}

/**
 * The catalogued context window for a model, or null when it is not catalogued.
 *
 * Null is meaningful and is NOT a zero: it means "this catalogue has no opinion",
 * and the caller must fall back rather than treat the window as unknown-but-zero.
 *
 * @param {string} model      model id, e.g. 'claude-opus-5'
 * @param {string} [provider] provider id as the agent reports it, e.g.
 *   'github-copilot'. Omit or pass a custom provider and the by-model index
 *   resolves it instead.
 * @returns {number|null}
 */function catalogueContextWindow(model, provider) {
  const m = String(model || '');
  if (!m) return null;
  // The user's own declaration for THIS provider wins outright — see above.
  const declared = userConfigContextWindow(m, provider);
  if (declared) return declared;

  const l = limits();
  if (!l) return null;
  if (provider) {
    const exact = l.byPair[`${String(provider)}/${m}`];
    if (exact) return exact;
  }
  return (l.byModel && l.byModel[m]) || null;
}

/** Drop the in-process memos. Tests only — each tick is a fresh process. */
function _resetForTests() {
  _memo = null;
  _userMemo = undefined;
}

module.exports = {
  catalogueContextWindow,
  catalogueSourcePath,
  catalogueCachePath,
  deriveLimits,
  FALLBACK_PROVIDERS,
  _resetForTests,
};
