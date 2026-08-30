// tests/agents/opencode-anthropic-native-splice.test.mjs
//
// Behavioral test for the OPENCODE_ANTHROPIC_NATIVE flag-gated provider splice in
// config/agents/opencode.sh (Phase 82, Plan 05, WIRE-07 gap).
//
// Gap requirement:
//   a. With OPENCODE_ANTHROPIC_NATIVE unset, no provider entry is spliced.
//   b. With OPENCODE_ANTHROPIC_NATIVE=1, the rendered content is valid JSON containing
//      a provider.anthropic entry whose options include a baseURL pointing at the proxy
//      /v1 and headers carrying x-task-id and x-agent: opencode.
//
// UPDATED 2026-08-29. Five of these asserted on the network branch that
// `agent_pre_launch` no longer has: a public pin of `claude-opus-4-6` +
// disabled_providers:["copilot"], and an INSIDE_CN pin of
// `github-copilot-enterprise/claude-opus-4.6`. Both were deleted because both
// were dead — `opencode models` lists zero ids under either provider — and the
// public one was Anthropic DIRECT, the egress bypass T1-T4 closed. The tests
// went red asserting the presence of exactly what that change correctly removed.
//
// They are not deleted, they are re-aimed. Two things replace them:
//
//   * The default is now the bare `{}`, so `_oc_splice_config`'s empty-object
//     branch went from a latent edge case to the PRIMARY path. Before, every
//     caller inherited a non-empty object from the network branch, which is the
//     guarantee that kept the old inline `{frag,${cur#\{}` splice from emitting
//     a trailing comma. That guarantee is gone; the test for it is below.
//
//   * "No network branch may come back" is now itself an invariant worth
//     holding, so the two INSIDE_CN cases assert they render IDENTICALLY rather
//     than each asserting its own pin. A reintroduced branch fails that, which
//     is the actual thing to defend — a second routing mechanism that can
//     disagree with llm-routing.yaml.
//
// The model assertions move to CODING_OPENCODE_MODEL, which is the override
// that survived and the only way a model id reaches this blob today.
//
// Strategy: shell out to bash, stub _agent_log and validate_agent_connectivity (defined
// in launch-agent-common.sh, not in opencode.sh), source the script, call agent_pre_launch,
// and capture OPENCODE_CONFIG_CONTENT via printf. Environment variables are passed via
// spawnSync's env option to keep the test isolated from the host environment.
//
// Runner: node --test tests/agents/opencode-anthropic-native-splice.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OPENCODE_SH = path.resolve(REPO_ROOT, 'config', 'agents', 'opencode.sh');

/**
 * Sources config/agents/opencode.sh in a controlled bash subprocess, calls
 * agent_pre_launch, and returns the rendered OPENCODE_CONFIG_CONTENT string.
 *
 * Stubs _agent_log (no-op) and validate_agent_connectivity (returns 0) to satisfy
 * the calls inside agent_pre_launch without requiring launch-agent-common.sh.
 *
 * @param {object} [overrideEnv]  Shell env vars to inject (merged over minimal PATH/HOME).
 * @returns {string}  The rendered OPENCODE_CONFIG_CONTENT, without trailing newline.
 */
function renderOpenCodeConfigContent(overrideEnv = {}) {
  // Minimal bash script: stub helper functions, source opencode.sh, invoke the hook,
  // then emit the result with printf (no trailing newline, unlike echo).
  const script = `
_agent_log() { :; }
validate_agent_connectivity() { return 0; }
source "${OPENCODE_SH}"
agent_pre_launch
printf '%s' "$OPENCODE_CONFIG_CONTENT"
`;

  // --norc --noprofile is load-bearing, not tidiness. Passing a restricted `env`
  // is NOT sufficient isolation on its own: macOS /bin/bash sources ~/.bashrc even
  // for a non-interactive `bash -c`, so every variable the developer exports there
  // reappears inside the subprocess AFTER we chose what to pass. On this machine
  // ~/.bashrc:2 exports CODING_REPO, which switches on the wrapper-scoped plugin
  // splice further down agent_pre_launch and rewrites OPENCODE_CONFIG_CONTENT.
  //
  // That made the two default-blob assertions below pass or fail depending on whose
  // ~/.bashrc was in play — green on a clean machine, red here, for a reason the
  // diff ("unexpected plugin/compaction keys") pointed nowhere near. The env option
  // controls what goes IN; --norc controls what bash adds back.
  const result = spawnSync('bash', ['--norc', '--noprofile', '-c', script], {
    encoding: 'utf8',
    // Deliberately NOT spreading process.env so the subprocess only sees what we pass.
    // This prevents a host OPENCODE_ANTHROPIC_NATIVE=1 from contaminating the "unset" tests.
    env: {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/tmp',
      ...overrideEnv,
    },
    timeout: 10_000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `bash exited ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }

  return result.stdout;
}

// ---------------------------------------------------------------------------
// a. Default (OPENCODE_ANTHROPIC_NATIVE unset) — no provider entry
//
// CODING_REPO is unset in these (see renderOpenCodeConfigContent), so the
// wrapper-scoped plugin splice is inert and the blob is exactly what
// agent_pre_launch assigned before any splice ran.
// ---------------------------------------------------------------------------

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE unset → a provider block with band variants and nothing else', () => {
  // RE-AIMED 2026-08-30. This asserted `rendered === '{}'`, which stopped being
  // true when opencode gained a per-turn complexity band: `variants` on the
  // rapid-proxy models is spliced UNCONDITIONALLY, because it is what lets
  // `--variant cheap` reach routing as `reasoning_effort: low` -> band `small`.
  // Before it existed, fg-chat/opencode was `from-caller` with no caller, so
  // every turn fell to defaults.fg-chat (high) — 770 such rows since 2026-08-16.
  //
  // The guarantee worth keeping is NOT "the provider key never appears" but
  // "the anthropic-native opt-in stays opt-in", which is asserted below and in
  // the plugins case. The empty-object branch of _oc_splice_config is still
  // exercised — it is the branch this very splice takes first.
  const parsed = JSON.parse(renderOpenCodeConfigContent({ INSIDE_CN: 'false' }));
  assert.deepEqual(Object.keys(parsed), ['provider'],
    'with no model override and no plugins, the band variants must be the only content');
  assert.deepEqual(Object.keys(parsed.provider), ['rapid-proxy'],
    'no anthropic entry may appear while OPENCODE_ANTHROPIC_NATIVE is unset');
  for (const [id, model] of Object.entries(parsed.provider['rapid-proxy'].models)) {
    assert.deepEqual(Object.keys(model.variants), ['cheap', 'standard', 'deep'],
      `${id} must offer the three band variants`);
    assert.equal(model.variants.cheap.reasoningEffort, 'low',
      `${id}: cheap must map to the effort word EFFORT_TO_BAND reads as \`small\``);
  }
});

test('opencode.sh: no network branch — INSIDE_CN true and false render identically', () => {
  // The point of the assertion is the EQUALITY, not the value. A pin
  // reintroduced on either side of a network test fails here, which is the
  // regression this file now exists to catch: routing is decided in
  // llm-routing.yaml, and a branch here is a second mechanism that can silently
  // disagree with it. It did, for as long as it existed — naming a corporate
  // provider on VPN while fg-chat/opencode sent the same turns to gh-copilot.
  const publicBlob = renderOpenCodeConfigContent({ INSIDE_CN: 'false' });
  const vpnBlob = renderOpenCodeConfigContent({ INSIDE_CN: 'true' });
  assert.equal(vpnBlob, publicBlob,
    'opencode.sh must not branch on network; pi and copilot never have');
});

test('opencode.sh: CODING_OPENCODE_MODEL is the one way a model id reaches the blob', () => {
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    CODING_OPENCODE_MODEL: 'rapid-proxy/claude-sonnet-5',
  });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.model, 'rapid-proxy/claude-sonnet-5',
    'the explicit override must survive the splices that run after it');
  // RE-AIMED 2026-08-30 alongside the case above: the override is no longer the
  // WHOLE blob, because the band variants are spliced unconditionally. What must
  // still hold is that it is the only path by which a model id appears — a
  // network branch reintroducing a pin is the regression this file defends.
  assert.deepEqual(Object.keys(parsed).sort(), ['model', 'provider']);
  assert.deepEqual(Object.keys(parsed.provider), ['rapid-proxy']);
});

// ---------------------------------------------------------------------------
// b. OPENCODE_ANTHROPIC_NATIVE=1 — valid JSON with provider.anthropic entry
// ---------------------------------------------------------------------------

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE=1 → rendered OPENCODE_CONFIG_CONTENT is valid JSON', () => {
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    OPENCODE_ANTHROPIC_NATIVE: '1',
  });
  assert.doesNotThrow(
    () => JSON.parse(rendered),
    `rendered content must parse as JSON; got: ${rendered}`,
  );
});

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE=1 → provider.anthropic entry present with baseURL targeting proxy /v1', () => {
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    OPENCODE_ANTHROPIC_NATIVE: '1',
    LLM_CLI_PROXY_PORT: '12435',
  });
  const parsed = JSON.parse(rendered);
  assert.ok(parsed.provider?.anthropic, 'provider.anthropic key must be present in the spliced JSON');
  const opts = parsed.provider.anthropic.options;
  assert.ok(opts?.baseURL, 'options.baseURL must be set');
  assert.ok(
    opts.baseURL.endsWith('/v1'),
    `baseURL must target proxy /v1 root (the @ai-sdk/anthropic client appends /messages); got: ${opts.baseURL}`,
  );
  assert.ok(
    opts.baseURL.includes('12435'),
    `baseURL must use proxy port 12435; got: ${opts.baseURL}`,
  );
});

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE=1 → headers carry x-task-id (TASK_ID value) and x-agent: opencode', () => {
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    OPENCODE_ANTHROPIC_NATIVE: '1',
    TASK_ID: 'exp1--r0',
  });
  const parsed = JSON.parse(rendered);
  const headers = parsed.provider?.anthropic?.options?.headers;
  assert.ok(headers, 'options.headers object must be present');
  assert.equal(headers['x-agent'], 'opencode', 'x-agent header must be "opencode"');
  assert.ok('x-task-id' in headers, 'x-task-id header key must be present');
  assert.equal(headers['x-task-id'], 'exp1--r0', 'x-task-id value must equal $TASK_ID');
});

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE=1 on the bare {} → no trailing comma', () => {
  // The reason _oc_splice_config exists. The old inline splice was
  // `{${frag},${cur#\{}`, which is correct ONLY while `cur` is a non-empty
  // object — a guarantee the deleted network branch happened to provide. On `{}`
  // it yields `{frag,}`: invalid JSON, and opencode would refuse the config.
  //
  // That path is no longer an edge case, it is the DEFAULT: a session with no
  // CODING_OPENCODE_MODEL and no CODING_REPO splices the provider straight onto
  // `{}`. Asserted structurally rather than by byte-compare so the baseURL port
  // and TASK_ID stay free to vary.
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    OPENCODE_ANTHROPIC_NATIVE: '1',
  });
  assert.doesNotThrow(() => JSON.parse(rendered),
    `splicing onto the bare {} must not emit a trailing comma; got: ${rendered}`);
  assert.deepEqual(Object.keys(JSON.parse(rendered)), ['provider'],
    'the provider entry must be the only key when nothing else is spliced');
});

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE=1 → CODING_OPENCODE_MODEL survives the splice', () => {
  // Replaces the old network-pin assertion. The override is now the only source
  // of a model id here, and the splice must not eat it.
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    OPENCODE_ANTHROPIC_NATIVE: '1',
    CODING_OPENCODE_MODEL: 'rapid-proxy/claude-sonnet-5',
  });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.model, 'rapid-proxy/claude-sonnet-5', 'the override must survive the provider splice');
  assert.ok(parsed.provider?.anthropic, 'and the provider entry must still be there');
});

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE=1 → LLM_CLI_PROXY_PORT respected; custom port appears in baseURL', () => {
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    OPENCODE_ANTHROPIC_NATIVE: '1',
    LLM_CLI_PROXY_PORT: '19999',
  });
  const parsed = JSON.parse(rendered);
  const baseURL = parsed.provider?.anthropic?.options?.baseURL ?? '';
  assert.ok(
    baseURL.includes('19999'),
    `custom LLM_CLI_PROXY_PORT 19999 must appear in baseURL; got: ${baseURL}`,
  );
});

// ---------------------------------------------------------------------------
// c. Wrapper-scoped plugins present (CODING_REPO set) — the flag still adds nothing
//
// Every session started through `coding` runs with CODING_REPO set, so the plugin
// splice is ON and the blob is NOT the bare default. Section (a) deliberately turns
// that off to test one thing at a time, which would leave the real-world shape
// untested — and it was: the plugin splice landed in P2, silently broke (a)'s
// byte-identity, and nothing reported it because no runner executed this file.
//
// The invariant this file exists to protect is narrower than "the blob never
// changes": with OPENCODE_ANTHROPIC_NATIVE unset there must be NO provider entry,
// whatever else is legitimately spliced in. Asserting that directly means the next
// legitimate addition to the blob does not read as a regression here — which is
// exactly what saved these two when the network branch was deleted underneath
// them, while the five that named its pins went red.
// ---------------------------------------------------------------------------

test('opencode.sh: plugins spliced (CODING_REPO set) + flag unset → still no anthropic provider entry', () => {
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    CODING_REPO: REPO_ROOT,
  });
  const parsed = JSON.parse(rendered);

  // RE-AIMED 2026-08-30: was `'provider' in parsed === false`. The unconditional
  // band-variants splice puts a `provider` key there now, so the assertion moves
  // to the property that actually encodes "the opt-in is still opt-in".
  assert.equal(
    'anthropic' in (parsed.provider || {}), false,
    `no anthropic provider entry may be spliced while OPENCODE_ANTHROPIC_NATIVE is unset; got: ${rendered}`,
  );
  // Both splices ran and produced ONE valid object — the duplicate-"provider"-key
  // bug this arrangement was restructured to avoid would show up right here.
  assert.deepEqual(Object.keys(parsed.provider), ['rapid-proxy']);
  // And the splice must actually have happened, or this test proves nothing.
  assert.ok(Array.isArray(parsed.plugin) && parsed.plugin.length > 0,
    'precondition: CODING_REPO set must splice the wrapper-scoped plugins');
});

test('opencode.sh: all three splices coexist — plugins, provider and the model override', () => {
  // Both splices target the same `{`-prefix seam, so a regression in either one
  // silently drops the other. Valid JSON alone does not catch that. The model
  // override rides the same seam, which is why it is asserted here rather than
  // trusted from the single-splice case above.
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    CODING_REPO: REPO_ROOT,
    OPENCODE_ANTHROPIC_NATIVE: '1',
    CODING_OPENCODE_MODEL: 'rapid-proxy/claude-sonnet-5',
  });
  const parsed = JSON.parse(rendered);

  assert.ok(parsed.provider?.anthropic, 'provider.anthropic must survive alongside the plugin splice');
  assert.ok(Array.isArray(parsed.plugin) && parsed.plugin.length > 0,
    'plugins must survive alongside the provider splice');
  assert.equal(parsed.model, 'rapid-proxy/claude-sonnet-5', 'the model override must survive both splices');
  assert.equal(parsed.compaction?.reserved, 40000,
    'compaction.reserved rides the plugin splice and must survive too');
});
