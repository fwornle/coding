/**
 * Unit suite for config/prompt-classifier.yaml — the judge's own configuration.
 *
 * ── What this file is defending ─────────────────────────────────────────────
 * Until 2026-09-02 the prompt classifier asked ONE endpoint, taken from an env
 * var at boot: llama.cpp on this laptop. That day, inside the corporate network,
 * two `--pi` turns ran on gh-copilot/claude-sonnet-5 and recorded
 * `classifier error: classifier HTTP 502` — the judge had dialled the laptop,
 * which was not running, while the offload DESTINATION for that network (the
 * on-prem cluster) was up, enabled and reachable throughout. The judge was the
 * only part of the path that could not follow the machine between networks.
 *
 * So `backends` is now an ordered, network-guarded list, and the properties
 * worth pinning are the ones that decide whether a verdict happens at all:
 *
 *   - the right backend is picked for the network, and ONLY that one
 *   - a config that can only mislead is refused, naming the key
 *   - "switched off" and "not answering" stay distinguishable, because their
 *     fixes are opposite
 *
 * Every rejection is asserted to NAME the offending key. A validator that says
 * "invalid config" sends someone to read the whole file; the proxy's
 * parseRoutingConfig set that convention and this follows it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import {
  parsePromptClassifierConfig,
  candidatesForNetwork,
  normalizeNetwork,
  describeBackends,
} from '../../scripts/lib/prompt-classifier-config.mjs';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The shipping shape: one backend per network, cluster first. */
const BOTH_NETWORKS = () => ({
  backends: [
    {
      id: 'qwen-local',
      base_url: 'http://10.143.241.223:8000/v1',
      model: 'qwen3.8-27b-dual-fast',
      api_key_env: 'QWEN_LOCAL_API_KEY',
      require_network: 'corporate',
      enabled: true,
      timeout_ms: 15000,
    },
    {
      id: 'qwen-laptop',
      base_url: 'http://127.0.0.1:8081/v1',
      model: 'qwen3.8-27b-local',
      require_network: 'public',
      enabled: true,
      timeout_ms: 15000,
    },
  ],
  rubric: 'You route requests to a model tier. Answer with EXACTLY one word: small, medium, or high.\n',
});

/** Apply a mutation to a fresh copy, so no test can leak into the next. */
const withDoc = (mut) => {
  const doc = BOTH_NETWORKS();
  mut(doc);
  return doc;
};

const throwsNaming = (doc, needle) =>
  assert.throws(
    () => parsePromptClassifierConfig(doc),
    (e) => {
      assert.match(e.message, needle, `message should name the offending key: ${e.message}`);
      return true;
    },
  );

// ── The file that ships ──────────────────────────────────────────────────────

describe('the checked-in config is valid and says what it means to', () => {
  it('parses, and declares exactly one backend per network', () => {
    // Reads the real file rather than a fixture. A fixture written today would
    // agree with itself forever; the thing worth knowing is whether the file the
    // service will actually load is loadable.
    const p = path.resolve(import.meta.dirname, '../../config/prompt-classifier.yaml');
    const cfg = parsePromptClassifierConfig(parse(fs.readFileSync(p, 'utf8')));
    assert.equal(cfg.backends.length, 2);
    assert.deepEqual(candidatesForNetwork(cfg.backends, 'corporate').map(b => b.id), ['qwen-local']);
    assert.deepEqual(candidatesForNetwork(cfg.backends, 'public').map(b => b.id), ['qwen-laptop']);
  });

  it('ships a rubric that defines all three bands', () => {
    const p = path.resolve(import.meta.dirname, '../../config/prompt-classifier.yaml');
    const { rubric } = parsePromptClassifierConfig(parse(fs.readFileSync(p, 'utf8')));
    // The calibration measured on 2026-08-30: with a bare "how hard is this?"
    // prompt "how many r's in strawberry" came back `medium`; with the three
    // definition lines it came back `small`. Losing one of them is a silent
    // recalibration of every agent at once.
    for (const band of ['small', 'medium', 'high']) {
      assert.match(rubric, new RegExp(`^${band}\\s*=`, 'm'), `rubric must define "${band}"`);
    }
  });
});

// ── Selection ────────────────────────────────────────────────────────────────

describe('backend selection follows the machine between networks', () => {
  it('picks the backend guarded to the live network, and only that one', () => {
    const { backends } = parsePromptClassifierConfig(BOTH_NETWORKS());
    assert.deepEqual(candidatesForNetwork(backends, 'corporate').map(b => b.id), ['qwen-local']);
    assert.deepEqual(candidatesForNetwork(backends, 'public').map(b => b.id), ['qwen-laptop']);
  });

  it('treats vpn as corporate, and anything unrecognised as public', () => {
    // Failing toward `public` is the safe direction: it declines to dial a
    // LAN-only endpoint, and to attach a corporate bearer, from a network that
    // could not be confirmed.
    assert.equal(normalizeNetwork('vpn'), 'corporate');
    assert.equal(normalizeNetwork('corporate'), 'corporate');
    assert.equal(normalizeNetwork('cafe-wifi'), 'public');
    assert.equal(normalizeNetwork(undefined), 'public');
    const { backends } = parsePromptClassifierConfig(BOTH_NETWORKS());
    assert.deepEqual(candidatesForNetwork(backends, 'vpn').map(b => b.id), ['qwen-local']);
  });

  it('an unguarded backend matches every network', () => {
    const { backends } = parsePromptClassifierConfig(withDoc((d) => {
      d.backends = [{ id: 'anywhere', base_url: 'http://127.0.0.1:9/v1', model: 'm' }];
    }));
    assert.deepEqual(candidatesForNetwork(backends, 'corporate').map(b => b.id), ['anywhere']);
    assert.deepEqual(candidatesForNetwork(backends, 'public').map(b => b.id), ['anywhere']);
  });

  it('a disabled backend is not a candidate — and that is not the same as unreachable', () => {
    // The distinction the /health shape exists to preserve. "Off" is a decision
    // and "not answering" is a fault; only the second is worth retrying past,
    // and only the first is fixed by a click.
    const { backends } = parsePromptClassifierConfig(withDoc((d) => { d.backends[1].enabled = false; }));
    assert.deepEqual(candidatesForNetwork(backends, 'public'), []);
    assert.match(describeBackends(backends), /qwen-laptop\[public\] \(off\)/);
  });

  it('reports NO candidate rather than falling back across networks', () => {
    // The failure this whole file exists for is the opposite of this: the judge
    // reaching for a box on the wrong network. No verdict is correct here; the
    // proxy fails open and the caller's band stands.
    const { backends } = parsePromptClassifierConfig(withDoc((d) => { d.backends.pop(); }));
    assert.deepEqual(candidatesForNetwork(backends, 'public'), []);
    assert.deepEqual(candidatesForNetwork(backends, 'corporate').map(b => b.id), ['qwen-local']);
  });

  it('preserves declaration order, so "first match wins" is the operator\'s', () => {
    const { backends } = parsePromptClassifierConfig(withDoc((d) => {
      d.backends = [
        { id: 'first', base_url: 'http://127.0.0.1:1/v1', model: 'm', require_network: 'public' },
        { id: 'catch-all', base_url: 'http://127.0.0.1:2/v1', model: 'm' },
      ];
    }));
    assert.deepEqual(candidatesForNetwork(backends, 'public').map(b => b.id), ['first', 'catch-all']);
  });
});

// ── Rejections ───────────────────────────────────────────────────────────────

describe('refuses a config that can only mislead, naming the key', () => {
  it('two backends claiming one network — the second can never be reached', () => {
    throwsNaming(withDoc((d) => { d.backends[1].require_network = 'corporate'; }), /backends\[1\]/);
  });

  it('an unguarded backend above a guarded one — same reason', () => {
    throwsNaming(withDoc((d) => { delete d.backends[0].require_network; }), /backends\[1\]/);
  });

  it('a duplicate id', () => {
    throwsNaming(withDoc((d) => { d.backends[1].id = 'qwen-local'; }), /backends\[1\]\.id/);
  });

  it('an unknown network', () => {
    throwsNaming(withDoc((d) => { d.backends[0].require_network = 'vpn'; }), /require_network/);
  });

  it('a missing or non-http base_url', () => {
    throwsNaming(withDoc((d) => { delete d.backends[0].base_url; }), /base_url/);
    throwsNaming(withDoc((d) => { d.backends[0].base_url = 'localhost:8081'; }), /base_url/);
  });

  it('a missing model', () => {
    throwsNaming(withDoc((d) => { delete d.backends[0].model; }), /model/);
  });

  it('a non-boolean enabled, with no coercion', () => {
    // `enabled: "false"` is a truthy string. Reading it as ON would be the exact
    // opposite of what was written, which is worse than refusing it.
    throwsNaming(withDoc((d) => { d.backends[0].enabled = 'false'; }), /enabled/);
  });

  it('a timeout that looks like seconds, and one longer than the call it fronts', () => {
    throwsNaming(withDoc((d) => { d.backends[0].timeout_ms = 15; }), /timeout_ms/);
    throwsNaming(withDoc((d) => { d.backends[0].timeout_ms = 600000; }), /timeout_ms/);
  });

  it('an empty or missing rubric — the judge would be asked nothing', () => {
    throwsNaming(withDoc((d) => { d.rubric = '   '; }), /rubric/);
    throwsNaming(withDoc((d) => { delete d.rubric; }), /rubric/);
  });

  it('an empty backends list, and a non-list', () => {
    throwsNaming(withDoc((d) => { d.backends = []; }), /backends/);
    throwsNaming(withDoc((d) => { d.backends = { qwen: {} }; }), /backends/);
  });

  it('an api_key_env holding a secret instead of a variable name', () => {
    // Only the NAME belongs here. The check cannot tell a key from a name, but
    // it can refuse the empty and non-string cases that a paste-gone-wrong
    // produces, and the message says which is wanted.
    throwsNaming(withDoc((d) => { d.backends[0].api_key_env = ''; }), /api_key_env/);
  });

  it('near-miss key names, rather than silently ignoring them', () => {
    // A typo that parses as "absent" is the failure mode the whole style exists
    // to prevent: the field appears configured and does nothing.
    const typos = [
      ['url', (d) => { d.backends[0].url = 'http://x/v1'; }],
      ['enable', (d) => { d.backends[0].enable = true; }],
      ['timeout', (d) => { d.backends[0].timeout = 5000; }],
      ['network', (d) => { d.backends[0].network = 'corporate'; }],
      ['prompt', (d) => { d.prompt = 'hello'; }],
    ];
    for (const [key, mut] of typos) {
      throwsNaming(withDoc(mut), new RegExp(key));
    }
  });
});
