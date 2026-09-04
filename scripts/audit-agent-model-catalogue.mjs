#!/usr/bin/env node
/**
 * Audit every agent-side model id against the provider catalogue in
 * rapid-llm-proxy's config/llm-routing.yaml.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The proxy already validates its OWN config at boot: a `models:` band table
 * naming an id outside that provider's `available_models` is refused, which is
 * how a stale id is caught the moment a vendor retires it.
 *
 * That check stops at the proxy boundary. The AGENTS declare model ids too —
 * opencode in its provider blocks, pi in its generated models.json, the
 * launchers in their pins — and nothing compared those against the catalogue.
 * Worse, nothing ever could complain at runtime: /api/complete builds its
 * upstream call as `{ ...body, model: routedModel }`, so the caller's requested
 * model is DISCARDED and replaced by whatever (provider, band) resolves to. A
 * wrong id there does not 400. It does not warn. It simply has no effect, while
 * continuing to appear in the agent's model picker as though it were a choice.
 *
 * Measured on 2026-08-29, that is exactly what had happened:
 *   • opencode offered rapid-proxy/claude-opus-4.6, -4.8, -4.5 and sonnet-4.5 —
 *     four ids the proxy's gh-copilot leg rejects outright ("400 The requested
 *     model is not supported" for every opus id, re-probed 2026-08-15)
 *   • config/agents/opencode.sh pinned github-copilot-enterprise/claude-opus-4.6
 *     on VPN and claude-opus-4-6 off it — two providers `opencode models` lists
 *     ZERO ids for, i.e. neither exists
 *
 * ── What is deliberately NOT audited ────────────────────────────────────────
 * A provider that does not go through the proxy is out of scope: opencode's
 * `github-copilot` (Copilot's own catalogue, which does serve opus) and
 * `qwen-laptop` (a local box with its own single id). They are checked against
 * their own endpoint or not at all — the point here is agreement with the
 * catalogue the PROXY will apply, not a universal model registry.
 *
 * Foreground claude is also out of scope, and cannot be brought in: /v1/messages
 * is a verbatim Anthropic-protocol passthrough that never rewrites body.model, so
 * Claude Code's own model selection goes on the wire and `available_models`
 * constrains nothing there by construction.
 *
 * Exit 0 = every audited id is in its provider's catalogue. Exit 1 = at least
 * one is not, and each is named with the file it came from.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.env.CODING_REPO || path.resolve(import.meta.dirname, '..');
// Sibling checkout: <parent>/_work/rapid-llm-proxy.
const ROUTING_YAML = process.env.LLM_ROUTING_YAML
  || path.resolve(REPO, '..', '_work', 'rapid-llm-proxy', 'config', 'llm-routing.yaml');
const OPENCODE_JSON = process.env.OPENCODE_CONFIG_PATH
  || path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

/**
 * Parse `providers.<id>.available_models` out of llm-routing.yaml.
 *
 * Deliberately a small regex reader rather than a yaml dependency: this script
 * has to run from a bare checkout, before any npm install, and the shape it
 * reads is two levels deep and fully indentation-determined. If the file will
 * not parse the proxy refuses to boot, so a malformed file is not this script's
 * failure mode to handle.
 */
function catalogue(yamlText) {
  const out = new Map();
  let inProviders = false;
  let provider = null;
  let collecting = false;
  for (const raw of yamlText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^providers:\s*$/.test(line)) { inProviders = true; continue; }
    if (!inProviders) continue;
    // Any key at column 0 ends the providers block.
    if (/^[a-z_]/i.test(line)) break;
    const prov = line.match(/^ {2}([a-z0-9-]+):\s*$/);
    if (prov) { provider = prov[1]; collecting = false; if (!out.has(provider)) out.set(provider, []); continue; }
    if (!provider) continue;
    if (/^ {4}available_models:\s*(\[\s*\])?\s*$/.test(line)) { collecting = true; continue; }
    if (collecting) {
      const item = line.match(/^ {6}- (.+?)\s*$/);
      if (item) { out.get(provider).push(item[1]); continue; }
      if (line.trim() !== '') collecting = false;
    }
  }
  return out;
}

const findings = [];
const checked = [];

function check(where, provider, ids, cat) {
  const known = cat.get(provider);
  if (!known) {
    findings.push(`${where}: provider "${provider}" is not declared in llm-routing.yaml`);
    return;
  }
  if (known.length === 0) return; // empty catalogue constrains nothing (see `gaia`)
  for (const id of ids) {
    checked.push(`${provider}/${id}`);
    if (!known.includes(id)) {
      findings.push(`${where}: "${id}" is not in ${provider}.available_models [${known.join(', ')}]`);
    }
  }
}

const cat = catalogue(fs.readFileSync(ROUTING_YAML, 'utf8'));

// ── opencode: only providers that POINT AT the proxy ────────────────────────
// Matched by base URL rather than by provider name, so renaming the provider
// block cannot quietly drop it out of the audit.
if (fs.existsSync(OPENCODE_JSON)) {
  const oc = JSON.parse(fs.readFileSync(OPENCODE_JSON, 'utf8'));
  const port = process.env.LLM_CLI_PROXY_PORT || '12435';
  for (const [pid, p] of Object.entries(oc.provider || {})) {
    const url = p?.options?.baseURL || '';
    if (!url.includes(`:${port}`)) continue;
    // A proxy-fronted opencode provider serves fg-chat/opencode, which
    // llm-routing.yaml routes to gh-copilot.
    check(`${OPENCODE_JSON} provider.${pid}`, 'gh-copilot', Object.keys(p.models || {}), cat);
  }
}

// ── pi: the ids its launcher writes into models.json ────────────────────────
// Read out of the heredoc in config/agents/pi.sh rather than a generated file,
// so the audit works without having launched pi.
const piSh = path.join(REPO, 'config', 'agents', 'pi.sh');
if (fs.existsSync(piSh)) {
  const src = fs.readFileSync(piSh, 'utf8');
  const proxyIds = [...src.matchAll(/"id":\s*"([^"]+)"/g)].map(m => m[1]);
  // qwen3.8-27b-local belongs to the laptop provider, not the proxy one.
  check(`${piSh} models.json`, 'gh-copilot', proxyIds.filter(id => !id.startsWith('qwen')), cat);
  check(`${piSh} models.json`, 'qwen-laptop', proxyIds.filter(id => id.startsWith('qwen')), cat);
}

// ── launcher pins ───────────────────────────────────────────────────────────
// Any `<provider>/<model>` literal pinned in an agent config is a claim about
// the catalogue and is audited as one.
for (const f of ['opencode.sh', 'copilot.sh', 'claude.sh', 'pi.sh']) {
  const fp = path.join(REPO, 'config', 'agents', f);
  if (!fs.existsSync(fp)) continue;
  const src = fs.readFileSync(fp, 'utf8');
  for (const m of src.matchAll(/"model"\s*:\s*"([a-z0-9-]+)\/([^"]+)"/g)) {
    const [, prov, model] = m;
    if (prov === 'rapid-proxy') check(`${fp} pin`, 'gh-copilot', [model], cat);
  }
}

const label = `${checked.length} model id(s) across ${new Set(checked.map(c => c.split('/')[0])).size} provider(s)`;
if (findings.length) {
  process.stdout.write(`agent-model-catalogue: FAIL — checked ${label}\n`);
  for (const f of findings) process.stdout.write(`  ✗ ${f}\n`);
  process.exit(1);
}
process.stdout.write(`agent-model-catalogue: OK — ${label} all present in llm-routing.yaml\n`);
