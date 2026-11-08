/**
 * The CI constraint gate (scripts/guard-check-diff.mjs): rules on the files a
 * pushed range changed, counting only what the range added.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRange } from '../../scripts/guard-check-diff.mjs';

const BAD = ['Fixed', 'in 2026 by the team.'].join(' ');

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const g = (...a) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), `${BAD}\n`); // a legacy violation
  g('add', '-A');
  g('commit', '-qm', 'base');
  const commit = (files, msg = 'change') => {
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), text);
    }
    g('add', '-A');
    g('commit', '-qm', msg);
    return g('rev-parse', 'HEAD');
  };
  return { root, base: g('rev-parse', 'HEAD'), commit };
}

test('a violation the range adds is reported; legacy ones and clean files are not', async () => {
  const r = repo();
  const head = r.commit({ 'NOTES.md': `${BAD}\n`, 'README.md': `${BAD}\nMore text.\n`, 'ok.md': 'Plain.\n' });
  const f = await checkRange(r.base, head, r.root);
  assert.deepStrictEqual(f.map((x) => [x.path, x.rule, x.overridden]), [['NOTES.md', 'no-incremental-documentation', false]]);
});

test('a Constraint-Override trailer lets that rule through for that path only', async () => {
  const r = repo();
  const head = r.commit({ 'NOTES.md': `${BAD}\n`, 'OTHER.md': `${BAD}\n` },
    'docs: dated note\n\nConstraint-Override: no-incremental-documentation NOTES.md');
  const f = await checkRange(r.base, head, r.root);
  assert.deepStrictEqual(f.map((x) => [x.path, x.overridden]), [['NOTES.md', true], ['OTHER.md', false]]);
});

test('skill-required rules judge a session, not a commit, and are not applied', async () => {
  const r = repo();
  const head = r.commit({ 'docs/puml/x.puml': '@startuml x\n!include _standard-style.puml\nA -> B\n@enduml\n' });
  const f = await checkRange(r.base, head, r.root);
  assert.ok(!f.some((x) => /skill/.test(x.rule)), JSON.stringify(f));
});
