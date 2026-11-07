/**
 * Redaction effectiveness gate.
 *
 * tests/e2e/redaction-system.test.js is an executable harness (shebang, own
 * runner), so neither jest nor node:test collects it — it ran only when
 * someone remembered to, and had drifted to 4 failing checks, one of them a
 * plain API_KEY=… left unredacted. This suite runs it on every `npm test` and
 * in CI and fails on any failing check.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(REPO, 'tests', 'e2e', 'redaction-system.test.js');

test('every redaction-system check passes', async () => {
  let stdout = '';
  let code = 0;
  try {
    ({ stdout } = await exec(process.execPath, [HARNESS], { cwd: REPO, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    stdout = err.stdout || '';
    code = err.code ?? 1;
  }

  const failures = [...stdout.matchAll(/"error":\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.strictEqual(code, 0, `redaction harness failed:\n  ${failures.join('\n  ') || stdout.slice(-2000)}`);
});
