#!/usr/bin/env node
/**
 * coding update — install the latest release and switch to it (lib/install/update.mjs).
 *
 *   coding update             download, verify, install beside, switch, restart
 *   coding update --check     report whether a newer release exists; install nothing
 *   coding update --rollback  switch back to the previous release and restart
 *   coding update --pull      on a development checkout: git pull + submodule update
 */
import { update } from '../lib/install/update.mjs';

// `… | head` closes the pipe early; that is the reader being done, not a failure.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const args = process.argv.slice(2);
const known = new Set(['--check', '--rollback', '--pull']);
const bad = args.filter((a) => !known.has(a));
if (bad.length) {
  process.stderr.write(`coding update: unknown option ${bad.join(' ')} (--check | --rollback | --pull)\n`);
  process.exit(2);
}
const code = await update({
  check: args.includes('--check'),
  rollback: args.includes('--rollback'),
  pull: args.includes('--pull'),
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
});
process.exit(code);
