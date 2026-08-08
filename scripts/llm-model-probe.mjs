#!/usr/bin/env node
/**
 * Discover which models each provider on the LLM proxy will ACTUALLY serve.
 *
 *   scripts/llm-model-probe.mjs                        # every provider, catalog + aliases
 *   scripts/llm-model-probe.mjs --provider claude-code
 *   scripts/llm-model-probe.mjs --models claude-opus-5,opus --provider claude-code
 *   scripts/llm-model-probe.mjs --show                 # last result, no calls
 *
 * WHY THIS EXISTS
 *
 * Neither the catalog nor the request can be trusted, and they fail in OPPOSITE
 * directions — so the only way to know what a provider serves is to ask it:
 *
 *   - `providerModels` ADVERTISES models a provider rejects. It lists
 *     `claude-opus-4.6` for copilot, which answers `400 The requested model is not
 *     supported`.
 *   - `providerModels` OMITS models a provider serves. It never lists any Opus 5,
 *     yet `claude -p --model claude-opus-5` is answered by claude-opus-5 on the Max
 *     subscription.
 *   - `/api/complete` IGNORES the request-body `model` outright. Only a
 *     processOverrides entry, keyed on the `process` literal, selects a model.
 *   - Names are spelled three ways for one model: `claude-haiku-4.5` (catalog),
 *     `claude-haiku-4-5-20251001` (response), `haiku` (CLI alias). Comparing raw
 *     strings reports a substitution that did not happen.
 *
 * The consequence of not having this: kgbench's judge requested `claude-opus-4.8`
 * for runs r6 and r7 and was answered by claude-haiku-4-5 every time, while
 * run.json published the requested name. Nothing in the stack objected.
 *
 * HOW IT PROBES
 *
 * A model cannot be selected per request, so each candidate is probed by installing
 * a processOverride on a dedicated `model-probe` process, reading the setting back to
 * confirm it landed, then sending a trivial completion and recording the `model` the
 * response reports. Probes are SERIALISED because they share that one override key —
 * running them concurrently makes each probe read whichever override won the race,
 * which is how a hand-probe session produced three mutually contradictory answers.
 *
 * The probe key is removed on exit, including on error, so a crashed probe cannot
 * leave a stray override that silently reroutes a later run.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.LLM_PROXY_PORT || '12435';
const BASE = `http://127.0.0.1:${PORT}`;
const SETTINGS = `${BASE}/api/llm/settings`;
const COMPLETE = `${BASE}/api/complete`;
const PROBE_PROCESS = 'model-probe';
const OUT_PATH = path.join(REPO_ROOT, '.data', 'llm-proxy', 'model-availability.json');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const out = (s) => console.log(s);

/**
 * Collapse the spellings of one model to a single comparable name.
 *
 * Rules, matching how the proxy and the CLIs actually differ:
 *   - lowercase
 *   - drop a trailing dated snapshot: `claude-haiku-4-5-20251001` -> `claude-haiku-4-5`
 *   - version separator to a dot: `claude-haiku-4-5` -> `claude-haiku-4.5`
 *   - bare tier aliases are NOT concrete models; they are marked `tier:<name>` so a
 *     probe of `opus` is never reported as equal to whatever concrete model answered it
 */
export function canonicalModel(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (/^(sonnet|haiku|opus|fast|standard|premium)$/.test(s)) return `tier:${s}`;
  return s.replace(/-\d{8}$/, '').replace(/(\d)-(\d)/g, '$1.$2');
}

const getSettings = async () => {
  const r = await fetch(SETTINGS);
  if (!r.ok) throw new Error(`GET settings -> ${r.status}`);
  const b = await r.json();
  return b.settings ?? b;
};

const putSettings = async (s) => {
  const r = await fetch(SETTINGS, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
  if (!r.ok) throw new Error(`PUT settings -> ${r.status} ${(await r.text()).slice(0, 200)}`);
};

/** Install the probe override and confirm by read-back that it is the live value. */
async function armProbe(provider, model) {
  const cur = await getSettings();
  const overrides = { ...(cur.processOverrides ?? {}), [PROBE_PROCESS]: { provider, model } };
  await putSettings({ ...cur, processOverrides: overrides });
  const back = (await getSettings()).processOverrides?.[PROBE_PROCESS];
  if (back?.provider !== provider || back?.model !== model) {
    throw new Error(`override did not land: wanted ${provider}/${model}, read back ${back?.provider}/${back?.model}`);
  }
}

async function clearProbe() {
  try {
    const cur = await getSettings();
    const overrides = { ...(cur.processOverrides ?? {}) };
    delete overrides[PROBE_PROCESS];
    await putSettings({ ...cur, processOverrides: overrides });
  } catch (err) {
    // Loud, because a leftover override silently reroutes whatever runs next.
    console.error(`llm-model-probe: FAILED to remove the '${PROBE_PROCESS}' override: ${err.message}`);
    console.error('llm-model-probe: remove it by hand before trusting any later run.');
  }
}

async function probeOnce(provider, model, timeoutMs) {
  await armProbe(provider, model);
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(COMPLETE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ process: PROBE_PROCESS, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await res.json().catch(() => null);
  } catch (err) {
    return { requested: model, provider, served: null, ok: false, error: `unreachable: ${err.message}`, latencyMs: Date.now() - t0 };
  }
  const latencyMs = Date.now() - t0;
  if (body?.error) return { requested: model, provider, served: null, ok: false, error: String(body.error).slice(0, 160), latencyMs };
  const served = body?.model ?? null;
  const servedProvider = body?.provider ?? null;
  // "Served" is only the same model if it canonicalises the same. A tier alias never
  // equals a concrete model, so `opus` answered by claude-opus-5 is recorded as a
  // resolution (alias -> concrete), not as an exact match.
  const same = served != null && canonicalModel(served) === canonicalModel(model);
  return {
    requested: model,
    provider,
    served,
    served_provider: servedProvider,
    canonical_requested: canonicalModel(model),
    canonical_served: canonicalModel(served),
    ok: served != null,
    exact: same,
    error: null,
    latencyMs,
  };
}

// ---- candidates -------------------------------------------------------------
// The catalog is a starting point, not the truth: it both over- and under-reports.
// Tier aliases are probed too, because they are what the CLIs natively accept and are
// the only way to reach "whatever the current top model is" without pinning a version.
const EXTRA_CANDIDATES = ['sonnet', 'haiku', 'opus', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4.5'];

async function main() {
  if (flag('show')) {
    if (!existsSync(OUT_PATH)) { out(`llm-model-probe: no cached result at ${OUT_PATH}; run without --show first.`); process.exit(1); }
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    out(`llm-model-probe: cached ${prev.probedAt} (${prev.results.length} probe(s))`);
    render(prev.results);
    return;
  }

  const settings = await getSettings();
  const catalog = settings.providerModels ?? {};
  const onlyProvider = opt('provider', null);
  const onlyModels = opt('models', null)?.split(',').map((s) => s.trim()).filter(Boolean);
  const timeoutMs = parseInt(opt('timeout', '240000'), 10);

  const providers = (onlyProvider ? [onlyProvider] : Object.keys(catalog))
    // Only providers the proxy reports as available; probing a dead provider measures nothing.
    .filter((p) => onlyProvider || (settings.providers?.[p]?.available ?? true));

  const plan = [];
  for (const p of providers) {
    const models = onlyModels ?? [...new Set([...(catalog[p] ?? []), ...EXTRA_CANDIDATES])];
    for (const m of models) plan.push([p, m]);
  }

  out(`llm-model-probe: ${plan.length} probe(s) across ${providers.length} provider(s), serialised.`);
  out('llm-model-probe: the catalog is not evidence — this asks each provider directly.');
  out('');

  // Each candidate is probed MORE THAN ONCE, because the answer is not stable. The first
  // observed run of this prober reported claude-code/claude-opus-5 as served by haiku; the
  // second, on identical settings, was served by claude-opus-5. A cold model appears to
  // fall back until something upstream warms, so a single probe produces a truth table
  // that is confidently wrong. Disagreement across repeats is itself the finding and is
  // reported as `unstable` rather than silently resolved by taking the last answer.
  const repeats = Math.max(1, parseInt(opt('repeats', '2'), 10));
  const results = [];
  try {
    for (const [p, m] of plan) {
      const obs = [];
      for (let i = 0; i < repeats; i++) obs.push(await probeOnce(p, m, timeoutMs));
      const servedSet = [...new Set(obs.map((o) => o.canonical_served ?? `error:${o.error}`))];
      const stable = servedSet.length === 1;
      // On disagreement prefer a concrete success over a fallback/error: the warm answer is
      // what the provider CAN serve, which is the question being asked. The instability is
      // preserved in `observed` so the reader is never told a flapping result is settled.
      const best = obs.find((o) => o.exact) ?? obs.find((o) => o.ok) ?? obs[obs.length - 1];
      const r = { ...best, stable, repeats, observed: obs.map((o) => o.served ?? `error:${o.error}`) };
      results.push(r);
      const verdict = r.error ? `REJECTED (${r.error})`
        : r.exact ? `ok -> ${r.served}`
        : `RESOLVED -> ${r.served}`;
      out(`  ${p.padEnd(12)} ${String(m).padEnd(26)} ${verdict}${stable ? '' : `  [UNSTABLE: ${r.observed.join(' | ')}]`}  ${r.latencyMs}ms`);
    }
  } finally {
    await clearProbe();
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    probedAt: new Date().toISOString(),
    proxy: BASE,
    note: 'Probed, not read from providerModels. The catalog both over- and under-reports.',
    results,
  }, null, 2) + '\n');

  out('');
  render(results);
  out('');
  out(`llm-model-probe: wrote ${path.relative(REPO_ROOT, OUT_PATH)}`);
}

function render(results) {
  const byProvider = {};
  for (const r of results) (byProvider[r.provider] ??= []).push(r);
  for (const [p, rs] of Object.entries(byProvider)) {
    const served = rs.filter((r) => r.ok);
    const concrete = [...new Set(served.map((r) => r.canonical_served))].sort();
    out(`${p}:`);
    out(`  serves            ${concrete.join(', ') || '(nothing)'}`);
    const rejected = rs.filter((r) => !r.ok).map((r) => r.requested);
    if (rejected.length) out(`  rejects           ${rejected.join(', ')}`);
    const unstable = rs.filter((r) => r.stable === false);
    if (unstable.length) {
      out('  UNSTABLE — the same request was answered differently across repeats:');
      for (const r of unstable) out(`    ${r.requested}  ->  ${r.observed.join(' | ')}`);
    }
    // The dangerous case: a request that succeeds but is answered by a DIFFERENT model.
    const substituted = served.filter((r) => !r.exact && !String(r.requested).startsWith('tier:') && canonicalModel(r.requested) !== r.canonical_served);
    const silent = substituted.filter((r) => !/^(sonnet|haiku|opus|fast|standard|premium)$/.test(String(r.requested).toLowerCase()));
    if (silent.length) {
      out('  SILENT SUBSTITUTION — asked for one model, answered by another:');
      for (const r of silent) out(`    ${r.requested}  ->  ${r.served}`);
    }
  }
}

// Run ONLY when invoked as a script. Without this guard, `import`ing the module to reuse
// canonicalModel() fires the whole probe matrix as a side effect — which it did, costing 42
// live model calls and, by accident, revealing that the results are not deterministic.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => { console.error(`llm-model-probe: ${err.message}`); clearProbe().finally(() => process.exit(1)); });
}
