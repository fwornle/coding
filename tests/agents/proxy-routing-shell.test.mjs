// tests/agents/proxy-routing-shell.test.mjs
//
// The launcher evals what lib/agents/proxy-routing.mjs prints (toShell). A value
// that bash re-interprets — a quote, `$`, a backtick, a newline (claude's
// ANTHROPIC_CUSTOM_HEADERS is two lines) — must arrive byte-for-byte, and an
// abort must stop the launcher. Round-trips through real bash.
//
// Runner: node --test tests/agents/proxy-routing-shell.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { toShell, proxyRouting } from '../../lib/agents/proxy-routing.mjs';

// Evaluated exactly the way _coding_wiring does: `eval "$_wiring"`.
function evalInBash(shell, after = '') {
  const script = `_agent_log() { printf 'LOG:%s\\n' "$1"; }\nexport GONE=1\neval "$WIRING"\n${after}`;
  return spawnSync('bash', ['--norc', '--noprofile', '-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, WIRING: shell } });
}

test('values bash would re-interpret arrive verbatim', () => {
  const tricky = `it's "$HOME" \`id\` \\ and\nsecond line`;
  const r = evalInBash(toShell({ set: { V: tricky }, unset: ['GONE'], log: ["can't $stop"] }),
    'printf "%s" "$V" >&2; [ -z "${GONE+x}" ] && echo GONE-UNSET');
  assert.equal(r.stderr, tricky);
  assert.match(r.stdout, /^LOG:can't \$stop$/m);
  assert.match(r.stdout, /GONE-UNSET/);
});

test('an abort stops the launcher after its log lines', () => {
  const r = evalInBash(toShell({ log: ['down'], abort: true }), 'echo AFTER');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /LOG:down/);
  assert.doesNotMatch(r.stdout, /AFTER/);
});

test('hook locals are assigned, not exported', () => {
  const r = evalInBash(toShell({ vars: { _pi_cfg_dir: '/a b' } }), `echo "[$_pi_cfg_dir]"; env | grep -c '^_pi_cfg_dir=' || true`);
  assert.match(r.stdout, /\[\/a b\]\n0/);
});

test('the fail-closed abort names the restart command for each OS', async () => {
  const down = { probe: async () => false, tries: 1, retryDelayMs: 0 };
  const hint = async (platform) => (await proxyRouting('claude', { CODING_REPO: '/c' }, { ...down, platform }))
    .log.find((l) => l.includes('Fix:'));
  assert.match(await hint('darwin'), /launchctl kickstart -k gui\/\$\(id -u\)\/com\.coding\.llm-cli-proxy/);
  assert.match(await hint('linux'), /systemctl --user restart llm-cli-proxy .*bash \/c\/scripts\/llm-proxy-service\.sh &/);
  assert.match(await hint('win32'), /Fix:\s+bash \/c\/scripts\/llm-proxy-service\.sh &/);
});
