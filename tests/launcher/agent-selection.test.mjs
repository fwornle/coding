/**
 * bin/coding: the agent is chosen by a bare word (`coding pi`) or a flag
 * (`coding --pi`), and plain `coding` launches claude.
 *
 * The parse loop and the agent-default block are sliced out of bin/coding and
 * evaluated in bash, so the test runs the launcher's own lines rather than a
 * restatement of them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = readFileSync(join(REPO, 'bin/coding'), 'utf8');

function slice(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start);
  assert.ok(start !== -1 && end !== -1, `bin/coding no longer has "${startMarker}" … "${endMarker}"`);
  return SOURCE.slice(start, end);
}

const PARSE = slice('# Parse arguments', '# Script directory already defined above');
const DEFAULT = slice('# Use forced agent if specified', '# Box mode.');

/** Run the launcher's parsing + default on `argv`; returns { agent, args }. */
function select(...argv) {
  const script = [
    `SCRIPT_DIR=${JSON.stringify(join(REPO, 'bin'))}`,
    'FORCE_AGENT=""; ARGS=()',
    'log() { :; }; error() { echo "ERR $*"; exit 1; }; show_help() { :; }',
    PARSE,
    DEFAULT,
    'printf "%s\\n" "$AGENT" "${ARGS[*]}"',
  ].join('\n');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODING_BOX')));
  const out = execFileSync('bash', ['-c', script, 'coding', ...argv], { env: clean, encoding: 'utf8' });
  const [agent, args = ''] = out.replace(/\n$/, '').split('\n');
  return { agent, args };
}

const AGENTS = ['claude', 'copilot', 'opencode', 'pi'];

describe('agent selection', () => {
  test('plain `coding` launches claude', () => {
    assert.deepEqual(select(), { agent: 'claude', args: '' });
  });

  test('every agent can be named by a bare word', () => {
    for (const a of AGENTS) assert.deepEqual(select(a), { agent: a, args: '' }, a);
  });

  test('the --flags still work', () => {
    for (const a of AGENTS) assert.deepEqual(select(`--${a}`), { agent: a, args: '' }, a);
    assert.equal(select('--copi').agent, 'copilot');
    assert.equal(select('--agent', 'pi').agent, 'pi');
  });

  test('a bare word after other options still selects the agent', () => {
    assert.equal(select('--box', 'pi').agent, 'pi');
    assert.equal(select('--project', '/tmp', 'opencode').agent, 'opencode');
  });

  test('only the first positional word selects; later ones reach the agent', () => {
    assert.deepEqual(select('claude', 'explain', 'pi'), { agent: 'claude', args: 'explain pi' });
    assert.deepEqual(select('suggest', 'pi'), { agent: 'claude', args: 'suggest pi' });
    assert.deepEqual(select('--copilot', 'opencode'), { agent: 'copilot', args: 'opencode' });
  });

  test('a word with no config/agents/<word>.sh is an agent argument, not an agent', () => {
    assert.deepEqual(select('nosuchagent'), { agent: 'claude', args: 'nosuchagent' });
  });
});
