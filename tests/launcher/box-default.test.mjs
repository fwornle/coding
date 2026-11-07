/**
 * bin/coding: Claude runs in the agent box by default; `--no-box` (or
 * CODING_BOX=false) is the escape hatch, and launch-agent-common.sh records it.
 * The other agents stay opt-in until their guard is wired into the box.
 *
 * The decision block is sliced out of bin/coding and evaluated in bash, so the
 * test runs the launcher's own lines rather than a restatement of them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = readFileSync(join(REPO, 'bin/coding'), 'utf8');
const LAUNCH = readFileSync(join(REPO, 'scripts/launch-agent-common.sh'), 'utf8');

function decisionBlock() {
  const start = SOURCE.indexOf('# Box mode.');
  const end = SOURCE.indexOf('export CODING_BOX_SOURCE', start);
  assert.ok(start !== -1 && end !== -1, 'bin/coding no longer has the box-mode block');
  return SOURCE.slice(start, end + 'export CODING_BOX_SOURCE'.length);
}

function decide({ agent, env = {}, source = '', constraints = true }) {
  // SCRIPT_DIR points at a stub coding-features that answers for `constraints`.
  const stubDir = mkdtempSync(join(tmpdir(), 'box-default-'));
  writeFileSync(join(stubDir, 'coding-features'), `process.exit(${constraints ? 0 : 1});\n`);
  const script = `SCRIPT_DIR=${stubDir}; AGENT=${agent}; CODING_BOX_SOURCE=${source}\n${decisionBlock()}\necho "$CODING_BOX $CODING_BOX_SOURCE"`;
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODING_BOX')));
  return execFileSync('bash', ['-c', script], { env: { ...clean, ...env }, encoding: 'utf8' }).trim();
}

describe('box mode default', () => {
  test('claude → box, by default', () => {
    assert.equal(decide({ agent: 'claude' }), 'true default');
  });

  test('with the constraints feature off (harness tier, no Docker) claude stays on the host', () => {
    assert.equal(decide({ agent: 'claude', constraints: false }), 'false default');
  });

  test('other agents stay opt-in', () => {
    for (const agent of ['copilot', 'opencode', 'pi']) assert.equal(decide({ agent }), 'false default', agent);
  });

  test('a flag wins over the default (--no-box / --box set CODING_BOX + source=flag)', () => {
    assert.equal(decide({ agent: 'claude', env: { CODING_BOX: 'false' }, source: 'flag' }), 'false flag');
    assert.equal(decide({ agent: 'pi', env: { CODING_BOX: 'true' }, source: 'flag' }), 'true flag');
  });

  test('CODING_BOX from the environment is honoured and marked as such', () => {
    assert.equal(decide({ agent: 'claude', env: { CODING_BOX: 'false' } }), 'false env');
  });

  test('--no-box is a parsed flag', () => {
    assert.match(SOURCE, /--no-box\)\n[\s\S]*?export CODING_BOX=false/);
  });

  test('leaving the box for claude is recorded in the guard audit log', () => {
    const outside = LAUNCH.slice(LAUNCH.indexOf('Outside the box the agent runs as you'));
    assert.match(outside, /coding-guard\.mjs" note box\.bypass/);
  });
});
