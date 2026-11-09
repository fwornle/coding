/**
 * bin/coding: claude, copilot and pi run in the agent box by default; `--no-box`
 * (or CODING_BOX=false) is the escape hatch, and launch-agent-common.sh records
 * it. opencode stays opt-in (its SQLite session store cannot be shared with the
 * box, so a boxed session would be invisible to session logging).
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

function decide({ agent, env = {}, source = '', constraints = true, showDefault = false }) {
  // SCRIPT_DIR points at a stub coding-features that answers for `constraints`.
  const stubDir = mkdtempSync(join(tmpdir(), 'box-default-'));
  writeFileSync(join(stubDir, 'coding-features'), `process.exit(${constraints ? 0 : 1});\n`);
  const script = `SCRIPT_DIR=${stubDir}; AGENT=${agent}; CODING_BOX_SOURCE=${source}\n${decisionBlock()}\necho "$CODING_BOX $CODING_BOX_SOURCE${showDefault ? ' $CODING_BOX_DEFAULT' : ''}"`;
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODING_BOX')));
  return execFileSync('bash', ['-c', script], { env: { ...clean, ...env }, encoding: 'utf8' }).trim();
}

describe('box mode default', () => {
  test('claude, copilot and pi → box, by default', () => {
    for (const agent of ['claude', 'copilot', 'pi']) assert.equal(decide({ agent }), 'true default', agent);
  });

  test('with the constraints feature off (harness tier, no Docker) every agent stays on the host', () => {
    for (const agent of ['claude', 'copilot', 'pi']) {
      assert.equal(decide({ agent, constraints: false }), 'false default', agent);
    }
  });

  test('opencode stays opt-in (its session store cannot be shared with the box)', () => {
    assert.equal(decide({ agent: 'opencode' }), 'false default');
    assert.equal(decide({ agent: 'opencode', env: { CODING_BOX: 'true' }, source: 'flag' }), 'true flag');
  });

  test('CODING_BOX_DEFAULT says what the default was, even when a flag overrides it', () => {
    assert.equal(decide({ agent: 'copilot', env: { CODING_BOX: 'false' }, source: 'flag', showDefault: true }), 'false flag true');
    assert.equal(decide({ agent: 'opencode', showDefault: true }), 'false default false');
    assert.equal(decide({ agent: 'pi', constraints: false, showDefault: true }), 'false default false');
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

  test('leaving the box where it is the default is recorded in the guard audit log', () => {
    const outside = LAUNCH.slice(LAUNCH.indexOf('Outside the box the agent runs as you'));
    assert.match(outside, /CODING_BOX_DEFAULT:-\}" = "true"[\s\S]*?coding-guard\.mjs" note box\.bypass/);
  });
});
