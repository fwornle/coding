/**
 * Locks in scripts/audit-agent-model-catalogue.mjs — the check that an agent's
 * declared model ids exist in the provider catalogue the proxy will apply.
 *
 * Why a check was needed at all: /api/complete builds its upstream call as
 * `{ ...body, model: routedModel }`, so a model id an agent asks for is
 * DISCARDED and replaced by whatever (provider, band) resolves to. A wrong id
 * therefore never 400s and never warns — it simply has no effect, while still
 * appearing in the agent's picker as though it were a choice. On 2026-08-29
 * opencode offered four such ids (opus-4.6/4.8/4.5, sonnet-4.5) against a
 * gh-copilot leg that rejects every opus id.
 *
 * Fixtures throughout: the real ~/.config/opencode/opencode.json is a user file
 * that need not exist, and pinning the audit to the live llm-routing.yaml would
 * make this suite fail whenever a vendor catalogue legitimately changes. What is
 * asserted here is that the CHECKER works — clean passes, drift fails, and the
 * failure names the id and the file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'audit-agent-model-catalogue.mjs');

const ROUTING = `version: 1

providers:

  gh-copilot:
    account: copilot-subscription
    impl: copilot
    available_models:
      - claude-haiku-4.5
      - claude-sonnet-5
    models:
      small: claude-haiku-4.5
      high: claude-sonnet-5

  qwen-laptop:
    account: on-device
    impl: qwen-laptop
    available_models:
      - qwen3.8-27b-local
    models:
      small: qwen3.8-27b-local

  gaia:
    account: corporate-api
    impl: gaia
    available_models: []
    models: {}

routes: {}
`;

function withFixtures(models, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-cat-'));
  try {
    const yaml = path.join(dir, 'llm-routing.yaml');
    fs.writeFileSync(yaml, ROUTING);
    const oc = path.join(dir, 'opencode.json');
    fs.writeFileSync(oc, JSON.stringify({
      provider: {
        'rapid-proxy': {
          options: { baseURL: 'http://localhost:12435/v1' },
          models: Object.fromEntries(models.map(m => [m, {}])),
        },
        // Not proxy-fronted: Copilot's own catalogue does serve opus, and this
        // audit is about agreement with the PROXY, not a universal registry.
        'github-copilot': {
          options: { baseURL: 'https://api.githubcopilot.com' },
          models: { 'claude-opus-4.6': {} },
        },
      },
    }));
    return run({ env: { LLM_ROUTING_YAML: yaml, OPENCODE_CONFIG_PATH: oc, CODING_REPO: dir } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function audit(env) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      encoding: 'utf8', env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('audit-agent-model-catalogue', () => {
  it('passes when every declared id is in the catalogue', () => {
    const r = withFixtures(['claude-haiku-4.5', 'claude-sonnet-5'], ({ env }) => audit(env));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK/);
  });

  it('fails on an id the proxy leg cannot serve, and names it', () => {
    // The exact 2026-08-29 drift: an opus id on a gh-copilot-backed provider.
    const r = withFixtures(['claude-haiku-4.5', 'claude-opus-4.6'], ({ env }) => audit(env));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /claude-opus-4\.6/);
    assert.match(r.out, /gh-copilot\.available_models/);
    // Naming the file matters: the id appears in several configs and the reader
    // has to know which one to edit.
    assert.match(r.out, /opencode\.json/);
  });

  it('ignores providers that do not point at the proxy', () => {
    // github-copilot in the fixture declares claude-opus-4.6, which is NOT in
    // gh-copilot.available_models. It must not be reported: that provider talks
    // to Copilot's own endpoint, whose catalogue does include opus.
    const r = withFixtures(['claude-haiku-4.5'], ({ env }) => audit(env));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /claude-opus-4\.6/);
  });

  it('treats an empty catalogue as constraining nothing', () => {
    // `gaia` ships available_models: [] on purpose — nothing has been probed
    // against it. That must read as "unknown", not "nothing is allowed".
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-cat-'));
    try {
      const yaml = path.join(dir, 'llm-routing.yaml');
      fs.writeFileSync(yaml, ROUTING);
      const oc = path.join(dir, 'opencode.json');
      fs.writeFileSync(oc, JSON.stringify({ provider: {} }));
      const r = audit({ LLM_ROUTING_YAML: yaml, OPENCODE_CONFIG_PATH: oc, CODING_REPO: dir });
      assert.equal(r.code, 0, r.out);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
