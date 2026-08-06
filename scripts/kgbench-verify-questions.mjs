#!/usr/bin/env node
/**
 * Verify a kgbench question set against the working tree.
 *
 *   kgbench-verify-questions.mjs [--set coding-v1]
 *
 * Ground truth rots. A question whose evidence file was renamed, or whose "correct"
 * answer was refactored away, silently starts scoring every arm as wrong — and the
 * benchmark reports that as a finding. This is the cheapest possible guard: pure file
 * reading, no services, no model calls, so it runs in lite CI on every change.
 *
 * Checks per question: shape (id/cls/prompt, a grader or a checklist, matchers on
 * every required fact), and that every provenance.evidence `path:line` still exists.
 *
 * Evidence under an uninitialised submodule is SKIPPED, not failed: CI checks out with
 * submodules:false and would otherwise fail for a reason unrelated to the question.
 * (The evaluation set avoids submodule evidence for exactly this reason.)
 *
 * Exit 0 clean, 1 with problems.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const out = (s) => console.log(s);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const QDIR = path.join(REPO, 'config/kgbench/questions');
const sets = opt('set', null)
  ? [opt('set', null)]
  : readdirSync(QDIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

const submoduleDirs = (() => {
  const f = path.join(REPO, '.gitmodules');
  if (!existsSync(f)) return [];
  return [...readFileSync(f, 'utf8').matchAll(/path\s*=\s*(.+)/g)].map((m) => m[1].trim());
})();
const inUninitialisedSubmodule = (rel) => {
  const sm = submoduleDirs.find((d) => rel === d || rel.startsWith(d + '/'));
  if (!sm) return false;
  try { return readdirSync(path.join(REPO, sm)).length === 0; } catch { return true; }
};

let problems = 0, checked = 0, skipped = 0;

for (const set of sets) {
  const file = path.join(QDIR, `${set}.json`);
  if (!existsSync(file)) { console.error(`missing set: ${file}`); problems++; continue; }
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const questions = doc.questions ?? doc;
  out(`\n${set}: ${questions.length} question(s)`);

  const ids = new Set();
  for (const q of questions) {
    const fail = (m) => { out(`  FAIL  ${q.id ?? '<no id>'}: ${m}`); problems++; };

    if (!q.id) { fail('missing id'); continue; }
    if (ids.has(q.id)) fail('duplicate id');
    ids.add(q.id);
    if (!q.cls) fail('missing cls');
    if (!q.prompt) fail('missing prompt');

    // Must be scoreable by something.
    const hasChecklist = Array.isArray(q.checklist) && q.checklist.length > 0;
    if (!hasChecklist && !q.grader) fail('has neither a checklist nor a grader');

    for (const f of q.checklist ?? []) {
      if (!f.id) fail('a checklist fact has no id');
      if (!f.match) fail(`fact ${f.id} has no matcher`);
    }
    for (const f of q.forbidden ?? []) {
      if (!f.match) fail(`forbidden ${f.id} has no matcher`);
    }
    // An abstain question without forbidden matchers cannot detect fabrication,
    // which is the only thing it is there to measure.
    if (q.cls === 'abstain' && !(q.forbidden ?? []).length) {
      fail('abstain question has no forbidden matchers — cannot detect fabrication');
    }

    for (const ev of q.provenance?.evidence ?? []) {
      const [rel, lineStr] = ev.split(':');
      if (inUninitialisedSubmodule(rel)) {
        out(`  skip  ${q.id}: ${ev} (uninitialised submodule)`);
        skipped++;
        continue;
      }
      const abs = path.join(REPO, rel);
      if (!existsSync(abs)) { fail(`evidence file missing: ${ev}`); continue; }
      if (lineStr) {
        const lines = readFileSync(abs, 'utf8').split('\n');
        const n = parseInt(lineStr, 10);
        if (!(n >= 1 && n <= lines.length)) fail(`evidence line out of range: ${ev} (file has ${lines.length})`);
      }
      checked++;
    }
  }
  const bad = problems;
  out(`  ${bad ? `${bad} problem(s)` : 'ok'}`);
}

out(`\n${checked} evidence reference(s) verified, ${skipped} skipped, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
