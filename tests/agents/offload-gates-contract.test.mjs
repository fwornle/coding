/**
 * Contract test for the dashboard's offload-gate mirror.
 *
 * `src/components/llm-routing/offload-gates.ts` duplicates the offload block of
 * rapid-llm-proxy's `resolveRoute()`. The duplicate exists for one reason: the
 * diagram must answer "what WOULD happen" for a policy the operator is editing
 * and has not saved, which `/api/llm/routing/resolve` cannot know about.
 *
 * A duplicate of routing logic is exactly the thing this codebase argues against
 * everywhere else, so it is allowed only while something proves it still agrees
 * with the original. That is this file: for EVERY route in the live config, it
 * asks the proxy and the mirror the same question and requires the same answer —
 * the provider that ends up serving, and whether the offload moved it.
 *
 * Fixtures would not do here. The failure this guards against is the proxy
 * changing and the mirror not following, and a fixture written today would agree
 * with a mirror written today forever.
 *
 * Skips when the proxy is not running, so a CI box without the daemon reports
 * "skipped", not "passed".
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PORT = process.env.LLM_CLI_PROXY_PORT || '12435';
const BASE = `http://127.0.0.1:${PORT}`;
const SRC = path.resolve(
  import.meta.dirname, '..', '..',
  'integrations/system-health-dashboard/src/components/llm-routing/offload-gates.ts');

let gates = null;
let config = null;
let reachable = false;

/** Transpile the TS module so node can import it. esbuild is already a dashboard dep. */
async function loadGates() {
  const esbuild = require('/Users/Q284340/Agentic/coding/integrations/system-health-dashboard/node_modules/esbuild');
  const out = esbuild.transformSync(fs.readFileSync(SRC, 'utf8'), { loader: 'ts', format: 'esm' });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gates-')), 'offload-gates.mjs');
  fs.writeFileSync(tmp, out.code);
  return import(tmp);
}

before(async () => {
  try {
    const r = await fetch(`${BASE}/api/llm/routing`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return;
    config = await r.json();
    gates = await loadGates();
    reachable = true;
  } catch {
    reachable = false;
  }
});

describe('offload-gates mirrors the proxy', () => {
  test('every live route resolves identically in both', async (t) => {
    if (!reachable) return t.skip('proxy not reachable on :12435');

    const policy = config.semanticRouting;
    // fg_transport is not in the trimmed provider catalogue the API returns, and
    // only claude-code-max has ever carried one. Naming it explicitly is honest
    // about the limit; getting it wrong can only UNDER-report gate 5.
    const hasFgTransport = (id) => id === 'claude-code-max';

    const entries = [
      ...Object.entries(config.routes).map(([k, v]) => ({ key: k, entry: v })),
      ...Object.entries(config.defaults).map(([cls, v]) => ({
        key: cls === 'fg-chat' ? 'fg-chat' : 'bg-__unrouted__', entry: v,
      })),
    ];

    const disagreements = [];
    for (const network of ['public', 'corporate']) {
      for (const { key, entry } of entries) {
        const isFg = key.startsWith('fg-chat');
        const qs = new URLSearchParams({ job: isFg ? 'fg-chat' : key, network });
        if (isFg && key.includes('/')) qs.set('agent', key.split('/')[1]);
        // `from-caller` routes need a concrete band before either side can decide;
        // supply one so the comparison is of the OFFLOAD logic, not of defaulting.
        const band = entry.complexity === 'from-caller' ? 'small' : entry.complexity;
        if (entry.complexity === 'from-caller') qs.set('complexity', 'small');

        const res = await fetch(`${BASE}/api/llm/routing/resolve?${qs}`);
        const proxy = await res.json();

        const mine = gates.evaluateOffload(policy, entry, key, band, network, hasFgTransport);

        if (mine.provider !== proxy.route.provider
            || (mine.offloadedFrom ?? null) !== (proxy.route.offloadedFrom ?? null)) {
          disagreements.push(
            `${network} ${key}: mirror says ${mine.provider}`
            + `${mine.offloadedFrom ? ` (offloaded from ${mine.offloadedFrom})` : ''}`
            + `, proxy says ${proxy.route.provider}`
            + `${proxy.route.offloadedFrom ? ` (offloaded from ${proxy.route.offloadedFrom})` : ''}`
            + `${proxy.route.offloadSkipped ? ` — ${proxy.route.offloadSkipped}` : ''}`);
        }
      }
    }

    assert.deepEqual(disagreements, [],
      `the diagram would draw a different decision than the proxy makes:\n  ${disagreements.join('\n  ')}`);
  });

  test('every reason the proxy is currently emitting maps to a rung', async (t) => {
    if (!reachable) return t.skip('proxy not reachable on :12435');
    const r = await fetch(`${BASE}/api/llm/routing/behaviour?hours=168`);
    const b = await r.json();
    const unclassified = (b.offloadSkips ?? [])
      .filter((s) => gates.rungOfReason(s.reason) === 'unclassified')
      .map((s) => `${s.reason} (×${s.count})`);
    // Not a hard failure of the UI — unclassified renders as its own visible row
    // rather than being silently folded into a neighbour — but it means the proxy
    // has grown a reason string this file has not been taught.
    assert.deepEqual(unclassified, [],
      `offloadSkips reasons with no rung:\n  ${unclassified.join('\n  ')}`);
  });

  test('the ladder is ordered as the proxy short-circuits', async (t) => {
    if (!reachable) return t.skip('proxy not reachable on :12435');
    // Band BEFORE target, and target fusing network-match with enabled, are the
    // two orderings a tidier-looking ladder would get wrong — and would then
    // blame the wrong gate for real recorded calls.
    assert.deepEqual(gates.GATES.map((g) => g.id),
      ['considered', 'route-allows', 'band', 'target', 'scope', 'transport', 'offloaded']);
  });
});
