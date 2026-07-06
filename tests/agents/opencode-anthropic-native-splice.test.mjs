// tests/agents/opencode-anthropic-native-splice.test.mjs
//
// Behavioral test for the OPENCODE_ANTHROPIC_NATIVE flag-gated provider splice in
// config/agents/opencode.sh (Phase 82, Plan 05, WIRE-07 gap).
//
// Gap requirement:
//   a. With OPENCODE_ANTHROPIC_NATIVE unset, OPENCODE_CONFIG_CONTENT is byte-identical
//      to the default blob (no provider entry, no behavioral change).
//   b. With OPENCODE_ANTHROPIC_NATIVE=1, the rendered content is valid JSON containing
//      a provider.anthropic entry whose options include a baseURL pointing at the proxy
//      /v1 and headers carrying x-task-id and x-agent: opencode.
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
const OPENCODE_SH = path.resolve(__dirname, '..', '..', 'config', 'agents', 'opencode.sh');

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

  const result = spawnSync('bash', ['-c', script], {
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
// a. Default (OPENCODE_ANTHROPIC_NATIVE unset) — byte-identical to original blob
// ---------------------------------------------------------------------------

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE unset (public branch) → OPENCODE_CONFIG_CONTENT equals default blob exactly', () => {
  // Public network branch: INSIDE_CN != "true"
  const expected = '{"model":"claude-opus-4-6","disabled_providers":["copilot"]}';
  const rendered = renderOpenCodeConfigContent({ INSIDE_CN: 'false' });
  assert.equal(rendered, expected,
    'default public blob must be byte-identical (no provider entry spliced in)');
});

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE unset (VPN branch) → OPENCODE_CONFIG_CONTENT equals default blob exactly', () => {
  // Corporate/VPN branch: INSIDE_CN = "true"
  const expected = '{"model":"github-copilot-enterprise/claude-opus-4.6","disabled_providers":["anthropic"]}';
  const rendered = renderOpenCodeConfigContent({ INSIDE_CN: 'true' });
  assert.equal(rendered, expected,
    'default VPN blob must be byte-identical (no provider entry spliced in)');
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

test('opencode.sh: OPENCODE_ANTHROPIC_NATIVE=1 → original model and disabled_providers are preserved after splice', () => {
  // The splice wraps the original JSON blob; model + disabled_providers must survive.
  const rendered = renderOpenCodeConfigContent({
    INSIDE_CN: 'false',
    OPENCODE_ANTHROPIC_NATIVE: '1',
  });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.model, 'claude-opus-4-6', 'original model must be preserved');
  assert.deepEqual(parsed.disabled_providers, ['copilot'], 'disabled_providers must be preserved');
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
