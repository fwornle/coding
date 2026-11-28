#!/usr/bin/env node
/**
 * coding releases — the installed releases of this machine (lib/install/layout.cjs).
 *
 *   coding releases [status] [--json]   channel, current version, installed releases
 *   coding releases list [--json]       installed release folders
 *   coding releases root                the code root to register daemons against
 *   coding releases use <version>       flip `current` to an installed release
 *   coding releases rollback            flip back to the previous release
 *   coding releases adopt <dir>         install an unpacked release tree (needs release.json)
 *   coding releases remove <version> [--force]
 *
 * Flipping changes which code the NEXT start runs. Running daemons keep the old
 * code until restarted: after `use`/`rollback`, run
 *   node scripts/apply-features.mjs   and restart the daemons (P4's `coding update`
 * does both).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// `… | head` closes the pipe early; that is the reader being done, not a failure.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});
const layout = require('../lib/install/layout.cjs');

const out = (s) => process.stdout.write(`${s}\n`);
const fail = (s) => {
  process.stderr.write(`coding releases: ${s}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const json = args.includes('--json');
const force = args.includes('--force');
const [verb = 'status', arg] = args.filter((a) => !a.startsWith('--'));

const RESTART_HINT =
  'Takes effect on the next start: run `node scripts/apply-features.mjs` and restart the daemons.';

function showStatus(s) {
  if (s.error) out(`install record: BROKEN — ${s.error}`);
  else {
    const i = s.install;
    out(`channel:  ${i.channel}${i.implicit ? ' (no install.json — this checkout)' : ''}`);
    out(`version:  ${i.version ?? '?'}`);
    if (i.source) out(`source:   ${i.source}`);
    if (i.previous) out(`previous: ${i.previous}  (coding releases rollback)`);
    out(`code root: ${s.codeRoot}`);
  }
  showList(s.releases);
}

function showList(list) {
  if (!list.length) return out('releases: none installed');
  out('releases:');
  for (const r of list) out(`  ${r.current ? '*' : ' '} ${r.version.padEnd(14)} ${r.complete ? '' : '(incomplete) '}${r.dir}`);
}

try {
  switch (verb) {
    case 'status': {
      const s = layout.status();
      if (json) out(JSON.stringify(s, null, 2));
      else showStatus(s);
      if (s.error) process.exit(1);
      break;
    }
    case 'list': {
      const list = layout.listReleases();
      if (json) out(JSON.stringify(list, null, 2));
      else showList(list);
      break;
    }
    case 'root':
      out(layout.codeRoot());
      break;
    case 'use': {
      if (!arg) fail('use <version>');
      const r = layout.activate(arg);
      out(r.from === r.to ? `already on ${r.to}` : `current: ${r.from ?? '(none)'} → ${r.to}`);
      out(RESTART_HINT);
      break;
    }
    case 'rollback': {
      const r = layout.rollback();
      out(`current: ${r.from} → ${r.to}`);
      out(RESTART_HINT);
      break;
    }
    case 'adopt': {
      if (!arg) fail('adopt <unpacked release dir>');
      const r = layout.adopt(arg);
      out(`installed ${r.version} at ${r.dir} (not active; \`coding releases use ${r.version}\`)`);
      break;
    }
    case 'remove': {
      if (!arg) fail('remove <version>');
      out(`removed ${layout.remove(arg, { force }).removed}`);
      break;
    }
    default:
      fail(`unknown verb '${verb}' (status|list|root|use|rollback|adopt|remove)`);
  }
} catch (err) {
  fail(err.message);
}
