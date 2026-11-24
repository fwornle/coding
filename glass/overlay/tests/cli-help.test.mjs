/**
 * `--help` after a subcommand prints help and runs nothing. It used to be ignored:
 * `glass update --help` installed a release, `glass uninstall --help` stopped the
 * daemon and (with --yes) deleted GLASS_HOME.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { main, wantsHelp } = await import('../lib/glass/cli.mjs');

/** Run main() with GLASS_HOME/GLASS_PORT pointed away from the real install, capturing stdout. */
async function run(argv) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-help-'));
  fs.writeFileSync(path.join(home, 'keep'), 'x');
  const saved = { home: process.env.GLASS_HOME, port: process.env.GLASS_PORT };
  process.env.GLASS_HOME = home;
  process.env.GLASS_PORT = '1'; // nothing listens there: a daemon call would fail, not reach a real one
  const write = process.stdout.write;
  let stdout = '';
  process.stdout.write = (chunk) => { stdout += chunk; return true; };
  try {
    const code = await main(argv);
    return { code, stdout, homeKept: fs.existsSync(path.join(home, 'keep')) };
  } finally {
    process.stdout.write = write;
    for (const [k, v] of [['GLASS_HOME', saved.home], ['GLASS_PORT', saved.port]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('wantsHelp: --help or -h anywhere before --', () => {
  assert.equal(wantsHelp(['--help']), true);
  assert.equal(wantsHelp(['--check', '-h']), true);
  assert.equal(wantsHelp(['on', '--help']), true);
  assert.equal(wantsHelp([]), false);
  assert.equal(wantsHelp(['--check']), false);
  assert.equal(wantsHelp(['--', '-h']), false, 'after -- it is a value, not a flag');
});

test('uninstall --help --yes prints help and deletes nothing', async () => {
  const r = await run(['uninstall', '--help', '--yes']);
  assert.equal(r.code, 0);
  assert.equal(r.homeKept, true, 'GLASS_HOME must survive');
  assert.match(r.stdout, /glass uninstall/);
});

for (const argv of [['update', '--help'], ['update', '-h'], ['stop', '--help'], ['job-classes', 'on', '--help']]) {
  test(`${argv.join(' ')} prints help and returns 0`, async () => {
    const r = await run(argv);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^glass \d+\.\d+\.\d+ — /);
  });
}

test('ab --help prints the ab help, not the general one', async () => {
  const r = await run(['ab', 'run', '--help']);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /^glass \d+\.\d+\.\d+ — token measurement/);
  assert.match(r.stdout, /ab/);
});
