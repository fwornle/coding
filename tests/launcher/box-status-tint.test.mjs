/**
 * A boxed session must be recognisable from its status bar alone: the wrapper
 * tints `status-style` when the launcher chose the box, and resets it to
 * default otherwise — including inside an existing tmux session, where a
 * previous boxed launch would otherwise leave its tint behind.
 *
 * The real wrapper runs against a stub `tmux` on PATH that records its
 * arguments, through the "already inside tmux" path, with `true` as the agent
 * command. No tmux server is needed, so this runs in the box and on CI too.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = join(REPO, 'scripts', 'tmux-session-wrapper.sh');

/** Run the wrapper with `env` overrides; return the status-style it set. */
function statusStyleFor(env) {
  const dir = mkdtempSync(join(tmpdir(), 'box-tint-'));
  const log = join(dir, 'tmux.log');
  const stub = join(dir, 'tmux');
  writeFileSync(stub, `#!/bin/bash\nprintf '%s\\n' "$*" >> '${log}'\n[ "$1" = display-message ] && echo test-session\nexit 0\n`);
  chmodSync(stub, 0o755);

  const res = spawnSync('bash', ['-c', `source '${WRAPPER}'; tmux_session_wrapper true`], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      TMUX: '/tmp/fake,1,0',
      CODING_REPO: dir,
      CODING_AGENT: 'claude',
      HEALTH_COORDINATOR_URL: 'http://127.0.0.1:9',
      ...env,
    },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(log), 'the stub tmux was never called');
  const line = readFileSync(log, 'utf8').split('\n').find((l) => l.includes(' status-style '));
  assert.ok(line, 'the wrapper did not set status-style');
  return line.split(' status-style ')[1];
}

describe('boxed sessions get a tinted status bar', () => {
  test('box launch (CODING_BOX=true) tints the bar, fg set with bg', () => {
    assert.equal(statusStyleFor({ CODING_BOX: 'true' }), 'bg=#0f3a57,fg=colour255');
  });

  test('strict box (CODING_BOX_STRICT=true) gets the green tint instead', () => {
    assert.equal(statusStyleFor({ CODING_BOX: 'true', CODING_BOX_STRICT: 'true' }), 'bg=#1b4d2e,fg=colour255');
    assert.equal(statusStyleFor({ CODING_BOX: 'true', CODING_BOX_STRICT: 'false' }), 'bg=#0f3a57,fg=colour255');
  });

  test('CODING_BOX_STRICT without the box is still a host session', () => {
    assert.equal(statusStyleFor({ CODING_BOX: 'false', CODING_BOX_STRICT: 'true' }), 'bg=default,fg=default');
  });

  test('CODING_BOX_STRICT_STATUS_STYLE overrides only the strict tint', () => {
    const style = 'bg=colour22,fg=colour255';
    const env = { CODING_BOX_STRICT_STATUS_STYLE: style };
    assert.equal(statusStyleFor({ ...env, CODING_BOX: 'true', CODING_BOX_STRICT: 'true' }), style);
    assert.equal(statusStyleFor({ ...env, CODING_BOX: 'true' }), 'bg=#0f3a57,fg=colour255');
  });

  test('host launch resets the bar to default', () => {
    assert.equal(statusStyleFor({ CODING_BOX: 'false' }), 'bg=default,fg=default');
    assert.equal(statusStyleFor({}), 'bg=default,fg=default');
  });

  test('CODING_BOX_STATUS_STYLE overrides the tint, but only for boxed sessions', () => {
    const style = 'bg=colour17,fg=colour250';
    assert.equal(statusStyleFor({ CODING_BOX: 'true', CODING_BOX_STATUS_STYLE: style }), style);
    assert.equal(statusStyleFor({ CODING_BOX: 'false', CODING_BOX_STATUS_STYLE: style }), 'bg=default,fg=default');
  });
});
